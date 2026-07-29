'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Cpu, ArrowsClockwise, CheckCircle, Warning, XCircle,
  ChatCircleDots, Package, WhatsappLogo, Wrench,
} from '@phosphor-icons/react';

type Level = 'ok' | 'warn' | 'error';

interface Check {
  id: string; label: string; level: Level;
  value: string; detail: string; fix?: string;
}

interface Line {
  line_key: string; display_name: string; phone_number: string | null;
  level: Level; state: string; detail: string; fix?: string; keepAliveErrors: number;
}

interface Health {
  checks: Check[];
  lines: Line[];
  activity: { date: string; in: number; out: number }[];
  totals: {
    messages14d: number; conversations14d: number;
    productsActive: number; productsQuotable: number;
  };
  checkedAt: string;
}

const STYLE: Record<Level, { ring: string; text: string; bg: string; Icon: any }> = {
  ok: { ring: 'border-emerald-500/30', text: 'text-emerald-400', bg: 'bg-emerald-500/10', Icon: CheckCircle },
  warn: { ring: 'border-amber-500/30', text: 'text-amber-400', bg: 'bg-amber-500/10', Icon: Warning },
  error: { ring: 'border-rose-500/30', text: 'text-rose-400', bg: 'bg-rose-500/10', Icon: XCircle },
};

export default function ControlRoomPage() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'No se pudo leer el estado');
      setData(body);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const problemas = (data?.checks || []).filter(c => c.level !== 'ok').length
    + (data?.lines || []).filter(l => l.level !== 'ok').length;

  const maxAct = Math.max(1, ...(data?.activity || []).map(a => a.in + a.out));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
              <Cpu size={20} weight="fill" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">Centro de Control</h1>
          </div>
          <p className="text-xs text-slate-400">
            Estado real del sistema. Cada punto en rojo o ámbar indica qué falla y cómo repararlo.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {data && (
            <span className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${
              problemas === 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
            }`}>
              {problemas === 0 ? 'Todo operativo' : `${problemas} punto(s) a revisar`}
            </span>
          )}
          <button
            onClick={load}
            disabled={loading}
            className="btn-ghost py-1.5 px-3 text-xs flex items-center gap-1.5 rounded-lg disabled:opacity-50"
          >
            <ArrowsClockwise size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Revisando...' : 'Revisar ahora'}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl text-sm bg-rose-500/10 border border-rose-500/20 text-rose-400">
          {error}
        </div>
      )}

      {!data && loading && (
        <div className="text-center py-16 text-slate-500 text-sm">Consultando el estado del sistema...</div>
      )}

      {data && (
        <>
          {/* KPIs reales */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Conversaciones (14 días)', value: data.totals.conversations14d, Icon: ChatCircleDots },
              { label: 'Mensajes (14 días)', value: data.totals.messages14d, Icon: WhatsappLogo },
              { label: 'Productos activos', value: data.totals.productsActive, Icon: Package },
              { label: 'Productos cotizables', value: data.totals.productsQuotable, Icon: Wrench },
            ].map(k => (
              <div key={k.label} className="glass rounded-2xl p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    {k.label}
                  </span>
                  <k.Icon size={18} className="text-slate-500" />
                </div>
                <h3 className="text-2xl font-black text-white mt-2">
                  {k.value.toLocaleString('es-CO')}
                </h3>
              </div>
            ))}
          </div>

          {/* Diagnóstico */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.checks.map(c => {
              const s = STYLE[c.level];
              return (
                <div key={c.id} className={`glass rounded-2xl p-5 border ${s.ring}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${s.bg} ${s.text}`}>
                        <s.Icon size={18} weight="fill" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-white">{c.label}</h3>
                        <p className={`text-xs font-semibold ${s.text}`}>{c.value}</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-3 leading-relaxed">{c.detail}</p>
                  {c.fix && (
                    <p className="text-[11px] text-slate-300 mt-2 pt-2 border-t border-white/5">
                      <span className="font-semibold text-slate-200">Qué hacer: </span>{c.fix}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Líneas */}
          {data.lines.length > 0 && (
            <div className="glass rounded-2xl p-6">
              <h2 className="text-sm font-bold text-white mb-1">Líneas de WhatsApp</h2>
              <p className="text-[11px] text-slate-400 mb-4">
                Estado verificado contra el puente, no contra lo que dice la base de datos.
              </p>
              <div className="space-y-3">
                {data.lines.map(l => {
                  const s = STYLE[l.level];
                  return (
                    <div key={l.line_key} className={`p-4 rounded-xl bg-white/2 border ${s.ring}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <s.Icon size={16} weight="fill" className={s.text} />
                          <span className="text-sm font-bold text-white">{l.display_name}</span>
                          <span className="text-[11px] text-slate-500 font-mono">
                            {l.phone_number || 'sin número'}
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${s.bg} ${s.text}`}>
                          {l.state}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-2">{l.detail}</p>
                      {l.fix && (
                        <p className="text-[11px] text-slate-300 mt-1">
                          <span className="font-semibold">Qué hacer: </span>{l.fix}
                        </p>
                      )}
                      {l.keepAliveErrors > 0 && (
                        <p className="text-[10px] text-amber-400/80 mt-1">
                          {l.keepAliveErrors} error(es) de conexión acumulados.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actividad real */}
          <div className="glass rounded-2xl p-6">
            <h2 className="text-sm font-bold text-white mb-1">Actividad de los últimos 14 días</h2>
            <p className="text-[11px] text-slate-400 mb-5">
              Mensajes recibidos de clientes y respuestas enviadas.
            </p>
            <div className="flex items-end gap-1.5 h-40">
              {data.activity.map(a => {
                const total = a.in + a.out;
                return (
                  <div key={a.date} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="w-full flex flex-col justify-end h-32" title={`${a.date}: ${a.in} recibidos, ${a.out} enviados`}>
                      <div className="w-full bg-indigo-500/70 rounded-t transition-all group-hover:bg-indigo-400"
                           style={{ height: `${(a.out / maxAct) * 100}%` }} />
                      <div className="w-full bg-emerald-500/70 transition-all group-hover:bg-emerald-400"
                           style={{ height: `${(a.in / maxAct) * 100}%` }} />
                    </div>
                    <span className="text-[9px] text-slate-500">{a.date.slice(8)}</span>
                    <span className="text-[9px] text-slate-600">{total || ''}</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-4 text-[10px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70" /> Recibidos
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500/70" /> Enviados
              </span>
            </div>
          </div>

          <p className="text-[10px] text-slate-600 text-center">
            Última revisión: {new Date(data.checkedAt).toLocaleString('es-CO')} · se actualiza cada minuto
          </p>
        </>
      )}
    </div>
  );
}
