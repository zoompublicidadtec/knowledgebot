import type { Message } from '@/lib/database.types';

export function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === 'outbound';
  const isBot = message.sender === 'bot';
  const isHuman = message.sender === 'human';

  const time = new Date(message.created_at).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Extract media from raw JSON stored in the database
  const rawObj = message.raw as any;
  const media = rawObj?.data?.message?.media;
  const mediaUrl = media?.url;
  const mimeType = media?.mimetype || '';
  const hasImage = mediaUrl && mimeType.startsWith('image/');
  const hasAudio = mediaUrl && (mimeType.startsWith('audio/') || mediaUrl.match(/\.(ogg|mp3|mpeg|wav)$/i));

  // Detect voice message (ptt = push-to-talk / audio message from WhatsApp)
  const rawMsgType = rawObj?.data?.message?.type;
  const isVoiceNote = rawMsgType === 'ptt' || rawMsgType === 'audio';

  // Extract the human-visible caption (before the AI image description)
  let displayText = message.content || '';
  let imageCaption = '';
  let aiDescription = '';

  if (hasImage && displayText.includes('[Foto del cliente:')) {
    const descMatch = displayText.match(/\[Foto del cliente:([\s\S]*?)\]/);
    if (descMatch) {
      aiDescription = descMatch[1].trim();
      imageCaption = displayText.replace(descMatch[0], '').trim();
    } else {
      imageCaption = displayText;
    }
  }

  // For audio messages, the content IS the transcription
  const transcription = hasAudio ? displayText : '';

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

        {/* Display Image */}
        {hasImage && (
          <div className="mt-1 mb-2 rounded-lg overflow-hidden border border-white/10 max-h-60 bg-black/20 flex flex-col items-center justify-center gap-1">
            <img
              src={mediaUrl}
              alt="Imagen adjunta"
              className="max-w-full max-h-52 object-contain hover:scale-[1.02] transition-transform duration-200"
            />
            {/* Show AI description as tooltip / collapsed caption for operators */}
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

        {/* Display Audio Player */}
        {hasAudio && (
          <div className="mt-1 mb-1 space-y-1">
            <div className="flex items-center gap-1.5 text-[10px] opacity-60">
              <span>🎤</span>
              <span>{isVoiceNote ? 'Nota de voz' : 'Audio'}</span>
            </div>
            <audio controls className="w-full max-w-xs h-8 accent-primary-500">
              <source src={mediaUrl} type={mimeType || 'audio/ogg'} />
              Tu navegador no soporta la reproducción de audio.
            </audio>
          </div>
        )}

        {/* Transcription block for audio messages */}
        {hasAudio && transcription && transcription !== '[Mensaje de voz]' && transcription !== '[Error al procesar mensaje de voz]' && (
          <div className="mt-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10">
            <p className="text-[9px] uppercase tracking-wider opacity-50 mb-0.5">Transcripción</p>
            <p className="text-xs whitespace-pre-wrap leading-relaxed text-white/90">{transcription}</p>
          </div>
        )}

        {/* Text content (for non-audio / non-image messages, or image caption) */}
        {!hasAudio && (
          <>
            {hasImage && imageCaption && (
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-white">{imageCaption}</p>
            )}
            {!hasImage && displayText && (
              <p className="text-sm whitespace-pre-wrap leading-relaxed text-white">{displayText}</p>
            )}
          </>
        )}

        <span className="block text-[9px] opacity-50 text-right">
          {time}
        </span>
      </div>
    </div>
  );
}
