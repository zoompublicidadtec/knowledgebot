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

  // Cuentas de pago: lista sin límite. El titular se escribe completo y el
  // panel muestra cómo lo va a decir el bot (abreviado).
  const [cuentas, setCuentas] = useState<any[]>(
    Array.isArray(persona?.payment_accounts) ? persona.payment_accounts : []
  );
  /**
   * Sedes: lista sin límite, y cada sede con sus propios teléfonos.
   *
   * Si el negocio todavía tiene el par dirección/teléfono suelto de antes, se
   * convierte en la primera sede al abrir el panel. Así el dueño ve su dato de
   * siempre en el sitio donde ahora vive, y no hay dos lugares que digan lo
   * mismo: al guardar, `address` y `phone` se vuelven a derivar de esta lista.
   */
  const [sedes, setSedes] = useState<any[]>(() => {
    if (Array.isArray(businessInfo?.sedes) && businessInfo.sedes.length > 0) {
      return businessInfo.sedes;
    }
    const direccion = String(businessInfo?.address || '').trim();
    const telefono = String(businessInfo?.phone || '').trim();
    if (!direccion && !telefono) return [];
    return [
      {
        nombre: '',
        direccion,
        telefonos: telefono ? [{ numero: telefono, tipo: 'ambos' }] : [],
      },
    ];
  });

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
          <label className="block text-xs font-semibold mb-1 text-slate-400">
            Primera frase que dice el bot
          </label>
          <input
            name="agentGreeting"
            type="text"
            defaultValue={persona.greeting || ''}
            className="input text-sm"
            placeholder="Hola, hablas con Oscar Herrera. Cuéntame, ¿cómo te puedo ayudar?"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            Solo se dice una vez, al empezar la conversación. Nunca se repite después.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">
            Qué vende su negocio
          </label>
          <textarea
            name="agentScope"
            defaultValue={persona.scope || ''}
            className="textarea h-20"
            placeholder="mugs, termos, bolígrafos, cuadernos, gorras, camisetas..."
          />
          <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
            <Info size={12} /> Escríbalo como se lo diría a un cliente. Si le piden algo que no está
            aquí, el bot lo dice y vuelve a lo suyo en una frase, en vez de ponerse a preguntar por
            cosas que usted no vende.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1 text-slate-400">
            Qué contesta cuando le piden algo que usted no vende
          </label>
          <input
            name="agentOfftopic"
            type="text"
            defaultValue={persona.offtopic_redirect || ''}
            className="input text-sm"
            placeholder="Eso puntual no lo manejamos, pero justo en {scope} te puedo ayudar de una."
          />
          <div className="text-[10px] text-slate-500 mt-1 space-y-1">
            <p>
              Donde escriba <code className="text-primary-400">{'{scope}'}</code> se pega{' '}
              <strong className="text-slate-300">lo que usted vende</strong>, o sea el campo de
              arriba. <strong className="text-slate-300">No</strong> se pega lo que pidió el cliente.
            </p>
            <p className="text-slate-500">
              Si un cliente pide unicornios, el bot NO dice «te puedo ayudar en unicornios». Dice
              «no manejamos eso, pero en <em>{'{lo que usted vende}'}</em> te puedo ayudar».
            </p>
            <p className="text-slate-600">
              Si prefiere, borre <code>{'{scope}'}</code> y escriba la frase completa a mano.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">
              Cómo puede pagar (solo los nombres)
            </label>
            <input
              name="paymentMethods"
              type="text"
              defaultValue={persona.payment_methods || ''}
              className="input text-sm"
              placeholder="Bancolombia, Nequi, Daviplata o PSE"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-slate-400">
              Cuándo se paga
            </label>
            <input
              name="paymentTerms"
              type="text"
              defaultValue={persona.payment_terms || ''}
              className="input text-sm"
              placeholder="50% para iniciar producción y 50% contra entrega"
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Cuentas donde puede pagar el cliente
              </label>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Agregue todas las que use: banco, Nequi, Daviplata, PayPal, Binance, Wise,
                lo que sea. Si no agrega ninguna, el bot dirá que el equipo se las confirma
                y <strong>nunca inventará</strong> un número.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setCuentas([...cuentas, { tipo: '', entidad: '', tipo_cuenta: '', numero: '', titular: '' }])
              }
              className="btn-secondary text-xs shrink-0"
            >
              + Agregar cuenta
            </button>
          </div>

          <input type="hidden" name="paymentAccountsJson" value={JSON.stringify(cuentas)} />

          {cuentas.length === 0 && (
            <p className="text-xs text-slate-500 italic">
              Sin cuentas todavía.
            </p>
          )}

          {cuentas.map((c: any, i: number) => {
            const actualizar = (campo: string, valor: string) => {
              const copia = [...cuentas];
              copia[i] = { ...copia[i], [campo]: valor };
              setCuentas(copia);
            };
            // Lo que el cliente va a leer: el titular abreviado.
            const titularVisible = String(c.titular || '')
              .trim()
              .split(/\s+/)
              .map((w: string) => (w.length <= 3 ? w : w.slice(0, 3) + 'x'.repeat(w.length - 3)))
              .join(' ');

            return (
              <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/10 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Entidad
                    </label>
                    <input
                      type="text"
                      value={c.entidad || ''}
                      onChange={e => actualizar('entidad', e.target.value)}
                      className="input text-sm"
                      placeholder="Bancolombia, Nequi, PayPal, Binance…"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Tipo
                    </label>
                    <input
                      type="text"
                      value={c.tipo_cuenta || ''}
                      onChange={e => actualizar('tipo_cuenta', e.target.value)}
                      className="input text-sm"
                      placeholder="Ahorros, Corriente, Billetera, Cripto…"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Número, usuario o correo
                    </label>
                    <input
                      type="text"
                      value={c.numero || ''}
                      onChange={e => actualizar('numero', e.target.value)}
                      className="input text-sm"
                      placeholder="123-456789-00 · pagos@empresa.com"
                    />
                  </div>
                </div>

                <div className="flex flex-col md:flex-row md:items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Titular (nombre completo)
                    </label>
                    <input
                      type="text"
                      value={c.titular || ''}
                      onChange={e => actualizar('titular', e.target.value)}
                      className="input text-sm"
                      placeholder="Oscar Herrera Lopez"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCuentas(cuentas.filter((_: any, j: number) => j !== i))}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-2 shrink-0"
                  >
                    Eliminar
                  </button>
                </div>

                {titularVisible && (
                  <p className="text-[11px] text-emerald-300/80">
                    El cliente verá: <strong>{titularVisible}</strong> — se abrevia solo, por
                    seguridad. Usted escribe el nombre completo.
                  </p>
                )}
              </div>
            );
          })}
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
            <label className="block text-xs font-semibold mb-1 text-slate-400">Email público</label>
            <input
              name="businessEmail"
              type="email"
              defaultValue={businessInfo.email || ''}
              className="input text-sm"
              placeholder="contacto@miempresa.com"
            />
          </div>
        </div>

        {/* ── Sedes ──────────────────────────────────────────────────────────
            Hasta el 03-ago-2026 había UN campo de dirección y UNO de teléfono.
            Un negocio con varios locales no cabe ahí: el bot solo podía dar una
            dirección, siempre la misma, sin importar cuál le sirviera al
            cliente.

            Cada número dice si sirve para llamar, para WhatsApp o para las dos
            cosas. Sin esa distinción, a quien pregunta «¿a qué número llamo?»
            el bot le puede dar uno que solo recibe mensajes, y lo manda a un
            teléfono que nunca va a timbrar.

            Lo que estaba escrito en los dos campos viejos se convierte solo en
            la primera sede al abrir el panel: no se pierde nada. */}
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-300">
                Sedes, direcciones y teléfonos
              </label>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Agregue todas las sedes que tenga, cada una con sus propios números. Si no
                agrega ninguna, el bot dirá que el equipo se lo confirma y{' '}
                <strong>nunca inventará</strong> una dirección ni un teléfono.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSedes([...sedes, { nombre: '', direccion: '', telefonos: [] }])}
              className="btn-secondary text-xs shrink-0"
            >
              + Agregar sede
            </button>
          </div>

          <input type="hidden" name="sedesJson" value={JSON.stringify(sedes)} />

          {sedes.length === 0 && (
            <p className="text-xs text-slate-500 italic">Sin sedes todavía.</p>
          )}

          {sedes.map((s: any, i: number) => {
            const actualizar = (campo: string, valor: any) => {
              const copia = [...sedes];
              copia[i] = { ...copia[i], [campo]: valor };
              setSedes(copia);
            };
            const telefonos: any[] = Array.isArray(s.telefonos) ? s.telefonos : [];
            const actualizarTelefono = (j: number, campo: string, valor: string) => {
              const lista = [...telefonos];
              lista[j] = { ...lista[j], [campo]: valor };
              actualizar('telefonos', lista);
            };

            return (
              <div
                key={i}
                className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3"
              >
                <div className="flex flex-col md:flex-row md:items-end gap-2">
                  <div className="md:w-1/3">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Nombre de la sede
                    </label>
                    <input
                      type="text"
                      value={s.nombre || ''}
                      onChange={e => actualizar('nombre', e.target.value)}
                      className="input text-sm"
                      placeholder="Centro, Norte, Bodega..."
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                      Dirección
                    </label>
                    <input
                      type="text"
                      value={s.direccion || ''}
                      onChange={e => actualizar('direccion', e.target.value)}
                      className="input text-sm"
                      placeholder="Cra 28 #10-86, Local 104"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setSedes(sedes.filter((_: any, k: number) => k !== i))}
                    className="text-xs text-red-400 hover:text-red-300 px-2 py-2 shrink-0"
                  >
                    Eliminar sede
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="block text-[10px] font-bold text-slate-500 uppercase">
                      Teléfonos de esta sede
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        actualizar('telefonos', [...telefonos, { numero: '', tipo: 'ambos' }])
                      }
                      className="btn-secondary text-[11px] shrink-0"
                    >
                      + Agregar teléfono
                    </button>
                  </div>

                  {telefonos.length === 0 && (
                    <p className="text-[11px] text-slate-500 italic">
                      Sin teléfonos. El bot dará la dirección y dirá que confirma el número.
                    </p>
                  )}

                  {telefonos.map((t: any, j: number) => (
                    <div key={j} className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={t.numero || ''}
                        onChange={e => actualizarTelefono(j, 'numero', e.target.value)}
                        className="input text-sm flex-1"
                        placeholder="+57 321 201 6229"
                      />
                      <select
                        value={t.tipo || 'ambos'}
                        onChange={e => actualizarTelefono(j, 'tipo', e.target.value)}
                        className="input text-sm sm:w-52"
                      >
                        <option value="ambos">Llamadas y WhatsApp</option>
                        <option value="llamada">Solo para llamar</option>
                        <option value="whatsapp">Solo WhatsApp</option>
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          actualizar(
                            'telefonos',
                            telefonos.filter((_: any, k: number) => k !== j)
                          )
                        }
                        className="text-xs text-red-400 hover:text-red-300 px-2 shrink-0"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
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
