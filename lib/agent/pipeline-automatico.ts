import { createAdminClient } from '../supabase/admin';
import { logger } from '../logger';

/**
 * La etapa del Pipeline sale de LOS HECHOS, no de que al modelo se le ocurra.
 *
 * EL FALLO QUE ESTO CIERRA
 * ------------------------
 * Mover una tarjeta del Kanban era trabajo del modelo: existía la herramienta
 * `updatePipelineStage` y él decidía cuándo llamarla. Es pedirle a un asesor
 * que además de atender se acuerde de arrastrar la ficha — a veces se acuerda,
 * casi nunca.
 *
 * Medido el 02-ago-2026 sobre 32 conversaciones reales del sistema:
 *
 *   | Columna           | Lo que el modelo movió | Lo que de verdad pasó |
 *   |-------------------|------------------------|-----------------------|
 *   | Entrada           | 30                     | 14                    |
 *   | Ventas            | 1                      | 18 recibieron precio  |
 *   | Listo para pagar  | 1                      | 1                     |
 *
 * **A 17 clientes el bot les entregó un precio y siguen en «Entrada».** No es
 * que no estuvieran negociando: es que nadie movió la tarjeta. El dueño abre
 * el Kanban y ve una columna de Ventas vacía mientras hay 18 cotizaciones
 * sobre la mesa, así que el Kanban no le sirve para trabajar y deja de mirarlo.
 *
 * POR QUÉ NO SE ARREGLA PIDIÉNDOSELO MEJOR AL MODELO
 * --------------------------------------------------
 * Porque es la misma clase de fallo, no un caso suelto: **cualquier dato del
 * CRM que dependa de que el modelo se acuerde de escribirlo va a estar mal la
 * mayoría de las veces.** Insistirle en el prompt sube la tasa un poco y
 * además induce alucinaciones (regla del proyecto: guardrails deterministas,
 * no instrucciones). Lo que obliga de verdad es leer lo que YA ocurrió.
 *
 * LAS DOS SEÑALES, Y POR QUÉ SON ESAS
 * -----------------------------------
 * - **Ventas**: el bot entregó una cotización con precio. Es el hecho más duro
 *   que existe en este sistema, porque el candado antialucinación ya garantiza
 *   que un precio en la respuesta salió de la calculadora. Si hay un precio
 *   sobre la mesa, hay negociación. No hace falta interpretar nada.
 * - **Listo para pagar**: el cliente escribió que compra o preguntó dónde
 *   pagar. Decisión del dueño (02-ago): esta columna la mueven **las dos
 *   vías** —esta señal y la herramienta del modelo—, la primera que se dé
 *   cuenta. Así no se pierde el criterio del modelo, pero tampoco se depende
 *   de él.
 *
 * SOLO SE AVANZA
 * --------------
 * Retroceder es decisión humana, y las etapas que APAGAN el bot —`angry`,
 * `unhandled`, `ignore`— no se tocan jamás desde el código: son de una
 * persona que decidió intervenir, y pisarlas volvería a encender un bot que
 * alguien apagó a propósito.
 *
 * La única marcha atrás automática que existe vive aparte, en
 * `webhook-processor`: quien vuelve a cotizar sale solo de «Listo para pagar»,
 * porque esa etapa describe un momento y no a una persona.
 */

/** Las tres etapas donde el bot sigue hablando, en orden comercial. */
export type EtapaComercial = 'inbox' | 'sales' | 'sold';

const ORDEN: Record<string, number> = { inbox: 0, sales: 1, sold: 2 };

/** Una cifra en pesos dicha en el texto. */
const PRECIO_EN_TEXTO = /\$\s?\d[\d.,]{2,}/;

/**
 * Las únicas herramientas de las que puede salir un precio de producto.
 * Misma lista que usa el candado antialucinación en `index.ts`: si el precio
 * no pasó por aquí, el candado ya habría bloqueado la respuesta.
 */
const HERRAMIENTAS_DE_PRECIO = new Set(['getProductPrice', 'calculateCustomPrice']);

/**
 * ¿El bot entregó de verdad una cotización en este turno?
 *
 * Se exigen las DOS cosas: que la calculadora corriera y que el precio aparezca
 * en lo que se le dijo al cliente. Con una sola no alcanza:
 *  - solo la calculadora → el bot cotizó por dentro y no lo dijo;
 *  - solo la cifra → puede ser un monto de una política del panel
 *    («envío gratis sobre $200.000»), que no es una cotización.
 */
export function huboCotizacion(respuesta: string | null | undefined, steps: any[]): boolean {
  if (!respuesta || !PRECIO_EN_TEXTO.test(respuesta)) return false;
  return (steps || []).some((step: any) =>
    (step?.toolResults || []).some((t: any) => HERRAMIENTAS_DE_PRECIO.has(t?.toolName))
  );
}

