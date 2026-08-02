import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '../../supabase/admin';
import { createAdapter } from '@/lib/whatsapp/adapter';
import { logger } from '../../logger';

interface ToolContext {
  orgId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
}

interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  role: string;
  notify_on_handoff: boolean;
}

/**
 * Sends a WhatsApp alert to all active emergency contacts configured for this org.
 */
async function notifyEmergencyContacts(
  alertMessage: string,
  orgId: string,
  conversationId: string,
  agentConfigMeta?: any
): Promise<string[]> {
  const notified: string[] = [];
  try {
    const supabase = createAdminClient();

    // Get WhatsApp config
    const { data: waConfig } = await (supabase as any)
      .from('whatsapp_configs')
      .select('*')
      .eq('organization_id', orgId)
      .single();

    if (!waConfig) {
      logger.warn('No WhatsApp config — cannot send emergency alerts', { orgId });
      return notified;
    }

    // Get conversation to find the line_key
    const { data: conv } = await (supabase as any)
      .from('conversations')
      .select('line_key')
      .eq('id', conversationId)
      .single();

    const lineKey = conv?.line_key || null;

    const adapter = createAdapter(waConfig, lineKey);

    // Collect active contacts from Supabase metadata
    const contacts: EmergencyContact[] = (agentConfigMeta?.emergency_contacts || []).filter(
      (c: EmergencyContact) => c.notify_on_handoff && c.phone
    );

    // Fallback: env variable
    if (contacts.length === 0 && process.env.HANDOFF_ALERT_PHONE) {
      contacts.push({
        id: 'env-fallback',
        name: 'Administrador',
        phone: process.env.HANDOFF_ALERT_PHONE,
        role: 'Dueño',
        notify_on_handoff: true,
      });
    }

    // Fan-out: send to all active contacts in parallel
    await Promise.allSettled(
      contacts.map(async (contact) => {
        try {
          await adapter.sendTextMessage(contact.phone, alertMessage);
          notified.push(contact.phone);
          logger.info('Emergency alert sent', { to: contact.phone, name: contact.name, orgId });
        } catch (err) {
          logger.error('Failed to send emergency alert', { error: String(err), to: contact.phone });
        }
      })
    );
  } catch (err) {
    logger.error('notifyEmergencyContacts error', { error: String(err), orgId });
  }
  return notified;
}



/**
 * ¿EL CLIENTE ESTÁ PIDIENDO UNA PERSONA?
 *
 * EL FALLO QUE ESTO CIERRA
 * ------------------------
 * Medido el 02-ago-2026 con el simulador. El cliente escribió:
 *
 *   «No me sirve el bot, quiero hablar con un asesor humano de verdad por favor»
 *
 * y el bot respondió *«Jaja, soy Oscar, del equipo comercial. Cuéntame qué
 * necesitas.»* — se quedó en «Entrada», con el bot encendido y sin avisarle a
 * nadie. Al cliente que pidió una persona se le negó la persona.
 *
 * La causa es la misma clase de fallo que vaciaba el Kanban: el traspaso
 * dependía de que el modelo se acordara de llamar `requestHumanHandoff`. Un
 * cliente que pide hablar con alguien es lo MENOS negociable que hay en un
 * CRM, y era justo lo que estaba librado al azar.
 *
 * Aquí se decide en código, antes de que el modelo abra la boca.
 *
 * POR QUÉ LA LISTA ES CORTA
 * -------------------------
 * Esto APAGA el bot: un falso positivo deja a un cliente esperando a un asesor
 * que nadie llamó. Así que se exige un verbo de CONTACTO (hablar, pasar,
 * comunicar, transferir…) junto a una palabra de PERSONA, y cerca. «Necesito
 * 100 mugs para una persona» tiene la palabra persona y no dispara, porque no
 * hay verbo de contacto. Si un cliente lo pide con palabras raras, el modelo
 * todavía tiene su herramienta: esta regla añade un piso, no reemplaza el techo.
 */
const PIDE_UNA_PERSONA =
  /(hablar|hable|habla|pasar|p[aá]same|p[aá]seme|pasas|pasarme|comunica(r|me)?|comun[ií]queme|transferir|transfi[eé]re(me)?|transfi[eé]rame|atienda|atiende)[^.?!\n]{0,40}\b(humano|humana|persona real|persona de verdad|un asesor|una asesora|un agente|una agente|alguien real|alguien de verdad|alguien que sepa|con alguien|una persona|un vendedor|un encargado)/i;

/** «No quiero hablar con un bot» dicho de frente, sin nombrar a la persona. */
const NO_QUIERE_BOT =
  /\bno\b[^.?!\n]{0,30}\b(bot|robot|m[aá]quina|contestadora|inteligencia artificial)\b/i;

