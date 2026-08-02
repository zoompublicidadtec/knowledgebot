'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { sendMessageAction } from '@/lib/conversations/actions';
import type { MensajeCitado } from '@/lib/whatsapp/message-preview';
import { Microphone, Paperclip, PaperPlaneRight, SpinnerGap, Trash, X } from '@phosphor-icons/react';

/** El mismo tope que aplican el puente y el servidor. */
const MAX_MB = 20;

/**
 * Tope de una nota de voz. Al llegar aqui se corta sola y se envia, en vez de
 * seguir creciendo hasta pasarse de los 20 MB y perderse entera.
 */
const MAX_SEGUNDOS_VOZ = 300;

interface MessageInputProps {
  conversationId: string;
  contactPhone: string;
  onMessageSent?: (text: string) => void;
  /** El mensaje al que se está respondiendo, elegido en la burbuja. */
  citado?: MensajeCitado | null;
  /** Quita la cita: la «x» del recuadro, y tambien al terminar de enviar. */
  onCancelarCita?: () => void;
}

export function MessageInput({
  conversationId,
  contactPhone,
  onMessageSent,
  citado = null,
  onCancelarCita,
}: MessageInputProps) {
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

  // ---------------------------------------------------------------- nota de voz
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const grabadoraRef = useRef<MediaRecorder | null>(null);
  const trozosRef = useRef<Blob[]>([]);
  const pistaRef = useRef<MediaStream | null>(null);
  const relojRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Distingue «descartar» de «enviar»: los dos paran la misma grabadora. */
  const descartarRef = useRef(false);

  useEffect(() => {
    setEsTactil(window.matchMedia('(pointer: coarse)').matches);
  }, []);

  /**
   * Suelta el microfono y para el reloj.
   *
   * Sin esto el navegador deja el punto rojo de «grabando» encendido despues de
   * enviar, y el dueño cree que el panel lo sigue escuchando.
   */
  function soltarMicrofono() {
    pistaRef.current?.getTracks().forEach((t) => t.stop());
    pistaRef.current = null;
    if (relojRef.current) {
      clearInterval(relojRef.current);
      relojRef.current = null;
    }
  }

  // Al salir de la conversacion, el microfono se suelta igual.
  useEffect(() => soltarMicrofono, []);

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
    // La cita se toma AHORA: si se lee dentro del `startTransition`, para
    // entonces ya se limpio y el mensaje saldria sin citar a nadie.
    const citaDeEsteEnvio = citado;
    setText('');
    onCancelarCita?.();

    // Instant local feedback (optimistic update)
    if (onMessageSent) {
      onMessageSent(currentText);
    }

    startTransition(async () => {
      const res = await sendMessageAction(
        conversationId,
        contactPhone,
        currentText,
        citaDeEsteEnvio || undefined,
      );
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

  /**
   * El envase que sabe grabar ESTE navegador.
   *
   * Chrome en Windows graba en webm/opus; Firefox, en ogg/opus; Safari, en mp4.
   * Cualquiera de los tres sirve: el servidor lo convierte a ogg/opus, que es
   * lo unico que WhatsApp pinta como nota de voz.
   */
  function envaseDeGrabacion(): string {
    if (typeof MediaRecorder === 'undefined') return '';
    for (const tipo of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (MediaRecorder.isTypeSupported?.(tipo)) return tipo;
    }
    return '';
  }

  async function enviarNotaDeVoz(audio: Blob) {
    setSubiendo(true);
    try {
      const datos = new FormData();
      datos.append('conversationId', conversationId);
      datos.append('to', contactPhone);
      datos.append('caption', '');
      // Esta marca es la que separa una nota de voz de un audio adjunto.
      datos.append('ptt', '1');
      datos.append(
        'file',
        new File([audio], 'nota-de-voz', { type: audio.type || 'audio/webm' }),
      );

      const res = await fetch('/api/conversations/send-media', { method: 'POST', body: datos });
      const cuerpo = await res.json().catch(() => ({}));

      if (!res.ok) {
        alert('No se pudo enviar la nota de voz: ' + (cuerpo?.error || `error ${res.status}`));
        return;
      }
      onMessageSent?.('[Nota de voz]');
    } catch (err) {
      alert('No se pudo enviar la nota de voz: ' + String(err));
    } finally {
      setSubiendo(false);
    }
  }

  async function empezarAGrabar() {
    if (grabando || subiendo || isPending) return;

    /**
     * El microfono solo se puede pedir en un sitio con candado (https). En una
     * direccion sin candado el navegador ni siquiera expone `mediaDevices`, y
     * sin este aviso el boton pareceria roto sin explicacion.
     */
    if (!navigator.mediaDevices?.getUserMedia) {
      alert(
        'Para grabar notas de voz entrá al panel por https://zoompublicidad.tech. ' +
          'Los navegadores no dan micrófono en direcciones sin candado.',
      );
      return;
    }

    try {
      const pista = await navigator.mediaDevices.getUserMedia({ audio: true });
      pistaRef.current = pista;

      const envase = envaseDeGrabacion();
      const grabadora = new MediaRecorder(pista, envase ? { mimeType: envase } : undefined);
      trozosRef.current = [];
      descartarRef.current = false;

      grabadora.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) trozosRef.current.push(e.data);
      };

      grabadora.onstop = () => {
        const trozos = trozosRef.current;
        trozosRef.current = [];
        soltarMicrofono();
        setGrabando(false);
        setSegundos(0);

        if (descartarRef.current || trozos.length === 0) return;
        const audio = new Blob(trozos, { type: grabadora.mimeType || 'audio/webm' });
        // Un toque sin querer no manda un mensaje vacio al cliente.
        if (audio.size < 1024) return;
        void enviarNotaDeVoz(audio);
      };

      grabadora.start();
      grabadoraRef.current = grabadora;
      setGrabando(true);
      setSegundos(0);

      let llevados = 0;
      relojRef.current = setInterval(() => {
        llevados += 1;
        setSegundos(llevados);
        if (llevados >= MAX_SEGUNDOS_VOZ) terminarYEnviar();
      }, 1000);
    } catch {
      soltarMicrofono();
      setGrabando(false);
      alert('No se pudo abrir el micrófono. Revisá que el navegador tenga permiso para usarlo.');
    }
  }

  function descartarGrabacion() {
    descartarRef.current = true;
    grabadoraRef.current?.stop();
  }

  function terminarYEnviar() {
    descartarRef.current = false;
    grabadoraRef.current?.stop();
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
  const reloj = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

  // `flex-wrap` en la barra: el recuadro de la cita ocupa todo el ancho y se
  // pone en su propio renglon encima del cuadro de escribir, sin mover nada.
  return (
    <form
      onSubmit={handleSubmit}
      className="chat-barra glass rounded-b-2xl max-lg:rounded-none flex flex-wrap items-end gap-2 p-2 lg:p-4"
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

      {/* A quien se le responde se ve ARRIBA del cuadro, antes de escribir,
          como en WhatsApp. */}
      {citado && (
        <div className="flex w-full items-start gap-2 rounded-xl border-l-2 border-primary-500 bg-slate-800/60 px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold text-primary-300">
              {citado.fromMe ? 'Respondiendo a tu mensaje' : 'Respondiendo al cliente'}
            </p>
            <p className="line-clamp-2 text-[11px] text-slate-300">{citado.texto}</p>
          </div>
          <button
            type="button"
            onClick={() => onCancelarCita?.()}
            aria-label="Quitar la cita"
            title="Quitar la cita"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-slate-400
                       transition-colors hover:bg-white/10 hover:text-slate-200"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {grabando ? (
        /* Mientras se graba, la barra ocupa el sitio del cuadro de escribir,
           como en WhatsApp: se ve el tiempo corriendo y la papelera descarta
           sin enviar nada. */
        <div className="flex flex-1 items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/20 px-3.5 py-2.5">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-rose-500" />
          <span className="font-mono text-sm tabular-nums text-rose-200">{reloj}</span>
          <span className="truncate text-xs text-slate-400">Grabando…</span>
          <button
            type="button"
            onClick={descartarGrabacion}
            aria-label="Descartar la grabación"
            title="Descartar la grabación"
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full
                       text-rose-300 transition-colors hover:bg-rose-500/15"
          >
            <Trash size={18} />
          </button>
        </div>
      ) : (
        /* El clip vive DENTRO de la pastilla, pegado al borde derecho.
           Suelto a la izquierda robaba ancho al campo —que en el telefono es lo
           que mas escasea— y se leia como una pieza de otro juego, no como parte
           del cuadro de escribir. El hueco a la derecha del texto se lo hace
           `pr-11` aqui y el `padding` de `.chat-campo` en globals.css, para que
           lo escrito nunca pase por debajo del icono. */
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
      )}

      {/* Con el campo vacio se ve el microfono; en cuanto hay algo escrito, se
          convierte en la flecha de enviar. Es lo que hace WhatsApp, y por eso
          no hace falta explicarselo a nadie. */}
      {!hayTexto && !grabando ? (
        <button
          type="button"
          onClick={() => void empezarAGrabar()}
          disabled={ocupado}
          aria-label="Grabar una nota de voz"
          title="Grabar una nota de voz"
          /* 44x44 es el area tactil minima que se acierta con el pulgar sin
             mirar; el boton anterior media 46x38 y estaba pegado al borde. */
          className="boton-enviar flex h-11 w-11 shrink-0 items-center justify-center rounded-full
                     bg-slate-800 text-slate-300 transition-all hover:bg-slate-700 hover:text-white
                     active:scale-95 disabled:opacity-40 lg:h-10 lg:w-10"
        >
          {subiendo ? (
            <SpinnerGap size={20} className="animate-spin" />
          ) : (
            <Microphone size={20} weight="fill" />
          )}
        </button>
      ) : (
        <button
          type={grabando ? 'button' : 'submit'}
          onClick={grabando ? terminarYEnviar : undefined}
          disabled={grabando ? false : ocupado || !hayTexto}
          aria-label={grabando ? 'Enviar la nota de voz' : 'Enviar mensaje'}
          title={grabando ? 'Enviar la nota de voz' : 'Enviar mensaje'}
          className={`boton-enviar flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all
                      lg:h-10 lg:w-10 ${
                        (hayTexto || grabando) && !isPending
                          ? 'bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-lg shadow-primary-900/40 active:scale-95'
                          : 'bg-slate-800 text-slate-500'
                      }`}
        >
          {ocupado && !grabando ? (
            <SpinnerGap size={20} className="animate-spin" />
          ) : (
            <PaperPlaneRight size={20} weight="fill" />
          )}
        </button>
      )}
    </form>
  );
}
