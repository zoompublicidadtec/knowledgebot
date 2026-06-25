'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ConversationList } from '@/components/chat/conversation-list';
import { MessageBubble } from '@/components/chat/message-bubble';
import { MessageInput } from '@/components/chat/message-input';
import { toggleBotAction } from '@/lib/conversations/actions';
import { Robot, SpinnerGap, WarningCircle, UserCircle, ArrowCounterClockwise } from '@phosphor-icons/react';

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
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  const supabase = createClient();
  const name = contact?.full_name || contact?.wa_phone || 'Desconocido';

  // Sync props when navigating between chats
  useEffect(() => {
    setConversations(initialConversations);
    setMessages(initialMessages);
    setBotActive(currentConversation.bot_active);
    setContact(currentConversation.contacts);
  }, [conversationId, initialConversations, initialMessages, currentConversation]);

  // Scroll to bottom on load/new message
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Live real-time subscription for messages and conversation updates
  useEffect(() => {
    const channel = supabase
      .channel('realtime_chat')
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
              if (prev.some((m) => m.id === payload.new.id)) return prev;
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

  return (
    <div className="animate-fade-in h-[calc(100vh-140px)] min-h-[450px] grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Sidebar List (Lg Screen) */}
      <div className="hidden lg:block lg:col-span-1 glass rounded-2xl overflow-hidden h-full">
        <ConversationList list={conversations} />
      </div>

      {/* Main chat window */}
      <div className="lg:col-span-3 glass rounded-2xl flex flex-col h-full overflow-hidden">
        {/* Chat Header */}
        <div className="p-4 border-b border-white/5 bg-slate-950/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold bg-primary-600/20 text-primary-300">
              {String(name).charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">{name}</h2>
              <p className="text-[10px]" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>
                {contact?.wa_phone}
              </p>
            </div>
          </div>

          {/* Bot switch */}
          <div className="flex items-center gap-2">
            <Robot size={18} className={botActive ? 'text-primary-400' : 'text-slate-500'} />
            <span className="text-xs text-slate-300">Agente IA</span>
            <button
              onClick={handleBotToggle}
              disabled={isPending}
              className={`toggle ${botActive ? 'active' : ''}`}
            >
              {isPending && (
                <SpinnerGap size={12} className="absolute left-1.5 top-1.5 animate-spin text-white" />
              )}
            </button>
          </div>
        </div>

        {/* 🚨 Handoff Alert Banner */}
        {!botActive && (
          <div
            className="mx-4 mt-3 mb-1 flex items-start gap-3 p-3.5 rounded-xl"
            style={{
              background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(220,38,38,0.08))',
              border: '1px solid rgba(239,68,68,0.3)',
              boxShadow: '0 0 20px rgba(239,68,68,0.08)',
            }}
          >
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.2)' }}
            >
              <WarningCircle size={18} weight="fill" className="text-red-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-300">Asistencia humana requerida</p>
              <p className="text-xs mt-0.5" style={{ color: 'rgba(252,165,165,0.7)' }}>
                El bot está <strong>pausado</strong>. Este cliente requiere atención directa.
                Responde desde aquí o desde tu WhatsApp personal.
              </p>
            </div>
            <button
              onClick={handleBotToggle}
              disabled={isPending}
              title="Reactivar bot"
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
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
              Reactivar bot
            </button>
          </div>
        )}

        {/* Messages Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length > 0 ? (
            messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))
          ) : (
            <div className="text-center py-12">
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.4)' }}>No hay mensajes anteriores</p>
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        {/* Message Input */}
        <MessageInput conversationId={conversationId} contactPhone={contact?.wa_phone || ''} />
      </div>
    </div>
  );
}
