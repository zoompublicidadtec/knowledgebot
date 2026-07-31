'use client';

import { useState, useEffect, useRef } from 'react';
import { Bell, ChatCircleDots, X, Clock, Check } from '@phosphor-icons/react';
import Link from 'next/link';

/**
 * TIPOS DE AVISO, en orden de urgencia.
 *
 * La campana vigilaba un interruptor (`bot_active = false`), no una situación.
 * Con 8 líneas corporativas, varias se usan para procesos internos: quedaban
 * avisando para siempre y una campana siempre encendida no avisa de nada.
 * Ahora agrupa por lo que de verdad necesita a una persona, y los chats de la
 * etapa 'ignore' no entran nunca.
 */
const TIPOS = {
  molesto: {
    titulo: 'Clientes molestos',
    detalle: 'Atiéndalos primero',
    avatar: 'bg-rose-600/30 text-rose-100 ring-2 ring-rose-400',
    cabecera: 'text-rose-300',
    punto: 'bg-rose-500',
  },
  listo: {
    titulo: 'Listos para comprar',
    detalle: 'Aceptaron: falta completar el pedido',
    avatar: 'bg-emerald-500/30 text-emerald-100 ring-2 ring-emerald-400',
    cabecera: 'text-emerald-300',
    punto: 'bg-emerald-500',
  },
  ayuda: {
    titulo: 'Piden hablar con una persona',
    detalle: 'El bot quedó apagado en ese chat',
    avatar: 'bg-amber-500/25 text-amber-100 ring-2 ring-amber-400',
    cabecera: 'text-amber-300',
    punto: 'bg-amber-500',
  },
} as const;

type TipoAviso = keyof typeof TIPOS;

interface HandoffAlert {
  tipo: TipoAviso;
  botActive?: boolean;
  conversationId: string;
  contactName: string | null;
  contactPhone: string;
  lastMessageAt: string;
  lastMessage: string;
  lastMessageDirection: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<HandoffAlert[]>([]);
  const [count, setCount] = useState(0);
  const [porTipo, setPorTipo] = useState<{ molesto: number; listo: number; ayuda: number }>({
    molesto: 0, listo: 0, ayuda: 0,
  });
  const [loading, setLoading] = useState(false);
  const [animate, setAnimate] = useState(false);
  const prevCount = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchAlerts = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/agent/handoff-alerts', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const newCount = data.count ?? 0;

      // Animate bell if new alerts arrived
      if (newCount > prevCount.current && prevCount.current !== 0) {
        setAnimate(true);
        setTimeout(() => setAnimate(false), 1000);
      }
      prevCount.current = newCount;
      setAlerts(data.alerts ?? []);
      setCount(newCount);
      setPorTipo(data.porTipo ?? { molesto: 0, listo: 0, ayuda: 0 });
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  // Resolve a handoff alert: reactivates the bot so the alert disappears.
  const resolveAlert = async (conversationId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const res = await fetch('/api/agent/handoff-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      });
      if (res.ok) {
        // Remove from the list immediately for instant feedback
        setAlerts(prev => prev.filter(a => a.conversationId !== conversationId));
        setCount(prev => Math.max(0, prev - 1));
      }
    } catch {
      // silent
    }
  };

