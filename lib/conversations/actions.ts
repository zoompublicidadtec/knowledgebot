'use server';

import { createAdminClient as createClient } from '@/lib/supabase/server';
import { sendWhatsAppMessage } from '@/lib/whatsapp/send';
import { redirect } from 'next/navigation';

/**
 * EL INTERRUPTOR DEL BOT Y LA COLUMNA DEL KANBAN SON LA MISMA COSA.
 *
 * EL FALLO QUE ESTO CIERRA
 * ------------------------
 * Mover la tarjeta en el Kanban ya apagaba o encendía el bot
 * (`updateContactStageAction`), pero al revés no: apagar el bot a mano desde el
 * chat dejaba la tarjeta donde estaba. Resultado, visto por el dueño el
 * 02-ago-2026 con una captura: la campana decía **3 conversaciones «piden
 * hablar con una persona»** y la columna «Sin Atender» solo tenía **2**. La
 * tercera seguía en «Entrada» con el bot apagado.
 *
 * No era un fallo de la campana ni del Kanban: cada uno miraba un dato
 * distinto para responder la MISMA pregunta —¿esta conversación necesita una
 * persona?—. La campana mira `bot_active`; el Kanban mira la etapa.
 *
 * Aquí se atan: apagar el bot manda la tarjeta a «Sin Atender», y encenderlo
 * la devuelve a «Entrada». Las etapas que puso una persona por otro motivo
 * —«Molesto» al apagar, «Ignorar» al encender— no se tocan.
 */
export async function toggleBotAction(conversationId: string, botActive: boolean) {
  const supabase = await createClient();

  const { data: conv, error } = await (supabase as any)
    .from('conversations')
    .update({ bot_active: botActive })
    .eq('id', conversationId)
    .select('contact_id')
    .single();

  if (error) {
    return { error: error.message };
  }

  if (conv?.contact_id) {
    const { data: contact } = await (supabase as any)
      .from('contacts')
      .select('metadata')
      .eq('id', conv.contact_id)
      .single();

    const meta = contact?.metadata || {};
    const etapa = meta.stage || 'inbox';
    const COMERCIALES = ['inbox', 'sales', 'sold'];

    let destino: string | null = null;
    if (!botActive && COMERCIALES.includes(etapa)) {
      // El bot se calla: alguien tiene que atender esto.
      destino = 'unhandled';
    } else if (botActive && (etapa === 'unhandled' || etapa === 'angry')) {
      // Vuelve a atender el bot: ya no está esperando a una persona.
      destino = 'inbox';
    }

    if (destino) {
      await (supabase as any)
        .from('contacts')
        .update({ metadata: { ...meta, stage: destino } })
        .eq('id', conv.contact_id);
    }
  }

  return { success: true };
}

export async function sendMessageAction(
  conversationId: string,
  to: string,
  text: string
) {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { error: 'Organización no encontrada' };
  const orgId = profile.organization_id;

  const success = await sendWhatsAppMessage(orgId, conversationId, to, text);
  if (!success) {
    return { error: 'Error al enviar el mensaje de WhatsApp' };
  }

  return { success: true };
}

export async function updateContactStageAction(contactId: string, stage: string) {
  const supabase = await createClient();
  
  const { data: contact } = await (supabase as any).from('contacts').select('metadata').eq('id', contactId).single();
  const currentMeta = contact?.metadata || {};
  
  const { error } = await (supabase as any)
    .from('contacts')
    .update({ metadata: { ...currentMeta, stage } })
    .eq('id', contactId);
    
  if (error) return { error: error.message };

  // Automate bot toggle based on Kanban stage
  // The bot should actively talk to customers in 'inbox' (Entrada), 'sales' (Ventas), and 'sold' (Vendido)
  // The bot MUST be turned OFF when in 'unhandled' (Sin Atender), 'angry' (Molesto), or 'ignore' (Ignorar)
  const botShouldBeActive = ['inbox', 'sales', 'sold'].includes(stage);
  
  await (supabase as any)
    .from('conversations')
    .update({ bot_active: botShouldBeActive })
    .eq('contact_id', contactId);

  return { success: true };
}
