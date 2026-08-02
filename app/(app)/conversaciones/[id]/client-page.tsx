'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ConversationList } from '@/components/chat/conversation-list';
import { MessageBubble } from '@/components/chat/message-bubble';
import { MessageInput } from '@/components/chat/message-input';
import { citaDesdeMensaje, type MensajeCitado } from '@/lib/whatsapp/message-preview';
import { toggleBotAction } from '@/lib/conversations/actions';
import { mostrarContacto } from '@/lib/whatsapp/contact-identity';
import { etiquetaDeDia, mismoDia } from '@/lib/chat/fechas';
import { Robot, SpinnerGap, WarningCircle, User, ArrowCounterClockwise, ArrowLeft } from '@phosphor-icons/react';

interface ChatClientPageProps {
  conversationId: string;
  initialConversations: any[];
  initialMessages: any[];
  currentConversation: any;
}

export default function ChatClientPage({
  conversationId,
  initialConversations,
  initialMessages,
  currentConversation,
}: ChatClientPageProps) {
  const [conversations, setConversations] = useState(initialConversations);
  const [messages, setMessages] = useState(initialMessages);
  const [botActive, setBotActive] = useState(currentConversation.bot_active);
  const [contact, setContact] = useState(currentConversation.contacts);
  /** Mensaje elegido con la flecha de la burbuja, para responderle citandolo. */
  const [citando, setCitando] = useState<MensajeCitado | null>(null);
  const [isPending, startTransition] = useTransition();
  /** El contenedor de mensajes: es el unico sitio que se desplaza. */
  const scrollRef = useRef<HTMLDivElement>(null);
  /** El primer scroll al abrir el chat es instantaneo, no animado. Ver abajo. */
  const esLaPrimeraVez = useRef(true);

  const supabase = createClient();

  /**
   * Por qué línea entra esta conversación.
   *
   * La cabecera decía quién escribe, pero no A QUIÉN. Con 8 líneas
   * corporativas, un asesor podía responder creyendo que hablaba desde otra
   * cuenta: el cliente recibe la respuesta desde un número que no reconoce, o
   * peor, desde la línea equivocada del negocio.
   */
  const [lineaActual, setLineaActual] = useState<{ display_name: string; phone_number: string | null } | null>(null);

  useEffect(() => {
    const lineKey = (currentConversation as any)?.line_key;
    if (!lineKey) { setLineaActual(null); return; }
    (async () => {
      const { data } = await (supabase as any)
        .from('whatsapp_lines')
        .select('display_name, phone_number')
        .eq('line_key', lineKey)
        .maybeSingle();
      setLineaActual(data || { display_name: lineKey, phone_number: null });
    })();
  }, [currentConversation]);

  // Nombre y teléfono con la MISMA regla que el resto del panel: nunca un
  // `@lid` disfrazado de teléfono. Ver lib/whatsapp/contact-identity.ts.
  const { nombre: name, telefono } = mostrarContacto(contact as any);

  // Sync props when navigating between chats
  useEffect(() => {
    setConversations(initialConversations);
    setMessages(initialMessages);
    setBotActive(currentConversation.bot_active);
    setContact(currentConversation.contacts);
    // Cambiar de chat vuelve a ser una "primera vez": hay que caer abajo de
    // golpe, no recorrer la conversacion entera a la vista.
    esLaPrimeraVez.current = true;
  }, [conversationId, initialConversations, initialMessages, currentConversation]);

  /**
   * Bajar al ultimo mensaje.
   *
   * Al ABRIR un chat se salta al final sin animacion, como WhatsApp: con
   * `smooth` en un historial largo el telefono se pasaba varios segundos
   * desfilando mensajes viejos antes de dejarte escribir.
   * Con un mensaje NUEVO si se anima, porque ahi el movimiento es la senal de
   * que llego algo.
   *
   * Se mueve el contenedor a mano en vez de usar `scrollIntoView` porque este
   * ultimo arrastra tambien a los ancestros y, con el chat a pantalla completa,
   * eso movia la pagina de debajo.
   */
  useEffect(() => {
    const caja = scrollRef.current;
    if (!caja) return;
    caja.scrollTo({ top: caja.scrollHeight, behavior: esLaPrimeraVez.current ? 'auto' : 'smooth' });
    esLaPrimeraVez.current = false;
  }, [messages]);

  // Live real-time subscription for messages and conversation updates
  useEffect(() => {
    // Unique channel per conversation to avoid collisions
    const channel = supabase
      .channel(`realtime_chat_${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setMessages((prev) => {
              // Si ya lo tenemos en el estado por actualización optimista, lo ignoramos o actualizamos
              if (prev.some((m) => m.id === payload.new.id || m.wa_message_id === payload.new.wa_message_id)) {
                return prev;
              }
              // Si hay un mensaje temporal optimista con el mismo contenido, lo reemplazamos con el real de Supabase
              const tempIndex = prev.findIndex((m) => m.id.startsWith('temp_') && m.content === payload.new.content);
              if (tempIndex !== -1) {
                const copy = [...prev];
                copy[tempIndex] = payload.new;
                return copy;
              }
              return [...prev, payload.new];
            });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          setBotActive(payload.new.bot_active);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'contacts',
        },
        (payload) => {
          setContact((prev: any) => ({ ...prev, ...payload.new }));
          setConversations((prev: any) =>
            prev.map((c: any) =>
              c.contacts?.id === payload.new.id
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
  }, [conversationId, supabase]);

  function handleBotToggle() {
    const nextState = !botActive;
    setBotActive(nextState);

    startTransition(async () => {
      const res = await toggleBotAction(conversationId, nextState);
      if (res?.error) {
        alert('Error: ' + res.error);
        setBotActive(!nextState); // Rollback
      }
    });
  }

  function handleOptimisticMessageSent(content: string) {
    const tempMessage = {
      id: `temp_${Date.now()}`,
      conversation_id: conversationId,
      direction: 'outbound',
      sender: 'human',
      content: content,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempMessage]);
  }

  return (
    /* `chat-pantalla` solo existe por debajo de 1024px: alli el chat se sale
       del <main> del panel y ocupa el telefono entero, con la lista de mensajes
       como unica zona desplazable. En escritorio no aplica y manda la rejilla
       de dos columnas de siempre. Ver el bloque "CONVERSACIONES EN EL TELEFONO"
       en globals.css. */
    <div className="animate-fade-in chat-pantalla lg:h-[calc(100vh-140px)] lg:min-h-[450px] lg:grid lg:grid-cols-4 lg:gap-6">
      {/* Sidebar List (solo desktop) - en móvil se navega con la flecha */}
      <div className="hidden lg:block lg:col-span-1 glass rounded-2xl overflow-hidden h-full">
        <ConversationList list={conversations} />
      </div>

      {/* Ventana del chat */}
      <div className="flex flex-1 min-h-0 flex-col glass rounded-2xl overflow-hidden max-lg:rounded-none lg:col-span-3 lg:h-full">
        {/* Cabecera */}
        <div className="chat-cabecera flex items-center justify-between gap-1 px-1.5 py-1.5 lg:gap-2 lg:px-4 lg:py-4 lg:border-b lg:border-white/5 lg:bg-slate-950/20">
          <div className="flex items-center gap-1.5 lg:gap-3 min-w-0 flex-1">
            {/* Volver - solo móvil (flujo tipo WhatsApp: lista -> chat -> volver) */}
            <Link
              href="/conversaciones"
              className="lg:hidden flex-shrink-0 flex h-10 w-8 items-center justify-center text-slate-200 active:opacity-60 transition-opacity"
              title="Volver a la lista de chats"
              aria-label="Volver a la lista de chats"
            >
              <ArrowLeft size={24} />
            </Link>
            <div className="w-10 h-10 lg:w-9 lg:h-9 rounded-full flex items-center justify-center text-base lg:text-xs font-semibold bg-slate-700 text-slate-300 lg:bg-primary-600/20 lg:text-primary-300 shrink-0">
              {String(name).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 leading-tight">
              <h2 className="text-[17px] lg:text-sm font-medium lg:font-semibold text-white truncate">{name}</h2>

              {/* Telefono y linea de la empresa en UN renglon.
                  El dato es el mismo que ya estaba — de quien viene y por que
                  linea nuestra entra — pero en escritorio va como etiqueta y en
                  telefono como texto corrido: la etiqueta con el numero completo
                  obligaba a la cabecera a partirse en dos filas, y esa fila de
                  mas es lo que se veia recortado arriba. */}
              <p
                className="lg:hidden text-[12px] truncate"
                style={{ color: 'rgba(148, 163, 184, 0.65)' }}
                title={
                  lineaActual
                    ? `Este chat entra por ${lineaActual.display_name}${lineaActual.phone_number ? ` · ${lineaActual.phone_number}` : ''}, y tu respuesta sale desde ahí`
                    : undefined
                }
              >
                {telefono}
                {lineaActual && <span className="text-slate-500"> → {lineaActual.display_name}</span>}
              </p>

              <div className="hidden lg:flex items-center gap-1.5 flex-wrap">
                <p className="text-[10px] truncate" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>
                  {telefono}
                </p>
                {lineaActual && (
                  <>
                    <span className="text-[10px] text-slate-600">→</span>
                    <span
                      className="text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-primary-500/10 text-primary-300 border-primary-500/30 whitespace-nowrap"
                      title="Línea de su empresa por la que entra este chat y desde la que sale su respuesta"
                    >
                      {lineaActual.display_name}
                      {lineaActual.phone_number ? ` · ${lineaActual.phone_number}` : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Telefono: un solo boton que dice quien esta respondiendo y lo
              cambia al tocarlo. El interruptor de escritorio mide 44x24 y viene
              con la palabra "Agente IA" al lado: junto al nombre del cliente,
              en 390px de ancho, no cabia. */}
          <button
            onClick={handleBotToggle}
            disabled={isPending}
            aria-pressed={botActive}
            aria-label={
              botActive
                ? 'Responde el agente IA. Tocar para pasar a responder tú.'
                : 'Respondes tú. Tocar para que vuelva a responder el agente IA.'
            }
            className={`lg:hidden shrink-0 flex items-center gap-1.5 rounded-full px-3 h-10 text-xs font-semibold transition-colors ${
              botActive
                ? 'bg-primary-600/25 text-primary-200 border border-primary-500/40'
                : 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
            }`}
          >
            {isPending ? (
              <SpinnerGap size={16} className="animate-spin" />
            ) : botActive ? (
              <Robot size={16} weight="fill" />
            ) : (
              <User size={16} weight="fill" />
            )}
            {botActive ? 'IA' : 'Tú'}
          </button>

          {/* Escritorio: el interruptor de siempre */}
          <div className="hidden lg:flex items-center gap-2">
            <Robot size={18} className={botActive ? 'text-primary-400' : 'text-slate-500'} />
            <span className="text-xs text-slate-300">Agente IA</span>
            <button
              onClick={handleBotToggle}
              disabled={isPending}
              aria-pressed={botActive}
              aria-label="Activar o pausar el agente IA en este chat"
              className={`toggle ${botActive ? 'active' : ''}`}
            >
              {isPending && (
                <SpinnerGap size={12} className="absolute left-1.5 top-1.5 animate-spin text-white" />
              )}
            </button>
          </div>
        </div>

        {/* 🚨 Handoff Alert Banner.
            En telefono se reduce a un renglon: el mismo aviso ocupaba antes un
            tercio de la pantalla y empujaba los mensajes fuera de la vista. */}
        {!botActive && (
          <div
            className="flex items-center gap-2 lg:items-start lg:gap-3 mx-2 lg:mx-4 mt-2 lg:mt-3 mb-1 p-2 lg:p-3.5 rounded-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(220,38,38,0.08))',
              border: '1px solid rgba(239,68,68,0.3)',
              boxShadow: '0 0 20px rgba(239,68,68,0.08)',
            }}
          >
            <div
              className="flex-shrink-0 w-7 h-7 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.2)' }}
            >
              <WarningCircle size={18} weight="fill" className="text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs lg:text-sm font-semibold text-red-300">
                <span className="lg:hidden">Estás respondiendo tú</span>
                <span className="hidden lg:inline">Asistencia humana requerida</span>
              </p>
              <p className="hidden lg:block text-xs mt-0.5" style={{ color: 'rgba(252,165,165,0.7)' }}>
                El bot está <strong>pausado</strong>. Este cliente requiere atención directa.
                Responde desde aquí o desde tu WhatsApp personal.
              </p>
            </div>
            <button
              onClick={handleBotToggle}
              disabled={isPending}
              title="Reactivar bot"
              className="flex-shrink-0 flex items-center gap-1.5 px-3 h-8 lg:py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: 'rgba(99,102,241,0.15)',
                border: '1px solid rgba(99,102,241,0.3)',
                color: '#a5b4fc',
              }}
            >
              {isPending ? (
                <SpinnerGap size={12} className="animate-spin" />
              ) : (
                <ArrowCounterClockwise size={12} weight="bold" />
              )}
              <span className="lg:hidden">Devolver</span>
              <span className="hidden lg:inline">Reactivar bot</span>
            </button>
          </div>
        )}

        {/* Mensajes — la unica zona que se desplaza.
            `overscroll-contain` evita que, al llegar al final, el tiron siga y
            arrastre la pagina de debajo. */}
        <div
          ref={scrollRef}
          className="chat-fondo flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 lg:p-4 space-y-2 lg:space-y-4"
        >
          {messages.length > 0 ? (
            messages.map((msg, i) => {
              // Pastilla de fecha cuando cambia el dia, para poder leer una
              // conversacion larga sin perder de vista cuando paso cada cosa.
              const anterior = messages[i - 1];
              const abreDia = !anterior || !mismoDia(anterior.created_at, msg.created_at);
              // Mensajes seguidos del mismo remitente forman una tanda: solo el
              // primero lleva cola.
              const agrupado =
                !!anterior &&
                !abreDia &&
                anterior.direction === msg.direction &&
                anterior.sender === msg.sender;
              return (
                <div key={msg.id} className={agrupado ? 'space-y-0.5' : 'space-y-2 lg:space-y-4'}>
                  {abreDia && (
                    <div className="flex justify-center py-1">
                      <span
                        className="rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-slate-300"
                        style={{ background: '#1f2c33' }}
                        suppressHydrationWarning
                      >
                        {etiquetaDeDia(msg.created_at)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={msg}
                    agrupado={agrupado}
                    onResponder={
                      msg.wa_message_id
                        ? () => setCitando(citaDesdeMensaje(msg))
                        : undefined
                    }
                  />
                </div>
              );
            })
          ) : (
            <div className="text-center py-12">
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.4)' }}>No hay mensajes anteriores</p>
            </div>
          )}
        </div>

        {/* Barra de escribir */}
        <MessageInput
          conversationId={conversationId}
          contactPhone={contact?.wa_phone || ''}
          onMessageSent={handleOptimisticMessageSent}
          citado={citando}
          onCancelarCita={() => setCitando(null)}
        />
      </div>
    </div>
  );
}
