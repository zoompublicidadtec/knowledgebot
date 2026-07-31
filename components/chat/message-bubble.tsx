'use client';

import { useEffect, useState } from 'react';
import type { Message } from '@/lib/database.types';

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
 */
export function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === 'outbound';
  const isBot = message.sender === 'bot';
  const isHuman = message.sender === 'human';

  /**
   * Zona horaria FIJA a proposito.
   *
   * Sin `timeZone`, el servidor formatea la hora en UTC (el contenedor no
   * tiene zona) y el navegador en la del equipo. El texto no coincide y React
   * lanza el error #418 de hidratacion, que es el que aparecia en la consola.
   * Fijando Bogota, servidor y navegador escriben exactamente lo mismo, que
   * ademas es la hora que le sirve al dueno.
   */
  const time = new Date(message.created_at).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });

  const rawObj = message.raw as any;
  const inbound = rawObj?.data?.message;
  const media = inbound?.media;
  // Las fotos de producto que envia el bot se guardan en la raiz de `raw`, con
  // una ruta que sirve la propia app; esas no pasan por R2.
  const outboundMedia = rawObj?.media;

  /** Clave del objeto en R2: hay que cambiarla por una URL firmada. */
  const r2Key: string | null =
    media?.r2_key ||
    (typeof media?.url === 'string' && media.url.startsWith('media/') ? media.url : null);

  /** Direccion que ya se puede usar tal cual (ruta de la app o URL absoluta). */
  const directUrl: string | null =
    (typeof outboundMedia?.url === 'string' && outboundMedia.url) ||
    (typeof media?.url === 'string' && /^(https?:\/\/|\/)/.test(media.url) ? media.url : null) ||
    null;

  const mimeType: string = media?.mimetype || '';
  const declaredType: string = inbound?.mediaType || inbound?.type || outboundMedia?.type || '';
  const sizeKB = media?.size_bytes ? Math.max(1, Math.round(media.size_bytes / 1024)) : null;

  const esImagen = mimeType.startsWith('image/') || declaredType === 'image';
  const esAudio =
    mimeType.startsWith('audio/') || declaredType === 'ptt' || declaredType === 'audio';
  /** El puente no pudo bajar el archivo: se dice, no se disimula. */
  const mediaError = inbound?.mediaError === true;

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

  /**
   * El puente mete la cita dentro del texto (`[En respuesta a: "…"]`) porque el
   * agente necesita el referente para entender "de ese, cuanto por 200". Aqui
   * se quita, porque la cita ya se pinta arriba en su propia caja y si no
   * saldria dos veces.
   */
  const displayText = (message.content || '')
    .replace(/\n?\[En respuesta a: "[\s\S]*?"\]/g, '')
    .trim();
  let imageCaption = '';
  let aiDescription = '';

  /**
   * Texto de una imagen: lo que acompaña a la foto, y aparte el análisis de IA.
   *
   * Dos fallos que se veían en el panel y aquí se corrigen juntos:
   *
   *  1. El servidor anota las fotos del cliente como `[Imagen adjunta de
   *     cliente: ...]`, pero aquí solo se buscaba `[Foto del cliente: ...]`.
   *     Dos nombres para lo mismo, así que el análisis nunca se pintaba.
   *  2. Si no aparecía ninguna de esas etiquetas, el pie se quedaba vacío. Las
   *     fotos de producto que envía el bot llevan su nombre, su referencia y su
   *     precio en el texto, y el panel los tiraba: el dueño veía la imagen
   *     desnuda mientras el cliente sí recibía la información en WhatsApp.
   *
   * Ahora: sin etiqueta, el texto ES el pie de foto.
   */
  if (esImagen) {
    const descMatch = displayText.match(/\[(?:Foto del cliente|Imagen adjunta de cliente):([\s\S]*?)\]/);
    if (descMatch) {
      aiDescription = descMatch[1].trim();
      imageCaption = displayText.replace(descMatch[0], '').trim();
    } else {
      imageCaption = displayText;
    }
  }

  // El texto de un audio ES su transcripcion.
  const transcription = esAudio ? displayText : '';

  return (
    <div className={`flex w-full ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`
          ${isOutbound ? 'bubble-outbound' : 'bubble-inbound'}
          ${isBot ? 'bubble-bot' : ''}
          ${isHuman ? 'bubble-human' : ''}
          relative space-y-1 shadow-sm max-w-[85%] sm:max-w-md md:max-w-lg
        `}
      >
        {/* Label for sender if outbound */}
        {isOutbound && (
          <span className="block text-[10px] uppercase font-bold tracking-wider opacity-60 text-right">
            {isBot ? '🤖 Bot' : '👤 Humano'}
          </span>
        )}

        {/* Cita del mensaje citado (reply) - solo se muestra si hay cita */}
        {(() => {
          const quotedBody = rawObj?.data?.message?.quoted?.body;
          if (!quotedBody) return null;
          return (
            <div className="mb-1 px-2 py-1 border-l-2 border-slate-500 bg-slate-800/40 rounded text-[11px] text-slate-300 italic line-clamp-2">
              <span className="not-italic font-semibold text-slate-400">↩ Respondiendo a: </span>
              {quotedBody}
            </div>
          );
        })()}

        {/* Archivo en camino: el panel dice qué está haciendo */}
        {estadoMedia === 'cargando' && (
          <div className="mt-1 mb-1 flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-slate-400" />
            <span className="text-[10px] text-slate-400">
              Cargando {esAudio ? 'la nota de voz' : esImagen ? 'la imagen' : 'el archivo'}…
            </span>
          </div>
        )}

        {/* Se guardó, pero ya no está en el almacenamiento */}
        {estadoMedia === 'no-disponible' && (
          <div className="mt-1 mb-1 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <p className="text-[10px] text-amber-300/90">
              El archivo ya no está disponible en el almacenamiento.
              {sizeKB ? ` Era ${esAudio ? 'un audio' : 'una imagen'} de ${sizeKB} KB.` : ''}
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

        {/* Imagen */}
        {hayImagen && (
          <div className="mt-1 mb-2 rounded-lg overflow-hidden border border-white/10 max-h-60 bg-black/20 flex flex-col items-center justify-center gap-1">
            <img
              src={src!}
              alt="Imagen adjunta"
              className="max-w-full max-h-52 object-contain hover:scale-[1.02] transition-transform duration-200"
              onError={() => setEstadoMedia('no-disponible')}
            />
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
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-white">
                {imageCaption}
              </p>
            )}
            {!esImagen && displayText && (
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-white">{displayText}</p>
            )}
          </>
        )}

        <span className="block text-[9px] opacity-50 text-right">{time}</span>
      </div>
    </div>
  );
}
