'use client';

import Link from 'next/link';
import { mostrarContacto } from '@/lib/whatsapp/contact-identity';
import { resumirMensaje } from '@/lib/whatsapp/message-preview';
import { etiquetaDeFecha } from '@/lib/chat/fechas';
import { usePathname } from 'next/navigation';
import { ChatCircleDots, Funnel, MagnifyingGlass, X, Checks } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface WhatsAppLine {
  line_key: string;
  display_name: string;
  phone_number?: string | null;
}

/**
 * Un color por línea, con su versión de etiqueta.
 *
 * Antes solo existía el punto de 6 px: con dos líneas se toleraba, con las 8
 * previstas es indescifrable — nadie recuerda que el cian es la línea 4. Ahora
 * el nombre de la línea va escrito al lado del color.
 *
 * Clases completas y no interpoladas: Tailwind necesita verlas literales.
 */
const LINE_COLORS = [
  'bg-pink-500', 'bg-violet-500', 'bg-indigo-500',
  'bg-cyan-500', 'bg-teal-500', 'bg-lime-500',
  'bg-yellow-500', 'bg-orange-500'
];

const LINE_CHIPS = [
  'bg-pink-500/15 text-pink-300 border-pink-500/30',
  'bg-violet-500/15 text-violet-300 border-violet-500/30',
  'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  'bg-teal-500/15 text-teal-300 border-teal-500/30',
  'bg-lime-500/15 text-lime-300 border-lime-500/30',
  'bg-yellow-500/15 text-yellow-300 border-yellow-500/30',
  'bg-orange-500/15 text-orange-300 border-orange-500/30',
];

/**
 * Etapas del pipeline, con su color y su nombre en castellano.
 *
 * ANTES esto era un punto de 8 px en la esquina derecha de la fila, y el dueño
 * lo reportó el 01-ago-2026: un cliente listo para comprar y uno molesto se
 * distinguían por un puntito que pasa desapercibido. En una bandeja con
 * decenas de chats, atender a un cliente enfadado creyendo que es uno nuevo es
 * un problema serio, y el panel no ayudaba a evitarlo.
 *
 * Ahora el color viste el círculo del contacto entero y va acompañado de su
 * nombre escrito: el color solo no basta — se pierde en una lista larga y no
 * sirve para quien no distingue bien los colores.
 *
 * Las clases van completas y no interpoladas porque Tailwind necesita verlas
 * literales para incluirlas en el CSS final.
 */
const ETAPAS: Record<string, { nombre: string; avatar: string; etiqueta: string; barra: string }> = {
  unhandled: {
    nombre: 'Sin atender',
    avatar: 'bg-orange-500/25 text-orange-200 ring-2 ring-orange-400',
    etiqueta: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
    barra: 'bg-orange-400',
  },
  sales: {
    nombre: 'Negociando',
    avatar: 'bg-blue-500/25 text-blue-200 ring-2 ring-blue-400',
    etiqueta: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
    barra: 'bg-blue-400',
  },
  sold: {
    nombre: 'Listo para pagar',
    avatar: 'bg-emerald-500/30 text-emerald-100 ring-2 ring-emerald-400',
    etiqueta: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
    barra: 'bg-emerald-400',
  },
  angry: {
    nombre: 'Molesto',
    avatar: 'bg-rose-500/25 text-rose-200 ring-2 ring-rose-400',
    etiqueta: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    barra: 'bg-rose-400',
  },
  ignore: {
    nombre: 'Ignorar',
    avatar: 'bg-purple-500/25 text-purple-200 ring-2 ring-purple-400',
    etiqueta: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
    barra: 'bg-purple-400',
  },
};

/** El último mensaje del chat, para el renglón de vista previa de la lista. */
export interface UltimoMensaje {
  content: string | null;
  raw: unknown;
  direction: 'inbound' | 'outbound';
}

interface ConversationItem {
  id: string;
  bot_active: boolean;
  last_message_at: string;
  line_key?: string | null;
  /** Lo llena la página; si falta, la fila cae al teléfono, nunca a un texto inventado. */
  ultimo_mensaje?: UltimoMensaje | null;
  contacts: {
    full_name: string | null;
    wa_phone: string;
    // El telefono real cuando `wa_phone` es un `@lid`. Ver mostrarContacto().
    metadata?: Record<string, unknown> | null;
  } | null;
}

