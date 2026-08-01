import { createAdminClient } from '@/lib/supabase/server';

/** Teléfono ficticio del simulador de Personalización. No es un cliente. */
const TELEFONO_DEL_SIMULADOR = '+10000000000';

/**
 * Los chats de la organizacion, con el ultimo mensaje de cada uno.
 *
 * POR QUE HACE FALTA EL ULTIMO MENSAJE
 * ------------------------------------
 * En el telefono, la lista de chats se lee como la de WhatsApp: bajo el nombre
 * va el renglon del ultimo mensaje, que es lo que uno mira para decidir si
 * entra o sigue de largo. Sin el, la fila solo repetia el telefono del
 * contacto, que ya esta en el nombre cuando no hay nombre guardado.
 *
 * COMO SE TRAE, Y QUE PASA SI NO ALCANZA
 * --------------------------------------
 * Una sola consulta para todos los chats — no una por chat — pidiendo los
 * mensajes mas recientes en bloque y quedandose con el primero de cada
 * conversacion. La consulta esta acotada a `TOPE_DE_MENSAJES` filas.
 *
 * Si un chat quedo fuera de esa ventana (su ultimo mensaje es viejo y mientras
 * tanto hubo mucho trafico en otros), la lista NO inventa nada: esa fila cae al
 * telefono del contacto. Se prefiere un renglon menos informativo a un renglon
 * equivocado.
 */
const TOPE_DE_MENSAJES = 1500;

export interface ConversacionConResumen {
  id: string;
  bot_active: boolean;
  last_message_at: string;
  line_key?: string | null;
  ultimo_mensaje: {
    content: string | null;
    raw: unknown;
    direction: 'inbound' | 'outbound';
  } | null;
  /** Exactamente los campos que pide el `select` de abajo. */
  contacts: {
    full_name: string | null;
    wa_phone: string;
    // El telefono real cuando `wa_phone` es un `@lid`. Ver mostrarContacto().
    metadata?: Record<string, unknown> | null;
  } | null;
  [campo: string]: unknown;
}

export async function cargarConversaciones(orgId: string): Promise<ConversacionConResumen[]> {
  const supabase = await createAdminClient();

  const { data: chats } = await (supabase as any)
    .from('conversations')
    .select('*, contacts(full_name, wa_phone, metadata)')
    .eq('organization_id', orgId)
    .order('last_message_at', { ascending: false });

  /**
   * El simulador de Personalización NO es un cliente.
   *
   * El chat de pruebas del panel vive en el mismo teléfono ficticio
   * (`+10000000000`, «Cliente Demo») y aparecía mezclado con los clientes
   * reales, arriba del todo porque se creaba de nuevo cada rato. Quien vaya a
   * usar el sistema no tiene por qué distinguir cuál de esos chats es de
   * verdad. Se sigue probando igual desde Personalización; solo deja de
   * ensuciar la bandeja.
   */
  const lista = ((chats || []) as ConversacionConResumen[]).filter(
    (c) => c.contacts?.wa_phone !== TELEFONO_DEL_SIMULADOR
  );
  if (lista.length === 0) return [];

  const { data: recientes } = await (supabase as any)
    .from('messages')
    .select('conversation_id, content, raw, direction, created_at')
    .in('conversation_id', lista.map((c) => c.id))
    .order('created_at', { ascending: false })
    .limit(TOPE_DE_MENSAJES);

  // Los mensajes vienen del mas nuevo al mas viejo, asi que el primero que
  // aparece de cada conversacion ES su ultimo mensaje.
  const ultimoPorChat = new Map<string, ConversacionConResumen['ultimo_mensaje']>();
  for (const m of (recientes || []) as any[]) {
    if (!ultimoPorChat.has(m.conversation_id)) {
      ultimoPorChat.set(m.conversation_id, {
        content: m.content ?? null,
        raw: m.raw ?? null,
        direction: m.direction,
      });
    }
  }

  return lista.map((c) => ({ ...c, ultimo_mensaje: ultimoPorChat.get(c.id) ?? null }));
}