export function clientePideUnaPersona(mensaje: string | null | undefined): boolean {
  const texto = String(mensaje || '');
  if (!texto.trim()) return false;
  return PIDE_UNA_PERSONA.test(texto) || NO_QUIERE_BOT.test(texto);
}

/**
 * LAS FRASES CON LAS QUE EL BOT ADMITE QUE NO PUDO CONTESTAR.
 *
 * Viven aquí y no sueltas en `index.ts` para que haya UNA sola definición: la
 * que el agente entrega al cliente y la que se usa para detectar que se trabó
 * son literalmente la misma cadena. Si alguien reescribe el respaldo y la
 * copia de la detección queda vieja, el sistema deja de darse cuenta de que
 * está fallando — y ese es justo el fallo que esto viene a cerrar.
 */
export const RESPALDO_PREGUNTAR =
  'Cuéntame un poco más de lo que necesitas para no ofrecerte algo que no era: ¿para qué lo vas a usar y qué tamaño o cantidad tienes en mente? Con eso lo reviso con el equipo y te confirmo.';
export const RESPALDO_COTIZAR =
  'Ya estoy revisando eso con producción para darte el valor exacto. Cuéntame mientras qué cantidad manejas y te armo la cotización completa.';
export const RESPALDO_ERROR = 'Dame un segundo que reviso eso y te confirmo.';

const RESPALDOS = [RESPALDO_PREGUNTAR, RESPALDO_COTIZAR, RESPALDO_ERROR];

/** Texto comparable: sin mayúsculas, sin signos, sin espacios de más. */
function normalizar(t: string | null | undefined): string {
  return String(t || '').toLowerCase().replace(/[^a-záéíóúñü0-9]+/gi, ' ').trim();
}

function esRespaldo(t: string | null | undefined): boolean {
  const n = normalizar(t);
  return !!n && RESPALDOS.some((r) => normalizar(r) === n);
}

/** Dos mensajes que dicen lo mismo: repetirse es no avanzar. */
function casiElMismo(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Uno que contiene al otro entero también es repetirse, siempre que haya
  // texto suficiente: con frases cortas cualquier cosa contiene a cualquiera.
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  return corto.length >= 40 && largo.includes(corto);
}

/**
 * ¿EL BOT LLEVA DOS TURNOS SEGUIDOS SIN AVANZAR?
 *
 * EL FALLO QUE ESTO CIERRA
 * ------------------------
 * El 02-ago-2026 el dueño mostró una conversación de su panel. El otro lado
 * era **otro bot** —de prospección, ofreciendo páginas web— y el bot de ZOOM
 * le contestó **dos veces seguidas el mismo saludo** («Hola, hablas con Oscar
 * Herrera…») antes de cotizarle portarretratos. Nadie se enteró: la
 * conversación se quedó en «Entrada», con el bot encendido, dando vueltas.
 *
 * Hasta hoy una conversación solo llegaba a «Sin Atender» si el cliente pedía
 * una persona o si el modelo decidía escalar. **Nada detectaba que el bot se
 * hubiera trabado**, que es el caso más común y el más silencioso.
 *
 * DOS SEÑALES, LAS DOS DURAS
 * --------------------------
 * - El bot entregó una de sus frases de respaldo: es el propio código
 *   admitiendo que agotó los reintentos y no supo qué contestar.
 * - El bot repitió lo que ya había dicho: no está llevando la conversación a
 *   ningún lado.
 *
 * POR QUÉ A LA SEGUNDA Y NO A LA PRIMERA
 * --------------------------------------
 * Decisión del dueño (02-ago). Un tropiezo suelto lo remonta el bot en el
 * mensaje siguiente; apagarlo ahí llenaría el panel de tarjetas que no
 * necesitaban a nadie. Dos seguidas ya no es un tropiezo.
 *
 * SIN CONTADORES EN LA BASE
 * -------------------------
 * No hace falta guardar nada: los mensajes anteriores del bot ya vienen
 * cargados en el turno, y de ellos se deduce si el turno pasado también se
 * trabó. Un contador guardado puede desincronizarse; los mensajes, no.
 */
export function elBotNoAvanza(params: {
  respuesta: string | null | undefined;
  mensajesPreviosDelBot: string[];
}): boolean {
  const previos = params.mensajesPreviosDelBot || [];
  const ultimo = previos[previos.length - 1];
  const penultimo = previos[previos.length - 2];

  const ahora = esRespaldo(params.respuesta) || casiElMismo(params.respuesta, ultimo);
  if (!ahora) return false;

  return esRespaldo(ultimo) || casiElMismo(ultimo, penultimo);
}

/**
 * EL ÚNICO SITIO QUE TRASPASA A UN HUMANO.
 *
 * Pasan por aquí las dos vías: la herramienta que llama el modelo y la regla
 * determinista de `clientePideUnaPersona`. Una sola implementación significa
 * que apagar el bot, mover la etapa y avisar al equipo ocurren siempre igual,
 * venga la orden de donde venga.
 */
