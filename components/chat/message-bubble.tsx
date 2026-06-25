import type { Message } from '@/lib/database.types';

export function MessageBubble({ message }: { message: Message }) {
  const isOutbound = message.direction === 'outbound';
  const isBot = message.sender === 'bot';
  const isHuman = message.sender === 'human';

  const time = new Date(message.created_at).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex w-full ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`
          ${isOutbound ? 'bubble-outbound' : 'bubble-inbound'}
          ${isBot ? 'bubble-bot' : ''}
          ${isHuman ? 'bubble-human' : ''}
          relative space-y-1 shadow-sm
        `}
      >
        {/* Label for sender if outbound */}
        {isOutbound && (
          <span className="block text-[10px] uppercase font-bold tracking-wider opacity-60 text-right">
            {isBot ? '🤖 Bot' : '👤 Humano'}
          </span>
        )}

        <p className="text-sm whitespace-pre-wrap leading-relaxed text-white">
          {message.content}
        </p>

        <span className="block text-[9px] opacity-50 text-right">
          {time}
        </span>
      </div>
    </div>
  );
}
