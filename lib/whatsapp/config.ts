/** WhatsApp Cloud API constants */
export const GRAPH_API_VERSION = 'v25.0';
export const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Normalized inbound message from any WhatsApp provider */
export interface NormalizedMessage {
  messageId: string;
  from: string; // E.164 phone
  text: string;
  timestamp: number;
  raw: Record<string, unknown>;
  media?: {
    data: string;
    mimetype: string;
    filename?: string;
  } | null;
  customerName?: string;
  fromMe?: boolean;
}

/** WhatsApp provider type */
export type WhatsAppProvider = 'meta' | 'openwa';
