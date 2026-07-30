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
import { contactIdVariants, pickCanonicalContact, waDigits, type ContactRow } from './contact-identity';

/**
 * Quita el base64 del archivo antes de guardar el mensaje en la base.
 *
 * `raw` guarda el payload completo del webhook. Mientras el puente no podía
 * descargar nada, `media` venía `null` y no había problema; en cuanto Baileys
 * empieza a descargar, cada nota de voz y cada foto se guardarían como base64
 * dentro de una columna JSONB, inflando la base y volviendo lento el panel.
 *
 * Se conservan mimetype, nombre y tamaño, que es lo que sirve para mostrar
 * "nota de voz" o "imagen" en el panel sin arrastrar los bytes.
 */
function stripMediaBytes(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  try {
    const clone: any = JSON.parse(JSON.stringify(raw));
    const msg = clone?.data?.message;
    if (msg?.media?.data) {
      const bytes = Buffer.byteLength(String(msg.media.data), 'base64');
      msg.media = {
        mimetype: msg.media.mimetype || null,
        filename: msg.media.filename || null,
        size_bytes: bytes,
        // Los bytes no se guardan aquí a propósito. Para que el dueño pueda
        // reproducir el archivo en el panel hace falta subirlo a R2.
        data: null,
      };
    }
    return clone;
  } catch {
    return raw;
  }
}

interface ProcessResult {
  success: boolean;
  conversationId?: string;
  response?: string;
}

/**
 * Conversaciones con el agente corriendo ahora mismo. WhatsApp reentrega el
 * mismo mensaje y el puente reenvía cada `message_create`, así que sin este
 * cerrojo el agente llegaba a ejecutarse dos veces y el cliente recibía la
 * misma respuesta duplicada (31% de los mensajes salientes en producción).
 */
const conversationsInFlight = new Set<string>();

/** El cliente está pidiendo ver el producto. */
const PHOTO_REQUEST =
  /\b(foto|fotos|fotico|imagen|imagenes|imágenes|im[aá]genes|ver|muestrame|muéstrame|mu[eé]strame|ense[nñ]ame|enséñame|c[oó]mo se ve|como se ve|pinta|catalogo visual)\b/i;

/**
 * Envía por WhatsApp las fotos de las propuestas SOLO cuando el cliente las
 * pide. El agente ya dejó en caché las imágenes de los productos que cotizó
 * (lib/agent), así que aquí no se consulta el catálogo ni se gastan tokens.
 */