  // Resolve ALL alerts at once
  const resolveAll = async () => {
    try {
      await Promise.all(alerts.map(a =>
        fetch('/api/agent/handoff-alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: a.conversationId }),
        })
      ));
      setAlerts([]);
      setCount(0);
    } catch {
      // silent
    }
  };

  useEffect(() => {
    fetchAlerts();
    // Poll every 30 seconds
    const interval = setInterval(fetchAlerts, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell button */}
      <button
        id="notification-bell-btn"
        onClick={() => { setOpen(!open); if (!open) fetchAlerts(); }}
        className={`relative flex items-center justify-center w-10 h-10 rounded-xl transition-all duration-200 hover:bg-white/10 ${open ? 'bg-white/10' : ''}`}
        title="Alertas de asistencia"
        aria-label={`Notificaciones: ${count} pendientes`}
      >
        <Bell
          size={22}
          weight={count > 0 ? 'fill' : 'regular'}
          className={`transition-all duration-300 ${
            porTipo.molesto > 0
              ? 'text-rose-400'
              : porTipo.listo > 0
                ? 'text-emerald-400'
                : count > 0
                  ? 'text-amber-400'
                  : 'text-slate-400'
          } ${animate ? 'animate-bounce' : ''}`}
        />
        {/* Badge */}
        {count > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold text-white px-1"
            style={
              porTipo.molesto > 0
                ? { background: 'linear-gradient(135deg, #f43f5e, #be123c)', boxShadow: '0 0 8px rgba(244,63,94,0.7)' }
                : porTipo.listo > 0
                  ? { background: 'linear-gradient(135deg, #10b981, #047857)', boxShadow: '0 0 8px rgba(16,185,129,0.6)' }
                  : { background: 'linear-gradient(135deg, #f59e0b, #b45309)', boxShadow: '0 0 8px rgba(245,158,11,0.6)' }
            }
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className="absolute right-0 top-12 z-[200] w-80 rounded-2xl overflow-hidden shadow-2xl border"
          style={{
            background: 'rgba(15, 23, 42, 0.98)',
            backdropFilter: 'blur(24px)',
            borderColor: 'rgba(99, 102, 241, 0.2)',
            boxShadow: '0 25px 50px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2">
              <Bell size={16} weight="fill" className="text-amber-400" />
              <span className="text-sm font-semibold text-white">Necesitan una persona</span>
              {count > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>
                  {count} pendiente{count !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {count > 0 && (
                <button
                  onClick={resolveAll}
                  title="Reactivar el bot en los chats que pidieron ayuda"
                  className="text-[10px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Atender todas
                </button>
              )}
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {loading && alerts.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(16,185,129,0.1)' }}>
                  <Bell size={20} className="text-emerald-400" />
                </div>
                <p className="text-xs text-center" style={{ color: 'rgba(148,163,184,0.5)' }}>
                  Todo en orden. Sin alertas pendientes.
                </p>
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {(Object.keys(TIPOS) as TipoAviso[]).map((tipo) => {
                  const delTipo = alerts.filter(a => (a.tipo || 'ayuda') === tipo);
                  if (delTipo.length === 0) return null;
                  const conf = TIPOS[tipo];
                  return (
                    <div key={tipo} className="pt-1">
                      {/* Cabecera del grupo: dice qué es y cuántos hay, para
                          no tener que deducirlo por el color. */}
                      <div className="flex items-center gap-2 px-2 pb-1">
                        <span className={`w-2 h-2 rounded-full ${conf.punto}`} />
                        <span className={`text-[11px] font-bold ${conf.cabecera}`}>
                          {conf.titulo}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {delTipo.length}
                        </span>
                        <span className="text-[9px] text-slate-600 truncate">
                          · {conf.detalle}
                        </span>
                      </div>
                      <div className="space-y-1">
                {delTipo.map((alert) => (
                  <div
                    key={alert.conversationId}
                    className="flex items-start gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors group"
                  >
                    {/* Avatar */}
                    <div
                      className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ${conf.avatar}`}
                    >
                      {(alert.contactName || alert.contactPhone).charAt(0).toUpperCase()}
                    </div>

                    {/* Info (clickable to open conversation) */}
                    <Link href={`/conversaciones/${alert.conversationId}`} onClick={() => setOpen(false)} className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-sm font-medium text-white truncate">
                          {alert.contactName || alert.contactPhone}
                        </p>
                        <span className="flex-shrink-0 flex items-center gap-0.5 text-[10px]" style={{ color: 'rgba(148,163,184,0.4)' }}>
                          <Clock size={10} />
                          {timeAgo(alert.lastMessageAt)}
                        </span>
                      </div>
                      {alert.contactName && (
                        <p className="text-[10px] mb-0.5" style={{ color: 'rgba(148,163,184,0.4)' }}>
                          {alert.contactPhone}
                        </p>
                      )}
                      {alert.lastMessage && (
                        <p className="text-xs truncate" style={{ color: 'rgba(148,163,184,0.6)' }}>
                          {alert.lastMessageDirection === 'inbound' ? '👤 ' : '🤖 '}
                          {alert.lastMessage}
                        </p>
                      )}
                    </Link>

                    {/* Solo tiene sentido donde el aviso ES que el bot está
                        apagado. En 'molesto' y 'listo' el aviso viene de la
                        etapa del cliente: se quita moviéndolo en el pipeline,
                        no encendiendo el bot. */}
                    {tipo === 'ayuda' && (
                    <button
                      onClick={(e) => resolveAlert(alert.conversationId, e)}
                      title="Marcar como atendida (reactivar bot)"
                      className="flex-shrink-0 mt-1 w-7 h-7 rounded-lg flex items-center justify-center text-slate-600 hover:bg-emerald-500/20 hover:text-emerald-400 transition-colors"
                    >
                      <Check size={14} weight="bold" />
                    </button>
                    )}
                  </div>
                ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {alerts.length > 0 && (
            <div className="px-4 py-3 border-t" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <Link
                href="/conversaciones"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-2 w-full text-xs font-medium text-primary-400 hover:text-primary-300 transition-colors"
              >
                <ChatCircleDots size={14} />
                Ver todas las conversaciones
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
