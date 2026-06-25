'use server';

import { createAdminClient as createClient } from '@/lib/supabase/server';
import { sendWhatsAppMessage } from '@/lib/whatsapp/send';
import { redirect } from 'next/navigation';

export async function toggleBotAction(conversationId: string, botActive: boolean) {
  const supabase = await createClient();

  const { error } = await (supabase as any)
    .from('conversations')
    .update({ bot_active: botActive })
    .eq('id', conversationId);

  if (error) {
    return { error: error.message };
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
