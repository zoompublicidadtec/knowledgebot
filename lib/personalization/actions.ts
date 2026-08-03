'use server';

import { createAdminClient as createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function saveAgentConfigAction(formData: FormData) {
  const supabase = await createClient();

  const systemPrompt = (formData.get('systemPrompt') as string) || '';
  const tone = (formData.get('tone') as string) || 'profesional y amable';
  const handoffMessage = (formData.get('handoffMessage') as string) || null;

  // Business Info
  const businessName = (formData.get('businessName') as string) || '';
  const businessEmail = (formData.get('businessEmail') as string) || '';
  const cancellationPolicy = (formData.get('cancellationPolicy') as string) || '';
  // Datos del negocio que el bot necesita para responder sin inventar. Son
  // genéricos a propósito: valen para una imprenta, un despacho de abogados o
  // una clínica. Lo específico de cada oficio va en `topics`.
  const businessWebsite = (formData.get('businessWebsite') as string) || '';
  const warranty = (formData.get('warranty') as string) || '';
  const deliveryTimes = (formData.get('deliveryTimes') as string) || '';

  /**
   * Temas libres: pares título + contenido que el dueño escribe en el panel.
   *
   * Es lo que hace al sistema servir para cualquier mercado sin tocar código:
   * un abogado añade "Honorarios" y "Horarios de audiencia", una clínica añade
   * "Preparación para exámenes". El bot los consulta por su título.
   */
  /**
   * Sedes: lista sin límite, cada una con su dirección y sus propios teléfonos.
   *
   * Antes había UN campo de dirección y UNO de teléfono, y con eso el bot solo
   * podía dar una sede. Cada número guarda además si sirve para llamar, para
   * WhatsApp o para las dos cosas: darle a quien pregunta «¿a qué número
   * llamo?» un número que solo recibe mensajes es mandarlo a un teléfono que
   * nunca va a timbrar.
   *
   * El tipo se guarda SOLO si es uno de los tres conocidos. Un valor raro no se
   * corrige a un valor por defecto que suene bien: se deja vacío, y entonces el
   * bot ofrece el número a secas, sin afirmar para qué sirve.
   */
  const sedesRaw = formData.get('sedesJson') as string;
  const TIPOS_DE_TELEFONO = ['llamada', 'whatsapp', 'ambos'];
  let sedes: Array<Record<string, any>> = [];
  try {
    const parsed = sedesRaw ? JSON.parse(sedesRaw) : [];
    sedes = (Array.isArray(parsed) ? parsed : [])
      .map((s: any) => ({
        nombre: String(s?.nombre || '').trim(),
        direccion: String(s?.direccion || '').trim(),
        telefonos: (Array.isArray(s?.telefonos) ? s.telefonos : [])
          .map((t: any) => {
            const tipo = String(t?.tipo || '').trim().toLowerCase();
            return {
              numero: String(t?.numero || '').trim(),
              tipo: TIPOS_DE_TELEFONO.includes(tipo) ? tipo : '',
            };
          })
          .filter((t: any) => t.numero),
      }))
      // Una sede sin dirección y sin un solo teléfono no dice nada: no se guarda.
      .filter((s: any) => s.direccion || s.telefonos.length > 0);
  } catch {
    return { error: 'Formato de sedes inválido. Intenta de nuevo.' };
  }

  /**
   * `address` y `phone` siguen existiendo porque los lee el encabezado del
   * prompt. Se DERIVAN de la primera sede para que haya una sola verdad: el
   * dueño edita la lista y nada más. Si borra todas las sedes, quedan vacíos, y
   * vacío es lo correcto — el bot omite la frase y dice que lo consulta.
   */
  const sedePrincipal: any = sedes[0];
  const direccionPrincipal = String(sedePrincipal?.direccion || '').trim();
  const telefonoPrincipal = String(sedePrincipal?.telefonos?.[0]?.numero || '').trim();
  /**
   * Cuentas de pago. El titular se guarda completo pero NUNCA sale completo:
   * `enmascararTitular()` lo recorta antes de que el bot lo diga, porque un
   * nombre completo junto a un numero de cuenta es dato sensible en un chat.
   */
  const cuentasRaw = formData.get('paymentAccountsJson') as string;
  let cuentasDePago: Array<Record<string, string>> = [];
  try {
    const parsed = cuentasRaw ? JSON.parse(cuentasRaw) : [];
    cuentasDePago = (Array.isArray(parsed) ? parsed : [])
      .map((c: any) => ({
        tipo: String(c?.tipo || '').trim(),
        entidad: String(c?.entidad || '').trim(),
        tipo_cuenta: String(c?.tipo_cuenta || '').trim(),
        numero: String(c?.numero || '').trim(),
        titular: String(c?.titular || '').trim(),
      }))
      // Sin entidad y sin numero no hay a donde pagar: no se guarda a medias.
      .filter(c => c.entidad && c.numero);
  } catch {
    return { error: 'Formato de cuentas de pago inválido. Intenta de nuevo.' };
  }

  const topicsRaw = formData.get('topicsJson') as string;
  let topics: Array<{ titulo: string; contenido: string }> = [];
  try {
    const parsed = topicsRaw ? JSON.parse(topicsRaw) : [];
    topics = (Array.isArray(parsed) ? parsed : [])
      .map((t: any) => ({
        titulo: String(t?.titulo || '').trim(),
        contenido: String(t?.contenido || '').trim(),
      }))
      .filter(t => t.titulo && t.contenido);
  } catch {
    return { error: 'Formato de temas inválido. Intenta de nuevo.' };
  }

  // Services JSON parse
  const servicesRaw = formData.get('servicesJson') as string;
  let services: any[] = [];
  try {
    services = servicesRaw ? JSON.parse(servicesRaw) : [];
  } catch {
    return { error: 'Formato de servicios inválido. Intenta de nuevo.' };
  }

  // Business Hours JSON parse
  const hoursRaw = formData.get('businessHoursJson') as string;
  let businessHours: any = {};
  try {
    businessHours = hoursRaw ? JSON.parse(hoursRaw) : {};
  } catch {
    return { error: 'Formato de horarios inválido. Intenta de nuevo.' };
  }

  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { error: 'Sesión expirada. Por favor recarga la página.' };
  const orgId = profile.organization_id;

  // Se lee la config actual para conservar las FAQ y el resto de metadata:
  // antes se sobrescribían con [] en cada guardado y se perdían.
  const { data: existing } = await (supabase as any)
    .from('agent_configs')
    .select('organization_id, business_info, metadata')
    .eq('organization_id', orgId)
    .single();

  const businessInfo = {
    name: businessName,
    address: direccionPrincipal,
    phone: telefonoPrincipal,
    sedes,
    email: businessEmail,
    cancellation_policy: cancellationPolicy,
    website: businessWebsite,
    warranty,
    delivery_times: deliveryTimes,
    topics,
    faq: (existing as any)?.business_info?.faq || [],
  };

  // Identidad del agente: lo que se escriba aquí manda sobre el prompt.
  const persona = {
    agent_name: ((formData.get('agentName') as string) || '').trim(),
    role: ((formData.get('agentRole') as string) || '').trim(),
    company: ((formData.get('agentCompany') as string) || businessName).trim(),
    greeting: ((formData.get('agentGreeting') as string) || '').trim(),
    scope: ((formData.get('agentScope') as string) || '').trim(),
    offtopic_redirect: ((formData.get('agentOfftopic') as string) || '').trim(),
    payment_methods: ((formData.get('paymentMethods') as string) || '').trim(),
    payment_terms: ((formData.get('paymentTerms') as string) || '').trim(),
    /**
     * A DONDE paga el cliente. Lista sin limite, no un texto suelto: cada cuenta
     * con su entidad, su tipo, su numero y su titular.
     *
     * `tipo` es texto libre a proposito. Antes solo se contemplaban bancos
     * colombianos; hoy un negocio cobra por PayPal, Binance, Wise, Mercado Pago
     * o lo que exista manana, y el sistema no puede quedarse corto por una
     * lista cerrada escrita en el codigo.
     */
    payment_accounts: cuentasDePago,
    /**
     * Que datos se le piden al cliente para cerrar. Estaban fijos en el codigo
     * ("nombre o razon social, NIT o cedula, correo, direccion de envio"), lo
     * que solo vale para una empresa colombiana que envia mercancia.
     */
    closing_data: ((formData.get('closingData') as string) || '').trim(),
    free_mockup: formData.get('freeMockup') === 'on',
  };

  const cleanPersona = Object.fromEntries(
    Object.entries(persona).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  );

  const metadata = { ...((existing as any)?.metadata || {}), persona: cleanPersona };

  const payload = {
    system_prompt: systemPrompt,
    tone,
    handoff_message: handoffMessage,
    business_info: businessInfo,
    services: services,
    business_hours: businessHours,
    metadata,
    updated_at: new Date().toISOString(),
  };

  let dbError;
  if (existing) {
    const { error } = await (supabase as any)
      .from('agent_configs')
      .update(payload)
      .eq('organization_id', orgId);
    dbError = error;
  } else {
    const { error } = await (supabase as any)
      .from('agent_configs')
      .insert({ organization_id: orgId, ...payload });
    dbError = error;
  }

  if (dbError) {
    return { error: `Error al guardar: ${dbError.message}` };
  }

  revalidatePath('/personalizacion');
  return { success: true };
}
