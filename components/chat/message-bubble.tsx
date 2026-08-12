'use client';

import { useEffect, useState } from 'react';
import type { Message } from '@/lib/database.types';
import { leerMedia, quitarCita, separarPieYAnalisis } from '@/lib/whatsapp/message-preview';
import { horaDelMensaje } from '@/lib/chat/fechas';
import { TextoWhatsApp } from './whatsapp-text';
import { ArrowBendUpLeft } from '@phosphor-icons/react';

/**
 * Burbuja de mensaje del panel de Conversaciones.
 *
 * POR QUE PIDE UNA URL FIRMADA
 * ----------------------------
 * Los audios y las fotos que manda el cliente se guardan en Cloudflare R2
 * (bucket `knowledgebot-fotos`), y en la base solo queda la CLAVE del objeto,
 * no una direccion publica: el bucket es privado. Para reproducir el archivo
 * hay que pedirle al servidor una URL firmada de una hora
 * (`/api/media/signed-url`), que nunca se guarda.
 *
 * El base64 no se guarda en la base a proposito: una nota de voz metida en una
 * columna JSONB infla la base y vuelve lento el panel.
 *
 * DE DONDE SALE LA CLASIFICACION DEL ADJUNTO
 * ------------------------------------------
 * De `lib/whatsapp/message-preview.ts`, que es el mismo sitio del que la toma
 * la lista de chats. Asi la fila y la burbuja no pueden contradecirse: si aqui
 * se pinta un reproductor de audio, alla dice "Nota de voz".
 */
