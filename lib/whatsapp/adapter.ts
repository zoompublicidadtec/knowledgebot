import { GRAPH_API_BASE, type NormalizedMessage, type WhatsAppProvider } from './config';
import { decrypt } from '@/lib/crypto';
import { logger } from '@/lib/logger';
import type { WhatsAppConfig } from '@/lib/database.types';
import { getBridgeUrl, bridgeHeaders } from './bridge';

/** Abstract adapter interface for WhatsApp messaging */
export interface WhatsAppAdapter {
  sendTextMessage(to: string, text: string): Promise<string | null>;
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
  const baseUrl = getBridgeUrl();
  const sessionId = lineKey || config.openwa_session_id || 'default';

  return {
    async sendTextMessage(to: string, text: string): Promise<string | null> {
      try {
        // Pass the exact ID as stored (which includes @c.us or @lid)
        const chatId = to.replace('+', '');
        const res = await fetch(
          `${baseUrl}/api/sessions/${sessionId}/messages/send-text`,
          {
            method: 'POST',
            headers: bridgeHeaders(),
            body: JSON.stringify({ chatId, text }),
          }
        );
        const data = await res.json() as { data?: { id?: string } };
        return data.data?.id ?? `openwa_${Date.now()}`;
      } catch (err) {
        logger.error('OpenWA send failed', { error: String(err), to });
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
        
        const contactPhone = fromMe ? toRaw : fromRaw;
        if (!contactPhone) return null;
        if (!text && !media) return null;

        return {
          messageId: (message.id as string) || `openwa_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          from: contactPhone,
          text,
          timestamp: Date.now(),
          raw: body,
          media: media || null,
          customerName: fromMe ? 'Tú' : (message.customerName as string || ''),
          fromMe,
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
