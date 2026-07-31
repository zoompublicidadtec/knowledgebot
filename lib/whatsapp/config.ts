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
  /**
   * Teléfono real del cliente, en dígitos, cuando el puente pudo resolverlo.
   *
   * `from` puede ser un `@lid`: un identificador interno de WhatsApp de 14-15
   * dígitos que NO es un teléfono y del que no se puede deducir el número. Se
   * mantiene como clave de enrutado, pero para MOSTRAR el contacto sirve esto.
   */
  senderPhone?: string;
  fromMe?: boolean;
  mediaError?: boolean;
  mediaType?: string;
}

/** WhatsApp provider type */
export type WhatsAppProvider = 'meta' | 'openwa';
