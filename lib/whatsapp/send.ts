import { createAdminClient } from '@/lib/supabase/admin';
import { createAdapter } from './adapter';
import { logger } from '@/lib/logger';

/**
 * Send a message to a WhatsApp contact from the dashboard (human sender).
 */
export async function sendWhatsAppMessage(
  orgId: string,
  conversationId: string,
  to: string,
  text: string
): Promise<boolean> {
  const supabase = createAdminClient();

  try {
    // Get WhatsApp config
    const { data: waConfig } = await supabase
      .from('whatsapp_configs')
      .select('*')
      .eq('organization_id', orgId)
      .single();

    if (!waConfig) {
      logger.error('No WhatsApp config found', { orgId });
      return false;
    }

    // Get conversation to find the line_key
    const { data: conv } = await (supabase as any)
      .from('conversations')
      .select('line_key')
      .eq('id', conversationId)
      .single();

    const lineKey = (conv as any)?.line_key || null;

    const adapter = createAdapter(waConfig, lineKey);
    const waMessageId = await adapter.sendTextMessage(to, text);

    // Save outbound message
    await (supabase as any)
      .from('messages')
      .insert({
        conversation_id: conversationId,
        organization_id: orgId,
        wa_message_id: waMessageId,
        direction: 'outbound',
        sender: 'human',
        content: text,
      });

    // Update conversation timestamp
    await (supabase as any)
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    return true;
  } catch (err) {
    logger.error('Send message failed', { error: String(err), orgId, conversationId });
    return false;
  }
}
