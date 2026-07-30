/**
 * ============================================================================
 * R2-STORAGE.TS — Almacenamiento de media en Cloudflare R2
 * ============================================================================
 * FASE 2b — Persistencia de audios/fotos de clientes (WhatsApp).
 *
 * El webhook sube aquí la imagen/audio que envía el cliente ANTES de procesarla
 * con Whisper/Gemini, y guarda la clave (key) en messages.raw.media.url. El
 * panel la recupera vía /api/media/signed-url con una URL firmada de 1h.
 *
 * R2 es S3-compatible: usamos @aws-sdk/client-s3 + s3-request-presigner
 * (ambos ya declarados en package.json). Si el SDK no está cargado en runtime,
 * las funciones fallan de forma controlada y el webhook sigue procesando
 * (mejor esfuerzo: la transcripción/descripción igual funciona en memoria).
 * ============================================================================
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '@/lib/logger';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || 'knowledgebot-fotos';

// R2 endpoint S3-compatible.
const R2_ENDPOINT =
  process.env.R2_ENDPOINT ||
  (R2_ACCOUNT_ID
    ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : '');

let _client: S3Client | null = null;

/**
 * Cliente R2 singleton. Solo se crea si hay credenciales.
 */
function getClient(): S3Client | null {
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
    return null;
  }
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

/**
 * ¿R2 está configurado (credenciales presentes)?
 */
export function isR2Configured(): boolean {
  return getClient() !== null;
}

/**
 * Sube un buffer (base64 decodificado) a R2 y devuelve la clave del objeto.
 *
 * @param buffer   Bytes del archivo.
 * @param mimetype Ej: 'image/jpeg', 'audio/ogg'.
 * @param ext      Extensión sin punto: 'jpg', 'ogg', 'mp3'.
 * @returns La clave (key) del objeto en R2, o null si falla.
 */
export async function uploadMediaToR2(
  buffer: Buffer,
  mimetype: string,
  ext: string,
): Promise<string | null> {
  const client = getClient();
  if (!client) {
    logger.warn('R2 no configurado, no se sube media');
    return null;
  }

  // Clave: media/<año>/<mes>/<uuid>.<ext> — ordenado y fácil de auditar.
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const key = `media/${yyyy}/${mm}/${rand}.${ext || 'bin'}`;

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }),
    );
    logger.info('Media subida a R2', { key, size: buffer.length, mimetype });
    return key;
  } catch (err) {
    logger.error('Error subiendo media a R2', { error: String(err), key });
    return null;
  }
}

/**
 * Genera una URL firmada (válido 1h) para leer un objeto de R2.
 * Nunca persistida: se calcula on-demand desde el panel.
 *
 * @param key La clave del objeto en R2.
 * @returns URL firmada o null si falla.
 */
export async function getSignedMediaUrl(key: string): Promise<string | null> {
  const client = getClient();
  if (!client || !key) return null;

  try {
    // Verificar que el objeto existe primero (evita URLs a objetos inexistentes).
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }),
      );
    } catch {
      // Si no existe, devolver null limpiamente.
      return null;
    }

    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      }),
      { expiresIn: 3600 }, // 1 hora
    );
    return url;
  } catch (err) {
    logger.error('Error firmando URL de R2', { error: String(err), key });
    return null;
  }
}

/**
 * Convierte base64 a Buffer y sube. Atajo para el webhook.
 */
export async function uploadBase64ToR2(
  base64Data: string,
  mimetype: string,
): Promise<string | null> {
  // Mapear mimetype -> extensión.
  const extMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'application/pdf': 'pdf',
  };

  /**
   * WhatsApp manda el tipo con parámetros: `audio/ogg; codecs=opus`. Comparar
   * la cadena completa contra la tabla no acertaba nunca y toda nota de voz se
   * guardaba como `.bin` (comprobado el 2026-07-30). Se recorta en el `;`.
   */
  const tipoBase = String(mimetype || '').split(';')[0].trim().toLowerCase();
  let ext = extMap[tipoBase];
  if (!ext) {
    // Último recurso: la parte de después de la barra, si parece una extensión.
    const sufijo = tipoBase.split('/')[1] || '';
    ext = /^[a-z0-9]{2,5}$/.test(sufijo) ? sufijo : 'bin';
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    return await uploadMediaToR2(buffer, mimetype, ext);
  } catch (err) {
    logger.error('Error convirtiendo base64 para R2', { error: String(err) });
    return null;
  }
}
