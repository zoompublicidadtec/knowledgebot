import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '../../supabase/admin';
import { logger } from '../../logger';

/**
 * LA COTIZACIÓN ARMADA — el total lo calcula el código, no el modelo.
 *
 * POR QUÉ EXISTE. Un cuaderno no tiene un precio: se arma sumando piezas
 * (base + insertos + filtro UV + guardas…). Hasta el 03-ago-2026, cada pieza
 * salía de la calculadora —y estaba bien— pero **la suma y la multiplicación
 * las escribía el modelo de cabeza**. Medido ese día, cinco corridas de la
 * misma frase («20 cuadernos argollados 120 hojas 1/2 octavo, con 6
 * insertos»), con contacto nuevo cada vez:
 *
 *   $487.000 ✔   $487.000 ✔   $427.000 ✘   $584.000 ✘   (y una que no cotizó)
 *
 *   · $427.000 = (16.000 + 5.350) × 20  → se le olvidaron 2 de los 6 insertos.
 *   · $584.000 = (16.000 + 10.200 + 3.000) × 20 → partió el 6 como 8+2, o sea
 *     DIEZ insertos, y encima lo escribió: «con 10 insertos».
 *
 * Un cliente podía recibir la misma cotización con $157.000 de diferencia.
 *
 * Y lo que cierra el caso: el prompt YA decía, con estas palabras, «desglosa
 * de MAYOR a MENOR: 6 = 4+2». Estaba escrito y usó 8+2 igual. Es la regla del
 * proyecto demostrada otra vez — una instrucción escrita no obliga; lo que
 * obliga es el código.
 *
 * QUÉ HACE. El modelo dice QUÉ lleva la cotización, sin una sola cifra. Esta
 * herramienta busca cada tarifa, resuelve el desglose, suma, multiplica y
 * devuelve el total ya hecho. El candado de salida comprueba después que el
 * total que sale al cliente sea exactamente este.
 *
 * QUÉ NO HACE. No adivina. Si la talla/tamaño es ambiguo o una cantidad no se
 * puede armar con lo que existe, devuelve el error y las opciones para que se
 * le pregunte al cliente. Es la misma regla de DEFAULT_PERSONA: si el dato no
 * está, no se inventa.
 */

/** Quita tildes y baja a minúsculas, para comparar «1/2 Octavo» con «1/2 octavo». */
function normalizar(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

const esUUID = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s));

type Producto = { id: string; reference: string; name: string };

/**
 * Resuelve lo que el modelo escribió a un producto real: primero por
 * referencia exacta, después por nombre exacto, y solo al final por parecido.
 * Nunca inventa: si no encuentra, lo dice.
 */
async function resolverProducto(supabase: any, texto: string): Promise<Producto | null> {
  const clave = String(texto || '').trim();
  if (!clave) return null;

  const columnas = 'id, reference, name';

  if (esUUID(clave)) {
    const { data } = await supabase.from('products').select(columnas).eq('id', clave).limit(1);
    if (data?.[0]) return data[0];
  }

  const { data: porRef } = await supabase
    .from('products')
    .select(columnas)
    .eq('reference', clave)
    .eq('active', true)
    .limit(1);
  if (porRef?.[0]) return porRef[0];

  const { data: porNombre } = await supabase
    .from('products')
    .select(columnas)
    .ilike('name', clave)
    .eq('active', true)
    .limit(1);
  if (porNombre?.[0]) return porNombre[0];

  const { data: parecidos } = await supabase
    .from('products')
    .select(columnas)
    .ilike('name', `%${clave}%`)
    .eq('active', true)
    .limit(2);
  // Con dos candidatos no se elige a dedo: que lo resuelva searchCatalog.
  if (parecidos?.length === 1) return parecidos[0];

  return null;
}

type Tramo = {
  variant: string | null;
  min_qty: number;
  max_qty: number | null;
  price: number;
  price_basis: string | null;
};

const precioCorrupto = (p: any) => {
  const n = Number(p);
  return !Number.isFinite(n) || n <= 0 || n > 1e9;
};

async function tarifasDe(supabase: any, productId: string): Promise<Tramo[]> {
  const { data } = await supabase
    .from('price_tiers')
    .select('variant, min_qty, max_qty, price, price_basis')
    .eq('product_id', productId);
  return (data || []).filter((t: Tramo) => !precioCorrupto(t.price));
}

/**
 * Elige el tramo que corresponde a la cantidad y a la variante pedida.
 *
 * Si quedan varias variantes posibles NO se elige una: se devuelven todas para
 * que el asesor le pregunte al cliente. Elegir a dedo entre «1/2 Carta»,
 * «1/2 Octavo» y «Carta» es la diferencia entre $15.000 y $23.000 por cuaderno.
 */
