import { createAdminClient } from '@/lib/supabase/admin';
import { createAdapter, type WhatsAppAdapter } from './adapter';
import { getBridgeUrl, bridgeHeaders } from './bridge';
import { logger } from '@/lib/logger';
import type { NormalizedMessage } from './config';
import type { WhatsAppConfig, AgentConfig } from '@/lib/database.types';
import { transcribeAudio } from './transcribe';

interface ProcessResult {
  success: boolean;
  conversationId?: string;
  response?: string;
}

export async function processInboundMessage(
  orgId: string,
  message: NormalizedMessage,
  waConfig: WhatsAppConfig,
  lineKey: string | null,
  runAgent: (params: {
    orgId: string;
    contactPhone: string;
    contactName: string | null;
    conversationId: string;
    messageText: string;
    agentConfig: AgentConfig;
  }) => Promise<string | null>
): Promise<ProcessResult> {
  const startTime = Date.now();
  const supabase = createAdminClient();

  try {
    // 1. Upsert contact
    const { data: existingContact } = await (supabase as any)
      .from('contacts')
      .select('id, full_name')
      .eq('organization_id', orgId)
      .eq('wa_phone', message.from)
      .single();

    let contactId: string;
    let contactName: string | null = null;

    if (existingContact) {
      contactId = existingContact.id;
      contactName = existingContact.full_name || message.customerName || null;
      
      // Update name if it was empty but we have it now
      if (!existingContact.full_name && message.customerName) {
        await (supabase as any).from('contacts').update({ full_name: message.customerName }).eq('id', contactId);
      }
    } else {
      const { data: newContact, error: contactErr } = await (supabase as any)
        .from('contacts')
        .insert({
          organization_id: orgId,
          wa_phone: message.from,
          full_name: message.customerName || null,
        })
        .select('id')
        .single();

      if (contactErr || !newContact) {
        logger.error('Failed to create contact', { error: contactErr?.message, orgId });
        return { success: false };
      }
      contactId = newContact.id;
      contactName = message.customerName || null;
    }

    // 2. Upsert conversation
    const { data: existingConv } = await (supabase as any)
      .from('conversations')
      .select('id, bot_active')
      .eq('organization_id', orgId)
      .eq('contact_id', contactId)
      .single();

    let conversationId: string;
    let botActive: boolean;

    if (existingConv) {
      conversationId = existingConv.id;
      botActive = existingConv.bot_active;
      await (supabase as any)
        .from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
    } else {
      const { data: newConv, error: convErr } = await (supabase as any)
        .from('conversations')
        .insert({
          organization_id: orgId,
          contact_id: contactId,
          line_key: lineKey,
        })
        .select('id, bot_active')
        .single();

      if (convErr || !newConv) {
        logger.error('Failed to create conversation', { error: convErr?.message, orgId });
        return { success: false };
      }
      conversationId = newConv.id;
      botActive = newConv.bot_active;
    }

    // 2b. Sync history from WhatsApp if this conversation has no messages in the database
    try {
      const { count } = await (supabase as any)
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId);

      const hasNoHistoryInDb = count === 0;

      if (hasNoHistoryInDb && waConfig.provider === 'openwa') {
        const baseUrl = getBridgeUrl();
        const sessionId = waConfig.openwa_session_id || 'default';
        
        // Fetch last 15 messages for context
        const res = await fetch(
          `${baseUrl}/api/sessions/${sessionId}/chats/${message.from}/history?limit=15`,
          {
            headers: bridgeHeaders({}),
          }
        );
        
        if (res.ok) {
          const result = await res.json() as { success: boolean, messages: any[] };
          if (result.success && result.messages?.length > 0) {
            logger.info('Syncing chat history from WhatsApp', { from: message.from, count: result.messages.length });
            
            const messagesToInsert = result.messages.map((m: any) => {
              const direction = m.fromMe ? 'outbound' : 'inbound';
              const sender = m.fromMe ? 'bot' : 'contact';
              
              let content = m.body || '';
              if (!content && m.type && m.type !== 'chat') {
                content = `[Mensaje tipo: ${m.type}]`;
              }

              return {
                conversation_id: conversationId,
                organization_id: orgId,
                wa_message_id: m.id,
                direction,
                sender,
                content: content,
                line_key: lineKey,
                created_at: new Date(m.timestamp).toISOString(),
              };
            });

            const { error: batchErr } = await (supabase as any)
              .from('messages')
              .upsert(messagesToInsert, { onConflict: 'wa_message_id', ignoreDuplicates: true });
            
            if (batchErr) {
              logger.error('Failed to insert synced history messages', { error: batchErr.message });
            }
          }
        }
      }
    } catch (historyErr) {
      logger.error('Error syncing history from WhatsApp web bridge', { error: String(historyErr) });
    }

    // 3. Transcribe audio message if present
    if (message.media && message.media.data) {
      try {
        const transcribedText = await transcribeAudio(message.media.data, message.media.mimetype);
        if (transcribedText) {
          message.text = transcribedText;
        } else {
          message.text = '[Mensaje de voz sin transcripción disponible]';
        }
      } catch (err) {
        logger.error('Error transcribing incoming WhatsApp audio message', { error: String(err) });
        message.text = '[Error al procesar mensaje de voz]';
      }
    }

    // 4. Insert message (idempotent)
    const direction = message.fromMe ? 'outbound' : 'inbound';
    const sender = message.fromMe ? 'bot' : 'contact';

    const { error: msgErr } = await (supabase as any)
      .from('messages')
      .upsert(
        {
          conversation_id: conversationId,
          organization_id: orgId,
          wa_message_id: message.messageId,
          direction,
          sender,
          content: message.text,
          line_key: lineKey,
          raw: message.raw,
        },
        { onConflict: 'wa_message_id', ignoreDuplicates: true }
      );

    if (msgErr) {
      // If it's a duplicate, that's fine (idempotency)
      if (!msgErr.message.includes('duplicate')) {
        logger.error('Failed to insert message', { error: msgErr.message, orgId });
      }
      return { success: true, conversationId };
    }

    // 5. If bot active and message is not from me, invoke agent
    if (botActive && !message.fromMe) {
      const { data: agentConfig } = await (supabase as any)
        .from('agent_configs')
        .select('*')
        .eq('organization_id', orgId)
        .single();

      if (agentConfig) {
        const agentResponse = await runAgent({
          orgId,
          contactPhone: message.from,
          contactName,
          conversationId,
          messageText: message.text,
          agentConfig,
        });

        if (agentResponse) {
          // Send response via WhatsApp
          const adapter: WhatsAppAdapter = createAdapter(waConfig, lineKey);
          const waMessageId = await adapter.sendTextMessage(message.from, agentResponse);

          // Save outbound message
          await (supabase as any)
            .from('messages')
            .insert({
              conversation_id: conversationId,
              organization_id: orgId,
              wa_message_id: waMessageId,
              direction: 'outbound',
              sender: 'bot',
              content: agentResponse,
              line_key: lineKey,
            });

          const latency = Date.now() - startTime;
          logger.info('Message processed', {
            orgId,
            conversationId,
            wa_message_id: message.messageId,
            latency_ms: latency,
          });

          return { success: true, conversationId, response: agentResponse };
        }
      }
    }

    return { success: true, conversationId };
  } catch (err) {
    logger.error('Webhook processing error', {
      error: String(err),
      orgId,
      wa_message_id: message.messageId,
      latency_ms: Date.now() - startTime,
    });
    return { success: false };
  }
}
