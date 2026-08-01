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

    /**
     * SI NO SALIÓ, NO SE GUARDA.
     *
     * Antes el mensaje se insertaba pasara lo que pasara y la función devolvía
     * `true` siempre: el asesor veía su mensaje en el chat, creía que el
     * cliente lo había recibido, y no había recibido nada. Un mensaje fantasma
     * escrito por una persona es peor que uno del bot, porque el asesor se
     * queda esperando una respuesta que nunca va a llegar.
     *
     * Medido el 01-ago-2026: de los últimos 6 mensajes escritos a mano desde el
     * panel, **3 no tenían id de WhatsApp** — nunca salieron. Coinciden con las
     * horas en las que la línea 2 estaba caída.
     *
     * La ruta del bot ya hacía esto bien (`webhook-processor`), la del panel
     * nunca se corrigió. Ahora se comportan igual: sin acuse de WhatsApp no hay
     * mensaje en el chat, y el asesor ve el error y puede reaccionar.
     */
    if (!waMessageId) {
      logger.error('El mensaje escrito desde el panel NO se pudo enviar', {
        orgId, conversationId, lineKey, to,
      });
      if (lineKey) {
        try {
          const { logLineError } = await import('./log-line-error');
          await logLineError({
            lineKey,
            orgId,
            errorType: 'connection',
            severity: 'error',
            message: 'El puente rechazó un mensaje escrito por un asesor desde el panel. El cliente no lo recibió.',
            context: { conversationId, to },
          });
        } catch (e) {
          logger.warn('No se pudo registrar el error de línea', { error: String(e) });
        }
      }
      return false;
    }

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
