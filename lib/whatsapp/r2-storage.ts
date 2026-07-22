import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '@/lib/logger';

// Configuracion R2 (Cloudflare) - leida de variables de entorno
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;
const R2_BUCKET = process.env.R2_BUCKET || 'knowledgebot-fotos';

// Cliente S3 reutilizable (compatible con R2)
let s3Client: S3Client | null = null;
function getClient(): S3Client {
  if (s3Client) return s3Client;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT) {
    throw new Error('R2 no configurado: faltan R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ENDPOINT en .env.local');
  }
  s3Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

/**
 * Sube una imagen (en base64) a Cloudflare R2.
 * @param base64Data  datos de la imagen en base64 (sin el prefijo data:)
 * @param mimetype    ej: 'image/jpeg', 'image/png'
 * @param key         ruta/clave dentro del bucket, ej: 'clientes/abc123/1689...jpg'
 * @returns la key bajo la que se guardo
 */
export async function uploadImageToR2(
  base64Data: string,
  mimetype: string,
  key: string
): Promise<string> {
  const client = getClient();
  const buffer = Buffer.from(base64Data, 'base64');

  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    })
  );

  logger.info('Imagen subida a R2', { key, bytes: buffer.length });
  return key;
}

/**
 * Genera una URL firmada (presigned) temporal para ver una imagen privada.
 * El panel usa esta URL para mostrar la foto. Caduca a la 1 hora;
 * cuando caduca, el panel pide una nueva (la foto NO se borra).
 *
 * @param key   ruta/clave del objeto en el bucket
 * @param expiresIn  duracion en segundos (default 3600 = 1 hora)
 */
export async function getSignedImageUrl(key: string, expiresIn = 3600): Promise<string> {
  const client = getClient();
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }),
    { expiresIn }
  );
  return url;
}

/**
 * Construye una key descriptiva y unica para una imagen de cliente.
 * Estructura: clientes/{conversationId}/{timestamp}.{ext}
 */
export function buildImageKey(conversationId: string, mimetype: string): string {
  const ext = mimetype.split('/')[1] || 'jpg';
  const ts = Date.now();
  const safeId = conversationId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36);
  return `clientes/${safeId}/${ts}.${ext}`;
}
