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
  const persona = initialConfig?.metadata?.persona || {};

  // Temas libres del negocio. Va DESPUÉS de businessInfo: si se declara antes,
  // se leería una constante que todavía no existe.
  const [topics, setTopics] = useState<any[]>(
    Array.isArray(businessInfo?.topics) ? businessInfo.topics : []
  );

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

      {/* Identity section */}
      <div className="card space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <BookOpen size={20} className="text-primary-400" />
          Identidad del agente
        </h2>
        <p className="text-[11px] text-slate-400 -mt-2">
          Quién es el agente para el cliente. Estos campos mandan sobre el prompt: si cambias
          el nombre y el rol, el bot cambia de personaje en la siguiente conversación.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Nombre del agente</label>
            <input
              name="agentName"
              type="text"
              defaultValue={persona.agent_name || ''}
              className="input text-sm"
              placeholder="Oscar Herrera"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Rol / cargo</label>
            <input
              name="agentRole"
              type="text"
              defaultValue={persona.role || ''}
              className="input text-sm"
              placeholder="asesor comercial"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Empresa</label>
            <input
              name="agentCompany"
              type="text"
              defaultValue={persona.company || ''}
              className="input text-sm"
              placeholder="ZOOM Publicidad"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">Saludo inicial</label>
          <input
            name="agentGreeting"
            type="text"
            defaultValue={persona.greeting || ''}
            className="input text-sm"
            placeholder="Hola, hablas con Oscar Herrera. Cuéntame, ¿cómo te puedo ayudar?"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">Qué vende (alcance del negocio)</label>
          <textarea
            name="agentScope"
            defaultValue={persona.scope || ''}
            className="textarea h-20"
            placeholder="mugs, termos, bolígrafos, cuadernos, gorras, camisetas..."
          />
          <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
            <Info size={12} /> Si el cliente pide algo fuera de esta lista, el bot reconduce en una frase
            en vez de ponerse a preguntar sobre temas que no vendes.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">Frase de reconducción</label>
          <input
            name="agentOfftopic"
            type="text"
            defaultValue={persona.offtopic_redirect || ''}
            className="input text-sm"
            placeholder="Eso puntual no lo manejamos, pero justo en {scope} te puedo ayudar de una."
          />
          <p className="text-[10px] text-slate-500 mt-1">
            Usa <code className="text-primary-400">{'{scope}'}</code> para insertar lo que vendes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Medios de pago</label>
            <input
              name="paymentMethods"
              type="text"
              defaultValue={persona.payment_methods || ''}
              className="input text-sm"
              placeholder="Bancolombia, Nequi, Daviplata o PSE"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Condiciones de pago</label>
            <input
              name="paymentTerms"
              type="text"
              defaultValue={persona.payment_terms || ''}
              className="input text-sm"
              placeholder="50% para iniciar producción y 50% contra entrega"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">
            A dónde paga el cliente (cuenta, titular, identificación)
          </label>
          <textarea
            name="paymentDetails"
            rows={2}
            defaultValue={persona.payment_details || ''}
            className="input text-sm"
            placeholder="Bancolombia Ahorros 123-456789-00 a nombre de Mi Empresa S.A.S., NIT 900.123.456-7"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            Sin esto, el bot no puede responder «¿a dónde pago?» y solo dirá que lo consulta
            con el equipo. Nunca inventa una cuenta.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">
            Datos que se le piden al cliente para cerrar
          </label>
          <input
            name="closingData"
            type="text"
            defaultValue={persona.closing_data || ''}
            className="input text-sm"
            placeholder="nombre o razón social, NIT o cédula, correo, dirección de envío"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            Cámbielos según su negocio: un despacho de abogados o un cliente de otro país
            piden datos distintos.
          </p>
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            name="freeMockup"
            defaultChecked={persona.free_mockup !== false}
            className="accent-primary-500"
          />
          Ofrecer boceto/montaje digital gratis con el logo del cliente ante objeciones estéticas
        </label>
      </div>

      {/* Prompts section */}
      <div className="card space-y-4">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <BookOpen size={20} className="text-primary-400" />
          Tono e indicaciones adicionales
        </h2>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">Indicaciones adicionales del negocio</label>
          <textarea
            name="systemPrompt"
            defaultValue={initialConfig?.system_prompt}
            className="textarea h-32"
            placeholder="Reglas propias del negocio: mínimos de pedido, tiempos de entrega, promociones vigentes..."
          />
          <p className="text-[10px] text-amber-400/80 mt-1 flex items-center gap-1">
            <Info size={12} /> No escribas aquí que el bot es un asistente virtual o una IA: esas frases
            se descartan automáticamente porque contradicen la identidad y hacen que el bot se delate.
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Página web</label>
            <input
              name="businessWebsite"
              type="text"
              defaultValue={businessInfo.website || ''}
              className="input text-sm"
              placeholder="www.miempresa.com"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">Tiempos de entrega</label>
            <input
              name="deliveryTimes"
              type="text"
              defaultValue={businessInfo.delivery_times || ''}
              className="input text-sm"
              placeholder="5 a 8 días hábiles después de aprobar el diseño"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">Garantía</label>
          <textarea
            name="warranty"
            rows={2}
            defaultValue={businessInfo.warranty || ''}
            className="input text-sm"
            placeholder="Garantía de 6 meses por defectos de fabricación. No cubre daños por mal uso."
          />
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

      {/* ── Temas propios del negocio ─────────────────────────────────────────
          Lo que hace que el sistema sirva para cualquier oficio sin tocar
          código: una imprenta escribe "Formas de envío", un despacho de
          abogados "Honorarios", una clínica "Preparación para exámenes".
          El bot los consulta por su título y responde SOLO con lo que hay
          escrito aquí. Lo que no esté, admite que no lo sabe. */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Información del negocio para el bot</h2>
            <p className="text-xs text-slate-400 mt-1">
              Todo lo que el bot debe saber responder y no es un producto: formas de envío,
              requisitos, procesos, condiciones. Si no está aquí, el bot dirá que lo consulta
              con el equipo en vez de inventarlo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTopics([...topics, { titulo: '', contenido: '' }])}
            className="btn-secondary text-xs shrink-0"
          >
            + Agregar tema
          </button>
        </div>

        <input type="hidden" name="topicsJson" value={JSON.stringify(topics)} />

        {topics.length === 0 && (
          <p className="text-xs text-slate-500 italic">
            Sin temas todavía. Ejemplos: «Formas de envío», «Requisitos para pedidos al por mayor»,
            «Qué incluye el servicio».
          </p>
        )}

        {topics.map((t: any, i: number) => (
          <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={t.titulo || ''}
                onChange={e => {
                  const copia = [...topics];
                  copia[i] = { ...copia[i], titulo: e.target.value };
                  setTopics(copia);
                }}
                className="input text-sm flex-1"
                placeholder="Título del tema (por ejemplo: Formas de envío)"
              />
              <button
                type="button"
                onClick={() => setTopics(topics.filter((_: any, j: number) => j !== i))}
                className="text-xs text-red-400 hover:text-red-300 px-2"
                title="Eliminar este tema"
              >
                Eliminar
              </button>
            </div>
            <textarea
              value={t.contenido || ''}
              onChange={e => {
                const copia = [...topics];
                copia[i] = { ...copia[i], contenido: e.target.value };
                setTopics(copia);
              }}
              rows={3}
              className="input text-sm"
              placeholder="La respuesta exacta que debe dar el bot sobre este tema."
            />
          </div>
        ))}
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
