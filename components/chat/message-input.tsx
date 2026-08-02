'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { sendMessageAction } from '@/lib/conversations/actions';
import { Paperclip, PaperPlaneRight, SpinnerGap } from '@phosphor-icons/react';

/** El mismo tope que aplican el puente y el servidor. */
const MAX_MB = 20;

interface MessageInputProps {
  conversationId: string;
  contactPhone: string;
  onMessageSent?: (text: string) => void;
}

export function MessageInput({ conversationId, contactPhone, onMessageSent }: MessageInputProps) {
  const [text, setText] = useState('');
  const [isPending, startTransition] = useTransition();
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const archivoRef = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
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

  /**
   * Manda el archivo por una ruta con `FormData`, no por una server action:
   * esas admiten 1 MB de cuerpo y una foto de celular pesa más.
   *
   * Si lo que hay escrito en el campo acompaña al archivo, viaja como pie de
   * foto — igual que en WhatsApp.
   */
  async function enviarArchivo(archivo: File) {
    if (!archivo || subiendo) return;

    if (archivo.size > MAX_MB * 1024 * 1024) {
      alert(
        `«${archivo.name}» pesa ${Math.round(archivo.size / 1024 / 1024)} MB ` +
          `y el máximo que acepta WhatsApp aquí son ${MAX_MB} MB.`,
      );
      return;
    }

    const pie = text.trim();
    setSubiendo(true);
    try {
      const datos = new FormData();
      datos.append('conversationId', conversationId);
      datos.append('to', contactPhone);
      datos.append('caption', pie);
      datos.append('file', archivo);

      const res = await fetch('/api/conversations/send-media', { method: 'POST', body: datos });
      const cuerpo = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert('No se pudo enviar: ' + (cuerpo?.error || `error ${res.status}`));
        return;
      }

      setText('');
      onMessageSent?.(pie || (archivo.type.startsWith('image/') ? '[Foto]' : '[Archivo]'));
    } catch (err) {
      alert('No se pudo enviar el archivo: ' + String(err));
    } finally {
      setSubiendo(false);
      // Se limpia para que elegir el MISMO archivo otra vez vuelva a disparar.
      if (archivoRef.current) archivoRef.current.value = '';
    }
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
  const ocupado = isPending || subiendo;

  return (
    <form
      onSubmit={handleSubmit}
      className="chat-barra glass rounded-b-2xl max-lg:rounded-none flex items-end gap-2 p-2 lg:p-4"
    >
      <input
        ref={archivoRef}
        type="file"
        accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={(e) => {
          const archivo = e.target.files?.[0];
          if (archivo) void enviarArchivo(archivo);
        }}
      />
      {/* El clip vive DENTRO de la pastilla, pegado al borde derecho.
          Suelto a la izquierda robaba ancho al campo —que en el telefono es lo
          que mas escasea— y se leia como una pieza de otro juego, no como parte
          del cuadro de escribir. El hueco a la derecha del texto se lo hace
          `pr-11` aqui y el `padding` de `.chat-campo` en globals.css, para que
          lo escrito nunca pase por debajo del icono. */}
      <div className="relative flex-1">
        <textarea
          ref={campoRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribe un mensaje de WhatsApp..."
          aria-label="Escribe un mensaje de WhatsApp"
          enterKeyHint={esTactil ? 'enter' : 'send'}
          disabled={ocupado}
          className="chat-campo block w-full resize-none overflow-y-auto rounded-2xl border border-white/10
                     bg-slate-900/70 py-2.5 pl-3.5 pr-11 text-white outline-none transition-colors
                     placeholder:text-slate-500 focus:border-primary-500/60 disabled:opacity-60
                     lg:text-sm"
        />
        <button
          type="button"
          onClick={() => archivoRef.current?.click()}
          disabled={ocupado}
          aria-label="Adjuntar una foto o un archivo"
          title="Adjuntar una foto o un archivo"
          className="absolute bottom-1.5 right-1.5 flex h-8 w-8 items-center justify-center rounded-full
                     text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200
                     disabled:opacity-40"
        >
          {subiendo ? <SpinnerGap size={18} className="animate-spin" /> : <Paperclip size={18} />}
        </button>
      </div>
      <button
        type="submit"
        disabled={ocupado || !hayTexto}
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
        {ocupado ? (
          <SpinnerGap size={20} className="animate-spin" />
        ) : (
          <PaperPlaneRight size={20} weight="fill" />
        )}
      </button>
    </form>
  );
}
