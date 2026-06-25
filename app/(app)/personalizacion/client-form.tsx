'use client';

import { useState, useTransition } from 'react';
import { saveAgentConfigAction } from '@/lib/personalization/actions';
import { Plus, Trash, SpinnerGap, Info, BookOpen } from '@phosphor-icons/react';

interface CustomizationClientFormProps {
  initialConfig: any;
}

export default function CustomizationClientForm({ initialConfig }: CustomizationClientFormProps) {
  const [isPending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Structured states for Services
  const [services, setServices] = useState<any[]>(
    initialConfig?.services || []
  );

  // Structured states for Business Hours
  const [hours, setHours] = useState<any>(
    initialConfig?.business_hours || {
      mon: [{ start: '09:00', end: '18:00' }],
      tue: [{ start: '09:00', end: '18:00' }],
      wed: [{ start: '09:00', end: '18:00' }],
      thu: [{ start: '09:00', end: '18:00' }],
      fri: [{ start: '09:00', end: '18:00' }],
      sat: [{ start: '09:00', end: '14:00' }],
      sun: [],
    }
  );

  const businessInfo = initialConfig?.business_info || {};

  function addService() {
    setServices((prev) => [
      ...prev,
      { name: 'Nuevo Servicio', duration_minutes: 30, description: 'Descripción breve', price: 0 },
    ]);
  }

  function removeService(index: number) {
    setServices((prev) => prev.filter((_, i) => i !== index));
  }

  function updateService(index: number, key: string, val: any) {
    setServices((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [key]: val } : item))
    );
  }

  function updateHoursSlot(day: string, slotIndex: number, key: string, val: string) {
    setHours((prev: any) => {
      const daySlots = [...(prev[day] || [])];
      daySlots[slotIndex] = { ...daySlots[slotIndex], [key]: val };
      return { ...prev, [day]: daySlots };
    });
  }

  function addHoursSlot(day: string) {
    setHours((prev: any) => ({
      ...prev,
      [day]: [...(prev[day] || []), { start: '09:00', end: '18:00' }],
    }));
  }

  function removeHoursSlot(day: string, slotIndex: number) {
    setHours((prev: any) => ({
      ...prev,
      [day]: prev[day].filter((_: any, i: number) => i !== slotIndex),
    }));
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const formData = new FormData(e.currentTarget);
    formData.append('servicesJson', JSON.stringify(services));
    formData.append('businessHoursJson', JSON.stringify(hours));

    startTransition(async () => {
      const res = await saveAgentConfigAction(formData);
      if (res?.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  const daysLabels: Record<string, string> = {
    mon: 'Lunes', tue: 'Martes', wed: 'Miércoles',
    thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo',
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {success && (
        <div className="p-4 rounded-xl text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
          Configuración guardada exitosamente. El bot de prueba se ha actualizado.
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl text-sm bg-rose-500/10 border border-rose-500/20 text-rose-400">
          {error}
        </div>
      )}

      {/* Prompts section */}
      <div className="card space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <BookOpen size={20} className="text-primary-400" />
          Personalidad y Prompt
        </h2>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">System Prompt Principal</label>
          <textarea
            name="systemPrompt"
            defaultValue={initialConfig?.system_prompt}
            required
            className="textarea h-32"
            placeholder="Instrucciones principales sobre cómo el bot debe actuar..."
          />
          <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
            <Info size={12} /> Define las reglas principales de comportamiento y flujo del bot.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Tono de voz / Estilo</label>
            <input
              name="tone"
              type="text"
              defaultValue={initialConfig?.tone}
              required
              className="input text-sm"
              placeholder="Ej: profesional y cálido, divertido y breve"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Mensaje de transferencia a Humano</label>
            <input
              name="handoffMessage"
              type="text"
              defaultValue={initialConfig?.handoff_message || ''}
              className="input text-sm"
              placeholder="Te paso con un humano en un momento..."
            />
          </div>
        </div>
      </div>

      {/* Business Info section */}
      <div className="card space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Info size={20} className="text-primary-400" />
          Información del Negocio
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Nombre del negocio</label>
            <input
              name="businessName"
              type="text"
              defaultValue={businessInfo.name || ''}
              className="input text-sm"
              placeholder="Mi Empresa"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Teléfono público</label>
            <input
              name="businessPhone"
              type="text"
              defaultValue={businessInfo.phone || ''}
              className="input text-sm"
              placeholder="+52 55 1234 5678"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Dirección física</label>
            <input
              name="businessAddress"
              type="text"
              defaultValue={businessInfo.address || ''}
              className="input text-sm"
              placeholder="Av. Principal 123, Col. Centro"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Email público</label>
            <input
              name="businessEmail"
              type="email"
              defaultValue={businessInfo.email || ''}
              className="input text-sm"
              placeholder="Mi Empresa"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">Política de Cancelación</label>
          <input
            name="cancellationPolicy"
            type="text"
            defaultValue={businessInfo.cancellation_policy || ''}
            className="input text-sm"
            placeholder="Las citas pueden cancelarse con al menos 2 horas de anticipación."
          />
        </div>
      </div>

      {/* Services List section */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            Catálogo de Servicios
          </h2>
          <button
            type="button"
            onClick={addService}
            className="btn-ghost py-1 px-2.5 text-xs flex items-center gap-1 rounded-lg"
          >
            <Plus size={14} /> Añadir Servicio
          </button>
        </div>

        <div className="space-y-3">
          {services.map((svc, index) => (
            <div key={index} className="p-4 rounded-xl bg-slate-900 border border-white/5 space-y-3 relative group">
              <button
                type="button"
                onClick={() => removeService(index)}
                className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 lg:transition-opacity"
              >
                <Trash size={16} />
              </button>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Nombre del Servicio</label>
                  <input
                    type="text"
                    value={svc.name}
                    onChange={(e) => updateService(index, 'name', e.target.value)}
                    required
                    className="input text-sm py-1.5"
                    placeholder="Consulta general"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Duración (minutos)</label>
                  <input
                    type="number"
                    value={svc.duration_minutes}
                    onChange={(e) => updateService(index, 'duration_minutes', Number(e.target.value))}
                    required
                    min={5}
                    step={5}
                    className="input text-sm py-1.5"
                    placeholder="30"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Precio</label>
                  <div className="flex rounded-xl bg-slate-950 border border-white/10 overflow-hidden focus-within:border-primary-500 transition-colors">
                    <span className="flex items-center justify-center px-3 text-slate-400 bg-slate-900/50 text-sm border-r border-white/10 select-none">$</span>
                    <input
                      type="number"
                      value={svc.price || 0}
                      onChange={(e) => updateService(index, 'price', Number(e.target.value))}
                      required
                      min={0}
                      className="w-full bg-transparent px-3 py-1.5 outline-none text-sm text-white"
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Descripción del Servicio</label>
                <input
                  type="text"
                  value={svc.description}
                  onChange={(e) => updateService(index, 'description', e.target.value)}
                  className="input text-sm py-1.5"
                  placeholder="Asesoria, soporte especializado, demo comercial..."
                />
              </div>
            </div>
          ))}

          {services.length === 0 && (
            <div className="text-center py-6 text-slate-500 text-xs">
              No hay servicios configurados. El bot no podrá agendar citas.
            </div>
          )}
        </div>
      </div>

      {/* Business Hours section */}
      <div className="card space-y-4">
        <h2 className="text-base font-bold text-white">
          Horarios de Atención
        </h2>

        <div className="space-y-3">
          {Object.keys(daysLabels).map((day) => {
            const daySlots = hours[day] || [];
            return (
              <div key={day} className="flex flex-col md:flex-row md:items-center gap-4 py-2 border-b border-white/5 last:border-0">
                <span className="w-24 text-sm font-semibold text-slate-300">{daysLabels[day]}</span>

                <div className="flex-1 flex flex-wrap items-center gap-3">
                  {daySlots.map((slot: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-2 bg-slate-900 border border-white/5 rounded-xl px-3 py-1.5">
                      <input
                        type="time"
                        value={slot.start}
                        onChange={(e) => updateHoursSlot(day, idx, 'start', e.target.value)}
                        className="bg-transparent border-0 outline-none text-xs text-white"
                      />
                      <span className="text-slate-500 text-xs">-</span>
                      <input
                        type="time"
                        value={slot.end}
                        onChange={(e) => updateHoursSlot(day, idx, 'end', e.target.value)}
                        className="bg-transparent border-0 outline-none text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => removeHoursSlot(day, idx)}
                        className="text-slate-500 hover:text-rose-400 p-0.5"
                      >
                        <Trash size={12} />
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={() => addHoursSlot(day)}
                    className="btn-ghost py-1 px-2 text-[10px] rounded-lg"
                  >
                    <Plus size={10} /> Añadir Bloque
                  </button>

                  {daySlots.length === 0 && (
                    <span className="text-xs text-rose-400/70 italic">Cerrado</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="btn-primary w-full py-3 text-base shadow-lg"
      >
        {isPending ? <SpinnerGap size={20} className="animate-spin" /> : null}
        {isPending ? 'Guardando configuración...' : 'Guardar y actualizar agente IA'}
      </button>
    </form>
  );
}