export async function ejecutarTraspasoAHumano(ctx: ToolContext, args: any) {
  const { reason, urgency = 'medium' } = args;
  const supabase = createAdminClient();

  // 1. Pause the bot for this conversation
  const { data: convData, error } = await (supabase as any)
    .from('conversations')
    .update({ bot_active: false })
    .eq('id', ctx.conversationId)
    .select('contact_id')
    .single();

  if (error || !convData) {
    logger.error('Failed to pause bot on handoff', {
      error: error?.message,
      conversationId: ctx.conversationId,
    });
    return { success: false, error: 'Error al transferir' };
  }

  // 1.5 Automatically update Kanban stage
  // If urgency is high, move to 'angry', otherwise 'unhandled'
  const newStage = urgency === 'high' ? 'angry' : 'unhandled';
  const { data: contactData } = await (supabase as any)
    .from('contacts')
    .select('metadata')
    .eq('id', convData.contact_id)
    .single();
  
  await (supabase as any)
    .from('contacts')
    .update({ metadata: { ...(contactData?.metadata || {}), stage: newStage } })
    .eq('id', convData.contact_id);

  // 2. Get agent config (handoff_message + owner alert phone)
  const { data: agentConfig } = await (supabase as any)
    .from('agent_configs')
    .select('handoff_message, metadata')
    .eq('organization_id', ctx.orgId)
    .single();

  // 3. Get last few messages for context
  const { data: recentMessages } = await (supabase as any)
    .from('messages')
    .select('direction, content, created_at')
    .eq('conversation_id', ctx.conversationId)
    .order('created_at', { ascending: false })
    .limit(5);

  const contactLabel = ctx.contactName
    ? `*${ctx.contactName}*`
    : `número desconocido`;

  const urgencyEmoji =
    urgency === 'high' ? '🚨' : urgency === 'medium' ? '⚠️' : 'ℹ️';

  // 4. Build the alert message for the owner/vet
  const contextLines = recentMessages
    ? [...recentMessages]
        .reverse()
        .map(
          (m: any) =>
            `${m.direction === 'inbound' ? '👤 Cliente' : '🤖 Bot'}: ${m.content}`
        )
        .join('\n')
    : '';

  const alertMessage = [
    `${urgencyEmoji} *ASISTENCIA HUMANA REQUERIDA*`,
    ``,
    `📋 *Cliente:* ${contactLabel}`,
    `📞 *Teléfono:* ${ctx.contactPhone}`,
    `❗ *Motivo:* ${reason}`,
    `📊 *Urgencia:* ${urgency.toUpperCase()}`,
    ``,
    contextLines
      ? `💬 *Últimos mensajes:*\n${contextLines}`
      : '',
    ``,
    `👉 El bot ha sido *pausado*. Responde directamente a este número para continuar la atención.`,
  ]
    .filter(Boolean)
    .join('\n');

  // 5. Notify all active emergency contacts via WhatsApp
  const notifiedNumbers = await notifyEmergencyContacts(
    alertMessage,
    ctx.orgId,
    ctx.conversationId,
    agentConfig?.metadata
  );

  logger.info('Human handoff completed', {
    orgId: ctx.orgId,
    conversationId: ctx.conversationId,
    contactPhone: ctx.contactPhone,
    reason,
    urgency,
    notifiedContacts: notifiedNumbers,
  });

  return {
    success: true,
    /**
     * EL CLIENTE NUNCA SE ENTERA DE QUE HABLA CON UN BOT.
     *
     * Este respaldo decia «Te paso con un humano en un momento»: una frase
     * que solo tiene sentido si quien la dice NO es humano. Delataba al bot
     * justo en el momento mas delicado, cuando el cliente ya pidio hablar
     * con alguien. Solo saltaba con el campo del panel vacio, asi que estaba
     * dormida esperando a que alguien lo borrara.
     *
     * El respaldo no puede omitirse —hay que contestarle algo al cliente—,
     * pero si puede no decir nada: ni que es un bot, ni un dato del negocio
     * que nadie escribio en el panel.
     */
    message:
      agentConfig?.handoff_message ||
      'Dame un momento que lo reviso y te confirmo.',
    reason,
    urgency,
    notifiedContacts: notifiedNumbers.length,
  };
}

export function requestHumanHandoffTool(ctx: ToolContext) {
  return tool({
    description:
      'Transfiere la conversación a un humano. Usar cuando el cliente necesita atención personalizada, tiene una queja grave, o una petición que el bot no puede resolver.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Razón específica por la que se necesita un humano',
        },
        urgency: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description:
            'Nivel de urgencia: low=consulta general, medium=requiere atención pronto, high=emergencia',
        },
      },
      required: ['reason'],
    }),
    execute: async (args: any) => ejecutarTraspasoAHumano(ctx, args),
  } as any);
}