/**
 * Cómo dice un cliente que compra o que quiere pagar.
 *
 * Deliberadamente corta y literal. Una lista larga de sinónimos empieza a
 * marcar como cerrado a quien solo estaba preguntando, y un falso «listo para
 * pagar» hace sonar la campana y manda a un asesor a perseguir un pago que
 * nadie prometió. Es preferible que se escape un cierre —el asesor lo ve en
 * Ventas igual— a inventar uno.
 */
const CIERRE =
  /(lo tomo|la tomo|los tomo|las tomo|me lo llevo|me la llevo|lo compro|la compro|los compro|las compro|d[oó]nde pago|d[oó]nde consigno|d[oó]nde te consigno|c[oó]mo pago|c[oó]mo te pago|c[oó]mo hago el pago|quiero pagar|hag[aá]moslo|hagamos el pedido|quiero hacer el pedido|hacemos el pedido|proced[ae]mos|res[eé]rvamelo|sep[aá]ramelo|ap[aá]rtamelo|env[ií]ame los datos de pago|m[aá]ndame los datos de pago|p[aá]same los datos de pago|env[ií]ame la cuenta|m[aá]ndame la cuenta)/gi;

/**
 * Negaciones que dan vuelta la frase. Sin esto, «no lo tomo», «todavía no lo
 * compro» y «aún no sé cómo pago» moverían la tarjeta a «Listo para pagar».
 */
const NEGACION = /\b(no|nunca|tampoco|a[uú]n|todav[ií]a)\b/i;

/** ¿El cliente dijo que compra, o preguntó dónde pagar? */
export function clienteQuiereCerrar(mensaje: string | null | undefined): boolean {
  const texto = String(mensaje || '');
  if (!texto.trim()) return false;

  CIERRE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CIERRE.exec(texto)) !== null) {
    // Se mira lo escrito justo antes: la negación casi siempre va pegada
    // («no lo tomo», «todavía no sé cómo pago»).
    const antes = texto.slice(Math.max(0, m.index - 28), m.index);
    if (NEGACION.test(antes)) continue;
    return true;
  }
  return false;
}

/**
 * La etapa que le corresponde a este turno por lo que pasó, o `null` si nada
 * cambió. `sold` gana sobre `sales`: quien cierra ya negoció.
 */
export function etapaPorHechos(params: {
  mensajeDelCliente: string | null | undefined;
  respuestaDelBot: string | null | undefined;
  steps: any[];
}): EtapaComercial | null {
  if (clienteQuiereCerrar(params.mensajeDelCliente)) return 'sold';
  if (huboCotizacion(params.respuestaDelBot, params.steps)) return 'sales';
  return null;
}

/**
 * EL ÚNICO SITIO QUE ESCRIBE LA ETAPA DEL PIPELINE.
 *
 * Pasan por aquí tanto la regla automática como la herramienta del modelo, para
 * que las dos garantías —solo se avanza, y jamás se toca una etapa puesta por
 * una persona— se cumplan sí o sí, y no dependan de que quien escriba el
 * próximo llamador se acuerde de repetirlas.
 */
export async function moverEtapaSiAvanza(params: {
  orgId: string;
  contactId: string;
  conversationId: string;
  destino: EtapaComercial;
  motivo: string;
}): Promise<{ movido: boolean; etapaAnterior: string | null; razon: string }> {
  const { orgId, contactId, conversationId, destino, motivo } = params;

  if (!(destino in ORDEN)) {
    return { movido: false, etapaAnterior: null, razon: 'etapa-no-comercial' };
  }

  const supabase = createAdminClient();

  const { data: contacto, error: errLectura } = await (supabase as any)
    .from('contacts')
    .select('id, metadata')
    .eq('id', contactId)
    .single();

  if (errLectura || !contacto) {
    logger.error('Pipeline: no se encontró el contacto', {
      error: errLectura?.message, contactId, conversationId,
    });
    return { movido: false, etapaAnterior: null, razon: 'contacto-no-encontrado' };
  }

  const etapaAnterior = ((contacto.metadata || {}).stage || 'inbox') as string;

  // Una etapa que NO es comercial la puso una persona: apaga el bot y no se
  // toca desde el código, ni para avanzar.
  if (!(etapaAnterior in ORDEN)) {
    return { movido: false, etapaAnterior, razon: 'etapa-humana-intacta' };
  }

  if (ORDEN[destino] <= ORDEN[etapaAnterior]) {
    return { movido: false, etapaAnterior, razon: 'no-avanza' };
  }

  const { error: errEscritura } = await (supabase as any)
    .from('contacts')
    .update({ metadata: { ...(contacto.metadata || {}), stage: destino } })
    .eq('id', contactId);

  if (errEscritura) {
    logger.error('Pipeline: no se pudo actualizar la etapa', {
      error: errEscritura.message, contactId, conversationId,
    });
    return { movido: false, etapaAnterior, razon: 'error-al-escribir' };
  }

  // No se toca `bot_active`: las tres etapas comerciales mantienen la IA
  // activa, igual que en lib/conversations/actions.ts.
  logger.info('Pipeline: etapa movida', {
    orgId, conversationId, contactId, etapaAnterior, destino, motivo,
  });

  return { movido: true, etapaAnterior, razon: 'movido' };
}