function elegirTramo(
  tramos: Tramo[],
  cantidad: number,
  varianteBuscada: string
): { tramo?: Tramo; ambiguo?: string[]; sinTramo?: boolean } {
  const porCantidad = tramos.filter(
    t => cantidad >= (t.min_qty || 0) && (t.max_qty == null || cantidad <= t.max_qty)
  );
  if (porCantidad.length === 0) return { sinTramo: true };

  const pista = normalizar(varianteBuscada);
  const candidatos = pista
    ? porCantidad.filter(t => normalizar(t.variant || '').includes(pista))
    : porCantidad;

  const utiles = candidatos.length > 0 ? candidatos : porCantidad;

  const variantes = [...new Set(utiles.map(t => t.variant || ''))];
  if (variantes.length > 1) return { ambiguo: variantes };

  return { tramo: utiles[0] };
}

/**
 * Descompone una cantidad en las presentaciones que EXISTEN en el catálogo.
 *
 * No hay ninguna lista escrita aquí: las presentaciones se leen del propio
 * catálogo (los productos de «insertos» son 1, 2, 3, 4 y 8, y el número sale
 * de su nombre). Si mañana el dueño carga un producto de 6 insertos, esto lo
 * usa solo y deja de partir.
 *
 * De mayor a menor, que es como lo pedía el prompt: 6 = 4+2, 7 = 4+3,
 * 9 = 8+1, 10 = 8+2. La diferencia es que ahora se cumple siempre.
 */
function descomponer(
  cantidad: number,
  disponibles: Array<{ n: number; producto: Producto }>
): Array<{ n: number; producto: Producto }> | null {
  if (cantidad <= 0) return null;
  const orden = [...disponibles].sort((a, b) => b.n - a.n);
  const piezas: Array<{ n: number; producto: Producto }> = [];
  let resto = cantidad;

  for (const opcion of orden) {
    while (resto >= opcion.n) {
      piezas.push(opcion);
      resto -= opcion.n;
      // Tope de seguridad: nunca más de 20 piezas para un mismo concepto.
      if (piezas.length > 20) return null;
    }
    if (resto === 0) break;
  }

  return resto === 0 ? piezas : null;
}

/** Busca la familia de un concepto y le lee el número al nombre de cada uno. */
async function presentacionesDelConcepto(
  supabase: any,
  concepto: string
): Promise<Array<{ n: number; producto: Producto }>> {
  const { data } = await supabase
    .from('products')
    .select('id, reference, name')
    .ilike('name', `%${concepto}%`)
    .eq('active', true)
    .limit(50);

  const salida: Array<{ n: number; producto: Producto }> = [];
  for (const p of data || []) {
    const m = String(p.name).match(/(\d+)/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n > 0 && !salida.some(x => x.n === n)) salida.push({ n, producto: p });
  }
  return salida;
}

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

