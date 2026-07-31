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
import { uploadBase64ToR2, isR2Configured } from '@/lib/r2-storage';

/**
 * Cambia el base64 del archivo por su clave en R2 antes de guardar el mensaje.
 *
 * `raw` guarda el payload completo del webhook. Mientras el puente no podía
 * descargar nada, `media` venía `null` y no había problema; en cuanto se
 * descarga de verdad, cada nota de voz y cada foto se guardarían como base64
 * dentro de una columna JSONB, inflando la base y volviendo lento el panel.
 *
 * Así que los bytes van a Cloudflare R2 y aquí solo queda la clave del objeto,
 * más mimetype, nombre y tamaño. Con eso el panel pide una URL firmada y el
 * dueño puede oír el audio o ver la foto (ver components/chat/message-bubble).
 */
function replaceMediaBytesWithKey(raw: unknown, r2Key: string | null): unknown {
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
        // La clave del objeto en R2. Si la subida falló queda en null y el
        // panel lo dice, en vez de mostrar un reproductor que no suena.
        r2_key: r2Key,
        // Los bytes NO se guardan aquí, a propósito.
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

/**
 * Espera a que el agente termine con esa conversación, hasta `maxMs`.
 *
 * Antes, si llegaba un mensaje mientras el agente estaba respondiendo al
 * anterior, se DESCARTABA y el cliente se quedaba sin contestación. Observado
 * el 2026-07-30 en linea_2: la imagen de las 13:26:46 y el audio de las
 * 13:27:03 llegaron durante los 26 s que tardó el mensaje previo y ninguno de
 * los dos recibió respuesta propia.
 *
 * Esperar es mejor que descartar: cuando el agente arranca lee el historial de
 * la conversación, así que contesta con los dos mensajes ya a la vista. Si la
 * espera se agota se sigue descartando, para no acumular peticiones colgadas.
 */
async function esperarTurno(conversationId: string, maxMs = 45_000): Promise<boolean> {
  const hasta = Date.now() + maxMs;
  while (conversationsInFlight.has(conversationId)) {
    if (Date.now() > hasta) return false;
    await new Promise(r => setTimeout(r, 500));
  }
  return true;
}

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
      .select('id, full_name, wa_phone, created_at, metadata')
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

    /**
     * TELÉFONO REAL para mostrar, separado de `wa_phone`.
     *
     * `wa_phone` es la CLAVE con la que se enruta y con la que las herramientas
     * del agente buscan al cliente: cambiarla rompería esas búsquedas y volvería
     * a partir las fichas. Pero cuando el chat va por `@lid`, esa clave es un
     * número interno de WhatsApp y el panel lo enseñaba como si fuera el
     * teléfono del cliente (`181290854776961@lid`), que no le sirve a nadie.
     *
     * Así que el teléfono de verdad se guarda aparte, en `metadata.telefono`,
     * y el panel muestra ese. Una cosa para enrutar, otra para mostrar.
     */
    const telefonoReal = (message.senderPhone || '').replace(/\D/g, '');

    if (existingContact) {
      contactId = existingContact.id;
      contactName = existingContact.full_name || message.customerName || null;
      contactPhoneKey = existingContact.wa_phone || message.from;

      const cambios: Record<string, unknown> = {};
      // Update name if it was empty but we have it now
      if (!existingContact.full_name && message.customerName) {
        cambios.full_name = message.customerName;
      }
      if (telefonoReal && (existingContact.metadata as any)?.telefono !== telefonoReal) {
        cambios.metadata = { ...((existingContact.metadata as any) || {}), telefono: telefonoReal };
      }
      if (Object.keys(cambios).length > 0) {
        await (supabase as any).from('contacts').update(cambios).eq('id', contactId);
      }
    } else {
      const { data: newContact, error: contactErr } = await (supabase as any)
        .from('contacts')
        .insert({
          organization_id: orgId,
          wa_phone: message.from,
          full_name: message.customerName || null,
          metadata: telefonoReal ? { telefono: telefonoReal } : {},
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

    // 2a. Eco del puente.
    //
    // Los puentes reenvían TODO lo que pasa por la línea, incluido el mensaje
    // que la propia app acaba de enviar. La idempotencia por `wa_message_id`
    // solo lo detecta si el identificador coincide, y no siempre coincide: el
    // puente viejo devolvía `sent_<timestamp>` al enviar y luego reenviaba el
    // mensaje con otro identificador, así que cada respuesta del bot quedaba
    // DOS VECES en el panel. Medido el 2026-07-30: 15 de las últimas 40
    // respuestas duplicadas, siempre el par `sent_*` + `openwa_*`.
    //
    // Esta compuerta no depende del identificador: si ya hay una salida idéntica
    // en esta conversación hace muy poco, lo que llega es el eco. Va antes de
    // procesar la media para no gastar transcripción ni visión en un eco.
    if (message.fromMe) {
      const desde = new Date(Date.now() - 90_000).toISOString();
      const { data: yaRegistrado } = await (supabase as any)
        .from('messages')
        .select('id, wa_message_id')
        .eq('conversation_id', conversationId)
        .eq('direction', 'outbound')
        .eq('content', message.text || '')
        .gte('created_at', desde)
        .limit(1);

      if (yaRegistrado && yaRegistrado.length > 0) {
        logger.info('Eco del puente descartado: esta salida ya estaba registrada', {
          conversationId,
          wa_message_id: message.messageId,
          ya_guardado_como: yaRegistrado[0].wa_message_id,
        });
        return { success: true, conversationId };
      }
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
            
            // El mensaje que se esta procesando AHORA no puede venir en esta
            // sincronizacion. El puente lo guarda en su historial antes de
            // reenviarlo, asi que se colaba aqui, se insertaba primero, y al
            // llegar al paso 4 la idempotencia lo veia repetido y se saltaba
            // el agente: el PRIMER mensaje de cada conversacion nueva se
            // quedaba sin respuesta. Observado el 2026-07-30: el "Hola" de las
            // 13:24:40 en linea_2 nunca recibio contestacion.
            const messagesToInsert = result.messages
              .filter((m: any) => String(m.id) !== String(message.messageId))
              .map((m: any) => {
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

    // 3. Process media message if present (audio transcription / image description)
    /** Clave del archivo en R2, para que el dueño pueda verlo/oírlo en el panel. */
    let r2Key: string | null = null;
    /**
     * La subida arranca AHORA y se espera al final: así el archivo viaja a R2
     * mientras Whisper o Gemini lo procesan, y no se le suma latencia al
     * cliente, que ya espera entre 5 y 15 segundos por respuesta.
     */
    let subidaR2: Promise<string | null> | null = null;

    if (message.media && message.media.data && isR2Configured()) {
      subidaR2 = uploadBase64ToR2(message.media.data, message.media.mimetype || '').catch(err => {
        logger.error('Fallo la subida del archivo a R2', { error: String(err) });
        return null;
      });
    }

    /**
     * LO QUE EL CLIENTE DIJO DE VERDAD, sin anotaciones del sistema.
     *
     * `message.text` se va enriqueciendo más abajo con notas nuestras, como
     * `[Imagen adjunta de cliente: ...]`. Eso es correcto para el modelo (es
     * contexto), pero NO puede usarse para decidir qué quiso el cliente: la
     * nota contiene la palabra "imagen", así que al mandar una foto el sistema
     * leía su propia etiqueta como si le hubieran pedido fotos y respondía con
     * tres imágenes de producto no solicitadas (medido el 31-jul-2026).
     *
     * Aquí se conserva aparte: el texto que escribió, o lo que dijo en el
     * audio. La descripción de una imagen NUNCA entra, porque no la dijo él.
     */
    let palabrasDelCliente = message.text || '';

    if (message.media && message.media.data) {
      const mimetype = message.media.mimetype || '';

      if (mimetype.startsWith('audio/')) {
        try {
          const transcribedText = await transcribeAudio(message.media.data, mimetype);
          if (transcribedText) {
            message.text = transcribedText;
            // Lo dicho en una nota de voz SÍ son palabras del cliente: si pide
            // fotos hablando, cuenta igual que si las pidiera escribiendo.
            palabrasDelCliente = transcribedText;
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

    // 3b. Recoger la clave de R2 antes de guardar el mensaje.
    if (subidaR2) {
      r2Key = await subidaR2;
      if (r2Key) {
        logger.info('Archivo del cliente guardado en R2', {
          r2Key, conversationId, tipo: message.mediaType || message.media?.mimetype,
        });
      } else {
        logger.warn('El archivo no se pudo guardar en R2: el panel no podrá reproducirlo', {
          conversationId, tipo: message.mediaType || message.media?.mimetype,
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
          raw: replaceMediaBytesWithKey(message.raw, r2Key),
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
        logger.info('El agente está ocupado con esta conversación; se espera turno', { conversationId });
        const huboTurno = await esperarTurno(conversationId);
        if (!huboTurno) {
          logger.warn('Se agotó la espera del turno del agente, se omite el mensaje', {
            conversationId, wa_message_id: message.messageId,
          });
          return { success: true, conversationId };
        }
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

          // Si el puente no pudo enviarla, NO se guarda como enviada: el panel
          // mostraría una respuesta que el cliente nunca recibió. Se deja el
          // rastro en el registro de errores de la línea para que el Centro de
          // Control lo pueda mostrar con su causa.
          if (!waMessageId) {
            logger.error('La respuesta del agente NO se pudo enviar por WhatsApp', {
              conversationId, lineKey, to: message.from,
            });
            if (lineKey) {
              await logLineError({
                lineKey,
                orgId,
                // Se usa un tipo YA existente a propósito: el panel mapea las
                // etiquetas de line_error_log y uno nuevo saldría sin traducir.
                errorType: 'connection',
                severity: 'error',
                message: 'El puente rechazó el envío de la respuesta del agente. El cliente no la recibió.',
                context: { conversationId, wa_message_id: message.messageId },
              });
            }
            return { success: false, conversationId, response: agentResponse };
          }

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
            to: message.from, clientText: palabrasDelCliente, botText: agentResponse,
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
