import { createAdminClient } from '../supabase/admin';
import { logger } from '../logger';
import { hojaParaLoQueDijoElCliente, type HojaDeCategoria } from './hojas';

/**
 * LA VENTA CRUZADA — una sola oferta, después de cerrar, con el precio hecho.
 *
 * QUÉ PIDIÓ EL DUEÑO, TEXTUAL
 * ---------------------------
 * «Se ofrece DESPUÉS de cerrar y asegurar la venta, nunca antes. El producto
 * adicional tiene que tener relación con lo comprado. Y NO PUEDE HACER DUDAR
 * AL CLIENTE NI TUMBAR LA VENTA.»
 *
 * Ese último es el requisito duro y es el que manda el diseño entero. Si el
 * bot ofrece «insertos» a secas, el cliente pregunta «¿qué es un inserto?,
 * ¿para qué sirve?, ¿cuánto vale?» y la venta que ya estaba cerrada se abre de
 * nuevo. Una venta cruzada que reabre la negociación no suma: resta.
 *
 * EL FALLO QUE ESTO CIERRA, MEDIDO
 * --------------------------------
 * Batería del 10-ago-2026, caso `cuadernos_base`. El bot cerró así:
 *
 *   «*30 Cuaderno Argollado - Base 80 hojas — $390.000 COP*
 *    Este precio es por el cuaderno base, sin adicionales.
 *    ¿Te gustaría agregarle insertos, filtro UV o guardas?»
 *
 * Las cuatro cosas que el dueño prohibió, en una sola frase: es una LISTA, usa
 * palabras que el cliente no entiende, no trae PRECIO, y llega ANTES de que la
 * venta esté cerrada. Salía del campo «¿Qué extras se le pueden agregar?» de la
 * hoja, que se le entrega al modelo como dato y el modelo suelta cuando quiere.
 *
 * POR QUÉ NO SE ARREGLA PIDIÉNDOSELO AL MODELO
 * --------------------------------------------
 * Regla 1 del proyecto, demostrada ya seis veces: una instrucción escrita en el
 * prompt no obliga. Si aquí se le pidiera «ofrece UNA sola cosa, con precio,
 * después de cerrar», acertaría a veces — y una venta cruzada que reabre la
 * negociación una de cada cinco veces es peor que no tenerla.
 *
 * Así que **la oferta no la escribe el modelo**: la escribe el dueño en la
 * hoja, el código le calcula el precio con la misma calculadora de siempre y la
 * pega al final de la respuesta ya aprobada. El modelo no participa, y por eso
 * no puede convertirla en lista, ni en pregunta abierta, ni inventarle un valor.
 *
 * LAS CINCO GARANTÍAS, TODAS EN CÓDIGO
 * ------------------------------------
 * 1. Solo después del cierre. La misma señal que mueve la tarjeta a «Listo
 *    para pagar» (`clienteQuiereCerrar`), que ya está medida y es conservadora.
 * 2. Una sola oferta. No es una lista: es un producto y una frase.
 * 3. Con el precio ya calculado, leído del catálogo para la cantidad que el
 *    cliente compró. Si no se puede calcular, NO SE OFRECE NADA.
 * 4. Una sola vez por conversación. Si el cliente dice que no, no se insiste.
 * 5. En las palabras del dueño, no en las del sistema. Si él no escribió la
 *    frase, no hay oferta — la misma regla de DEFAULT_PERSONA: sin dato, no se
 *    rellena con un ejemplo.
 */

/** Los dos campos que el dueño llena en la hoja para que esto exista. */
export type OfertaDeHoja = Pick<HojaDeCategoria, 'ofrecer_al_cerrar' | 'frase_al_cerrar'>;

/** Un precio en pesos, como lo escribe el resto del sistema. */
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

const esUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s));

