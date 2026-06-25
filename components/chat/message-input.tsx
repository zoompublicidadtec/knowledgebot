'use client';

import { useState, useTransition } from 'react';
import { sendMessageAction } from '@/lib/conversations/actions';
import { PaperPlaneRight, SpinnerGap } from '@phosphor-icons/react';

interface MessageInputProps {
  conversationId: string;
  contactPhone: string;
}

export function MessageInput({ conversationId, contactPhone }: MessageInputProps) {
  const [text, setText] = useState('');
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || isPending) return;

    const currentText = text;
    setText('');

    startTransition(async () => {
      const res = await sendMessageAction(conversationId, contactPhone, currentText);
      if (res?.error) {
        alert('Error al enviar: ' + res.error);
        setText(currentText); // Restore text on failure
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 glass rounded-b-2xl flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escribe un mensaje de WhatsApp..."
        className="input flex-1"
        disabled={isPending}
      />
      <button
        type="submit"
        disabled={isPending || !text.trim()}
        className="btn-primary px-4 py-2 flex items-center justify-center min-w-[46px]"
      >
        {isPending ? (
          <SpinnerGap size={18} className="animate-spin" />
        ) : (
          <PaperPlaneRight size={18} weight="bold" />
        )}
      </button>
    </form>
  );
}
