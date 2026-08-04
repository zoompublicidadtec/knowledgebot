import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

/**
 * LÍNEAS APAGADAS A PROPÓSITO.
 *
 * POR QUÉ EXISTE. El Centro de Control daba por «problema» toda línea que no
 * estuviera conectada. Con la meta de 8 líneas, eso significa que cada ranura
 * que el dueño cree y todavía no quiera usar se convierte en una alarma
 * permanente: el panel en rojo por decisión propia. Lo reportó el 04-ago-2026:
 * «si uno cancela o desvincula una línea no debería aparecer como un problema».
 *
 * LA SEÑAL ES EL ACTO, NO UNA CASILLA NUEVA. Desvincular una línea desde el
 * panel ES la declaración de que no se quiere conectada. Pedirle el QR otra vez
 * es la declaración contraria. No hace falta que el dueño marque nada aparte:
 * el sistema no adivina, lee lo que él ya hizo.
 *
 * DÓNDE VIVE. En `agent_configs.metadata.lineas_apagadas`, el mismo sitio que
 * las hojas, las sedes y las cuentas de pago. La columna `status` de
 * `whatsapp_lines` es un enum cerrado (connected | awaiting_qr | disconnected)
 * y no admite un valor nuevo sin migrar la base: se comprobó y lo rechaza.
 */

const CLAVE = 'lineas_apagadas';

async function leerMetadata(orgId: string): Promise<Record<string, any>> {
  const admin = createAdminClient();
  const { data } = await (admin as any)
    .from('agent_configs')
    .select('metadata')
    .eq('organization_id', orgId)
    .single();
  return (data?.metadata as any) || {};
}

/** Las líneas que el dueño apagó a propósito. */
export async function lineasApagadas(orgId: string): Promise<string[]> {
  try {
    const meta = await leerMetadata(orgId);
    const lista = meta[CLAVE];
    return Array.isArray(lista) ? lista.map(String) : [];
  } catch (err) {
    logger.warn('lineasApagadas: no se pudo leer', { error: String(err) });
    return [];
  }
}

/**
 * Marca o desmarca una línea como apagada a propósito.
 *
 * Conserva el resto de `metadata`: escribir solo esta clave borraría la persona
 * del agente y las hojas de categoría, y eso ya pasó antes en este proyecto.
 */
export async function marcarLineaApagada(
  orgId: string,
  lineKey: string,
  apagada: boolean
): Promise<void> {
  try {
    if (!orgId || !lineKey) return;
    const meta = await leerMetadata(orgId);
    const actuales: string[] = Array.isArray(meta[CLAVE]) ? meta[CLAVE].map(String) : [];

    const nuevas = apagada
      ? [...new Set([...actuales, lineKey])]
      : actuales.filter(k => k !== lineKey);

    if (nuevas.length === actuales.length && apagada === actuales.includes(lineKey)) return;

    const admin = createAdminClient();
    await (admin as any)
      .from('agent_configs')
      .update({ metadata: { ...meta, [CLAVE]: nuevas }, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId);

    logger.info('Linea marcada', { lineKey, apagada, total: nuevas.length });
  } catch (err) {
    // Que no se pueda anotar la intención NUNCA debe impedir desvincular una
    // línea: lo importante es que la sesión se cierre.
    logger.warn('marcarLineaApagada: no se pudo guardar', { error: String(err) });
  }
}