async function dispatchRequestedPhotos(params: {
  supabase: any;
  orgId: string;
  conversationId: string;
  lineKey: string | null;
  waConfig: WhatsAppConfig;
  to: string;
  clientText: string;
  botText: string;
}) {
  const { supabase, orgId, conversationId, lineKey, waConfig, to, clientText, botText } = params;

  try {
    if (!PHOTO_REQUEST.test(clientText || '')) return;

    const photos = getPhotosForConversation(conversationId).filter(p => p.image_url);
    if (photos.length === 0) return;

    // Si el cliente o el bot nombran productos concretos, se envían solo esos.
    const haystack = `${clientText}\n${botText}`.toLowerCase();
    let selected = photos.filter(p => {
      const ref = p.reference?.toLowerCase() || '';
      const name = p.name?.toLowerCase() || '';
      if (ref && haystack.includes(ref)) return true;
      const words = name.split(/\s+/).filter(w => w.length > 4);
      return words.length > 0 && words.some(w => haystack.includes(w));
    });
    if (selected.length === 0) selected = photos;
    selected = selected.slice(0, 3);

    const adapter: WhatsAppAdapter = createAdapter(waConfig, lineKey);

    for (const photo of selected) {
      const caption = photo.unit_price
        ? `*${photo.name}* (Ref: ${photo.reference}) — $${photo.unit_price.toLocaleString('es-CO')} COP c/u`
        : `*${photo.name}* (Ref: ${photo.reference})`;

      const mediaId = await adapter.sendMediaMessage(to, photo.image_url, caption);
      if (!mediaId) {
        logger.warn('No se pudo enviar la foto del producto', { reference: photo.reference });
        continue;
      }

      await (supabase as any).from('messages').upsert(
        {
          conversation_id: conversationId,
          organization_id: orgId,
          wa_message_id: mediaId,
          direction: 'outbound',
          sender: 'bot',
          content: caption,
          line_key: lineKey,
          raw: { media: { url: photo.image_url, type: 'image' } },
        },
        { onConflict: 'wa_message_id', ignoreDuplicates: true }
      );
    }

    logger.info('Fotos de propuestas enviadas', { conversationId, count: selected.length });
  } catch (err) {
    logger.error('Error enviando fotos de propuestas', { error: String(err), conversationId });
  }
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
    // 1. Resolver el contacto.
    //
    // Se busca por TODAS las formas con que un puente puede nombrar a la misma
    // persona (dígitos sueltos, @c.us, @s.whatsapp.net, @lid). Antes se buscaba
    // solo por el identificador exacto que acababa de llegar, y por eso la
    // misma persona acumulaba varias fichas y el bot perdía su historial:
    // `victor ramirez` llegó a tener tres. Ver lib/whatsapp/contact-identity.ts.
    const variants = contactIdVariants(message.from);
    const { data: candidateContacts } = await (supabase as any)
      .from('contacts')
      .select('id, full_name, wa_phone, created_at')
      .eq('organization_id', orgId)
      .in('wa_phone', variants);

    const existingContact = pickCanonicalContact(
      (candidateContacts || []) as ContactRow[],
      message.from
    );

    if ((candidateContacts?.length || 0) > 1) {
      logger.warn('Varias fichas para el mismo contacto: se usa la canónica', {
        digits: waDigits(message.from),
        encontradas: candidateContacts.map((c: any) => c.wa_phone),
        elegida: existingContact?.wa_phone,
      });
    }

    let contactId: string;
    let contactName: string | null = null;
    /**
     * Identificador con el que el contacto está guardado. Es el que se le pasa
     * al agente, porque sus herramientas buscan por `wa_phone` exacto: si se
     * les pasara el identificador entrante en otro formato, no encontrarían al
     * cliente y perderían sus datos guardados.
     */
    let contactPhoneKey: string = message.from;

    if (existingContact) {
      contactId = existingContact.id;
      contactName = existingContact.full_name || message.customerName || null;
      contactPhoneKey = existingContact.wa_phone || message.from;

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

    // 2. Resolver la conversación, que es por contacto Y POR LÍNEA.
    //
    // Antes se buscaba solo por contacto. Con las fichas duplicadas eso pasaba
    // desapercibido, pero al unificarlas el mismo cliente escribiendo a dos
    // líneas caería en un único hilo y el panel lo mostraría bajo la línea
    // equivocada. Con 8 líneas centralizadas eso es inaceptable: cada línea
    // tiene su propia conversación con el mismo cliente.
    let convQuery = (supabase as any)
      .from('conversations')
      .select('id, bot_active, created_at')
      .eq('organization_id', orgId)
      .eq('contact_id', contactId);
    convQuery = lineKey ? convQuery.eq('line_key', lineKey) : convQuery.is('line_key', null);

    // Se ordena y se toma la primera en vez de usar `.single()`: con dos filas
    // `.single()` devuelve error y el código habría creado una tercera
    // conversación en silencio.
    const { data: convRows } = await convQuery.order('created_at', { ascending: true });
    const existingConv = (convRows || [])[0] || null;

    if ((convRows?.length || 0) > 1) {
      logger.warn('Varias conversaciones para el mismo contacto y línea: se usa la más antigua', {
        contactId, lineKey, total: convRows.length,
      });
    }

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
        // El historial lo tiene el puente de ESA línea. Antes se preguntaba al
        // puente por defecto con la sesión 'default': para una línea migrada
        // eso consultaba el puente equivocado y devolvía cero mensajes.
        const baseUrl = getBridgeUrl(lineKey);
        const sessionId = lineKey || waConfig.openwa_session_id || 'default';

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

    // `ignoreDuplicates` no devuelve error ante conflicto, así que pedimos la
    // fila de vuelta: si llega vacía, este mensaje ya se procesó antes y el
    // agente NO debe volver a responderlo.
    const { data: insertedRows, error: msgErr } = await (supabase as any)
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
          raw: stripMediaBytes(message.raw),
        },
        { onConflict: 'wa_message_id', ignoreDuplicates: true }
      )
      .select('id');

    if (msgErr) {
      if (!msgErr.message.includes('duplicate')) {
        logger.error('Failed to insert message', { error: msgErr.message, orgId });
      }
      return { success: true, conversationId };
    }

    if (!insertedRows || insertedRows.length === 0) {
      logger.info('Mensaje ya procesado, se omite el agente', {
        wa_message_id: message.messageId, conversationId,
      });
      return { success: true, conversationId };
    }

    // 5. If bot active and message is not from me, invoke agent
    if (botActive && !message.fromMe) {
      if (conversationsInFlight.has(conversationId)) {
        logger.warn('Agente ya corriendo para esta conversación, se omite', { conversationId });
        return { success: true, conversationId };
      }
      conversationsInFlight.add(conversationId);
      try {
      const { data: agentConfig } = await (supabase as any)
        .from('agent_configs')
        .select('*')
        .eq('organization_id', orgId)
        .single();

      if (agentConfig) {
        const agentResponse = await runAgent({
          orgId,
          // El identificador con el que el contacto está GUARDADO, no el que
          // llegó: las herramientas del agente buscan por `wa_phone` exacto.
          contactPhone: contactPhoneKey,
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
            .upsert(
              {
                conversation_id: conversationId,
                organization_id: orgId,
                wa_message_id: waMessageId,
                direction: 'outbound',
                sender: 'bot',
                content: agentResponse,
                line_key: lineKey,
              },
              { onConflict: 'wa_message_id', ignoreDuplicates: true }
            );

          // Fotos de las 3 propuestas: se envían solo si el cliente las pidió.
          await dispatchRequestedPhotos({
            supabase, orgId, conversationId, lineKey, waConfig,
            to: message.from, clientText: message.text, botText: agentResponse,
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
      } finally {
        conversationsInFlight.delete(conversationId);
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
