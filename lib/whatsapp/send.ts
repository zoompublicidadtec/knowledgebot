import { createAdminClient } from '@/lib/supabase/admin';
import { createAdapter } from './adapter';
import { logger } from '@/lib/logger';
import { uploadBase64ToR2, getSignedMediaUrl, isR2Configured } from '@/lib/r2-storage';
import type { MensajeCitado } from './message-preview';

/** El mismo tope que aplica el puente, para avisar antes de subir en vano. */
const MAX_MEDIA_MB = parseInt(process.env.MAX_MEDIA_MB || '20', 10);

/**
 * MANDA UNA IMAGEN O UN ARCHIVO AL CLIENTE DESDE EL PANEL.
 *
 * EL FALLO QUE ESTO CIERRA
 * ------------------------
 * Desde el panel solo se podía escribir texto. Un asesor que quería mandar la
 * foto de un producto, un arte para aprobar o una cotización en PDF tenía que
 * salirse del sistema y hacerlo desde el celular — y ese mensaje ya no queda
 * en la conversación del CRM.
 *
 * LA TUBERÍA YA EXISTÍA ENTERA
 * ----------------------------
 * El puente tiene `/messages/send-media` desde hace tiempo, con el mismo freno
 * por rechazos y la misma verificación del acuse que el texto, y el adaptador
 * ya sabía llamarlo: es la vía por la que el bot le manda al cliente las fotos
 * de los productos. Lo único que faltaba era esta función y un botón.
 *
 * ORDEN DE LOS PASOS, Y POR QUÉ
 * -----------------------------
 * El archivo se guarda ANTES de pedir el envío, porque el puente no recibe
 * bytes: recibe una dirección y la descarga él. Sin el archivo ya guardado no
 * hay nada que descargar.
 *
 * SI NO SALIÓ, NO SE GUARDA — igual que el texto. Ver `sendWhatsAppMessage`.
 */
export async function sendWhatsAppMedia(
  orgId: string,
  conversationId: string,
  to: string,
  base64Data: string,
  mimetype: string,
  caption?: string,
  /** true = nota de voz (ogg/opus ya convertido). Ver lib/whatsapp/nota-de-voz.ts */
  esNotaDeVoz = false,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminClient();

  try {
    if (!isR2Configured()) {
      return { ok: false, error: 'El almacenamiento de archivos no está configurado en el servidor.' };
    }

    // 3/4 es la proporción exacta de base64 a bytes.
    const bytes = Math.floor((base64Data.length * 3) / 4);
    if (bytes > MAX_MEDIA_MB * 1024 * 1024) {
      return {
        ok: false,
        error: `El archivo pesa ${Math.round(bytes / 1024 / 1024)} MB y el máximo son ${MAX_MEDIA_MB} MB.`,
      };
    }

    const { data: waConfig } = await supabase
      .from('whatsapp_configs')
      .select('*')
      .eq('organization_id', orgId)
      .single();

    if (!waConfig) {
      logger.error('No WhatsApp config found', { orgId });
      return { ok: false, error: 'No hay una configuración de WhatsApp para este negocio.' };
    }

    const { data: conv } = await (supabase as any)
      .from('conversations')
      .select('line_key')
      .eq('id', conversationId)
      .single();

    const lineKey = (conv as any)?.line_key || null;

    const key = await uploadBase64ToR2(base64Data, mimetype);
    if (!key) {
      return { ok: false, error: 'No se pudo guardar el archivo antes de enviarlo.' };
    }

    const url = await getSignedMediaUrl(key);
    if (!url) {
      return { ok: false, error: 'No se pudo preparar el archivo para el envío.' };
    }

    const adapter = createAdapter(waConfig, lineKey);
    const waMessageId = await adapter.sendMediaMessage(to, url, caption || undefined, esNotaDeVoz);

    if (!waMessageId) {
      logger.error('El archivo enviado desde el panel NO salió', {
        orgId, conversationId, lineKey, to, mimetype, bytes,
      });
      if (lineKey) {
        try {
          const { logLineError } = await import('./log-line-error');
          await logLineError({
            lineKey,
            orgId,
            errorType: 'connection',
            severity: 'error',
            message: 'El puente rechazó un archivo enviado por un asesor desde el panel. El cliente no lo recibió.',
            context: { conversationId, to, mimetype },
          });
        } catch (e) {
          logger.warn('No se pudo registrar el error de línea', { error: String(e) });
        }
      }
      return { ok: false, error: 'WhatsApp no aceptó el archivo. El cliente NO lo recibió.' };
    }

    /**
     * Se guarda con la MISMA forma que trae un adjunto entrante, para que la
     * burbuja lo pinte sin ninguna rama especial: `leerMedia` encuentra el tipo
     * y la clave de R2 donde ya sabe buscarlos.
     */
    const tipo = mimetype.startsWith('image/')
      ? 'image'
      : mimetype.startsWith('video/')
        ? 'video'
        : mimetype.startsWith('audio/')
          ? 'audio'
          : 'document';

    await (supabase as any).from('messages').insert({
      conversation_id: conversationId,
      organization_id: orgId,
      wa_message_id: waMessageId,
      direction: 'outbound',
      sender: 'human',
      content: caption || '',
      raw: {
        data: {
          message: { mediaType: tipo, media: { mimetype, r2_key: key, size_bytes: bytes } },
        },
      },
    });

    await (supabase as any)
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    return { ok: true };
  } catch (err) {
    logger.error('Send media failed', { error: String(err), orgId, conversationId });
    return { ok: false, error: 'No se pudo enviar el archivo.' };
  }
}

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

