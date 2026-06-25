'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { 
  CaretLeft, 
  CaretRight, 
  Plus 
} from '@phosphor-icons/react';
import { AppointmentModal } from './appointment-modal';
import { getDateParts } from '@/lib/timezone';

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

interface CalendarGridProps {
  initialAppointments: Appointment[];
  timezone: string;
}

export function CalendarGrid({ initialAppointments, timezone }: CalendarGridProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);

  const supabase = createClient();

  useEffect(() => {
    setAppointments(initialAppointments);
    
    const channel = supabase.channel('realtime:appointments')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setAppointments(prev => [...prev, payload.new as Appointment]);
        } else if (payload.eventType === 'UPDATE') {
          setAppointments(prev => prev.map(apt => apt.id === payload.new.id ? payload.new as Appointment : apt));
        } else if (payload.eventType === 'DELETE') {
          setAppointments(prev => prev.filter(apt => apt.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [initialAppointments]);

  // Month generation logic
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Adjusted first day (Monday starting index: Monday is 0, Sunday is 6)
  const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;

  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blankDays = Array.from({ length: adjustedFirstDay });

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  function prevMonth() {
    setCurrentDate(new Date(year, month - 1, 1));
  }

  function nextMonth() {
    setCurrentDate(new Date(year, month + 1, 1));
  }

  // Filter appointments for a specific day using the organization's timezone
  function getAppointmentsForDay(day: number) {
    return appointments.filter(apt => {
      if (apt.status === 'cancelled') return false; // Hide cancelled appointments from grid
      const aptDate = new Date(apt.starts_at);
      const parts = getDateParts(aptDate, timezone);
      return parts.year === year &&
             parts.month === month &&
             parts.day === day;
    });
  }

  return (
    <div className="space-y-6">
      {/* Month Selector Controls */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">
          {monthNames[month]} {year}
        </h2>
        <div className="flex gap-2">
          <button onClick={prevMonth} className="btn-ghost p-2 rounded-xl">
            <CaretLeft size={16} />
          </button>
          <button onClick={nextMonth} className="btn-ghost p-2 rounded-xl">
            <CaretRight size={16} />
          </button>
        </div>
      </div>

      {/* Monthly Grid */}
      <div className="glass rounded-2xl p-4 overflow-hidden border border-white/5 shadow-xl">
        {/* Days of Week Headers */}
        <div className="grid grid-cols-7 gap-2 mb-2 text-center">
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => (
            <span key={d} className="text-xs font-semibold py-2" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>
              {d}
            </span>
          ))}
        </div>

        {/* Days Grid */}
        <div className="grid grid-cols-7 gap-2 min-h-[300px]">
          {/* Blank Days before start of month */}
          {blankDays.map((_, i) => (
            <div key={`blank-${i}`} className="p-2 rounded-xl bg-slate-900/10 border border-transparent opacity-20" />
          ))}

          {/* Actual days in month */}
          {daysArray.map(day => {
            const apts = getAppointmentsForDay(day);
            const isToday = new Date().getFullYear() === year &&
                            new Date().getMonth() === month &&
                            new Date().getDate() === day;

            return (
              <div
                key={day}
                className={`
                  p-2 rounded-xl min-h-[80px] border flex flex-col justify-between transition-colors
                  ${isToday ? 'bg-primary-600/10 border-primary-500/30' : 'bg-slate-950/20 border-white/5 hover:border-white/10'}
                `}
              >
                {/* Day Number */}
                <span className={`text-xs font-semibold ${isToday ? 'text-primary-300' : 'text-slate-400'}`}>
                  {day}
                </span>

                {/* Appointments list preview */}
                <div className="space-y-1 mt-2 flex-1 flex flex-col justify-end">
                  {apts.slice(0, 2).map(apt => (
                    <button
                      key={apt.id}
                      onClick={() => setSelectedApt(apt)}
                      className={`
                        w-full text-left text-[9px] font-semibold py-1 px-1.5 rounded-lg truncate transition-all
                        ${apt.status === 'confirmed' ? 'bg-primary-600/30 text-primary-200 border border-primary-500/20 hover:bg-primary-600/40' : ''}
                        ${apt.status === 'completed' ? 'bg-emerald-600/30 text-emerald-200 border border-emerald-500/20 hover:bg-emerald-600/40' : ''}
                        ${apt.status === 'cancelled' ? 'bg-rose-600/30 text-rose-200 border border-rose-500/20 hover:bg-rose-600/40' : ''}
                      `}
                    >
                      {new Date(apt.starts_at).toLocaleTimeString('es-MX', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false })} {apt.service}
                    </button>
                  ))}
                  {apts.length > 2 && (
                    <span className="text-[8px] text-slate-500 block text-right">
                      +{apts.length - 2} más
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Appointment Detail Modal popup */}
      {selectedApt && (
        <AppointmentModal appointment={selectedApt} timezone={timezone} onClose={() => setSelectedApt(null)} />
      )}
    </div>
  );
}
