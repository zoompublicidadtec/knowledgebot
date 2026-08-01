'use client';

import { useEffect, useState } from 'react';
import type { Message } from '@/lib/database.types';
import { leerMedia, quitarCita, separarPieYAnalisis } from '@/lib/whatsapp/message-preview';
import { horaDelMensaje } from '@/lib/chat/fechas';
import { TextoWhatsApp } from './whatsapp-text';

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
}: {
  message: Message;
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
  const { esImagen, esAudio, mimeType, declaredType, sizeKB, r2Key, directUrl, mediaError } = media;

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

  return (
    <div className={`flex w-full ${isOutbound ? 'justify-end' : 'justify-start'}`}>
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

        {/* Imagen.
            En el telefono ocupa el ancho de la burbuja y se puede abrir a
            tamano completo tocandola, como en WhatsApp: antes quedaba encajada
            en 208px de alto y una etiqueta impresa no se alcanzaba a leer. */}
        {hayImagen && (
          <div className="mt-1 mb-2 rounded-lg overflow-hidden border border-white/10 bg-black/20 flex flex-col items-center justify-center gap-1">
            <a href={src!} target="_blank" rel="noopener noreferrer" className="block w-full">
              <img
                src={src!}
                alt={aiDescription || imageCaption || 'Imagen adjunta'}
                className="w-full max-h-72 lg:max-h-52 object-contain transition-transform duration-200 lg:hover:scale-[1.02]"
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
    </div>
  );
}
