import { createAdminClient } from '../supabase/admin';
import { logger } from '../logger';

/**
 * EL PRECIO ESPECIAL POR VOLUMEN — «llevando más, le sale más barato».
 *
 * QUÉ PIDIÓ EL DUEÑO, TEXTUAL (11-ago-2026)
 * -----------------------------------------
 * «Había otra cosa que el bot sí hacía y lo hacía muy bien: ofrecer la
 * promoción por volumen, y eso no lo volví a ver. Ejemplo: los pad mouse, que
 * pasan de valer 18.200 cada uno por compras de hasta 29 unidades a valer
 * 12.350 si llevan 30.»
 *
 * TENÍA RAZÓN, Y ESTÁ MEDIDO. El mismo día, a «cuánto valen 12 pad mouse
 * ergonómicos» el bot contestó «$218.400 COP» y **ni una palabra** de que con
 * 30 el pedido queda en $370.500 con cada uno a $12.350. Son 18 unidades más
 * por 152.100 pesos más: la clase de dato que sube el ticket sin regatear.
 *
 * POR QUÉ DEJÓ DE HACERLO
 * -----------------------
 * Nunca hubo nada que lo obligara. `getProductPrice` le entrega al modelo la
 * tabla entera de rangos y el modelo decide si la menciona. Por eso «lo hacía
 * muy bien» unos días y otros no: es la Regla 1 del proyecto por octava vez —
 * una instrucción escrita no obliga; lo que obliga es el código.
 *
 * POR QUÉ NO VA EN LAS HOJAS DE CATEGORÍA
 * ---------------------------------------
 * El dueño preguntó si se podían agregar ahí. No: **el dato ya está cargado**.
 * Son los rangos que él mismo llenó producto por producto, y al 11-ago-2026 los
 * tienen **191 productos activos** de los 2.228. Copiarlos a mano a una hoja
 * sería escribir miles de cifras que quedarían mintiendo el día que cambie un
 * precio. La hoja guarda lo que el código no puede deducir; esto sí lo deduce.
 *
 * LAS GARANTÍAS, TODAS EN CÓDIGO
 * ------------------------------
 * 1. Solo con precios POR UNIDAD. Un precio por m² o por lote no se multiplica
 *    por unidades sin mentir — misma regla que `buildQuote`.
 * 2. Solo si el rango de más arriba es de verdad más barato POR UNIDAD.
 * 3. Nunca se elige a dedo: si a esa cantidad le corresponden dos tarifas
 *    distintas, es ambiguo y no se dice nada.
 * 4. No se repite la misma sugerencia en la misma conversación.
 * 5. Se pega DESPUÉS del candado de salida, como la venta cruzada: si se
 *    pegara antes, `applyOutputGuardrail` vería una cifra que ninguna
 *    herramienta devolvió y bloquearía la respuesta entera.
 * 6. Solo mientras se cotiza, nunca en el turno del cierre: ahí ya habla la
 *    venta cruzada, y dos ofertas en el mismo mensaje son una lista.
 */

/** Un precio en pesos, como lo escribe el resto del sistema. */
const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

const esUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s));

type Tarifa = { min_qty: number | null; max_qty: number | null; price: number | null; price_basis: string | null };

/** Lo que se le pidió a la calculadora en este turno: producto y cantidad. */
export function productosCotizadosEnElTurno(pasos: any[]): Array<{ pedido: string; cantidad: number }> {
  const out: Array<{ pedido: string; cantidad: number }> = [];
  for (const paso of pasos || []) {
    for (const call of ((paso?.toolCalls || []) as any[])) {
      // Solo la calculadora por producto. `calculateCustomPrice` y `buildQuote`
      // arman el precio por componentes y tienen su propia matemática: meterse
      // ahí sería contradecirlos.
      if (call?.toolName !== 'getProductPrice') continue;
      const args = call.input ?? call.args ?? {};
      const pedido = String(args?.product_id ?? args?.productId ?? '').trim();
      const cantidad = Number(args?.quantity ?? args?.cantidad);
      if (!pedido) continue;
      if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 1_000_000) continue;
      if (out.some((o) => o.pedido === pedido && o.cantidad === Math.round(cantidad))) continue;
      out.push({ pedido, cantidad: Math.round(cantidad) });
    }
  }
  return out.slice(0, 6);
}

/** El precio por unidad que le toca a esa cantidad, o null si es ambiguo. */
function precioDeEsaCantidad(tarifas: Tarifa[], cantidad: number): number | null {
  const utiles = tarifas.filter((t) => {
    const p = Number(t.price);
    if (!Number.isFinite(p) || p <= 0 || p > 1e9) return false;
    if (String(t.price_basis || 'unitario').toLowerCase() !== 'unitario') return false;
    return cantidad >= (t.min_qty || 0) && (t.max_qty == null || cantidad <= t.max_qty);
  });
  if (utiles.length === 0) return null;
  const precios = utiles.map((t) => Number(t.price));
  const distintos = precios.filter((p, i) => precios.indexOf(p) === i);
  return distintos.length > 1 ? null : distintos[0];
}

/**
 * EL SIGUIENTE ESCALÓN QUE DE VERDAD BAJA EL PRECIO.
 *
 * Se toma el más cercano hacia arriba, no el más barato de todos: decirle a
 * quien pide 12 que a partir de 1.000 le sale a la mitad no es una oferta, es
 * una burla. El salto alcanzable es el que convierte.
 */
