'use client';

import Link from 'next/link';
import { mostrarContacto } from '@/lib/whatsapp/contact-identity';
import { usePathname } from 'next/navigation';
import { ChatCircleDots, Funnel } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface WhatsAppLine {
  line_key: string;
  display_name: string;
}

const LINE_COLORS = [
  'bg-pink-500', 'bg-violet-500', 'bg-indigo-500', 
  'bg-cyan-500', 'bg-teal-500', 'bg-lime-500', 
  'bg-yellow-500', 'bg-orange-500'
];

interface ConversationItem {
  id: string;
  bot_active: boolean;
  last_message_at: string;
  line_key?: string | null;
  contacts: {
    full_name: string | null;
    wa_phone: string;
    // El telefono real cuando `wa_phone` es un `@lid`. Ver mostrarContacto().
    metadata?: Record<string, unknown> | null;
  } | null;
}

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
    avatar: 'bg-rose-600/35 text-rose-100 ring-2 ring-rose-400',
    etiqueta: 'bg-rose-500/20 text-rose-200 border-rose-500/50',
    barra: 'bg-rose-500',
  },
  ignore: {
    nombre: 'Ignorar',
    avatar: 'bg-purple-500/25 text-purple-200 ring-2 ring-purple-400',
    etiqueta: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
    barra: 'bg-purple-400',
  },
};

export function ConversationList({ list }: { list: ConversationItem[] }) {
  const pathname = usePathname();
  const [conversations, setConversations] = useState(list);
  const [lines, setLines] = useState<WhatsAppLine[]>([]);
  const [selectedLine, setSelectedLine] = useState<string>('Todas');
  const supabase = createClient();

  useEffect(() => {
    const fetchLines = async () => {
      const { data } = await (supabase as any).from('whatsapp_lines').select('line_key, display_name').order('created_at');
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
            const updated = { ...prev[idx], last_message_at: payload.new.created_at };
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

  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-white/5 space-y-3">
        <h2 className="text-sm font-semibold text-white">Chat Recientes</h2>
        
        {lines.length > 0 && (
          <div className="flex items-center gap-2 bg-slate-900/50 p-1.5 rounded-lg border border-white/5">
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
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {conversations.filter(c => selectedLine === 'Todas' || c.line_key === selectedLine).length > 0 ? (
          conversations.filter(c => selectedLine === 'Todas' || c.line_key === selectedLine).map((conv) => {
            const isActive = pathname.includes(conv.id);
            const contact = conv.contacts;
            // Misma regla de presentacion que el resto del panel.
            const { nombre: name, telefono } = mostrarContacto(contact as any);

            const etapaId = (contact as any)?.metadata?.stage;
            const etapa = etapaId && etapaId !== 'inbox' ? ETAPAS[etapaId] : undefined;

            return (
              <Link
                key={conv.id}
                href={`/conversaciones/${conv.id}`}
                className={`
                  relative overflow-hidden flex items-center justify-between p-3 pl-4 rounded-xl transition-all text-decoration-none
                  ${isActive ? 'bg-primary-600/20 border border-primary-500/30' : 'hover:bg-white/5'}
                `}
                suppressHydrationWarning
              >
                {/* Franja de color a lo largo de toda la fila: se ve incluso
                    recorriendo la lista de un vistazo, sin leer nada. */}
                {etapa && (
                  <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${etapa.barra}`} aria-hidden />
                )}

                <div className="flex items-center gap-3 overflow-hidden">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold ${
                      etapa ? etapa.avatar : 'bg-slate-800 text-slate-400'
                    }`}
                    title={etapa ? `Etapa: ${etapa.nombre}` : undefined}
                    suppressHydrationWarning
                  >
                    {Array.from(name)[0]?.toUpperCase()}
                  </div>
                  <div className="flex flex-col overflow-hidden">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-200 truncate" suppressHydrationWarning>
                        {name}
                      </span>
                      {conv.line_key && lines.length > 0 && (
                        <div 
                          className={`w-1.5 h-1.5 rounded-full ${LINE_COLORS[lines.findIndex(l => l.line_key === conv.line_key) % LINE_COLORS.length]}`} 
                          title={`Línea: ${lines.find(l => l.line_key === conv.line_key)?.display_name}`}
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
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

                <div className="flex flex-col items-end gap-2 shrink-0">
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
            <span className="text-xs">No hay conversaciones activas</span>
          </div>
        )}
      </div>
    </div>
  );
}