export function ConversationList({
  list,
  accionesMovil,
}: {
  list: ConversationItem[];
  /**
   * Lo que va a la derecha del título "Chats", solo en teléfono.
   * Sirve para meter la campana de avisos DENTRO de la cabecera de la lista:
   * antes tenía una banda propia de unos 50 px en la que no había nada más, y
   * en un teléfono eso es casi una fila de chat desperdiciada.
   */
  accionesMovil?: React.ReactNode;
}) {
  const pathname = usePathname();
  const [conversations, setConversations] = useState(list);
  const [lines, setLines] = useState<WhatsAppLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<string>('Todas');
  // Buscador: solo en teléfono. En una lista larga, encontrar a un cliente
  // desplazando con el pulgar es justo lo que hacía inmanejable esta pantalla.
  const [busqueda, setBusqueda] = useState('');
  const supabase = createClient();

  useEffect(() => {
    const fetchLines = async () => {
      const { data } = await (supabase as any).from('whatsapp_lines').select('line_key, display_name, phone_number').order('created_at');
      if (data) setLines(data);
    };
    fetchLines();
    const saved = localStorage.getItem('kb_selected_line');
    if (saved) setSelectedLine(saved);
  }, [supabase]);

  // Sync when parent prop changes (navigation between chats)
  useEffect(() => {
    setConversations(list);
  }, [list]);

  // Real-time: auto-update sidebar when new messages arrive or new conversations created
  useEffect(() => {
    const channel = supabase
      .channel('sidebar_realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversations' },
        async (payload) => {
          // New conversation from a new client — fetch full data with contact info
          const { data } = await supabase
            .from('conversations')
            .select('id, bot_active, last_message_at, line_key, contacts(full_name, wa_phone, metadata)')
            .eq('id', payload.new.id)
            .single();
          if (data) {
            const newConv = data as unknown as ConversationItem;
            setConversations((prev) => {
              // Avoid duplicates
              if (prev.some((c) => c.id === newConv.id)) return prev;
              return [newConv, ...prev];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const convId = payload.new.conversation_id;
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c.id === convId);
            if (idx === -1) return prev;
            const updated = {
              ...prev[idx],
              last_message_at: payload.new.created_at,
              // La vista previa se mueve con el mensaje que acaba de llegar; si
              // no, la fila sube al tope mostrando todavía el mensaje anterior.
              ultimo_mensaje: {
                content: payload.new.content ?? null,
                raw: payload.new.raw ?? null,
                direction: payload.new.direction,
              },
            };
            const rest = prev.filter((c) => c.id !== convId);
            return [updated, ...rest]; // bubble to top
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations' },
        (payload) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === payload.new.id
                ? { ...c, bot_active: payload.new.bot_active, last_message_at: payload.new.last_message_at }
                : c
            )
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'contacts' },
        (payload) => {
          setConversations((prev) =>
            prev.map((c) =>
              c.contacts && (c.contacts as any).id === payload.new.id
                ? { ...c, contacts: { ...c.contacts, ...payload.new } }
                : c
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return conversations
      .filter((c) => selectedLine === 'Todas' || c.line_key === selectedLine)
      .filter((c) => {
        if (!texto) return true;
        const { nombre, telefono } = mostrarContacto(c.contacts as any);
        return `${nombre} ${telefono}`.toLowerCase().includes(texto);
      });
  }, [conversations, selectedLine, busqueda]);

  return (
    <div className="flex flex-1 min-h-0 flex-col lg:h-full">
      {/* Cabecera: no se desplaza, es hermana de la lista y no parte de ella. */}
      <div className="lista-cabecera px-3 py-2.5 lg:p-4 lg:border-b lg:border-white/5 space-y-2.5 lg:space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[20px] lg:text-sm font-medium lg:font-semibold text-white">
            <span className="lg:hidden">Chats</span>
            <span className="hidden lg:inline">Chat Recientes</span>
          </h2>
          {accionesMovil && <div className="lg:hidden shrink-0">{accionesMovil}</div>}
        </div>

        {/* Buscador — solo teléfono. `text-base` son 16 px exactos: por debajo de
            eso Safari de iPhone hace zoom solo al enfocar y descuadra la lista. */}
        <div className="lg:hidden relative">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar un cliente"
            aria-label="Buscar un cliente por nombre o teléfono"
            className="w-full text-base rounded-full bg-slate-900/70 border border-white/10 py-2.5 pl-9 pr-9 text-white outline-none focus:border-primary-500/60 placeholder:text-slate-500"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda('')}
              aria-label="Borrar la búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-slate-400 active:bg-white/10"
            >
              <X size={14} weight="bold" />
            </button>
          )}
        </div>

        {lines.length > 0 && (
          <>
            {/* Teléfono: fichas que se tocan con el pulgar, con el MISMO color que
                lleva cada línea en su etiqueta dentro de la fila. El desplegable
                nativo obliga a abrir un menú y apuntar a un renglón de 20 px. */}
            <div className="lg:hidden -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedLine('Todas');
                  localStorage.setItem('kb_selected_line', 'Todas');
                }}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  selectedLine === 'Todas'
                    ? 'bg-primary-600/30 text-primary-200 border-primary-500/40'
                    : 'bg-slate-900/60 text-slate-400 border-white/5'
                }`}
              >
                Todas
              </button>
              {lines.map((linea, idx) => (
                <button
                  key={linea.line_key}
                  type="button"
                  onClick={() => {
                    setSelectedLine(linea.line_key);
                    localStorage.setItem('kb_selected_line', linea.line_key);
                  }}
                  className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    selectedLine === linea.line_key
                      ? LINE_CHIPS[idx % LINE_CHIPS.length]
                      : 'bg-slate-900/60 text-slate-400 border-white/5'
                  }`}
                >
                  {linea.display_name}
                </button>
              ))}
            </div>

            {/* Escritorio: el desplegable de siempre, sin cambios. */}
            <div className="hidden lg:flex items-center gap-2 bg-slate-900/50 p-1.5 rounded-lg border border-white/5">
              <Funnel size={14} className="text-slate-400 ml-1" />
              <select
                value={selectedLine}
                onChange={(e) => {
                  setSelectedLine(e.target.value);
                  localStorage.setItem('kb_selected_line', e.target.value);
                }}
                className="bg-transparent text-xs text-slate-300 outline-none w-full cursor-pointer"
              >
                <option value="Todas" className="bg-slate-900">Todas las líneas</option>
                {lines.map(line => (
                  <option key={line.line_key} value={line.line_key} className="bg-slate-900">
                    {line.display_name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {/* La ÚNICA zona que se desplaza, en teléfono y en escritorio. Antes en
          teléfono había dos scrolls anidados — el de la página y el de esta
          caja — y el dedo arrastraba el equivocado. */}
      <div className="lista-scroll flex-1 min-h-0 overflow-y-auto lg:p-2 lg:space-y-1">
        {visibles.length > 0 ? (
          visibles.map((conv) => {
            const isActive = pathname.includes(conv.id);
            const contact = conv.contacts;
            // Misma regla de presentacion que el resto del panel.
            const { nombre: name, telefono } = mostrarContacto(contact as any);

            const etapaId = (contact as any)?.metadata?.stage;
            const etapa = etapaId && etapaId !== 'inbox' ? ETAPAS[etapaId] : undefined;

            const idxLinea = lines.findIndex((l) => l.line_key === conv.line_key);
            const linea = idxLinea >= 0 ? lines[idxLinea] : undefined;

            const resumen = resumirMensaje(conv.ultimo_mensaje as any);
            const esMio = conv.ultimo_mensaje?.direction === 'outbound';

            return (
              /*
                * prefetch={false}: sin esto el sistema PRECARGA la pagina de
                * cada chat en cuanto su fila aparece en pantalla. La lista
                * pinta las 149 conversaciones sin tope, asi que bajar por ella
                * disparaba decenas de paginas completas del servidor -dos
                * consultas cada una- que nadie pidio.
                *
                * Se vio en la consola del dueno el 04-ago-2026, cuatro
                * seguidas: «conversaciones/4160e410...?_rsc=», y ese _rsc es
                * justamente la marca de una precarga.
                *
                * Abrir un chat cuesta 0,30 s medidos: no hace falta adelantarlo,
                * y menos multiplicado por 149.
                */
              <Link
                key={conv.id}
                prefetch={false}
                href={`/conversaciones/${conv.id}`}
                className={`
                  chat-fila relative overflow-hidden
                  lg:flex lg:items-center lg:justify-between lg:gap-0 lg:p-3 lg:pl-4 lg:min-h-0
                  lg:rounded-xl lg:transition-all
                  ${isActive ? 'bg-primary-600/20 lg:border lg:border-primary-500/30' : 'lg:hover:bg-white/5'}
                `}
                suppressHydrationWarning
              >
                {/* Franja de color a lo largo de toda la fila: se ve incluso
                    recorriendo la lista de un vistazo, sin leer nada. */}
                {etapa && (
                  <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${etapa.barra}`} aria-hidden />
                )}

                <div className="flex items-center gap-3 overflow-hidden flex-1 min-w-0">
                  {/* Avatar: 52 px en teléfono (lo que mide en WhatsApp), 40 en
                      escritorio. El aro de color dice la etapa sin leer. */}
                  <div
                    className={`w-[52px] h-[52px] lg:w-10 lg:h-10 rounded-full flex items-center justify-center shrink-0 font-semibold text-lg lg:text-base ${
                      etapa ? etapa.avatar : 'bg-slate-800 text-slate-400'
                    }`}
                    title={etapa ? `Etapa: ${etapa.nombre}` : undefined}
                    suppressHydrationWarning
                  >
                    {Array.from(name)[0]?.toUpperCase()}
                  </div>

                  <div className="flex flex-col overflow-hidden flex-1 min-w-0 gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-base lg:text-sm font-medium text-slate-100 lg:text-slate-200 truncate"
                        suppressHydrationWarning
                      >
                        {name}
                      </span>
                      {linea && (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 ${
                            LINE_CHIPS[idxLinea % LINE_CHIPS.length]
                          }`}
                          title={
                            linea.phone_number
                              ? `Escribió a ${linea.display_name} · ${linea.phone_number}`
                              : `Escribió a ${linea.display_name}`
                          }
                        >
                          {linea.display_name}
                        </span>
                      )}
                    </div>

                    {/* Teléfono: el último mensaje, que es lo que uno lee para
                        decidir si entra. Si no hay, el número del contacto —
                        nunca un texto de relleno. */}
                    <div className="lg:hidden flex items-center gap-1 text-[13px] text-slate-400 min-w-0">
                      {resumen ? (
                        <>
                          {esMio && <Checks size={14} className="shrink-0 text-slate-500" />}
                          {resumen.icono && <span className="shrink-0">{resumen.icono}</span>}
                          <span className="truncate">{resumen.texto}</span>
                        </>
                      ) : (
                        <span className="truncate text-slate-500" suppressHydrationWarning>
                          {telefono || 'Sin mensajes todavía'}
                        </span>
                      )}
                    </div>

                    {/* Escritorio: teléfono y hora, como estaba. */}
                    <div className="hidden lg:flex items-center gap-1.5 text-[10px] text-slate-500">
                      {telefono && (
                        <>
                          <span suppressHydrationWarning>{telefono}</span>
                          <span>•</span>
                        </>
                      )}
                      <span suppressHydrationWarning>
                        {new Date(conv.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1 lg:gap-2 shrink-0 pl-2">
                  {/* Teléfono: la hora arriba a la derecha, como en la app. */}
                  <span className="lg:hidden text-[11px] text-slate-500 capitalize" suppressHydrationWarning>
                    {etiquetaDeFecha(conv.last_message_at)}
                  </span>

                  {/* Status Badge */}
                  {conv.bot_active ? (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-0.5">
                      🤖 IA
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center gap-0.5">
                      👤 Humano
                    </span>
                  )}

                  {/* Etapa del pipeline, escrita. El color solo no basta. */}
                  {etapa && (
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${etapa.etiqueta}`}
                    >
                      {etapa.nombre}
                    </span>
                  )}
                </div>
              </Link>
            );
          })
        ) : (
          <div className="text-center py-8 text-slate-500 flex flex-col items-center">
            <ChatCircleDots size={32} className="opacity-20 mb-2" />
            <span className="text-xs">
              {busqueda.trim() ? `Ningún chat coincide con "${busqueda.trim()}"` : 'No hay conversaciones activas'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