function siguienteEscalon(
  tarifas: Tarifa[],
  cantidad: number,
  precioActual: number
): { desde: number; precio: number } | null {
  const candidatas = tarifas
    .filter((t) => {
      const p = Number(t.price);
      const desde = Number(t.min_qty);
      if (!Number.isFinite(p) || p <= 0) return false;
      if (String(t.price_basis || 'unitario').toLowerCase() !== 'unitario') return false;
      return Number.isFinite(desde) && desde > cantidad && p < precioActual;
    })
    .map((t) => ({ desde: Number(t.min_qty), precio: Number(t.price) }))
    .sort((a, b) => a.desde - b.desde);

  if (candidatas.length === 0) return null;

  // A ese mismo escalón no puede corresponderle más de un precio: si el
  // catálogo tiene dos filas distintas para «desde 30», no se elige a dedo.
  const primera = candidatas[0];
  const mismasDe = candidatas.filter((c) => c.desde === primera.desde);
  if (mismasDe.some((c) => c.precio !== primera.precio)) return null;

  return primera;
}

/** ¿Ya se le dijo esto mismo en esta conversación? */
async function yaSeDijo(supabase: any, contactId: string, conversationId: string, marca: string): Promise<boolean> {
  const { data } = await supabase.from('contacts').select('metadata').eq('id', contactId).single();
  const dichas: string[] = ((data?.metadata || {}).precio_volumen || {})[conversationId] || [];
  return dichas.indexOf(marca) !== -1;
}

/** Deja la marca. Se relee justo antes de escribir: en este mismo turno otras
 *  partes tocan `contacts.metadata` y una copia vieja borraría lo suyo. */
async function dejarMarca(supabase: any, contactId: string, conversationId: string, marca: string): Promise<void> {
  const { data } = await supabase.from('contacts').select('metadata').eq('id', contactId).single();
  const metadata = data?.metadata || {};
  const previas = metadata.precio_volumen || {};
  const dichas: string[] = previas[conversationId] || [];
  if (dichas.indexOf(marca) === -1) dichas.push(marca);
  await supabase
    .from('contacts')
    .update({ metadata: { ...metadata, precio_volumen: { ...previas, [conversationId]: dichas } } })
    .eq('id', contactId);
}

/**
 * EL AVISO, O NADA.
 *
 * Devuelve la frase lista para pegar al final de la respuesta ya aprobada, o
 * `null`. Igual que la venta cruzada: todos los caminos que no terminan en un
 * aviso exacto terminan en `null`.
 */
export async function avisoDeMejorPrecioPorVolumen(params: {
  contactId: string;
  conversationId: string;
  respuestaDelBot: string | null;
  pasos: any[];
}): Promise<string | null> {
  const { contactId, conversationId, respuestaDelBot, pasos } = params;

  // Sin un precio a la vista no hay nada que mejorar: el turno no cotizó.
  if (!/\$\s?\d/.test(String(respuestaDelBot || ''))) return null;

  const pedidos = productosCotizadosEnElTurno(pasos);
  if (pedidos.length === 0) return null;

  const supabase = createAdminClient();

  type Candidato = {
    marca: string; nombre: string; cantidad: number;
    desde: number; precioNuevo: number; ahorro: number;
  };
  const candidatos: Candidato[] = [];

  for (const { pedido, cantidad } of pedidos) {
    // El modelo manda el UUID que le dio el buscador; a veces manda la
    // referencia. Se aceptan las dos, igual que `getProductPrice`.
    const columnas = 'id, name';
    let producto: any = null;
    if (esUUID(pedido)) {
      const { data } = await supabase.from('products').select(columnas).eq('id', pedido).limit(1);
      producto = (data || [])[0] || null;
    } else {
      const { data } = await supabase
        .from('products').select(columnas).eq('reference', pedido).eq('active', true).limit(1);
      producto = (data || [])[0] || null;
    }
    if (!producto?.id) continue;

    const { data: tarifas, error } = await supabase
      .from('price_tiers')
      .select('min_qty, max_qty, price, price_basis')
      .eq('product_id', producto.id);
    // Una consulta rota devuelve vacío sin avisar: mirar SIEMPRE el error.
    if (error) {
      logger.warn('Precio por volumen: no se pudieron leer las tarifas', {
        error: error.message, productId: producto.id,
      });
      continue;
    }

    const precioActual = precioDeEsaCantidad((tarifas || []) as Tarifa[], cantidad);
    if (precioActual == null) continue;

    const mejor = siguienteEscalon((tarifas || []) as Tarifa[], cantidad, precioActual);
    if (!mejor) continue;

    // Si el bot ya dijo esa cifra por su cuenta, no se repite.
    if (String(respuestaDelBot).includes(pesos(mejor.precio))) continue;

    candidatos.push({
      marca: `${producto.id}:${mejor.desde}`,
      nombre: String(producto.name || '').trim(),
      cantidad,
      desde: mejor.desde,
      precioNuevo: mejor.precio,
      ahorro: (precioActual - mejor.precio) / precioActual,
    });
  }

  if (candidatos.length === 0) return null;

  // Con varios productos cotizados en el mismo turno se avisa de UNO solo: el
  // del ahorro más grande. Una lista de rebajas es otra vez la lista que el
  // dueño prohibió.
  candidatos.sort((a, b) => b.ahorro - a.ahorro);
  const elegido = candidatos[0];

  if (await yaSeDijo(supabase, contactId, conversationId, elegido.marca)) return null;
  await dejarMarca(supabase, contactId, conversationId, elegido.marca);

  const total = elegido.precioNuevo * elegido.desde;
  logger.info('Se avisó del mejor precio por volumen', {
    producto: elegido.nombre, pidio: elegido.cantidad, desde: elegido.desde,
    precioNuevo: elegido.precioNuevo,
  });

  return (
    `Un dato que te sirve: si en vez de ${elegido.cantidad} llevas ${elegido.desde} ` +
    `*${elegido.nombre}*, cada uno te queda en *${pesos(elegido.precioNuevo)}* ` +
    `y el pedido completo en *${pesos(total)}*.`
  );
}
