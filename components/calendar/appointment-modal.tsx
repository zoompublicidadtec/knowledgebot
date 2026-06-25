'use client';

import { X, CalendarBlank, Clock, User, Phone, CheckCircle, WarningCircle, Trash } from '@phosphor-icons/react';
import { useTransition } from 'react';
import { updateAppointmentStatusAction } from '@/lib/appointments/actions';

interface Appointment {
  id: string;
  service: string;
  starts_at: string;
  ends_at: string;
  status: 'confirmed' | 'cancelled' | 'completed';
  full_name: string;
  phone: string;
  is_new_patient: boolean | null;
  notes: string | null;
}

interface AppointmentModalProps {
  appointment: Appointment;
  timezone: string;
  onClose: () => void;
}

export function AppointmentModal({ appointment, timezone, onClose }: AppointmentModalProps) {
  const [isPending, startTransition] = useTransition();

  function handleStatusChange(status: 'completed' | 'cancelled') {
    startTransition(async () => {
      const res = await updateAppointmentStatusAction(appointment.id, status);
      if (res?.error) {
        alert('Error: ' + res.error);
      } else {
        onClose();
      }
    });
  }

  const startTime = new Date(appointment.starts_at).toLocaleTimeString('es-MX', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
  const endTime = new Date(appointment.ends_at).toLocaleTimeString('es-MX', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
  const dateFormatted = new Date(appointment.starts_at).toLocaleDateString('es-MX', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative glass rounded-2xl w-full max-w-md p-6 overflow-hidden animate-slide-up shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Detalle de la Cita</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Info */}
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <CalendarBlank size={20} className="text-primary-400 mt-0.5" />
            <div>
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Servicio y Fecha</p>
              <p className="text-sm font-semibold text-white">{appointment.service}</p>
              <p className="text-xs capitalize" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>{dateFormatted}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Clock size={20} className="text-primary-400 mt-0.5" />
            <div>
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Horario</p>
              <p className="text-sm font-semibold text-white">{startTime} - {endTime}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <User size={20} className="text-primary-400 mt-0.5" />
            <div>
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Dueño</p>
              <p className="text-sm font-semibold text-white flex items-center gap-2">
                {appointment.full_name}
                {appointment.is_new_patient && (
                  <span className="badge badge-success text-[10px]">Nuevo</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Phone size={20} className="text-primary-400 mt-0.5" />
            <div>
              <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>WhatsApp</p>
              <p className="text-sm font-semibold text-white">{appointment.phone}</p>
            </div>
          </div>

          {/* Grooming / Pet Details parsed from notes */}
          {appointment.notes && (() => {
            const notes = appointment.notes!;
            const petName = notes.match(/🐾 Mascota: ([^|]+)/)?.[1]?.trim();
            const breed = notes.match(/Raza: ([^|]+)/)?.[1]?.trim();
            const coat = notes.match(/Pelaje: ([^|]+)/)?.[1]?.trim();
            const temperament = notes.match(/Temperamento: ([^|]+)/)?.[1]?.trim();
            const grooming = notes.match(/Obs\. Grooming: ([^|]+)/)?.[1]?.trim();
            const generalNotes = notes.match(/Notas: ([^|]+)/)?.[1]?.trim();
            const hasPetInfo = petName || breed || coat || temperament;

            return (
              <div className="space-y-2">
                {hasPetInfo && (
                  <div className="p-3 rounded-xl border border-amber-500/20" style={{ background: 'rgba(245, 158, 11, 0.06)' }}>
                    <p className="font-semibold text-amber-400 text-xs mb-2 flex items-center gap-1.5">🐾 Datos de la Mascota</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {petName && (
                        <div>
                          <span style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Nombre: </span>
                          <span className="text-white font-medium">{petName}</span>
                        </div>
                      )}
                      {breed && (
                        <div>
                          <span style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Raza: </span>
                          <span className="text-white font-medium">{breed}</span>
                        </div>
                      )}
                      {coat && (
                        <div>
                          <span style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Pelaje: </span>
                          <span className="text-white font-medium">{coat}</span>
                        </div>
                      )}
                      {temperament && (
                        <div>
                          <span style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Temperamento: </span>
                          <span className="text-white font-medium">{temperament}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {grooming && (
                  <div className="p-3 rounded-xl glass-light text-xs">
                    <p className="font-semibold text-slate-300 mb-1">📋 Observaciones de Grooming:</p>
                    <p style={{ color: 'rgba(148, 163, 184, 0.8)' }}>{grooming}</p>
                  </div>
                )}

                {generalNotes && (
                  <div className="p-3 rounded-xl glass-light text-xs">
                    <p className="font-semibold text-slate-300 mb-1">Notas:</p>
                    <p style={{ color: 'rgba(148, 163, 184, 0.8)' }}>{generalNotes}</p>
                  </div>
                )}

                {/* Fallback: if notes don't match the structured format, show raw */}
                {!hasPetInfo && !grooming && !generalNotes && (
                  <div className="p-3 rounded-xl glass-light text-xs">
                    <p className="font-semibold text-slate-300 mb-1">Notas del cliente:</p>
                    <p style={{ color: 'rgba(148, 163, 184, 0.8)' }}>{notes}</p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Status Badge */}
          <div className="pt-2">
            <span className="text-xs mr-2" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Estado:</span>
            <span className={`badge ${
              appointment.status === 'confirmed' ? 'badge-primary' :
              appointment.status === 'completed' ? 'badge-success' : 'badge-danger'
            }`}>
              {appointment.status === 'confirmed' ? 'Confirmada' :
               appointment.status === 'completed' ? 'Completada' : 'Cancelada'}
            </span>
          </div>
        </div>

        {/* Actions */}
        {appointment.status === 'confirmed' && (
          <div className="mt-8 flex gap-2">
            <button
              onClick={() => handleStatusChange('completed')}
              disabled={isPending}
              className="btn-primary flex-1 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 shadow-emerald-900/20"
            >
              <CheckCircle size={16} />
              Completar
            </button>
            <button
              onClick={() => handleStatusChange('cancelled')}
              disabled={isPending}
              className="btn-danger flex-1"
            >
              <WarningCircle size={16} />
              Cancelar Cita
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
