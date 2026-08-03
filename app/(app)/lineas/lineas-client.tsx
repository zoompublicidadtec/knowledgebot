'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Pulse,
  Phone,
  Plug,
  Warning,
  ArrowsClockwise,
  SpinnerGap,
  HardDrives,
  Clock,
  Bug,
  CheckCircle,
  XCircle,
  DesktopTower,
} from '@phosphor-icons/react';

interface LineDiagnostic {
  line_key: string;
  display_name: string;
  phone_number: string | null;
  dbStatus: 'connected' | 'awaiting_qr' | 'disconnected';
  dbLastConnectedAt: string | null;
  loaded: boolean;
  runtimeStatus: string | null;
  connectedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  keepAliveErrors: number;
  sessionOnDisk: boolean;
  isZombie: boolean;
  /**
   * La línea se desconecta a intervalos regulares (no una vez suelta: un
   * reloj). Trae cada cuántos minutos y cuándo fue el último.
   */
  cicloDeCortes: { veces: number; cadaMinutos: number; ultimoISO: string } | null;
}

interface DiagnosticResponse {
  lines: LineDiagnostic[];
  bridgeReachable: boolean;
  bridgeTime: string | null;
  checkedAt: string;
}

interface LineError {
  id: string;
  line_key: string;
  error_type: string;
  severity: 'warn' | 'error';
  message: string;
  context: Record<string, any> | null;
  created_at: string;
}

interface ErrorsResponse {
  errors: LineError[];
  summary: Record<string, { total: number; errors: number; warns: number; lastAt: string | null }>;
  windowHours: number;
  checkedAt: string;
}

// Etiquetas legibles para cada tipo de error.
const ERROR_TYPE_LABELS: Record<string, string> = {
  transcription: 'Transcripción de audio',
  media_download: 'Descarga de media',
  webhook: 'Webhook',
  keep_alive: 'Keep-alive',
  db_insert: 'Inserción en BD',
  describe_image: 'Descripción de imagen',
  connection: 'Conexión',
  other: 'Otro',
};

