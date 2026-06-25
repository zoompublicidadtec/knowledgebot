'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { PaperPlaneRight, SpinnerGap, ChatCircleDots } from '@phosphor-icons/react';
import { createClient } from '@/lib/supabase/client';

interface AgentSandboxProps {
  orgId: string;
  conversationId: string;
  initialMessages: any[];
}

export function AgentSandbox({ orgId, conversationId, initialMessages }: AgentSandboxProps) {
  const [messages, setMessages] = useState<any[]>(initialMessages);
  const [text, setText] = useState('');
  const [isPending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen to new messages in the sandbox conversation
  useEffect(() => {
    const channel = supabase
      .channel(`sandbox_${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, supabase]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || isPending) return;

    const currentText = text;
    setText('');

    startTransition(async () => {
      try {
        const res = await fetch('/api/agent/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: currentText,
            conversationId,
            orgId,
          }),
        });
        const data = await res.json();
        if (data.error) {
          alert('Error: ' + data.error);
          setText(currentText);
        }
      } catch {
        alert('Error de conexión');
        setText(currentText);
      }
    });
  }

  return (
    <div className="glass rounded-2xl h-[550px] flex flex-col overflow-hidden border border-primary-500/20">
      {/* Header */}
      <div className="p-4 border-b border-white/5 bg-primary-600/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChatCircleDots size={20} className="text-primary-400" />
          <h3 className="text-sm font-semibold text-white">Simulador de Chat IA</h3>
        </div>
        <span className="badge badge-primary text-[10px]">Sandbox</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length > 0 ? (
          messages.map((msg) => {
            const isOutbound = msg.direction === 'outbound';
            return (
              <div key={msg.id} className={`flex w-full ${isOutbound ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`
                    p-3 rounded-2xl max-w-[80%] text-sm leading-relaxed
                    ${isOutbound ? 'bg-slate-800 text-slate-100 border border-white/5' : 'bg-primary-600 text-white'}
                  `}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <ChatCircleDots size={36} className="mb-2 text-slate-600" />
            <p className="text-xs">¡Escribe un mensaje para iniciar la conversación simulada con tu bot!</p>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="p-3 border-t border-white/5 bg-slate-950/20 flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe un mensaje de prueba..."
          className="input flex-1 text-sm py-2"
          disabled={isPending}
        />
        <button
          type="submit"
          disabled={isPending || !text.trim()}
          className="btn-primary p-2 flex items-center justify-center min-w-[38px] rounded-xl"
        >
          {isPending ? <SpinnerGap size={16} className="animate-spin" /> : <PaperPlaneRight size={16} />}
        </button>
      </form>
    </div>
  );
}