export function buildQuoteTool() {
  return tool({
    description:
      'Arma la cotizacion COMPLETA de un pedido que se compone de varias piezas (un producto base mas sus adicionales) y devuelve el TOTAL ya calculado. OBLIGATORIA siempre que el precio final sea una SUMA de dos o mas conceptos: por ejemplo un cuaderno con insertos, filtro UV o guardas. NO calcules ni sumes tu: envia solo QUE lleva el pedido, sin cifras, y usa el total que devuelva.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        quantity: {
          type: 'number',
          description: 'Cuantas unidades pidio el cliente (ej. 20 cuadernos).',
        },
        variant: {
          type: 'string',
          description:
            'Tamano, talla, material o acabado que eligio el cliente, tal como aparece en la tabla de precios (ej. "1/2 Octavo", "2 Tintas"). Dejalo vacio si el producto tiene una sola variante.',
        },
        items: {
          type: 'array',
          description:
            'Las piezas del pedido. La primera es el producto base; las demas son los adicionales.',
          items: {
            type: 'object',
            properties: {
              product: {
                type: 'string',
                description:
                  'Referencia exacta del producto (ej. ZM-CUA-012), tal como la devolvio searchCatalog.',
              },
              concept: {
                type: 'string',
                description:
                  'Alternativa a product cuando el adicional se pide por cantidad y no por referencia (ej. "insertos"). Usalo junto con count.',
              },
              count: {
                type: 'number',
                description:
                  'Cuantas unidades de ese concepto lleva CADA producto (ej. 6 insertos por cuaderno). Solo con concept.',
              },
            },
          },
        },
      },
      required: ['quantity', 'items'],
    }),
    execute: async (args: any) => {
      const cantidad = Math.floor(Number(args?.quantity) || 0);
      const variante = String(args?.variant || '');
      const items = Array.isArray(args?.items) ? args.items : [];

      if (cantidad <= 0) {
        return { success: false, error: 'Falta la cantidad de unidades del pedido.' };
      }
      if (items.length === 0) {
        return { success: false, error: 'Falta decir que lleva el pedido.' };
      }

      try {
        const supabase = createAdminClient();

        // 1. Cada item se convierte en una o varias piezas con producto real.
        type Pieza = { etiqueta: string; producto: Producto };
        const piezas: Pieza[] = [];

        for (const item of items) {
          const concepto = String(item?.concept || '').trim();
          const cuenta = Math.floor(Number(item?.count) || 0);

          if (concepto && cuenta > 0) {
            const disponibles = await presentacionesDelConcepto(supabase, concepto);
            if (disponibles.length === 0) {
              return {
                success: false,
                error: `No existe ningun producto de "${concepto}" en el catalogo. No lo ofrezcas.`,
              };
            }
            const partes = descomponer(cuenta, disponibles);
            if (!partes) {
              const nes = disponibles.map(d => d.n).sort((a, b) => a - b).join(', ');
              return {
                success: false,
                error:
                  `No se puede armar ${cuenta} de "${concepto}" con lo que existe (${nes}). ` +
                  `Preguntale al cliente cual de esas cantidades quiere.`,
              };
            }
            for (const parte of partes) {
              piezas.push({ etiqueta: parte.producto.name, producto: parte.producto });
            }
            continue;
          }

          const clave = String(item?.product || '').trim();
          const producto = await resolverProducto(supabase, clave);
          if (!producto) {
            return {
              success: false,
              error: `No encontre el producto "${clave}". Ejecuta searchCatalog y usa la referencia exacta que devuelva.`,
            };
          }
          piezas.push({ etiqueta: producto.name, producto });
        }

        // 2. Cada pieza busca su tarifa. Nada se estima ni se redondea a ojo.
        const lineas: Array<{
          concepto: string;
          referencia: string;
          variante: string;
          unitario: number;
          subtotal: number;
        }> = [];

        for (const pieza of piezas) {
          const tramos = await tarifasDe(supabase, pieza.producto.id);
          if (tramos.length === 0) {
            return {
              success: false,
              error: `"${pieza.producto.name}" no tiene tabla de precios. No se puede cotizar.`,
            };
          }

          const elegido = elegirTramo(tramos, cantidad, variante);

          if (elegido.ambiguo) {
            return {
              success: false,
              error:
                `Para "${pieza.producto.name}" hay varias opciones y no puedo elegir por el cliente: ` +
                `${elegido.ambiguo.join(' / ')}. Preguntale cual quiere y vuelve a llamarme con ese dato en "variant".`,
            };
          }
          if (elegido.sinTramo || !elegido.tramo) {
            const minimo = Math.min(...tramos.map(t => t.min_qty || 0));
            return {
              success: false,
              error:
                `"${pieza.producto.name}" no tiene tarifa para ${cantidad} unidades. ` +
                `Su tabla empieza en ${minimo}. Informale el minimo al cliente.`,
            };
          }

          const t = elegido.tramo;
          const base = String(t.price_basis || 'unitario').toLowerCase();

          if (base === 'cm2') {
            return {
              success: false,
              error:
                `"${pieza.producto.name}" se cobra por area. Cotizalo con calculateCustomPrice, no aqui.`,
            };
          }

          const subtotal = base === 'lote_total' ? Number(t.price) : Number(t.price) * cantidad;
          const unitario = base === 'lote_total' ? Number(t.price) / cantidad : Number(t.price);

          lineas.push({
            concepto: pieza.producto.name,
            referencia: pieza.producto.reference,
            variante: t.variant || '',
            unitario,
            subtotal,
          });
        }

        // 3. La suma. Este es el único sitio donde se hace, y se hace en código.
        const total = Math.round(lineas.reduce((acc, l) => acc + l.subtotal, 0));
        const unitarioTotal = Math.round(total / cantidad);

        const nombreBase = lineas[0]?.concepto || 'pedido';
        const refBase = lineas[0]?.referencia || '';

        logger.info('buildQuote: cotizacion armada', {
          cantidad,
          variante: lineas[0]?.variante || '',
          piezas: lineas.map(l => `${l.referencia} ${l.unitario}`),
          total,
        });

        return {
          success: true,
          quantity: cantidad,
          variante: lineas[0]?.variante || '',
          lineas,
          unitario_total: unitarioTotal,
          total,
          total_texto: pesos(total),
          resumen: `${cantidad} ${nombreBase}${refBase ? ` (Ref: ${refBase})` : ''} — ${pesos(total)} COP`,
          note:
            `EL TOTAL ES ${pesos(total)} COP. Escribelo EXACTAMENTE asi, sin recalcular nada. ` +
            `El desglose de las piezas es para calcular, NO para contarselo al cliente: ` +
            `dile la cantidad que pidio en una sola linea. Si necesita el unitario, es ${pesos(unitarioTotal)}.`,
        };
      } catch (err: any) {
        logger.error('buildQuote: excepcion', { error: String(err) });
        return { success: false, error: err?.message || String(err) };
      }
    },
  } as any);
}