/** Un código no es lenguaje: «MU-303-1.» y «mu3031» son el mismo código. */
function soloCodigo(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resuelve lo que el dueño escribió en la hoja a un producto real del catálogo.
 *
 * El panel guarda la REFERENCIA (el dueño elige el producto de una lista), así
 * que el camino normal es el primero. Los demás existen porque una hoja vieja
 * puede tener escrito el nombre a mano, y porque 34 referencias del Excel
 * traían un punto pegado al final.
 *
 * Si quedan dos candidatos NO se elige a dedo: se devuelve nada y no hay
 * oferta. Ofrecer el producto equivocado en el cierre es justo lo que el dueño
 * prohibió.
 */
async function resolverProductoOfrecido(
  supabase: any,
  texto: string
): Promise<{ id: string; reference: string; name: string } | null> {
  const clave = String(texto || '').trim();
  if (!clave) return null;
  const columnas = 'id, reference, name';

  if (esUUID(clave)) {
    const { data } = await supabase.from('products').select(columnas).eq('id', clave).limit(1);
    if (data?.[0]) return data[0];
  }

  const { data: porRef } = await supabase
    .from('products').select(columnas).eq('reference', clave).eq('active', true).limit(1);
  if (porRef?.[0]) return porRef[0];

  // La referencia con basura pegada («MU-303-1.»): se compara sin puntos ni guiones.
  const { data: parecidasRef } = await supabase
    .from('products').select(columnas).ilike('reference', `${clave}*`).eq('active', true).limit(5);
  const exacta = (parecidasRef || []).filter((p: any) => soloCodigo(p.reference) === soloCodigo(clave));
  if (exacta.length === 1) return exacta[0];

  const { data: porNombre } = await supabase
    .from('products').select(columnas).ilike('name', clave).eq('active', true).limit(1);
  if (porNombre?.[0]) return porNombre[0];

  const { data: parecidos } = await supabase
    .from('products').select(columnas).ilike('name', `%${clave}%`).eq('active', true).limit(2);
  if (parecidos?.length === 1) return parecidos[0];

  return null;
}

/**
 * El precio unitario del producto ofrecido para ESA cantidad.
 *
 * Misma regla que `buildQuote`: si a esa cantidad le corresponden varias
 * variantes con precios distintos, es ambiguo y **no se elige una**. Y solo
 * sirve el precio por unidad: un precio por cm² o por lote no se puede
 * multiplicar por la cantidad de unidades sin mentir.
 */
async function precioUnitarioDe(
  supabase: any,
  productId: string,
  cantidad: number
): Promise<number | null> {
  const { data, error } = await supabase
    .from('price_tiers')
    .select('variant, min_qty, max_qty, price, price_basis')
    .eq('product_id', productId);

  if (error) {
    logger.warn('Venta cruzada: no se pudieron leer las tarifas', { error: error.message, productId });
    return null;
  }

  const utiles = (data || []).filter((t: any) => {
    const p = Number(t.price);
    if (!Number.isFinite(p) || p <= 0 || p > 1e9) return false;
    const base = String(t.price_basis || 'unitario').toLowerCase();
    if (base !== 'unitario') return false;
    return cantidad >= (t.min_qty || 0) && (t.max_qty == null || cantidad <= t.max_qty);
  });

  if (utiles.length === 0) return null;

  const precios: number[] = utiles.map((t: any) => Number(t.price));
  const distintos = precios.filter((p, i) => precios.indexOf(p) === i);
  if (distintos.length > 1) return null; // ambiguo: no se elige a dedo

  return distintos[0];
}

/** Un precio escrito en el texto, para no confundirlo con una cantidad. */
const PRECIO_EN_TEXTO = /\$\s?\d[\d.,]*/g;

/**
 * CUÁNTAS UNIDADES COMPRÓ.
 *
 * Primero por los hechos: lo que recibió la calculadora en este turno. Si el
 * turno de cierre no la usó, se lee del texto — el bot escribe la cantidad
 * pegada al producto («*30 Cuaderno Argollado…*», «tu pedido de 20 Mugs»).
 *
 * Las cifras de dinero se borran antes de mirar, o «$390.000» se leería como
 * una cantidad de 390.
 */
export function cantidadDelPedido(
  pasos: any[],
  textos: Array<string | null | undefined>
): number | null {
  const HERRAMIENTAS = new Set(['getProductPrice', 'calculateCustomPrice', 'buildQuote']);
  for (const paso of [...(pasos || [])].reverse()) {
    for (const call of ((paso?.toolCalls || []) as any[])) {
      if (!HERRAMIENTAS.has(call?.toolName)) continue;
      const args = call.input ?? call.args ?? {};
      const n = Number(args?.quantity ?? args?.cantidad);
      if (Number.isFinite(n) && n > 0 && n <= 1_000_000) return Math.round(n);
    }
  }

  for (const texto of textos) {
    const limpio = String(texto || '').replace(PRECIO_EN_TEXTO, ' ');
    const m = limpio.match(/(?<![\d.,])(\d{1,6})(?![\d.,])/);
    const n = m ? Number(m[1]) : NaN;
    if (Number.isFinite(n) && n > 0 && n <= 1_000_000) return n;
  }

  return null;
}

/** ¿A este contacto ya se le ofreció algo en esta conversación? */
async function yaSeOfrecio(supabase: any, contactId: string, conversationId: string): Promise<boolean> {
  const { data } = await supabase.from('contacts').select('metadata').eq('id', contactId).single();
  const marcas = (data?.metadata || {}).venta_cruzada || {};
  return !!marcas[conversationId];
}

/**
 * Deja la marca de «ya se ofreció». Se relee el contacto justo antes de
 * escribir porque en el mismo turno `moverEtapaSiAvanza` acaba de tocar este
 * mismo campo: leer una copia vieja borraría la etapa recién puesta.
 */
async function marcarOfrecida(supabase: any, contactId: string, conversationId: string): Promise<void> {
  const { data } = await supabase.from('contacts').select('metadata').eq('id', contactId).single();
  const metadata = data?.metadata || {};
  const marcas = { ...(metadata.venta_cruzada || {}), [conversationId]: true };
  await supabase.from('contacts').update({ metadata: { ...metadata, venta_cruzada: marcas } }).eq('id', contactId);
}

/**
 * LA FRASE QUE ESCRIBIÓ EL DUEÑO, CON EL PRECIO PUESTO.
 *
 * Los huecos son los del panel: {precio} por unidad, {total} por el pedido
 * entero, {cantidad} y {producto}. Se exige que la frase traiga {precio} o
 * {total}: sin un precio a la vista el cliente tiene que preguntar cuánto vale,
 * y preguntar es exactamente lo que el dueño quiere evitar.
 */
function armarFrase(params: {
  frase: string;
  precioUnitario: number;
  cantidad: number;
  nombre: string;
}): string | null {
  const { frase, precioUnitario, cantidad, nombre } = params;
  if (!/\{precio\}|\{total\}/.test(frase)) return null;

  return frase
    .replace(/\{precio\}/g, pesos(precioUnitario))
    .replace(/\{total\}/g, pesos(precioUnitario * cantidad))
    .replace(/\{cantidad\}/g, String(cantidad))
    .replace(/\{producto\}/g, nombre)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * LA OFERTA, O NADA.
 *
 * Devuelve la frase lista para pegar al final de la respuesta, o `null`. Todos
 * los caminos que no terminan en una oferta perfecta terminan en `null`: es
 * preferible no ofrecer nada a ofrecer algo que obligue al cliente a preguntar.
 */
export async function ofertaDespuesDelCierre(params: {
  orgId: string;
  contactId: string;
  conversationId: string;
  mensajeDelCliente: string | null | undefined;
  respuestaDelBot: string | null | undefined;
  pasos: any[];
}): Promise<string | null> {
  const { orgId, contactId, conversationId, mensajeDelCliente, respuestaDelBot, pasos } = params;

  try {
    const supabase = createAdminClient();

    if (await yaSeOfrecio(supabase, contactId, conversationId)) return null;

    // De qué familia es lo que compró. Se mira la respuesta del bot primero:
    // ahí está el nombre del producto que se acaba de cotizar, mientras que el
    // cliente en el cierre suele escribir solo «listo, lo quiero».
    const cual =
      (await hojaParaLoQueDijoElCliente(orgId, String(respuestaDelBot || ''))) ||
      (await hojaParaLoQueDijoElCliente(orgId, String(mensajeDelCliente || '')));
    if (!cual) return null;

    const queOfrecer = String(cual.hoja.ofrecer_al_cerrar || '').trim();
    const frase = String(cual.hoja.frase_al_cerrar || '').trim();
    if (!queOfrecer || !frase) return null; // sin dato no se rellena

    const cantidad = cantidadDelPedido(pasos, [respuestaDelBot, mensajeDelCliente]);
    if (!cantidad) {
      logger.info('Venta cruzada: no se supo la cantidad, no se ofrece', { orgId, conversationId });
      return null;
    }

    const producto = await resolverProductoOfrecido(supabase, queOfrecer);
    if (!producto) {
      logger.warn('Venta cruzada: la hoja apunta a un producto que no se encontró', {
        orgId, hoja: cual.hoja.nombre, escrito: queOfrecer,
      });
      return null;
    }

    // Lo que ya se está vendiendo no se vuelve a ofrecer.
    if (new RegExp(soloCodigo(producto.reference), 'i').test(soloCodigo(String(respuestaDelBot || '')))) {
      return null;
    }

    const precio = await precioUnitarioDe(supabase, producto.id, cantidad);
    if (!precio) {
      logger.info('Venta cruzada: sin tarifa clara para esa cantidad, no se ofrece', {
        orgId, producto: producto.reference, cantidad,
      });
      return null;
    }

    const texto = armarFrase({ frase, precioUnitario: precio, cantidad, nombre: producto.name });
    if (!texto) {
      logger.warn('Venta cruzada: la frase de la hoja no tiene dónde poner el precio', {
        orgId, hoja: cual.hoja.nombre,
      });
      return null;
    }

    await marcarOfrecida(supabase, contactId, conversationId);
    logger.info('Venta cruzada ofrecida', {
      orgId, conversationId, hoja: cual.hoja.nombre, producto: producto.reference, cantidad, precio,
    });

    return texto;
  } catch (err) {
    // Que falle esto no puede tocar la respuesta que el cliente ya tiene ganada.
    logger.error('Venta cruzada: falló y se omite', { error: String(err), orgId, conversationId });
    return null;
  }
}
