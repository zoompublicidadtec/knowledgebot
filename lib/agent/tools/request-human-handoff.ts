import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { createAdapter } from '@/lib/whatsapp/adapter';
import { logger } from '@/lib/logger';

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
    execute: async (args: any) => {
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
        message:
          agentConfig?.handoff_message ||
          'Te paso con un humano en un momento. Por favor espera. 🙏',
        reason,
        urgency,
        notifiedContacts: notifiedNumbers.length,
      };
    },
  } as any);
}
