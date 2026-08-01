'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { sendMessageAction } from '@/lib/conversations/actions';
import { PaperPlaneRight, SpinnerGap } from '@phosphor-icons/react';

interface MessageInputProps {
  conversationId: string;
  contactPhone: string;
  onMessageSent?: (text: string) => void;
}

export function MessageInput({ conversationId, contactPhone, onMessageSent }: MessageInputProps) {
  const [text, setText] = useState('');
  const [isPending, startTransition] = useTransition();
  const campoRef = useRef<HTMLTextAreaElement>(null);
  /**
   * `true` en pantallas tactiles. Decide que hace la tecla Enter, y no se puede
   * saber en el servidor: se mide despues de montar para no romper la
   * hidratacion.
   */
  const [esTactil, setEsTactil] = useState(false);

  useEffect(() => {
    setEsTactil(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  /**
   * El campo crece con el texto, hasta el tope que fija `.chat-campo`.
   * Antes era un `<input>` de una linea: una cotizacion de tres renglones se
   * escribia a ciegas, viendo solo las ultimas palabras.
   */
  function ajustarAlto() {
    const el = campoRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(ajustarAlto, [text]);

  function enviar() {
    if (!text.trim() || isPending) return;

    const currentText = text;
    setText('');

    // Instant local feedback (optimistic update)
    if (onMessageSent) {
      onMessageSent(currentText);
    }

    startTransition(async () => {
      const res = await sendMessageAction(conversationId, contactPhone, currentText);
      if (res?.error) {
        alert('Error al enviar: ' + res.error);
        setText(currentText); // Restore text on failure
      }
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    enviar();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter') return;
    // En el teclado fisico Enter envia y Mayus+Enter hace salto de linea, que
    // es lo que espera quien atiende desde el computador.
    // En el telefono NO: alli Enter tiene que hacer salto de linea, como en la
    // app de WhatsApp, y para enviar esta el boton — si no, cualquier intento
    // de escribir un segundo renglon manda el mensaje a medias al cliente.
    if (esTactil || e.shiftKey) return;
    e.preventDefault();
    enviar();
  }

  const hayTexto = text.trim().length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      className="chat-barra glass rounded-b-2xl max-lg:rounded-none flex items-end gap-2 p-2 lg:p-4"
    >
      <textarea
        ref={campoRef}
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Escribe un mensaje de WhatsApp..."
        aria-label="Escribe un mensaje de WhatsApp"
        enterKeyHint={esTactil ? 'enter' : 'send'}
        disabled={isPending}
        className="chat-campo flex-1 resize-none overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/70
                   px-3.5 py-2.5 text-white outline-none transition-colors
                   placeholder:text-slate-500 focus:border-primary-500/60 disabled:opacity-60
                   lg:text-sm"
      />
      <button
        type="submit"
        disabled={isPending || !hayTexto}
        aria-label="Enviar mensaje"
        /* 44x44 es el area tactil minima que se acierta con el pulgar sin
           mirar; el boton anterior media 46x38 y estaba pegado al borde. */
        className={`boton-enviar flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all
                    lg:h-10 lg:w-10 ${
                      hayTexto && !isPending
                        ? 'bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-900/40 active:scale-95'
                        : 'bg-slate-800 text-slate-500'
                    }`}
      >
        {isPending ? (
          <SpinnerGap size={20} className="animate-spin" />
        ) : (
          <PaperPlaneRight size={20} weight="fill" />
        )}
      </button>
    </form>
  );
}