// Convierte un ISO timestamp en "hace Xh Ym" legible.
function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'recién';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `hace ${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `hace ${d}d ${h % 24}h`;
}

export default function LineasClient() {
  const [data, setData] = useState<DiagnosticResponse | null>(null);
  const [errorsData, setErrorsData] = useState<ErrorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiagnostic = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const res = await fetch('/api/whatsapp-lines/diagnostic', { cache: 'no-store' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const json: DiagnosticResponse = await res.json();
      setData(json);
      setError(null);
    } catch (e: any) {
      setError(e.message || 'Error al cargar el diagnóstico');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchErrors = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp-lines/errors?hours=24&limit=50', { cache: 'no-store' });
      if (res.ok) {
        const json: ErrorsResponse = await res.json();
        setErrorsData(json);
      }
    } catch {
      // Silencioso: el panel de estado funciona sin errores.
    }
  }, []);

  // Carga inicial + polling cada 15s (estado) y 30s (errores).
  useEffect(() => {
    fetchDiagnostic();
    fetchErrors();
    const id = setInterval(() => fetchDiagnostic(true), 15000);
    const idErr = setInterval(fetchErrors, 30000);
    return () => { clearInterval(id); clearInterval(idErr); };
  }, [fetchDiagnostic, fetchErrors]);

  // Estado derivado global.
  const lines = data?.lines || [];
  const downCount = lines.filter(l => l.isZombie || l.dbStatus !== 'connected').length;
  const zombieCount = lines.filter(l => l.isZombie).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <SpinnerGap size={28} className="animate-spin text-primary-400 mr-3" />
        Cargando estado de las líneas...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight flex items-center gap-2">
            <Pulse size={24} className={downCount > 0 ? 'text-rose-400' : 'text-emerald-400'} weight="fill" />
            Líneas de WhatsApp
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Seguimiento en tiempo real del estado de cada línea.
          </p>
        </div>
        <button
          onClick={() => { fetchDiagnostic(); fetchErrors(); }}
          disabled={refreshing}
          className="btn-primary flex items-center gap-2"
        >
          {refreshing ? <SpinnerGap size={16} className="animate-spin" /> : <ArrowsClockwise size={16} />}
          Actualizar
        </button>
      </div>

      {/* Resumen rápido */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          icon={<CheckCircle size={18} weight="fill" className="text-emerald-400" />}
          label="Conectadas"
          value={lines.filter(l => l.dbStatus === 'connected' && l.loaded && !l.isZombie).length}
          tone="emerald"
        />
        <SummaryCard
          icon={<XCircle size={18} weight="fill" className="text-rose-400" />}
          label="Caídas"
          value={downCount}
          tone={downCount > 0 ? 'rose' : 'slate'}
        />
        <SummaryCard
          icon={<Bug size={18} weight="fill" className="text-amber-400" />}
          label="Zombies"
          value={zombieCount}
          tone={zombieCount > 0 ? 'amber' : 'slate'}
        />
        <SummaryCard
          icon={<DesktopTower size={18} weight="fill" className={data?.bridgeReachable ? 'text-emerald-400' : 'text-rose-400'} />}
          label="Puente"
          value={data?.bridgeReachable ? 'OK' : 'Caído'}
          tone={data?.bridgeReachable ? 'emerald' : 'rose'}
          isText
        />
      </div>

      {/* Aviso si el puente está caído */}
      {data && !data.bridgeReachable && (
        <div className="glass p-4 rounded-2xl border border-rose-500/30 bg-rose-500/5 flex items-start gap-3">
          <Warning size={20} className="text-rose-400 mt-0.5" weight="fill" />
          <div className="text-sm">
            <p className="font-semibold text-rose-300">No se pudo contactar al puente de WhatsApp.</p>
            <p className="text-xs text-slate-400 mt-1">
              El servicio del puente (puerto 3004) no responde. Los datos a continuación pueden estar desactualizados.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="glass p-4 rounded-2xl border border-rose-500/30 bg-rose-500/5 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Lista de líneas */}
      <div className="space-y-3">
        {lines.length === 0 && (
          <div className="glass p-8 rounded-2xl text-center border border-dashed border-white/10">
            <Phone size={28} className="mx-auto text-slate-500 mb-2" weight="light" />
            <p className="text-sm text-slate-400">No hay líneas configuradas.</p>
          </div>
        )}

        {lines.map(line => (
          <LineCard key={line.line_key} line={line} onRenombrada={fetchDiagnostic} />
        ))}
      </div>

      {/* Errores operacionales recientes */}
      <RecentErrors errorsData={errorsData} />

      {/* Pie: info de sincronización */}
      {data && (
        <div className="text-[11px] text-slate-500 flex items-center gap-2">
          <Clock size={12} />
          Última verificación: {timeAgo(data.checkedAt)}
          {data.bridgeTime && (
            <span className="ml-2">· Hora del puente: {new Date(data.bridgeTime).toLocaleTimeString('es-CO')}</span>
          )}
          <span className="ml-2">· Se actualiza cada 15s</span>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon, label, value, tone, isText,
}: { icon: React.ReactNode; label: string; value: number | string; tone: 'emerald' | 'rose' | 'amber' | 'slate'; isText?: boolean }) {
  const toneMap = {
    emerald: 'border-emerald-500/20',
    rose: 'border-rose-500/30',
    amber: 'border-amber-500/30',
    slate: 'border-white/10',
  };
  return (
    <div className={`glass p-3 rounded-xl border ${toneMap[tone]} flex flex-col gap-1`}>
      <div className="flex items-center gap-2 text-[11px] text-slate-400 uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className={`text-xl font-bold ${tone === 'rose' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : tone === 'emerald' ? 'text-emerald-300' : 'text-white'}`}>
        {isText ? value : value}
      </div>
    </div>
  );
}

function LineCard({ line, onRenombrada }: { line: LineDiagnostic; onRenombrada?: () => void }) {
  /**
   * Renombrar la línea.
   *
   * `line_key` (linea_1, linea_2…) NO se toca: es la clave con la que se
   * enrutan los mensajes, se nombran las sesiones en disco y se agrupan las
   * conversaciones. Lo que se cambia es el nombre visible, que antes solo se
   * podía fijar al crear la línea: todas quedaban como "Línea 1", "Línea 2"…
   * y con 8 líneas eso no le dice a nadie de quién es cada una.
   */
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(line.display_name || line.line_key);
  const [guardando, setGuardando] = useState(false);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);

  async function guardarNombre() {
    const limpio = nombre.trim();
    if (!limpio) { setErrorNombre('El nombre no puede quedar vacío'); return; }
    setGuardando(true);
    setErrorNombre(null);
    try {
      const res = await fetch(`/api/whatsapp-lines/${line.line_key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: limpio }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorNombre(json?.error || 'No se pudo guardar el nombre');
        return;
      }
      setEditando(false);
      onRenombrada?.();
    } catch (e) {
      setErrorNombre('No se pudo guardar el nombre');
    } finally {
      setGuardando(false);
    }
  }

  const isConnected = line.dbStatus === 'connected' && line.loaded && !line.isZombie;
  const isZombie = line.isZombie;

  // Color de borde y estado.
  const borderColor = isZombie
    ? 'border-amber-500/40'
    : isConnected
      ? 'border-emerald-500/20'
      : 'border-rose-500/30';
  const bgTint = isZombie
    ? 'bg-amber-500/5'
    : isConnected
      ? 'bg-emerald-500/5'
      : 'bg-rose-500/5';

  return (
    <div className={`glass p-5 rounded-2xl border ${borderColor} ${bgTint}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            isConnected ? 'bg-emerald-500/20' : isZombie ? 'bg-amber-500/20' : 'bg-rose-500/20'
          }`}>
            <Phone size={20} className={isConnected ? 'text-emerald-400' : isZombie ? 'text-amber-400' : 'text-rose-400'} />
          </div>
          <div>
            {editando ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={nombre}
                    maxLength={60}
                    onChange={e => setNombre(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') guardarNombre();
                      if (e.key === 'Escape') { setEditando(false); setNombre(line.display_name || line.line_key); setErrorNombre(null); }
                    }}
                    className="input text-sm py-1 px-2 w-56"
                    placeholder="WhatsApp de Juanita · Local 211"
                  />
                  <button
                    onClick={guardarNombre}
                    disabled={guardando}
                    className="btn-primary py-1 px-2.5 text-[11px] rounded-lg disabled:opacity-50"
                  >
                    {guardando ? '…' : 'Guardar'}
                  </button>
                  <button
                    onClick={() => { setEditando(false); setNombre(line.display_name || line.line_key); setErrorNombre(null); }}
                    className="btn-ghost py-1 px-2 text-[11px] rounded-lg"
                  >
                    Cancelar
                  </button>
                </div>
                {errorNombre && <span className="text-[10px] text-rose-400">{errorNombre}</span>}
              </div>
            ) : (
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                {line.display_name || line.line_key}
                <button
                  onClick={() => setEditando(true)}
                  className="text-[10px] font-medium text-slate-500 hover:text-primary-300 transition-colors"
                  title="Ponerle un nombre a esta línea"
                >
                  Renombrar
                </button>
                {isZombie && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wide">
                    ⚠ Zombie
                  </span>
                )}
              </h3>
            )}
            <p className="text-xs text-slate-400 mt-0.5">
              {line.line_key} · {line.phone_number || 'Sin número'}
            </p>
          </div>
        </div>
        <StatusBadge isConnected={isConnected} isZombie={isZombie} loaded={line.loaded} />
      </div>

      {/*
        LÍNEA QUE SE CAE EN CICLO.

        Va ARRIBA de todo y con la reparación escrita, porque este fallo es
        invisible: la línea se cae unos segundos y vuelve sola, así que en el
        panel siempre se ve «conectada». El 02-ago-2026 una línea llevaba horas
        cayéndose cada 50m04s y solo se descubrió leyendo registros a mano. Con
        8 puntos de venta eso no puede depender de que alguien sospeche.
      */}
      {line.cicloDeCortes && (
        <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2">
          <Warning size={16} className="text-amber-400 mt-0.5 shrink-0" weight="fill" />
          <div className="text-[11px] leading-relaxed">
            <p className="text-amber-200 font-semibold">
              Esta línea se desconecta sola cada {line.cicloDeCortes.cadaMinutos} minutos
              {' '}({line.cicloDeCortes.veces} veces).
            </p>
            <p className="text-slate-300 mt-1">
              Vuelve sola en unos segundos, así que casi no se nota, pero no es
              normal. Suele ser algo trabado en la sesión de este número —no en
              el sistema: las otras líneas siguen igual.
            </p>
            <p className="text-amber-100 mt-1">
              <span className="font-semibold">Qué hacer:</span> desvincular este
              número y volver a escanear el QR. Le da una sesión nueva y limpia.
            </p>
          </div>
        </div>
      )}

      {/* Grilla de diagnóstico */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <DiagRow
          icon={<Clock size={14} className="text-slate-400" />}
          label="Estado desde"
          value={
            isConnected
              ? (line.connectedAt ? `${timeAgo(line.connectedAt)} (${new Date(line.connectedAt).toLocaleTimeString('es-CO')})` : '—')
              : (line.lastErrorAt ? `Caída ${timeAgo(line.lastErrorAt)}` : '—')
          }
        />
        <DiagRow
          icon={<HardDrives size={14} className={line.sessionOnDisk ? 'text-emerald-400' : 'text-rose-400'} />}
          label="Sesión en disco"
          value={line.sessionOnDisk ? '✓ Intacta (puede reconectar sin QR)' : '✗ No existe (requiere QR)'}
          valueClass={line.sessionOnDisk ? 'text-emerald-300' : 'text-rose-300'}
        />
        <DiagRow
          icon={<Bug size={14} className={line.keepAliveErrors > 0 ? 'text-amber-400' : 'text-emerald-400'} />}
          label="Errores keep-alive"
          value={String(line.keepAliveErrors)}
          valueClass={line.keepAliveErrors > 0 ? 'text-amber-300' : 'text-emerald-300'}
        />
        <DiagRow
          icon={<Plug size={14} className="text-slate-400" />}
          label="Cargada en memoria"
          value={line.loaded ? 'Sí' : 'No'}
          valueClass={line.loaded ? 'text-emerald-300' : 'text-rose-300'}
        />
      </div>

      {/* Último error */}
      {line.lastError && (
        <div className="mt-3 p-3 rounded-xl bg-slate-950/40 border border-white/5 flex items-start gap-2">
          <Warning size={14} className="text-amber-400 mt-0.5 shrink-0" weight="fill" />
          <div className="text-[11px]">
            <span className="text-slate-400">Último error: </span>
            <span className="text-amber-200 font-mono break-all">{line.lastError}</span>
            {line.lastErrorAt && (
              <span className="text-slate-500 block mt-0.5">{timeAgo(line.lastErrorAt)}</span>
            )}
          </div>
        </div>
      )}

      {/* Explicación del zombie */}
      {isZombie && (
        <div className="mt-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 flex items-start gap-2">
          <Warning size={14} className="text-amber-400 mt-0.5 shrink-0" weight="fill" />
          <p className="text-[11px] text-amber-200/90 leading-relaxed">
            La base de datos dice que esta línea está <strong>conectada</strong>, pero el puente
            no la tiene cargada en memoria. Esto es una <strong>caída silenciosa</strong> (probablemente
            un Frame detachado). {line.sessionOnDisk ? 'La sesión en disco está intacta, así que puede reconectar sin escanear QR.' : 'Requiere escanear QR nuevo.'}
          </p>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ isConnected, isZombie, loaded }: { isConnected: boolean; isZombie: boolean; loaded: boolean }) {
  if (isConnected) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        En servicio
      </span>
    );
  }
  if (isZombie) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
        <span className="w-2 h-2 rounded-full bg-amber-400" />
        Zombie
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-rose-400">
      <span className="w-2 h-2 rounded-full bg-rose-400" />
      Caída {loaded ? '' : '/ no cargada'}
    </span>
  );
}

