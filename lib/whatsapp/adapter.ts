import { GRAPH_API_BASE, type NormalizedMessage, type WhatsAppProvider } from './config';
import { decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import type { WhatsAppConfig } from '@/lib/database.types';
import { getSendBridgeUrl, bridgeHeaders } from './bridge';

/** Abstract adapter interface for WhatsApp messaging */
export interface WhatsAppAdapter {
  /**
   * `citado` es opcional: sin el, el envio es exactamente el de siempre.
   * Ver `MensajeCitado` en lib/whatsapp/message-preview.ts.
   */
  sendTextMessage(
    to: string,
    text: string,
    citado?: { id: string; fromMe: boolean; texto: string },
  ): Promise<string | null>;
  /**
   * `ptt` = push to talk: marca el audio como NOTA DE VOZ, no como archivo
   * adjunto. Es opcional para no tocar a ninguno de los que ya la llaman.
   */
  sendMediaMessage(to: string, mediaUrl: string, caption?: string, ptt?: boolean): Promise<string | null>;
  parseInboundMessage(body: Record<string, unknown>): NormalizedMessage | null;
}

/** Meta Cloud API adapter */
export function createMetaAdapter(config: WhatsAppConfig): WhatsAppAdapter {
  const accessToken = decrypt(config.access_token_encrypted);

  return {
    async sendTextMessage(to: string, text: string): Promise<string | null> {
      try {
        const res = await fetch(
          `${GRAPH_API_BASE}/${config.phone_number_id}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to,
              type: 'text',
              text: { body: text },
            }),
          }
        );
        const data = await res.json() as { messages?: { id: string }[] };
        return data.messages?.[0]?.id ?? null;
      } catch (err) {
        logger.error('Meta send failed', { error: String(err), to });
        return null;
      }
    },

    async sendMediaMessage(to: string, mediaUrl: string, caption?: string, _ptt?: boolean): Promise<string | null> {
      logger.warn('Meta sendMediaMessage not fully implemented - falling back to text representation', { mediaUrl });
      return this.sendTextMessage(to, `${caption ? caption + ' ' : ''}${mediaUrl}`);
    },

    parseInboundMessage(body: Record<string, unknown>): NormalizedMessage | null {
      try {
        const entry = (body.entry as Array<Record<string, unknown>>)?.[0];
        const changes = (entry?.changes as Array<Record<string, unknown>>)?.[0];
        const value = changes?.value as Record<string, unknown>;
        const messages = (value?.messages as Array<Record<string, unknown>>);
        if (!messages?.length) return null;

        const msg = messages[0];
        const text = (msg.text as { body?: string })?.body;
        if (!text) return null;

        return {
          messageId: msg.id as string,
          from: msg.from as string,
          text,
          timestamp: Number(msg.timestamp) * 1000,
          raw: body,
        };
      } catch {
        return null;
      }
    },
  };
}

/** OpenWA adapter for testing */
export function createOpenWAAdapter(config: WhatsAppConfig, lineKey?: string | null): WhatsAppAdapter {
  /**
   * El puente que ENVÍA no es necesariamente el que recibe.
   *
   * Baileys descarga los audios y las fotos pero no logra entregar: WhatsApp
   * rechaza sus mensajes en el acuse con `error: 463`. El puente
   * `whatsapp-web.js` entrega sin problema porque usa el WhatsApp Web real de
   * Chrome. Así que cada línea recibe por uno y envía por el otro.
   * Ver `getSendBridgeUrl` en lib/whatsapp/bridge.ts.
   */
  const baseUrl = getSendBridgeUrl(lineKey);
  const sessionId = lineKey || config.openwa_session_id || 'default';

  return {
    async sendTextMessage(
      to: string,
      text: string,
      citado?: { id: string; fromMe: boolean; texto: string },
    ): Promise<string | null> {
      try {
        // Pass the exact ID as stored (which includes @c.us or @lid)
        const chatId = to.replace('+', '');
        const res = await fetch(
          `${baseUrl}/api/sessions/${sessionId}/messages/send-text`,
          {
            method: 'POST',
            headers: bridgeHeaders(),
            // `quoted` solo viaja cuando se esta respondiendo a algo: sin el,
            // el puente hace exactamente lo mismo que hacia hasta hoy.
            body: JSON.stringify({ chatId, text, ...(citado ? { quoted: citado } : {}) }),
          }
        );

        // Sin esta comprobación, un rechazo del puente (por ejemplo, la línea
        // reconectándose devuelve 400) caía igual en el `??` de abajo, se
        // inventaba un identificador y la app guardaba la respuesta COMO
        // ENVIADA. El cliente no recibía nada y el panel decía que sí.
        if (!res.ok) {
          const detalle = await res.text().catch(() => '');
          logger.error('El puente rechazó el envío de texto', {
            status: res.status, to, sessionId, detalle: detalle.slice(0, 300),
          });
          return null;
        }

        const data = await res.json() as { data?: { id?: string } };
        return data.data?.id ?? `openwa_${Date.now()}`;
      } catch (err) {
        logger.error('OpenWA send failed', { error: String(err), to });
        return null;
      }
    },

    async sendMediaMessage(to: string, mediaUrl: string, caption?: string, ptt?: boolean): Promise<string | null> {
      try {
        const chatId = to.replace('+', '');
        const res = await fetch(
          `${baseUrl}/api/sessions/${sessionId}/messages/send-media`,
          {
            method: 'POST',
            headers: bridgeHeaders(),
            // `ptt` solo viaja cuando es una nota de voz: el puente sin esa
            // marca se comporta exactamente igual que hasta ahora.
            body: JSON.stringify({ chatId, mediaUrl, caption, ...(ptt ? { ptt: true } : {}) }),
          }
        );

        if (!res.ok) {
          const detalle = await res.text().catch(() => '');
          logger.error('El puente rechazó el envío de la foto', {
            status: res.status, to, sessionId, mediaUrl, detalle: detalle.slice(0, 300),
          });
          return null;
        }

        const data = await res.json() as { data?: { id?: string } };
        return data.data?.id ?? `openwa_media_${Date.now()}`;
      } catch (err) {
        logger.error('OpenWA send media failed', { error: String(err), to });
        return null;
      }
    },

    parseInboundMessage(body: Record<string, unknown>): NormalizedMessage | null {
      try {
        const event = body.event as string;
        if (event !== 'message.received') return null;

        const data = body.data as Record<string, unknown>;
        const message = data?.message as Record<string, unknown>;
        if (!message) return null;

        const fromRaw = message.from as string;
        const toRaw = message.to as string;
        const fromMe = !!message.fromMe;
        const text = (message.body as string || message.text as string || '').trim();
        const media = message.media as any;
        const mediaError = !!message.mediaError;
        const mediaType = (message.mediaType as string) || (message.type as string) || '';
        
        const contactPhone = fromMe ? toRaw : fromRaw;
        if (!contactPhone) return null;
        if (!text && !media && !mediaError) return null;

        return {
          messageId: (message.id as string) || `openwa_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          from: contactPhone,
          text,
          timestamp: Date.now(),
          raw: body,
          media: media || null,
          /**
           * EL «Tú» ES DE LA PANTALLA, NO DEL CONTACTO.
           *
           * Aqui decia `fromMe ? 'Tú' : ...`, asi que TODO mensaje saliente
           * —los que escriben Oscar, Adriana o el bot desde la linea— traia el
           * literal 'Tú' como nombre del cliente, y el webhook lo guardaba en su
           * ficha. Medido el 12-ago-2026: **38 de 73 contactos** se llamaban
           * «Tú» en la bandeja y el dueno no sabia de quien era cada chat.
           *
           * El «Tú» del globo del chat sale de otro sitio y no se toca:
           * `app/(app)/conversaciones/[id]/client-page.tsx:291`
           * (`botActive ? 'IA' : 'Tú'`). Comprobado que nadie mas lee
           * `customerName` para pintar: solo lo usa el webhook para la ficha.
           *
           * En un mensaje SALIENTE no hay nombre de cliente que aprender: el
           * `pushName` que llega es el de NUESTRA linea. Vacio es la respuesta
           * honesta, y el webhook ya sabe no pisar un nombre bueno con vacio.
           */
          customerName: fromMe ? '' : (message.customerName as string || ''),
          // Solo tiene sentido para mensajes entrantes: en los salientes el
          // "remitente" somos nosotros.
          senderPhone: fromMe ? '' : ((message.senderPhone as string) || ''),
          fromMe,
          mediaError,
          mediaType,
        };
      } catch {
        return null;
      }
    },
  };
}

/** Factory: create the right adapter based on provider config */
export function createAdapter(config: WhatsAppConfig, lineKey?: string | null): WhatsAppAdapter {
  const provider: WhatsAppProvider = config.provider || 'openwa';
  switch (provider) {
    case 'meta':
      return createMetaAdapter(config);
    case 'openwa':
      return createOpenWAAdapter(config, lineKey);
    default:
      return createOpenWAAdapter(config, lineKey);
  }
}
