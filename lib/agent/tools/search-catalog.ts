import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { hojaParaEsteProducto, textoDeHoja, traducirConsulta } from '../hojas';

function removeAccentsSimple(t: string): string {
  return (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * RETRIEVAL RAIL \u2014 el cat\u00e1logo no le entrega NINGUNA cifra al modelo.
 *
 * Mientras searchCatalog devolv\u00eda `price`, `max_price` o descripciones con
 * "PRECIO BOMBA $12.550", el modelo copiaba esos n\u00fameros en su respuesta sin
 * llamar a getProductPrice. El candado de precios lo bloqueaba y forzaba hasta
 * 3 reintentos: 84 segundos por mensaje y el triple de tokens.
 *
 * Sin cifras en el contexto, cotizar con la herramienta es el \u00fanico camino
 * posible. `has_pricing` e `is_most_expensive` bastan para armar el embudo.
 */
function stripPrices(text: string): string {
  if (!text) return '';
  return text
    .replace(/\$\s?[\d.,]+/g, '')
    .replace(/\b(precio bomba|precio|valor)\b\s*:?\s*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Categorías hermanas cotizables para redirección automática cuando una
// búsqueda trae <2 productos con precio válido. Cumplen la misma función.
const SISTER_CATEGORY: Record<string, string> = {
  mug: 'termo',
  mugs: 'termo',
  pocillo: 'termo',
  pocillos: 'termo',
  taza: 'termo',
  tazas: 'termo',
  'pocillo pal tinto': 'termo',
  gorra: 'Gorra Mesh',
  gorras: 'Gorra Mesh',
  cachucha: 'Gorra Mesh',
  cachuchas: 'Gorra Mesh',
};

/**
 * Dado un conjunto de matches, consulta en Supabase todos sus price_tiers
 * y los anota con has_pricing (si tiene al menos un precio válido), max_price
 * (el precio unitario máximo de su tabla) y marca con is_most_expensive = true
 * al producto con el valor unitario más costoso de todo el grupo.
 */
async function annotateMatchesWithPricing(supabase: any, matches: any[]): Promise<any[]> {
  if (!matches || matches.length === 0) return matches;

  try {
    const ids = matches.map(m => m.product_id).filter(Boolean);
    const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
    
    const uuidsInInput = ids.filter(isUUID);
    const refsInInput = ids.filter(id => !isUUID(id));

    let resolvedUuids: string[] = [...uuidsInInput];
    const refToUuidMap = new Map<string, string>();

    if (refsInInput.length > 0) {
      const { data: prods } = await (supabase as any)
        .from('products')
        .select('id, reference')
        .in('reference', refsInInput)
        .limit(1000);
      
      for (const p of (prods || [])) {
        refToUuidMap.set(p.reference, p.id);
        resolvedUuids.push(p.id);
      }
    }

    const { data: tiers } = await (supabase as any)
      .from('price_tiers')
      .select('product_id, price, price_basis')
      .in('product_id', resolvedUuids)
      .limit(5000);

    // Techo de cordura para artículos promocionales. La importación desde Excel
    // dejó ~16 productos con celdas concatenadas (unas Gafas Bamboo a
    // $850.010.900, un Cepillo a $47.554.950). Como el embudo obliga a ofrecer
    // el producto más caro como opción Premium, esas cifras llegaban al cliente.
    // Se descartan hasta que se corrijan desde el panel.
    const MAX_PRECIO_RAZONABLE = 1_500_000;
    const isSane = (p: any) => {
      const n = Number(p);
      return Number.isFinite(n) && n > 0 && n <= MAX_PRECIO_RAZONABLE;
    };

    const uuidMaxPrice = new Map<string, number>();
    for (const t of (tiers || [])) {
      // El techo solo aplica a tarifas unitarias: "lote_total" es el precio del
      // pedido completo y puede ser legítimamente alto.
      const sane = t.price_basis === 'unitario' || !t.price_basis
        ? isSane(t.price)
        : Number(t.price) > 0 && Number(t.price) < 1e9;
      if (sane) {
        const val = Number(t.price);
        const current = uuidMaxPrice.get(t.product_id) || 0;
        if (val > current) {
          uuidMaxPrice.set(t.product_id, val);
        }
      }
    }

    let maxFoundPrice = -1;
    let mostExpensiveMatchIndex = -1;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      let uuid = m.product_id;
      if (!isUUID(uuid)) {
        uuid = refToUuidMap.get(uuid) || '';
      }

      m.has_pricing = false;
      m.max_price = 0;
      m.is_most_expensive = false;

      if (uuid && uuidMaxPrice.has(uuid)) {
        const price = uuidMaxPrice.get(uuid)!;
        m.has_pricing = true;
        m.max_price = price;
        
        if (price > maxFoundPrice) {
          maxFoundPrice = price;
          mostExpensiveMatchIndex = i;
        }
      }
    }

    if (mostExpensiveMatchIndex !== -1) {
      matches[mostExpensiveMatchIndex].is_most_expensive = true;
    }

    return matches;
  } catch (err) {
    logger.error('Error in annotateMatchesWithPricing', { error: String(err) });
    return matches;
  }
}

/**
 * Marca el orden de presentación de la propuesta.
 *
 * Regla del dueño: se ofrecen los 3 PRIMEROS del ranking de la búsqueda —que ya
 * prioriza la producción propia de ZOOM— y de esos 3 se presenta primero el de
 * mayor valor. Antes el prompt exigía como "Premium" el producto más caro de
 * toda la búsqueda, y por eso la propuesta se iba a los importados de gama alta
 * aunque hubiera mugs propios en cabeza.
 *
 * El orden se calcula aquí con max_price, que se elimina del payload: el modelo
 * sigue sin ver una sola cifra hasta llamar a getProductPrice.
 */
function marcarSugeridos(matches: any[]): void {
  const top3 = matches.filter((m: any) => m.has_pricing).slice(0, 3);
  top3.sort((a: any, b: any) => (Number(b.max_price) || 0) - (Number(a.max_price) || 0));
  // Lo que el cliente pidió por su código encabeza la propuesta, pase lo que
  // pase con el precio: es lo que preguntó, no una sugerencia nuestra.
  top3.sort((a: any, b: any) => Number(!!b.protegido) - Number(!!a.protegido));
  top3.forEach((m: any, i: number) => { m.sugerido = i + 1; });
}


/**
 * Le pega a cada producto la GUIA DE VENTA de su categoria, que el dueño
 * escribio en el panel. Es dato de recuperacion, no una instruccion metida en
 * el prompt: llena el hueco de `instrucciones_venta`, que el prompt mandaba
 * obedecer dos veces y NUNCA existio.
 *
 * Sin hojas cargadas no toca nada y el bot se comporta exactamente como antes.
 *
 * SE BUSCA TAMBIEN POR LO QUE PIDIO EL CLIENTE, no solo por la categoria del
 * producto. Medido el 11-ago-2026: de las 12 hojas del panel, 11 no tienen
 * ninguna categoria marcada, asi que por este camino solo llegaba la de
 * Cuadernos — el dueño podia llenar entera la hoja de Mugs y no pasaba nada.
 * El porque completo, en `hojaParaEsteProducto`.
 */
async function adjuntarGuiaDeVenta(
  matches: any[],
  orgId?: string,
  loQueSeBusco?: string,
  mensajeDelCliente?: string
): Promise<any[]> {
  if (!orgId || !Array.isArray(matches) || matches.length === 0) return matches;
  try {
    const cache = new Map<string, string>();
    const pedido = String(loQueSeBusco || '');
    // La hoja se busca por la CONSULTA; la lista de extras se decide con lo que
    // el cliente escribió de verdad. Son dos textos distintos a proposito: la
    // consulta la escribe el modelo y casi nunca dice «con 6 insertos».
    const dijoElCliente = String(mensajeDelCliente || pedido);
    for (const m of matches) {
      const cat = String(m?.category || '');
      if (!cache.has(cat)) {
        cache.set(cat, textoDeHoja(await hojaParaEsteProducto(orgId, cat, pedido), dijoElCliente));
      }
      const guia = cache.get(cat) || '';
      if (guia) m.guia_de_venta = guia;
    }
  } catch (err) {
    logger.warn('No se pudo adjuntar la guia de venta', { error: String(err) });
  }
  return matches;
}
/**
 * LA REFERENCIA QUE DA EL CLIENTE SE BUSCA COMO CÓDIGO, NO COMO TEXTO.
 * ---------------------------------------------------------------------------
 * Medido el 10-ago-2026 sobre la queja del dueño: pidió «10 mug metálicos ref
 * MU-303-1» y el bot contestó que esa referencia no existe. **Existe y está
 * activa**, guardada como `MU-303-1.` con un punto al final y con el nombre
 * `.Mug Metálico Wilem 380ml II`. Tres cosas la escondían a la vez:
 *
 * 1. El rail determinista descarta las palabras de menos de 4 letras y los
 *    números sueltos, así que de «MU-303-1» no quedaba NADA con que buscar.
 * 2. El modelo, al no tener el código, buscaba «mug metálico» — y con esas
 *    palabras el motor devuelve los mugs de ZOOM, no el Wilem (medido).
 * 3. Aunque hubiera llegado, el filtro de «ZOOM primero» lo habría descartado
 *    por ser importado.
 *
 * Un código no es lenguaje: se compara carácter a carácter, sin puntos ni
 * guiones ni mayúsculas. Y el producto que el cliente nombró por su código
 * queda PROTEGIDO: ningún filtro posterior puede quitarlo de la propuesta,
 * porque es exactamente lo que pidió.
 */
/**
 * UNA SOLA LETRA TAMBIEN ES UNA REFERENCIA: «S-841», «R-524», «D-5».
 *
 * Hasta el 11-ago-2026 se exigian DOS letras antes del guion, y con eso todo el
 * catalogo de sellos de ZOOM quedaba invisible: son «S-…» y «R-…». Medido ese
 * dia, recien unificadas las referencias con las del Excel de la empresa, a
 * «precio del sello S-828D» el bot contestaba **«no encuentro el sello S-828D
 * en nuestro catalogo»** sobre una referencia que existe y esta activa.
 *
 * El filtro de longitud minima es el que evita los falsos positivos: «a-1» o
 * «y-2» se quedan en dos caracteres y se descartan solos.
 */
const CODIGO_CON_GUION = /\b[A-Za-z]{1,12}(?:-[A-Za-z0-9]{1,8}){1,4}\b/g;
const CODIGO_PEGADO = /\b[A-Za-z]{2,6}\s?\d{2,6}\b/g;

function normalizarCodigo(s: string): string {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Palabras que van pegadas a un número en el habla normal. Sin esta lista,
 * «el precio de 10» se leía como la referencia «DE10» y «cuánto valen 20» como
 * «VALEN20» (visto en los registros del 10-ago, en cada mensaje con cantidad).
 * No rompían nada, pero ensuciaban el registro y gastaban una consulta.
 */
const NO_SON_REFERENCIAS = new Set([
  'de', 'del', 'en', 'por', 'con', 'para', 'son', 'valen', 'vale', 'cuesta',
  'cuestan', 'unos', 'unas', 'como', 'hasta', 'desde', 'sobre', 'entre', 'que',
  'las', 'los', 'una', 'uno', 'mas', 'ref', 'cantidad', 'precio', 'total',
  'oz', 'ml', 'cm', 'mm', 'gr', 'kg', 'unidades', 'unidad', 'hojas', 'paneles',
  // Letras sueltas, ahora que un codigo puede empezar con una sola: «x» es la
  // de las medidas y las demas son palabras enteras del español.
  'x', 'y', 'o', 'a', 'e', 'u', 'talla', 'tallas',
]);

export function referenciasEnElTexto(texto: string): string[] {
  const t = String(texto || '');
  const crudos = [...(t.match(CODIGO_CON_GUION) || []), ...(t.match(CODIGO_PEGADO) || [])];
  const out: string[] = [];
  for (const c of crudos) {
    const letras = (c.match(/^[A-Za-z]+/) || [''])[0];
    if (NO_SON_REFERENCIAS.has(letras.toLowerCase())) continue;

    const tieneDigito = /\d/.test(c);
    const enMayusculas = letras === letras.toUpperCase();
    // Con dígito es candidato seguro. Sin dígito solo si viene en mayúsculas,
    // como HELIX-BAM: así «auto-adhesivo» no se toma por una referencia.
    if (!tieneDigito && !enMayusculas) continue;
    // «de 10» lleva espacio y va en minúsculas: no es un código. «MU 180» sí.
    if (/\s/.test(c) && !enMayusculas) continue;

    const norm = normalizarCodigo(c);
    // TRES caracteres, no cuatro: «N-46» y «S-1» son referencias reales del
    // catalogo de sellos. Por debajo de tres, cualquier cosa parece un codigo.
    if (norm.length < 3) continue;
    if (!out.includes(norm)) out.push(norm);
  }
  return out.slice(0, 5);
}

/**
 * Busca productos activos por su código, tolerando puntos, espacios y guiones
 * de más o de menos. Devuelve el mismo formato que el buscador normal para que
 * el resto del sistema no note la diferencia.
 */
export async function buscarPorReferencia(codigos: string[], orgId?: string): Promise<any[]> {
  const pedidos = (codigos || []).map(normalizarCodigo).filter((c) => c.length >= 4);
  if (pedidos.length === 0) return [];

  try {
    const supabase = createAdminClient();

    /**
     * Se filtra por las LETRAS del código, no por sus primeros caracteres.
     *
     * Con `slice(0,3)` sobre el código ya normalizado, «MU-303-1» quedaba como
     * «MU3» y se buscaba `reference.ilike.%MU3%` — que **no** encuentra
     * `MU-303-1.`, porque el guion está en medio. Ese detalle dejó el arreglo
     * sin efecto en la primera prueba: el registro decía «el cliente nombró una
     * referencia que no está en el catálogo» sobre una que sí está.
     */
    // OJO CON EL COMODÍN. Dentro de `.or(...)` la condición viaja tal cual en la
    // dirección web, y ahí el comodín es `*`, no `%`: un `%` se interpreta como
    // el comienzo de un carácter escapado y la consulta no devuelve nada. Es lo
    // que hizo que el primer arreglo de la MU-303-1 no tuviera ningún efecto.
    /**
     * SE BUSCA CON Y SIN EL «ZM-» DELANTE.
     *
     * Todo producto de ZOOM lleva el prefijo `ZM-`: es lo que hace que el bot
     * lo ofrezca por encima de un importado (`es_propio`). Pero el cliente
     * —y el propio dueño— usan el código de la lista de precios, que va sin
     * prefijo: pide «el sello S-841», no «ZM-S-841». Las dos formas tienen que
     * llevar al mismo producto, así que se busca por las dos.
     */
    // Al normalizar se pierde el guion, así que «ZM-S-841» llega como «ZMS841»
    // y sus «letras» serían «ZMS», que no existe. Se le quita el prefijo antes
    // de mirar: así «S-841» y «ZM-S-841» generan el mismo filtro.
    const letrasDe = (c: string) => {
      const base = c.replace(/^ZM/, '') || c;
      return (base.match(/^[A-Z]+/) || [''])[0] || base.slice(0, 2);
    };
    const filtros = [
      ...new Set(
        pedidos.flatMap((c) => {
          const letras = letrasDe(c);
          if (!letras) return [];
          return [`reference.ilike.${letras}*`, `reference.ilike.ZM-${letras}*`];
        })
      ),
    ].join(',');
    // `requires_area` NO es columna de products: pedirla devolvía un error 400 y
    // la consulta se quedaba vacía **sin avisar**. El registro decía «esa
    // referencia no está en el catálogo» sobre una que sí está. Por eso ahora
    // el error se mira y se escribe: un fallo mudo cuesta una tarde.
    const { data: candidatos, error: errBusqueda } = await (supabase as any)
      .from('products')
      .select('id, reference, name, unit, description, notes, image_url, category_id')
      .eq('active', true)
      .or(filtros)
      .limit(1000);

    if (errBusqueda) {
      logger.error('La búsqueda por referencia falló en la base', {
        filtros, error: errBusqueda.message || String(errBusqueda),
      });
      return [];
    }

    const encontrados: any[] = [];
    // El «ZM» del principio es nuestro, no del código: «S-841» tiene que
    // encontrar «ZM-S-841». Se compara primero tal cual —por si algún día
    // existieran las dos— y solo después sin el prefijo.
    const sinPrefijo = (c: string) => c.replace(/^ZM/, '');
    for (const pedido of pedidos) {
      const exacto =
        (candidatos || []).find((p: any) => normalizarCodigo(p.reference) === pedido) ||
        (candidatos || []).find(
          (p: any) => sinPrefijo(normalizarCodigo(p.reference)) === sinPrefijo(pedido)
        );
      if (exacto && !encontrados.some((e) => e.id === exacto.id)) encontrados.push(exacto);
    }
    if (encontrados.length === 0) return [];

    // El nombre de la categoría, para que la hoja correcta le quede pegada.
    const catIds = [...new Set(encontrados.map((p: any) => p.category_id).filter(Boolean))];
    const nombrePorId = new Map<string, string>();
    if (catIds.length > 0) {
      const { data: cats } = await (supabase as any).from('categories').select('id, name').in('id', catIds);
      for (const c of cats || []) nombrePorId.set(String(c.id), String(c.name || ''));
    }

    let matches = encontrados.map((p: any) => ({
      product_id: p.reference,
      es_propio: String(p.reference || '').toUpperCase().startsWith('ZM-'),
      protegido: true, // lo nombró el cliente: ningún filtro puede quitarlo
      category: nombrePorId.get(String(p.category_id)) || '',
      name: limpiarNombre(p.name),
      unit: p.unit || 'unidad',
      description: stripPrices(p.description || ''),
      instrucciones_venta: '',
      notes: stripPrices(p.notes || ''),
      requires_area: false,
      image_urls: p.image_url ? [p.image_url] : [],
      score: 99,
      has_pricing: false,
      max_price: 0,
      is_most_expensive: false,
    }));

    matches = await annotateMatchesWithPricing(supabase, matches);
    matches = await adjuntarGuiaDeVenta(matches, orgId);

    logger.info('Búsqueda por referencia exacta', {
      pidio: pedidos.join(','),
      encontro: matches.map((m: any) => `${m.product_id}:${m.name}`).join(' | '),
    });
    return matches;
  } catch (err) {
    logger.warn('No se pudo buscar por referencia', { error: String(err) });
    return [];
  }
}

/**
 * El importador de Excel dejó 58 nombres con un punto pegado adelante o atrás
 * («.Mug Metálico Wilem 380ml II»). Se le muestran así al cliente. Se limpian
 * al vuelo mientras se corrigen en la base, que es donde toca arreglarlos.
 */
function limpiarNombre(n: string): string {
  const t = String(n || '');
  // Los «...» del final NO se tocan: 24 nombres del catálogo vienen recortados
  // del Excel y los puntos suspensivos son lo único que avisa que hay más texto.
  // Quitarlos deja el nombre partido a mitad de palabra («…color cr»).
  const cola = /\.{3}$/.test(t.trim()) ? '' : '[\\s.·-]+$';
  let out = t.replace(/^[\s.·-]+/, '');
  if (cola) out = out.replace(new RegExp(cola), '');
  return out.replace(/\s{2,}/g, ' ').trim();
}

export function searchCatalogTool(ctx?: { orgId?: string; mensajeDelCliente?: string }) {
  return tool({
    description:
      'Busca productos en el catalogo por nombre, categoria o descripcion. Devuelve el ID del producto (product_id), nombre y unidad de medida. Usalo SIEMPRE para identificar de que producto habla el cliente antes de pedir el precio.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'El termino de busqueda del producto (ej. "llavero plastisol", "mug magico", "gorra dril").',
        },
      },
      required: ['query'],
    }),
    execute: async (args: any) =>
      runCatalogSearch(String(args.query || ''), ctx?.orgId, ctx?.mensajeDelCliente),
  } as any);
}