function DiagRow({
  icon, label, value, valueClass,
}: { icon: React.ReactNode; label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-slate-500">{label}:</span>
      <span className={`font-medium ${valueClass || 'text-slate-300'}`}>{value}</span>
    </div>
  );
}

function RecentErrors({ errorsData }: { errorsData: ErrorsResponse | null }) {
  const errors = errorsData?.errors || [];
  const summary = errorsData?.summary || {};
  const totalErrors = Object.values(summary).reduce((acc, s) => acc + s.errors, 0);
  const totalWarns = Object.values(summary).reduce((acc, s) => acc + s.warns, 0);
  const windowHours = errorsData?.windowHours || 24;

  return (
    <div className="glass rounded-2xl border border-white/10 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Bug size={16} className="text-amber-400" weight="fill" />
          Errores operacionales recientes
        </h2>
        <div className="flex items-center gap-3 text-[11px]">
          {totalErrors > 0 && (
            <span className="text-rose-400 font-medium">{totalErrors} error(es)</span>
          )}
          {totalWarns > 0 && (
            <span className="text-amber-400 font-medium">{totalWarns} aviso(s)</span>
          )}
          {totalErrors === 0 && totalWarns === 0 && (
            <span className="text-emerald-400 flex items-center gap-1">
              <CheckCircle size={12} weight="fill" /> Sin errores
            </span>
          )}
          <span className="text-slate-500">últimas {windowHours}h</span>
        </div>
      </div>

      {errors.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">
          <CheckCircle size={24} className="mx-auto mb-2 text-emerald-500/50" weight="light" />
          No se han registrado errores operacionales en las últimas {windowHours} horas.
          <br />
          <span className="text-[11px] text-slate-600">
            Aquí aparecerán fallos de transcripción de audios, descarga de media, webhooks, etc.
          </span>
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {errors.map((e) => (
            <div
              key={e.id}
              className={`flex items-start gap-3 p-3 rounded-xl border text-xs ${
                e.severity === 'error'
                  ? 'border-rose-500/20 bg-rose-500/5'
                  : 'border-amber-500/20 bg-amber-500/5'
              }`}
            >
              <span
                className={`mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 ${
                  e.severity === 'error' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                }`}
              >
                {e.severity === 'error' ? '!' : '?'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-semibold text-slate-200">{e.line_key}</span>
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    {ERROR_TYPE_LABELS[e.error_type] || e.error_type}
                  </span>
                </div>
                <p className="text-slate-400 break-words">{e.message}</p>
                {e.context && Object.keys(e.context).length > 0 && (
                  <p className="text-[10px] text-slate-600 mt-1 truncate">
                    {Object.entries(e.context)
                      .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
                      .join(' · ')}
                  </p>
                )}
              </div>
              <span className="text-[10px] text-slate-600 flex-shrink-0 whitespace-nowrap">
                {timeAgo(e.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