/**
 * LA MISMA VÍA, PERO CITANDO A UN MENSAJE.
 *
 * Va AL LADO de `sendWhatsAppMessage`, sin tocarla. Esa función carga la regla
 * de «si no salió, no se guarda», que costó descubrir con mensajes fantasma
 * medidos el 01-ago-2026; no se toca para agregar algo nuevo al costado.
 *
 * Lo único que cambia respecto de aquella:
 *   1. le pasa la cita al puente, que es quien la arma para WhatsApp; y
 *   2. guarda la cita en `raw` con la MISMA forma que trae un mensaje entrante
 *      citado, para que la burbuja la pinte sin ninguna rama nueva.
 *
 * El panel ya sabía VER citas desde hace tiempo. Lo que no había era forma de
 * CREAR una.
 */
export async function sendWhatsAppReply(
  orgId: string,
  conversationId: string,
  to: string,
  text: string,
  citado: MensajeCitado,
): Promise<boolean> {
  const supabase = createAdminClient();

  try {
    const { data: waConfig } = await supabase
      .from('whatsapp_configs')
      .select('*')
      .eq('organization_id', orgId)
      .single();

    if (!waConfig) {
      logger.error('No WhatsApp config found', { orgId });
      return false;
    }

    const { data: conv } = await (supabase as any)
      .from('conversations')
      .select('line_key')
      .eq('id', conversationId)
      .single();

    const lineKey = (conv as any)?.line_key || null;

    const adapter = createAdapter(waConfig, lineKey);
    const waMessageId = await adapter.sendTextMessage(to, text, citado);

    // La misma regla que arriba: sin acuse de WhatsApp no hay mensaje en el
    // chat. Un mensaje fantasma deja al asesor esperando una respuesta que
    // nunca va a llegar.
    if (!waMessageId) {
      logger.error('La respuesta citada escrita desde el panel NO se pudo enviar', {
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
            message: 'El puente rechazó una respuesta citada escrita por un asesor desde el panel. El cliente no la recibió.',
            context: { conversationId, to },
          });
        } catch (e) {
          logger.warn('No se pudo registrar el error de línea', { error: String(e) });
        }
      }
      return false;
    }

    await (supabase as any).from('messages').insert({
      conversation_id: conversationId,
      organization_id: orgId,
      wa_message_id: waMessageId,
      direction: 'outbound',
      sender: 'human',
      content: text,
      raw: { data: { message: { quoted: { body: citado.texto } } } },
    });

    await (supabase as any)
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    return true;
  } catch (err) {
    logger.error('Send reply failed', { error: String(err), orgId, conversationId });
    return false;
  }
}