/**
 * Ejecuta la busqueda del catalogo. Se exporta para que el agente pueda
 * lanzarla de forma DETERMINISTA con las palabras del cliente, sin depender de
 * que el modelo decida llamar a la herramienta: en produccion no la llamaba y
 * respondia "eso no lo manejamos" sobre productos que si existen.
 */
export async function runCatalogSearch(
  rawQueryInput: string,
  orgId?: string,
  mensajeDelCliente?: string
): Promise<any> {
      const pedido = String(rawQueryInput || '').trim();

      if (!pedido) {
        return { success: false, error: 'Debes enviar un termino de busqueda.' };
      }

      // TODA consulta pasa por las hojas del panel, venga del sistema o del
      // modelo. Es lo que impide que el modelo se vaya por su cuenta con la
      // palabra del cliente: medido el 10-ago, buscando «esferos» el motor
      // devuelve una *Alcancía Esfera* entre las tres primeras.
      const traducida = await traducirConsulta(orgId, pedido);
      const rawQuery = traducida.consulta;
      if (traducida.cambio) {
        logger.info('La hoja del panel tradujo la búsqueda', {
          escribio: pedido, seBuscoCon: rawQuery, hoja: traducida.hoja,
        });
      }

      const supabase = createAdminClient();

      // 0. ¿Vino un CÓDIGO? Se resuelve carácter a carácter, antes de todo. Es
      //    lo único que contesta bien a «el precio de la ref MU-303-1».
      const porCodigo = await buscarPorReferencia(referenciasEnElTexto(rawQuery), orgId);

      // 1. Intentar buscar en el microservicio RAG (Python FastAPI)
      try {
        const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8001';
        logger.info('Querying RAG microservice', { url: RAG_SERVICE_URL, query: rawQuery });

        const response = await fetch(`${RAG_SERVICE_URL}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: rawQuery, top_k: 15 }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          let products = (data.products || []).slice();

          let matches = products.map((prod: any) => ({
            product_id: prod.product_id,
            es_propio: prod.es_propio === true,
            category: prod.category || '',
            name: limpiarNombre(prod.name),
            unit: prod.unit || 'unidad',
            description: stripPrices(prod.description || ''),
            instrucciones_venta: prod.instrucciones_venta || '',
            notes: stripPrices(prod.notes || ''),
            requires_area: prod.requires_area || false,
            image_urls: prod.image_urls || [],
            score: prod.score,
            has_pricing: false,
            max_price: 0,
            is_most_expensive: false,
          }));

          matches = await annotateMatchesWithPricing(supabase, matches);
          matches = await adjuntarGuiaDeVenta(matches, orgId, pedido + " " + rawQuery, mensajeDelCliente);

          // El producto que el cliente nombró por su código va PRIMERO y no lo
          // toca ningún filtro posterior.
          if (porCodigo.length > 0) {
            const yaEstan = new Set(matches.map((m: any) => String(m.product_id).toUpperCase()));
            const nuevos = porCodigo.filter((p: any) => !yaEstan.has(String(p.product_id).toUpperCase()));
            for (const m of matches) {
              if (porCodigo.some((p: any) => String(p.product_id).toUpperCase() === String(m.product_id).toUpperCase())) {
                m.protegido = true;
              }
            }
            matches = [...porCodigo.filter((p: any) => !yaEstan.has(String(p.product_id).toUpperCase())), ...matches];
            if (nuevos.length > 0) {
              logger.info('searchCatalog: la referencia pedida se añadió a la propuesta', {
                query: rawQuery, añadidos: nuevos.map((n: any) => n.product_id).join(','),
              });
            }
          }

          // REDIRECCIÓN AUTOMÁTICA: si la categoría trae <2 productos con precio válido
          const pricedCount = matches.filter((m: any) => m.has_pricing).length;
          if (pricedCount < 2) {
            const sister = SISTER_CATEGORY[rawQuery.toLowerCase().trim()] || SISTER_CATEGORY[removeAccentsSimple(rawQuery.toLowerCase().trim())];
            if (sister) {
              try {
                const sisterResp = await fetch(`${RAG_SERVICE_URL}/query`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ query: sister, top_k: 15 }),
                });
                if (sisterResp.ok) {
                  const sisterData = (await sisterResp.json()) as any;
                  const sisterProds = (sisterData.products || []).slice();
                  const existingIds = new Set(matches.map((m: any) => m.product_id));
                  
                  const sisterMatches = sisterProds
                    .filter((sp: any) => !existingIds.has(sp.product_id))
                    .map((sp: any) => ({
                      product_id: sp.product_id,
                      category: sp.category || '',
                      name: sp.name,
                      unit: sp.unit || 'unidad',
                      description: stripPrices(sp.description || ''),
                      notes: stripPrices(sp.notes || ''),
                      requires_area: sp.requires_area || false,
                      image_urls: sp.image_urls || [],
                      score: sp.score,
                      has_pricing: false,
                      max_price: 0,
                      is_most_expensive: false,
                    }));

                  if (sisterMatches.length > 0) {
                    matches = [...matches, ...sisterMatches];
                    matches = await annotateMatchesWithPricing(supabase, matches);
                    matches = await adjuntarGuiaDeVenta(matches, orgId, pedido + " " + rawQuery, mensajeDelCliente);
                    logger.info('Auto-redirect to sister category', { from: rawQuery, to: sister, added: sisterMatches.length });
                  }
                }
              } catch {}
            }
          }

          // Reordenar: lo que el cliente pidió por su código va primero SIEMPRE;
          // después los cotizables (con precio) y luego el resto.
          matches.sort((a: any, b: any) =>
            (Number(!!b.protegido) - Number(!!a.protegido)) ||
            (Number(b.has_pricing) - Number(a.has_pricing)) ||
            ((b.score || 0) - (a.score || 0)));

          // ZOOM PRIMERO, DE FORMA DETERMINISTA.
          // El embudo obliga a ofrecer el producto más caro como Premium y los
          // importados cuestan hasta 10 veces más que los propios, así que la
          // propuesta salía con 2 importados y 1 ZOOM aunque el motor devolviera
          // los propios en cabeza. Si hay 3 o más propios cotizables, el modelo
          // solo recibe propios: no puede ofrecer lo que no se le entregó.
          //
          // EXCEPCIÓN: si el cliente nombró un producto por su código, ese
          // producto se queda aunque sea importado. Preferir lo propio es una
          // política comercial; ignorar lo que el cliente pidió con nombre y
          // apellido es perder la venta (medido el 10-ago con la MU-303-1).
          const propiosCotizables = matches.filter((m: any) => m.es_propio && m.has_pricing);
          if (propiosCotizables.length >= 3) {
            const soloPropios = matches.filter((m: any) => m.es_propio || m.protegido);
            logger.info('searchCatalog: propuesta restringida a producción propia ZOOM', {
              query: rawQuery, propios: soloPropios.length, descartados: matches.length - soloPropios.length,
              protegidos: soloPropios.filter((m: any) => m.protegido).length,
            });
            matches = soloPropios;
            // El Premium se recalcula dentro del conjunto entregado.
            for (const m of matches) m.is_most_expensive = false;
            matches = await annotateMatchesWithPricing(supabase, matches);
            matches = await adjuntarGuiaDeVenta(matches, orgId, pedido + " " + rawQuery, mensajeDelCliente);
            matches.sort((a: any, b: any) =>
              (Number(!!b.protegido) - Number(!!a.protegido)) ||
              (Number(b.has_pricing) - Number(a.has_pricing)) ||
              ((b.score || 0) - (a.score || 0)));
          }

          const cotizables = matches.filter((m: any) => m.has_pricing).length;
          marcarSugeridos(matches);
          logger.info('RAG microservice response success', {
            count: matches.length, cotizables,
            sugeridos: matches.filter((m: any) => m.sugerido).map((m: any) => `${m.sugerido}:${m.name}`).join(' | '),
          });

          // El modelo nunca ve cifras: max_price solo sirvió para ordenar aquí.
          const payload = matches.map(({ max_price, is_most_expensive, ...rest }: any) => rest);

          return {
            success: true,
            query: rawQuery,
            matches: payload,
            note: 'Estos son los ÚNICOS productos que puedes nombrar. Ofrece EXACTAMENTE los 3 marcados con "sugerido" (1, 2 y 3) y en ESE orden: el 1 va primero. No busques el más caro del catálogo, no etiquetes ninguna opción como Premium ni por gama, y no fuerces precios altos. Este resultado NO trae precios: llama getProductPrice con cada product_id antes de responder.',
          };
        } else {
          logger.warn(`RAG microservice returned status ${response.status}, falling back to database search`);
        }
      } catch (err: any) {
        logger.warn('Failed to connect to RAG microservice, falling back to database search', { error: err.message || String(err) });
      }

      // 2. Fallback original a Supabase / Postgres
      const query = rawQuery.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).join(' & ');

      try {
        const { data, error } = await (supabase as any).rpc('search_products', { query: query, limit_n: 100 });

        if (error) {
          logger.error('Search catalog error', { error: error.message });
          return { success: false, error: `Error al buscar: ${error.message}` };
        }

        logger.info('Search catalog result (database)', { query, count: data?.length || 0 });

        if (!data || data.length === 0) {
          // Aunque el buscador por texto no encuentre nada, el código sí puede
          // haber dado con el producto exacto.
          if (porCodigo.length > 0) {
            marcarSugeridos(porCodigo);
            return {
              success: true,
              query,
              matches: porCodigo.map(({ max_price, is_most_expensive, ...rest }: any) => rest),
              note: 'El cliente pidió estos productos por su código exacto. Son los que tienes que cotizar. Llama getProductPrice con cada product_id antes de responder.',
            };
          }
          return {
            success: true,
            query,
            matches: [],
            note: 'No se encontraron productos con ese término. Dile amablemente al cliente que te de un poco mas de detalles sobre el producto que busca o pregúntale si se refiere a otro artículo y trata de obtener mas informacion con 2 o 3 preguntas simples pero contundentes que te ayuden a descartar u obtener el producto que necesita o algo similar que pueda estar buscando el cliente para poder ayudarle.'
          };
        }

        let matches = data.slice(0, 40).map((row: any) => ({
          product_id: row.id,
          category: row.category,
          name: limpiarNombre(row.name),
          unit: row.unit,
          description: stripPrices(row.description || ''),
          instrucciones_venta: row.instrucciones_venta || '',
          notes: stripPrices(row.notes || ''),
          requires_area: row.requires_area,
          image_urls: [],
          has_pricing: false,
          max_price: 0,
          is_most_expensive: false,
        }));

        matches = await annotateMatchesWithPricing(supabase, matches);
        matches = await adjuntarGuiaDeVenta(matches, orgId, pedido + " " + rawQuery, mensajeDelCliente);

        if (porCodigo.length > 0) {
          const yaEstan = new Set(matches.map((m: any) => String(m.product_id).toUpperCase()));
          matches = [...porCodigo.filter((p: any) => !yaEstan.has(String(p.product_id).toUpperCase())), ...matches];
        }

        // Reordenar: primero lo pedido por código, después lo cotizable.
        matches.sort((a: any, b: any) =>
          (Number(!!b.protegido) - Number(!!a.protegido)) ||
          (Number(b.has_pricing) - Number(a.has_pricing)));
        marcarSugeridos(matches);

        const payload = matches.map(({ max_price, is_most_expensive, ...rest }: any) => rest);

        return {
          success: true,
          query,
          matches: payload,
          note: 'Estos son los ÚNICOS productos que puedes nombrar. Ofrece EXACTAMENTE los 3 marcados con "sugerido" (1, 2 y 3) y en ESE orden: el 1 va primero. No busques el más caro del catálogo, no etiquetes ninguna opción como Premium ni por gama, y no fuerces precios altos. Este resultado NO trae precios: llama getProductPrice con cada product_id antes de responder.',
        };
      } catch (err: any) {
        logger.error('Search catalog exception', { error: String(err) });
        return { success: false, error: err.message || String(err) };
      }
}