export function MessageBubble({
  message,
  agrupado = false,
  onResponder,
}: {
  message: Message;
  /**
   * Responder citando ESTE mensaje. Si no llega, el boton no se pinta: es lo
   * que pasa con un mensaje que todavia no tiene identificador de WhatsApp.
   */
  onResponder?: () => void;
  /**
   * `true` cuando el mensaje anterior es del mismo remitente y del mismo dia.
   * Entonces la burbuja pierde la cola, como en WhatsApp: la cola marca donde
   * EMPIEZA a hablar alguien, y repetirla en cada mensaje de una misma tanda
   * llena la pantalla de picos.
   */
  agrupado?: boolean;
}) {
  const isOutbound = message.direction === 'outbound';
  const isBot = message.sender === 'bot';
  const isHuman = message.sender === 'human';

  const time = horaDelMensaje(message.created_at);

  const media = leerMedia(message);
  const { esImagen, esAudio, esVideo, esSticker, esDocumento, etiquetaArchivo, mimeType, declaredType, sizeKB, r2Key, directUrl, mediaError } =
    media;

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [estadoMedia, setEstadoMedia] = useState<
    'sin-archivo' | 'cargando' | 'listo' | 'no-disponible'
  >(r2Key ? 'cargando' : 'sin-archivo');

  useEffect(() => {
    if (!r2Key) return;
    let cancelado = false;

    (async () => {
      try {
        const res = await fetch(`/api/media/signed-url?key=${encodeURIComponent(r2Key)}`);
        if (cancelado) return;
        if (!res.ok) {
          setEstadoMedia('no-disponible');
          return;
        }
        const data = (await res.json()) as { url?: string };
        if (cancelado) return;
        if (data.url) {
          setSignedUrl(data.url);
          setEstadoMedia('listo');
        } else {
          setEstadoMedia('no-disponible');
        }
      } catch {
        if (!cancelado) setEstadoMedia('no-disponible');
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [r2Key]);

  const src = signedUrl || directUrl;
  const hayImagen = esImagen && !!src;
  const hayAudio = esAudio && !!src;
  const hayVideo = esVideo && !!src;
  const hayDocumento = esDocumento && !!src;

  // El puente incrusta la cita dentro del texto porque el agente necesita el
  // referente; aqui se quita, que la cita ya se pinta arriba en su propia caja.
  const displayText = quitarCita(message.content);

  // Sin etiqueta, el texto ES el pie de foto: las fotos de producto que envia
  // el bot llevan nombre, referencia y precio ahi.
  const { pie: imageCaption, analisis: aiDescription } = esImagen
    ? separarPieYAnalisis(displayText)
    : { pie: '', analisis: '' };

  // El texto de un audio ES su transcripcion.
  const transcription = esAudio ? displayText : '';

  /**
   * LA FLECHA DE RESPONDER VA FUERA DE LA BURBUJA, NUNCA ENCIMA DEL TEXTO.
   *
   * Primero se puso DENTRO, arriba a la derecha, apareciendo al pasar el raton
   * por encima. En el computador se veia bien; en el telefono no existe «pasar
   * por encima», asi que ahi tenia que verse siempre — y siempre significaba
   * **tapando el primer renglon de cada mensaje**. Lo reporto el dueño con una
   * captura el 02-ago-2026.
   *
   * Ahora va en el hueco que queda al costado: a la izquierda si el mensaje es
   * nuestro, a la derecha si es del cliente. Siempre por el lado libre. Ocupa
   * su sitio desde el principio (se atenua, no se esconde), asi que al pasar el
   * raton por encima nada se mueve de lugar.
   */
  const botonResponder = onResponder ? (
    <button
      type="button"
      onClick={onResponder}
      aria-label="Responder citando este mensaje"
      title="Responder citando este mensaje"
      className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full
                 text-slate-400 opacity-0 transition-opacity hover:bg-white/10
                 hover:text-white focus-visible:opacity-100
                 group-hover/fila:opacity-100 max-lg:opacity-40"
    >
      <ArrowBendUpLeft size={15} />
    </button>
  ) : null;

  return (
    <div
      className={`group/fila flex w-full items-end gap-0.5 ${
        isOutbound ? 'justify-end' : 'justify-start'
      }`}
    >
      {isOutbound && botonResponder}
      <div
        className={`
          ${isOutbound ? 'bubble-outbound' : 'bubble-inbound'}
          ${isBot ? 'bubble-bot' : ''}
          ${isHuman ? 'bubble-human' : ''}
          ${agrupado ? 'burbuja-agrupada' : ''}
          relative shadow-sm max-w-[85%] sm:max-w-md md:max-w-lg
        `}
      >
        {/* Cita del mensaje citado (reply) - solo se muestra si hay cita */}
        {media.citado && (
          <div className="mb-1 px-2 py-1 border-l-2 border-slate-500 bg-slate-800/40 rounded text-[11px] text-slate-300 italic line-clamp-2">
            <span className="not-italic font-semibold text-slate-400">↩ Respondiendo a: </span>
            {media.citado}
          </div>
        )}

        {/* Archivo en camino: el panel dice qué está haciendo */}
        {estadoMedia === 'cargando' && (
          <div className="mt-1 mb-1 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-slate-400" />
            <span className="text-[10px] text-slate-400">
              Cargando{' '}
              {esAudio
                ? 'la nota de voz'
                : esVideo
                  ? 'el video'
                  : esSticker
                    ? 'el sticker'
                    : esImagen
                      ? 'la imagen'
                      : 'el archivo'}
              …
            </span>
          </div>
        )}

        {/* Se guardó, pero ya no está en el almacenamiento */}
        {estadoMedia === 'no-disponible' && (
          <div className="mt-1 mb-1 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <p className="text-[10px] text-amber-300/90">
              El archivo ya no está disponible en el almacenamiento.
              {sizeKB
                ? ` Era ${esAudio ? 'un audio' : esVideo ? 'un video' : 'una imagen'} de ${sizeKB} KB.`
                : ''}
            </p>
          </div>
        )}

        {/* El puente nunca pudo descargarlo: se dice con claridad */}
        {mediaError && (
          <div className="mt-1 mb-1 px-2 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30">
            <p className="text-[10px] text-red-300/90">
              ⚠ El puente de WhatsApp no pudo descargar este{' '}
              {declaredType === 'ptt' || declaredType === 'audio' ? 'audio' : 'archivo'}, así que no
              hay nada que reproducir. El bot tampoco pudo procesarlo.
            </p>
          </div>
        )}

        {/* Imagen.
            En el telefono ocupa el ancho de la burbuja y se puede abrir a
            tamano completo tocandola, como en WhatsApp: antes quedaba encajada
            en 208px de alto y una etiqueta impresa no se alcanzaba a leer. */}
        {hayImagen && (
          <div
            className={
              esSticker
                ? 'mt-1 mb-2 flex items-center justify-start'
                : 'mt-1 mb-2 rounded-lg overflow-hidden border border-white/10 bg-black/20 flex flex-col items-center justify-center gap-1'
            }
          >
            <a
              href={src!}
              target="_blank"
              rel="noopener noreferrer"
              className={esSticker ? 'block' : 'block w-full'}
            >
              <img
                src={src!}
                alt={aiDescription || imageCaption || (esSticker ? 'Sticker' : 'Imagen adjunta')}
                className={
                  esSticker
                    ? 'h-28 w-28 object-contain'
                    : 'w-full max-h-72 lg:max-h-52 object-contain transition-transform duration-200 lg:hover:scale-[1.02]'
                }
                onError={() => setEstadoMedia('no-disponible')}
              />
            </a>
            {aiDescription && (
              <details className="w-full px-2 pb-1">
                <summary className="text-[9px] text-slate-400 cursor-pointer hover:text-slate-300 select-none">
                  📋 Ver análisis de IA
                </summary>
                <p className="text-[10px] text-slate-400 mt-1 leading-snug">{aiDescription}</p>
              </details>
            )}
          </div>
        )}

        {/* Video y GIF.
            Un GIF de WhatsApp no viaja como .gif: viaja como un mp4 corto, así
            que los dos se pintan con el mismo reproductor. Hasta hoy el panel
            no tenía rama para 'video': el archivo se descargaba y se guardaba,
            pero en pantalla no aparecía nada. */}
        {hayVideo && (
          <div className="mt-1 mb-2 rounded-lg overflow-hidden border border-white/10 bg-black/20">
            <video
              controls
              preload="metadata"
              playsInline
              className="w-full max-h-72 lg:max-h-52 object-contain"
              onError={() => setEstadoMedia('no-disponible')}
            >
              <source src={src!} type={mimeType || 'video/mp4'} />
              Tu navegador no soporta la reproducción de video.
            </video>
          </div>
        )}

        {/* Reproductor de audio */}
        {hayAudio && (
          <div className="mt-1 mb-1 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] opacity-60">
              <span>🎤</span>
              <span>
                {declaredType === 'ptt' || declaredType === 'audio' ? 'Nota de voz' : 'Audio'}
                {sizeKB ? ` · ${sizeKB} KB` : ''}
              </span>
            </div>
            <audio controls preload="none" className="w-full max-w-xs h-8 accent-primary-500">
              <source src={src!} type={mimeType || 'audio/ogg'} />
              Tu navegador no soporta la reproducción de audio.
            </audio>
          </div>
        )}

        {/* Documento: PDF, ZIP, Excel…
            El archivo siempre estuvo descargado y guardado —los 48 de la base
            tienen su clave—, pero el panel no tenía rama para documento, así
            que en pantalla no aparecía nada que se pudiera abrir. Mismo fallo
            que tuvo el video. Se pinta como un botón, no como un párrafo. */}
        {hayDocumento && (
          <a
            href={src!}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 mb-2 flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors no-underline"
          >
            <span className="text-lg leading-none">📄</span>
            <span className="flex flex-col leading-tight">
              <span className="text-xs font-semibold tracking-wide">{etiquetaArchivo}</span>
              {sizeKB ? (
                <span className="text-[10px] opacity-60">
                  {sizeKB >= 1024 ? `${(sizeKB / 1024).toFixed(1)} MB` : `${sizeKB} KB`}
                </span>
              ) : null}
            </span>
            <span className="ml-auto text-[10px] uppercase tracking-wider opacity-70">Abrir</span>
          </a>
        )}

        {/* Transcripción del audio */}
        {esAudio &&
          transcription &&
          transcription !== '[Mensaje de voz]' &&
          transcription !== '[Error al procesar mensaje de voz]' && (
            <div className="mt-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <p className="text-[9px] uppercase tracking-wider opacity-50 mb-0.5">Transcripción</p>
              <p className="text-xs whitespace-pre-wrap leading-relaxed text-white/90">
                {transcription}
              </p>
            </div>
          )}

        {/* Texto */}
        {!esAudio && (
          <>
            {esImagen && imageCaption && (
              <TextoWhatsApp
                texto={imageCaption}
                className="texto-mensaje text-sm whitespace-pre-wrap leading-relaxed text-white"
              />
            )}
            {!esImagen && displayText && (
              <TextoWhatsApp
                texto={displayText}
                className="texto-mensaje text-sm whitespace-pre-wrap leading-relaxed text-white"
              />
            )}
          </>
        )}

        {/* Quien lo mando y a que hora, en un solo renglon al pie.
            Antes "🤖 BOT" iba en mayusculas y ocupaba una linea entera encima
            del mensaje: en el telefono, cada burbuja gastaba un renglon de
            pantalla en repetir algo que el color de la burbuja ya dice. */}
        <div className="flex items-center justify-end gap-1.5 pt-0.5 text-[10px] opacity-50">
          {isOutbound && <span className="font-medium">{isBot ? '🤖 Bot' : '👤 Tú'}</span>}
          <span>{time}</span>
        </div>
      </div>
      {!isOutbound && botonResponder}
    </div>
  );
}
