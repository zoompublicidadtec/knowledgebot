'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  connectGoogleCalendarAction,
  disconnectGoogleCalendarAction,
  saveGoogleCalendarIdAction,
} from '@/lib/integrations/actions';
import {
  WhatsappLogo,
  GoogleLogo,
  Plugs,
  SpinnerGap,
  Trash,
} from '@phosphor-icons/react';

interface IntegrationsPageProps {
  initialWaConfig: any;
  initialCalendarConfig: any;
  calendarsList: { id: string; name: string }[];
}

export default function IntegrationsClientPage({
  initialWaConfig,
  initialCalendarConfig,
  calendarsList
}: IntegrationsPageProps) {
  const [isPending, startTransition] = useTransition();

  const [calId, setCalId] = useState(initialCalendarConfig?.calendar_id || '');
  const [calError, setCalError] = useState<string | null>(null);
  const [calSuccess, setCalSuccess] = useState(false);

  function handleCalIdSave() {
    setCalError(null);
    setCalSuccess(false);
    startTransition(async () => {
      const res = await saveGoogleCalendarIdAction(calId);
      if (res?.error) {
        setCalError(res.error);
      } else {
        setCalSuccess(true);
      }
    });
  }


  function handleGoogleConnect() {
    startTransition(async () => {
      await connectGoogleCalendarAction();
    });
  }

  function handleGoogleDisconnect() {
    if (confirm('¿Seguro que deseas desconectar Google Calendar?')) {
      startTransition(async () => {
        const res = await disconnectGoogleCalendarAction();
        if (res?.error) {
          alert('Error: ' + res.error);
        } else {
          window.location.reload();
        }
      });
    }
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Plugs size={28} weight="fill" className="text-primary-400" />
          Integraciones
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
          Configura tus canales de comunicación y herramientas externas.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* WhatsApp Config Card */}
        <div className="card space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(16, 185, 129, 0.15)' }}>
              <WhatsappLogo size={24} weight="fill" className="text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">WhatsApp</h2>
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Canal principal de chat de los clientes</p>
            </div>
          </div>

          <div className="bg-primary-500/10 border border-primary-500/20 rounded-xl p-5 mb-4 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold bg-primary-500 text-white px-2 py-0.5 rounded uppercase tracking-wider">Nuevo</span>
              <h3 className="text-sm font-bold text-white">Gestor Multi-Línea</h3>
            </div>
            <p className="text-xs text-slate-300 mb-4 leading-relaxed">
              Ahora puedes conectar hasta 8 números de WhatsApp independientes. Asigna nombres a tus líneas y escanea los códigos QR directamente desde tu navegador sin usar la consola.
            </p>
            <Link href="/integraciones/whatsapp" className="btn-primary w-full inline-flex justify-center items-center gap-2">
              <WhatsappLogo size={18} weight="fill" />
              Administrar Líneas
            </Link>
          </div>

          {/* Legacy single-line Meta Cloud API configuration removed.
              All WhatsApp management is done in the Multi-Line Manager above.
              (Meta official API is explicitly NOT used in this project.) */}
        </div>

        {/* Google Calendar Card */}
        <div className="card space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
              <GoogleLogo size={24} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Google Calendar</h2>
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Para agendar citas y llamadas desde el bot</p>
            </div>
          </div>

          {initialCalendarConfig?.refresh_token_encrypted ? (
            <div className="space-y-6">
              <div className="p-4 rounded-xl glass-light flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse-soft" />
                  <span className="text-sm font-semibold text-white">Conectado a Google</span>
                </div>
                <button
                  onClick={handleGoogleDisconnect}
                  className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                  title="Desconectar"
                >
                  <Trash size={18} />
                </button>
              </div>

              {calError && (
                <div className="p-3 rounded-xl text-sm bg-rose-500/10 border border-rose-500/20 text-rose-400">
                  {calError}
                </div>
              )}

              {calSuccess && (
                <div className="p-3 rounded-xl text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  Calendario guardado correctamente.
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>
                    Seleccionar calendario para agendar
                  </label>
                  <select
                    value={calId}
                    onChange={(e) => setCalId(e.target.value)}
                    className="input text-sm"
                  >
                    <option value="">Selecciona un calendario</option>
                    {calendarsList.map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.name}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={handleCalIdSave}
                  disabled={isPending || !calId}
                  className="btn-primary w-full"
                >
                  {isPending ? <SpinnerGap size={18} className="animate-spin" /> : null}
                  Guardar calendario
                </button>
              </div>
              
            </div>
          ) : (
            <div className="space-y-4 py-6 text-center">
              <GoogleLogo size={48} className="mx-auto text-slate-500 mb-2" />
              <p className="text-sm" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>
                Conecta tu cuenta de Google para que el bot pueda verificar disponibilidad y agendar citas en tu calendario.
              </p>
              <button
                onClick={handleGoogleConnect}
                disabled={isPending}
                className="btn-primary inline-flex mt-2"
              >
                {isPending ? <SpinnerGap size={18} className="animate-spin" /> : <GoogleLogo size={18} weight="bold" />}
                Conectar Google Calendar
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}