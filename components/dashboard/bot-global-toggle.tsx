'use client';

import { useState, useTransition } from 'react';
import { Robot, Power } from '@phosphor-icons/react';

interface BotGlobalToggleProps {
  initialEnabled: boolean;
}

export function BotGlobalToggle({ initialEnabled }: BotGlobalToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleToggle() {
    const newValue = !enabled;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/agent/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: newValue }),
        });
        const data = await res.json();
        if (data.success) {
          setEnabled(newValue);
        } else {
          setError(data.error || 'Error al cambiar el estado');
        }
      } catch {
        setError('Error de conexión');
      }
    });
  }

  return (
    <div
      className="card animate-slide-up"
      style={{
        borderColor: enabled
          ? 'rgba(16, 185, 129, 0.3)'
          : 'rgba(244, 63, 94, 0.3)',
        background: enabled
          ? 'rgba(16, 185, 129, 0.05)'
          : 'rgba(244, 63, 94, 0.05)',
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-300"
            style={{
              background: enabled
                ? 'rgba(16, 185, 129, 0.2)'
                : 'rgba(244, 63, 94, 0.2)',
            }}
          >
            {enabled ? (
              <Robot size={24} weight="fill" className="text-emerald-400" />
            ) : (
              <Power size={24} weight="fill" className="text-rose-400" />
            )}
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">
              Bot Oscar Herrera
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              <div
                className="w-2 h-2 rounded-full transition-all duration-300"
                style={{
                  background: enabled ? '#34d399' : '#fb7185',
                  boxShadow: enabled
                    ? '0 0 8px rgba(52, 211, 153, 0.6)'
                    : '0 0 8px rgba(251, 113, 133, 0.6)',
                }}
              />
              <span
                className="text-xs font-medium"
                style={{
                  color: enabled
                    ? 'rgba(52, 211, 153, 0.9)'
                    : 'rgba(251, 113, 133, 0.9)',
                }}
              >
                {enabled ? 'Respondiendo a clientes' : 'Pausado — solo recibiendo mensajes'}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={handleToggle}
          disabled={isPending}
          className={`toggle ${enabled ? 'active' : ''}`}
          style={{
            width: '52px',
            height: '28px',
            borderRadius: '14px',
            opacity: isPending ? 0.6 : 1,
            background: enabled
              ? 'linear-gradient(135deg, #10b981, #059669)'
              : 'rgba(148, 163, 184, 0.25)',
          }}
          title={enabled ? 'Clic para pausar el bot' : 'Clic para activar el bot'}
          aria-label={enabled ? 'Pausar bot' : 'Activar bot'}
          id="bot-global-toggle"
        />
      </div>

      {error && (
        <div className="mt-3 p-2 rounded-lg text-xs bg-rose-500/10 border border-rose-500/20 text-rose-400">
          {error}
        </div>
      )}

      <p
        className="text-xs mt-3 leading-relaxed"
        style={{ color: 'rgba(148, 163, 184, 0.5)' }}
      >
        {enabled
          ? 'El bot está atendiendo automáticamente todas las conversaciones activas.'
          : 'Los mensajes se reciben y guardan, pero el bot no responde. Ideal para clasificar chats antes de activar.'}
      </p>
    </div>
  );
}
