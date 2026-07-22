import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * Registra un error operacional de una línea de WhatsApp en la tabla
 * `line_error_log` para que sea visible en el panel "Líneas de WhatsApp".
 *
 * Es "best-effort": si la BD no responde, solo loguea y NO lanza, para no
 * romper el flujo principal del webhook/transcripción.
 *
 * Uso típico:
 *   await logLineError({
 *     lineKey: 'linea_2',
 *     orgId,
 *     errorType: 'transcription',
 *     severity: 'error',
 *     message: 'All transcription models failed',
 *     context: { model: 'whisper-large-v3-turbo', mimetype: 'audio/ogg' },
 *   });
 */
export type LineErrorType =
  | 'transcription'
  | 'media_download'
  | 'webhook'
  | 'keep_alive'
  | 'db_insert'
  | 'describe_image'
  | 'connection'
  | 'other';

export interface LogLineErrorParams {
  lineKey: string;
  orgId?: string | null;
  errorType: LineErrorType;
  severity?: 'warn' | 'error';
  message: string;
  context?: Record<string, any>;
}

export async function logLineError(params: LogLineErrorParams): Promise<void> {
  const { lineKey, orgId, errorType, severity = 'error', message, context } = params;
  try {
    const supabase = createAdminClient();
    const { error } = await (supabase as any).from('line_error_log').insert({
      organization_id: orgId || null,
      line_key: lineKey,
      error_type: errorType,
      severity,
      message: String(message).slice(0, 2000), // limitar tamaño
      context: context || null,
    });
    if (error) {
      logger.warn('logLineError: no se pudo insertar en line_error_log', {
        error: error.message,
        lineKey,
        errorType,
      });
    }
  } catch (err: any) {
    // Nunca propagar: es un registro de observabilidad, no crítico.
    logger.warn('logLineError: excepción silenciosa', {
      error: err?.message || String(err),
      lineKey,
      errorType,
    });
  }
}
