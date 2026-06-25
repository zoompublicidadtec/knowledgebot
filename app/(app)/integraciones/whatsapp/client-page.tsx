'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Phone, QrCode, Plus, Trash, Plug, SpinnerGap, Warning, ArrowCounterClockwise } from '@phosphor-icons/react';

interface WhatsAppLine {
  id: string;
  line_key: string;
  display_name: string;
  phone_number: string | null;
  status: 'disconnected' | 'awaiting_qr' | 'connected';
  qr_code: string | null;
}

// Maximum number of WhatsApp lines. Set NEXT_PUBLIC_MAX_WHATSAPP_LINES env to override.
const MAX_LINES = Number(process.env.NEXT_PUBLIC_MAX_WHATSAPP_LINES || 8);

// Track how long each line has been in awaiting_qr without a QR
const QR_TIMEOUT_MS = 35_000; // 35 seconds

export default function ClientPage({ initialLines }: { initialLines: WhatsAppLine[] }) {
  const [lines, setLines] = useState<WhatsAppLine[]>(initialLines);
  const [isLoading, setIsLoading] = useState(false);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [loadingLines, setLoadingLines] = useState<Set<string>>(new Set());
  // Track when each line entered awaiting_qr state (to detect timeout)
  const awaitingQrSince = useRef<Record<string, number>>({});

  const fetchLines = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp-lines');
      if (res.ok) {
        const data: WhatsAppLine[] = await res.json();
        setLines(prev => {
          // Track when lines newly enter awaiting_qr state
          data.forEach(line => {
            if (line.status === 'awaiting_qr' && !line.qr_code) {
              if (!awaitingQrSince.current[line.line_key]) {
                awaitingQrSince.current[line.line_key] = Date.now();
              }
            } else {
              // Reset timer if QR arrived or status changed
              delete awaitingQrSince.current[line.line_key];
            }
          });
          return data;
        });

        // Pull-fallback: for VISIBLE lines awaiting QR without one, try fetching directly from bridge.
        // Only for lines that pass the visibility filter (connected/awaiting/has phone) to avoid
        // spamming the bridge with requests for hidden/empty lines (which causes 502 errors).
        const visibleAwaitingWithoutQr = data.filter(l =>
          (l.status === 'connected' || l.status === 'awaiting_qr' || l.phone_number) &&
          l.status === 'awaiting_qr' && !l.qr_code
        );
        for (const line of visibleAwaitingWithoutQr) {
          const since = awaitingQrSince.current[line.line_key];
          // Start pulling after 5 seconds, before timeout
          if (since && Date.now() - since > 5000) {
            fetch(`/api/whatsapp-lines/${line.line_key}/qr`)
              .then(r => r.ok ? r.json() : null)
              .catch(() => null);
          }
        }
      }
    } catch (e) {
      console.error('Error fetching lines:', e);
    }
  }, []);

  // Sync DB state with the REAL bridge state on load and periodically.
  // Fixes lines stuck in 'awaiting_qr' that are actually connected (or vice versa).
  const syncWithBridge = useCallback(async () => {
    try {
      await fetch('/api/whatsapp-lines/sync');
      await fetchLines();
    } catch (e) {
      console.error('Error syncing with bridge:', e);
    }
  }, [fetchLines]);

  // On mount: sync once, then poll for QRs
  useEffect(() => {
    syncWithBridge();
    const syncInterval = setInterval(syncWithBridge, 30000); // every 30s
    return () => clearInterval(syncInterval);
  }, [syncWithBridge]);


  // Poll only when there are lines in awaiting_qr state without a QR yet
  useEffect(() => {
    const hasAwaitingWithoutQr = lines.some(l => l.status === 'awaiting_qr');
    if (!hasAwaitingWithoutQr) return;

    const interval = setInterval(fetchLines, 3000);
    return () => clearInterval(interval);
  }, [lines, fetchLines]);

  // Check for QR timeouts
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      forceUpdate(n => n + 1); // Trigger re-render to update timeout display
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const isQrTimedOut = (lineKey: string) => {
    const since = awaitingQrSince.current[lineKey];
    if (!since) return false;
    return Date.now() - since > QR_TIMEOUT_MS;
  };

  const setLineLoading = (lineKey: string, loading: boolean) => {
    setLoadingLines(prev => {
      const next = new Set(prev);
      if (loading) next.add(lineKey);
      else next.delete(lineKey);
      return next;
    });
  };

  const clearLineError = (lineKey: string) => {
    setLineErrors(prev => {
      const next = { ...prev };
      delete next[lineKey];
      return next;
    });
  };

  const handleConnect = async (lineKey: string) => {
    clearLineError(lineKey);
    setLineLoading(lineKey, true);
    // Mark as awaiting immediately to show spinner
    awaitingQrSince.current[lineKey] = Date.now();
    try {
      const displayName = lines.find(l => l.line_key === lineKey)?.display_name;
      const res = await fetch('/api/whatsapp-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_key: lineKey, display_name: displayName }),
      });
      const data = await res.json();
      if (data.bridgeError) {
        setLineErrors(prev => ({ ...prev, [lineKey]: data.bridgeError }));
        // Reset awaiting timer since bridge failed
        delete awaitingQrSince.current[lineKey];
      }
      await fetchLines();
    } catch (e: any) {
      setLineErrors(prev => ({ ...prev, [lineKey]: e.message }));
      delete awaitingQrSince.current[lineKey];
    } finally {
      setLineLoading(lineKey, false);
    }
  };

  const handleRetryQr = async (lineKey: string) => {
    // Reset the DB status to disconnected first, then reconnect
    clearLineError(lineKey);
    setLineLoading(lineKey, true);
    try {
      // Force disconnect to reset state
      await fetch(`/api/whatsapp-lines/${lineKey}`, { method: 'DELETE' });
      await fetchLines();
      // Small delay then reconnect
      await new Promise(r => setTimeout(r, 1000));
      await handleConnect(lineKey);
    } finally {
      setLineLoading(lineKey, false);
    }
  };

  const handleDisconnect = async (lineKey: string) => {
    setLineLoading(lineKey, true);
    try {
      await fetch(`/api/whatsapp-lines/${lineKey}`, { method: 'DELETE' });
      await fetchLines();
    } finally {
      setLineLoading(lineKey, false);
    }
  };

  // Refresh a QR: force the bridge to REGENERATE a new QR by restarting the session.
  // This is different from just pulling the existing QR (which may be expired).
  // We call the same /start endpoint used by "Solicitar QR" to get a fresh QR.
  const handleRefreshQr = async (lineKey: string) => {
    setLineLoading(lineKey, true);
    clearLineError(lineKey);
    awaitingQrSince.current[lineKey] = Date.now(); // reset the awaiting timer
    try {
      // Force a NEW session start → bridge destroys the old one and generates a fresh QR
      const res = await fetch('/api/whatsapp-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_key: lineKey, display_name: lines.find(l => l.line_key === lineKey)?.display_name }),
      });
      const data = await res.json();
      if (data.bridgeError) {
        setLineErrors(prev => ({ ...prev, [lineKey]: data.bridgeError }));
        delete awaitingQrSince.current[lineKey];
      }
      await fetchLines();
    } catch (e: any) {
      setLineErrors(prev => ({ ...prev, [lineKey]: e.message }));
      delete awaitingQrSince.current[lineKey];
    } finally {
      setLineLoading(lineKey, false);
    }
  };

  const handleAddLine = async () => {
    const nextNum = lines.length + 1;
    if (nextNum > MAX_LINES) return alert(`Máximo ${MAX_LINES} líneas permitidas`);
    const name = prompt('Nombre de la nueva línea:', `Línea ${nextNum}`);
    if (!name) return;

    setIsLoading(true);
    try {
      const lineKey = `linea_${nextNum}`;
      const res = await fetch('/api/whatsapp-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line_key: lineKey, display_name: name }),
      });
      const data = await res.json();
      if (data.bridgeError) {
        alert(`⚠️ Línea creada pero el bridge no respondió:\n\n${data.bridgeError}\n\nAsegúrate de que "node server.js" esté corriendo en la carpeta wa-server-knowledge.`);
      }
      await fetchLines();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Líneas de WhatsApp</h1>
          <p className="text-sm text-slate-400 mt-1">Administra hasta {MAX_LINES} sesiones independientes en tu panel.</p>
        </div>
        <button
          onClick={handleAddLine}
          disabled={lines.length >= MAX_LINES || isLoading}
          className="btn-primary flex items-center gap-2"
        >
          <Plus size={18} weight="bold" />
          Nueva Línea
        </button>
      </div>

      {/* Bridge Instructions Banner */}
      <div className="p-4 rounded-xl border border-primary-500/20 bg-primary-500/5 text-xs text-slate-300 leading-relaxed">
        <p className="font-semibold text-primary-300 mb-1">⚡ Requisito: Bridge WhatsApp activo</p>
        <p>Para generar QR, el bridge debe estar corriendo. Abre una terminal en 
          <code className="mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-slate-200">wa-server-knowledge/</code> 
          y ejecuta:
          <code className="ml-1 px-2 py-0.5 bg-slate-800 rounded text-emerald-300">node server.js</code>
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Show ALL lines that exist, ordered by relevance:
            connected first, then awaiting QR, then disconnected. */}
        {[...lines].sort((a, b) => {
          const order = { connected: 0, awaiting_qr: 1, disconnected: 2 };
          return (order[a.status] ?? 3) - (order[b.status] ?? 3);
        }).map(line => {
          const isLineLoading = loadingLines.has(line.line_key);
          const lineError = lineErrors[line.line_key];
          const timedOut = isQrTimedOut(line.line_key);
          const waitingForQr = line.status === 'awaiting_qr' && !line.qr_code;

          return (
            <div key={line.id} className="glass p-5 rounded-2xl flex flex-col relative overflow-hidden group">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">{line.display_name}</h3>
                  <p className={`text-xs mt-1 ${line.phone_number ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {line.phone_number || 'Sin número detectado'}
                  </p>
                </div>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  line.status === 'connected' ? 'bg-emerald-500/20' : 'bg-slate-800/50'
                }`}>
                  <Phone size={16} className={line.status === 'connected' ? 'text-emerald-400' : 'text-slate-500'} />
                </div>
              </div>

              {/* QR / Status Area */}
              <div className="flex-1 min-h-[160px] flex items-center justify-center border border-white/5 bg-slate-950/30 rounded-xl mb-4 p-2 relative">
                {lineError ? (
                  <div className="flex flex-col items-center gap-2 text-center px-2">
                    <Warning size={24} className="text-rose-400" weight="fill" />
                    <p className="text-[10px] text-rose-300 leading-relaxed">{lineError}</p>
                  </div>
                ) : line.status === 'awaiting_qr' && line.qr_code ? (
                  // QR received — show it
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={line.qr_code} alt="QR Code" className="w-full h-auto rounded-lg" />
                ) : waitingForQr && timedOut ? (
                  // Timed out waiting for QR
                  <div className="flex flex-col items-center gap-2 text-center px-2">
                    <Warning size={24} className="text-amber-400" weight="fill" />
                    <p className="text-[10px] text-amber-300 leading-relaxed">
                      El bridge tardó demasiado. ¿Está corriendo <code className="bg-slate-800 px-1 rounded">node server.js</code>?
                    </p>
                  </div>
                ) : waitingForQr ? (
                  // Waiting for QR from bridge
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <SpinnerGap size={24} className="animate-spin text-primary-400" />
                    <span className="text-xs">Generando QR...</span>
                    <span className="text-[10px] text-slate-500">Puede tomar 10-30 segundos</span>
                  </div>
                ) : line.status === 'connected' ? (
                  <div className="flex flex-col items-center gap-2 text-emerald-400/80">
                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-1">
                      <Plug size={24} weight="fill" />
                    </div>
                    <span className="text-xs font-medium">Línea en Servicio</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-500">
                    <QrCode size={32} weight="light" />
                    <span className="text-xs">Desconectada</span>
                  </div>
                )}
              </div>

              {/* Action Button */}
              <div className="mt-auto space-y-2">
                {line.status === 'connected' ? (
                  <button
                    onClick={() => handleDisconnect(line.line_key)}
                    disabled={isLineLoading}
                    className="w-full py-2.5 rounded-xl text-xs font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
                  >
                    {isLineLoading ? <SpinnerGap size={14} className="animate-spin" /> : null}
                    Desvincular número
                  </button>
                ) : line.status === 'awaiting_qr' && line.qr_code ? (
                  // QR showing — offer refresh (QRs expire ~60s)
                  <>
                    <div className="text-[10px] text-amber-400/80 text-center -mb-1">
                      ⏱ Si no escanea pronto, el QR expira. Refresca.
                    </div>
                    <button
                      onClick={() => handleRefreshQr(line.line_key)}
                      disabled={isLineLoading}
                      className="w-full py-2.5 rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 border border-amber-500/20 transition-colors flex items-center justify-center gap-2"
                    >
                      {isLineLoading ? <SpinnerGap size={14} className="animate-spin" /> : <ArrowCounterClockwise size={14} />}
                      Refrescar QR
                    </button>
                    <button
                      onClick={() => handleDisconnect(line.line_key)}
                      disabled={isLineLoading}
                      className="w-full py-2 rounded-xl text-[11px] font-medium bg-slate-800/40 text-slate-400 hover:bg-slate-700/40 transition-colors"
                    >
                      Cancelar
                    </button>
                  </>
                ) : line.status === 'disconnected' || lineError ? (
                  <button
                    onClick={() => handleConnect(line.line_key)}
                    disabled={isLineLoading}
                    className="w-full py-2.5 rounded-xl text-xs font-semibold bg-primary-500/20 text-primary-300 hover:bg-primary-500/30 transition-colors flex items-center justify-center gap-2"
                  >
                    {isLineLoading ? <SpinnerGap size={14} className="animate-spin" /> : null}
                    {lineError ? 'Reintentar' : 'Solicitar QR'}
                  </button>
                ) : waitingForQr && timedOut ? (
                  // Show retry button on timeout
                  <button
                    onClick={() => handleRetryQr(line.line_key)}
                    disabled={isLineLoading}
                    className="w-full py-2.5 rounded-xl text-xs font-semibold bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-colors flex items-center justify-center gap-2"
                  >
                    {isLineLoading ? <SpinnerGap size={14} className="animate-spin" /> : <ArrowCounterClockwise size={14} />}
                    Reintentar
                  </button>
                ) : (
                  // Waiting for QR (not timed out yet)
                  <button
                    disabled
                    className="w-full py-2.5 rounded-xl text-xs font-semibold bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 cursor-wait flex items-center justify-center gap-2"
                  >
                    <SpinnerGap size={14} className="animate-spin" />
                    Esperando Escaneo
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {lines.length === 0 && (
          <div className="col-span-full glass p-8 rounded-2xl text-center border border-dashed border-white/10">
            <Phone size={32} className="mx-auto text-slate-500 mb-3" weight="light" />
            <h3 className="text-sm font-medium text-white mb-1">No hay líneas configuradas</h3>
            <p className="text-xs text-slate-400 mb-4 max-w-sm mx-auto">
              Comienza agregando tu primera línea de WhatsApp para sincronizar chats y atender clientes.
            </p>
            <button onClick={handleAddLine} disabled={isLoading} className="btn-primary inline-flex">
              Agregar Línea
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
