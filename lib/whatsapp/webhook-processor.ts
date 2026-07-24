import { createAdminClient } from '@/lib/supabase/admin';
import { createAdapter, type WhatsAppAdapter } from './adapter';
import { getBridgeUrl, bridgeHeaders } from './bridge';
import { logger } from '@/lib/logger';
import type { NormalizedMessage } from './config';
import type { WhatsAppConfig, AgentConfig } from '@/lib/database.types';
import { transcribeAudio } from './transcribe';
import { describeImage } from './describe-image';
import { logLineError } from './log-line-error';
import { getPhotosForConversation } from '@/lib/agent';

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

    // 3. Process media message if present (audio transcription / image description 100% in-memory)
    if (message.media && message.media.data) {
      const mimetype = message.media.mimetype || '';

      if (mimetype.startsWith('audio/')) {
        try {
          const transcribedText = await transcribeAudio(message.media.data, mimetype);
          if (transcribedText) {
            message.text = transcribedText;
          } else {
            message.text = '[Mensaje de voz sin transcripción disponible]';
            if (lineKey) {
              await logLineError({
                lineKey,
                orgId,
                errorType: 'transcription',
                severity: 'warn',
                message: 'Transcripción devolvió texto vacío (audio inaudible o muy corto)',
                context: { mimetype, messageId: message.messageId },
              });
            }
          }
        } catch (err) {
          logger.error('Error transcribing incoming WhatsApp audio message', { error: String(err) });
          message.text = '[Error al procesar mensaje de voz]';
          if (lineKey) {
            await logLineError({
              lineKey,
              orgId,
              errorType: 'transcription',
              severity: 'error',
              message: `Error transcribiendo audio: ${String(err).slice(0, 300)}`,
              context: { mimetype, messageId: message.messageId },
            });
          }
        }
      } else if (mimetype.startsWith('image/')) {
        try {
          const imageDescription = await describeImage(message.media.data, mimetype);
          if (imageDescription) {
            if (message.text) {
              message.text = `${message.text}\n\n[Imagen adjunta de cliente: ${imageDescription}]`;
            } else {
              message.text = `[Imagen adjunta de cliente: ${imageDescription}]`;
            }
          } else {
            message.text = message.text || '[Imagen sin descripción disponible]';
          }
        } catch (err) {
          logger.error('Error describing incoming WhatsApp image message with Gemini', { error: String(err) });
          message.text = message.text || '[Imagen]';
          if (lineKey) {
            await logLineError({
              lineKey,
              orgId,
              errorType: 'describe_image',
              severity: 'error',
              message: `Error analizando imagen con Gemini: ${String(err).slice(0, 300)}`,
              context: { mimetype, messageId: message.messageId },
            });
          }
        }
      } else {
        if (!message.text) {
          message.text = '[Archivo adjunto]';
        }
      }
    } else if (message.mediaError) {
      const type = message.mediaType || '';
      let errorPromptText = '[El cliente envió un archivo adjunto pero no se pudo descargar en este momento. Por favor dile de forma amable que no pudiste abrir el archivo y pídele que te describa lo que necesita por texto para cotizarle de inmediato.]';
      
      if (type === 'image') {
        errorPromptText = '[El cliente envió una imagen pero el archivo no pudo ser abierto en este momento. Por favor dile de forma amable que no pudiste ver la foto y pídele que te la describa en texto para cotizarle de inmediato.]';
      } else if (type === 'audio' || type === 'ptt') {
        errorPromptText = '[El cliente envió una nota de voz pero el archivo de audio no pudo ser abierto. Por favor dile de forma amable que no pudiste escuchar el audio y pídele que te escriba su consulta por texto para responderle de inmediato.]';
      }

      if (message.text) {
        message.text = `${message.text}\n\n${errorPromptText}`;
      } else {
        message.text = errorPromptText;
      }

      if (lineKey) {
        await logLineError({
          lineKey,
          orgId,
          errorType: 'media_download',
          severity: 'warn',
          message: `Media no disponible tras reintentos (type=${type})`,
          context: { messageId: message.messageId, mediaType: type },
        });
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

          // Dispatch queued product photos if any were captured during tool calls
          const photos = getPhotosForConversation(conversationId);
          if (photos && photos.length > 0) {
            for (const photo of photos) {
              try {
                await adapter.sendMediaMessage(message.from, photo.image_url, photo.name);
              } catch (photoErr) {
                logger.error('Failed to send product photo', { error: String(photoErr), photo });
              }
            }
          }

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
