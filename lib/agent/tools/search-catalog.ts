import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { hojaDeCategoria, textoDeHoja } from '../hojas';

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
  top3.forEach((m: any, i: number) => { m.sugerido = i + 1; });
}


/**
 * Le pega a cada producto la GUIA DE VENTA de su categoria, que el dueño
 * escribio en el panel. Es dato de recuperacion, no una instruccion metida en
 * el prompt: llena el hueco de `instrucciones_venta`, que el prompt mandaba
 * obedecer dos veces y NUNCA existio.
 *
 * Sin hojas cargadas no toca nada y el bot se comporta exactamente como antes.
 */
async function adjuntarGuiaDeVenta(matches: any[], orgId?: string): Promise<any[]> {
  if (!orgId || !Array.isArray(matches) || matches.length === 0) return matches;
  try {
    const cache = new Map<string, string>();
    for (const m of matches) {
      const cat = String(m?.category || '');
      if (!cache.has(cat)) {
        cache.set(cat, textoDeHoja(await hojaDeCategoria(orgId, cat)));
      }
      const guia = cache.get(cat) || '';
      if (guia) m.guia_de_venta = guia;
    }
  } catch (err) {
    logger.warn('No se pudo adjuntar la guia de venta', { error: String(err) });
  }
  return matches;
}
export function searchCatalogTool(ctx?: { orgId?: string }) {
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
    execute: async (args: any) => runCatalogSearch(String(args.query || ''), ctx?.orgId),
  } as any);
}

/**
 * Ejecuta la busqueda del catalogo. Se exporta para que el agente pueda
 * lanzarla de forma DETERMINISTA con las palabras del cliente, sin depender de
 * que el modelo decida llamar a la herramienta: en produccion no la llamaba y
 * respondia "eso no lo manejamos" sobre productos que si existen.
 */
export async function runCatalogSearch(rawQueryInput: string, orgId?: string): Promise<any> {
      const rawQuery = String(rawQueryInput || '').trim();

      if (!rawQuery) {
        return { success: false, error: 'Debes enviar un termino de busqueda.' };
      }

      const supabase = createAdminClient();

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
            name: prod.name,
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
          matches = await adjuntarGuiaDeVenta(matches, orgId);

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
                    matches = await adjuntarGuiaDeVenta(matches, orgId);
                    logger.info('Auto-redirect to sister category', { from: rawQuery, to: sister, added: sisterMatches.length });
                  }
                }
              } catch {}
            }
          }

          // Reordenar: primero los cotizables (con precio), luego el resto.
          matches.sort((a: any, b: any) => (Number(b.has_pricing) - Number(a.has_pricing)) || ((b.score || 0) - (a.score || 0)));

          // ZOOM PRIMERO, DE FORMA DETERMINISTA.
          // El embudo obliga a ofrecer el producto más caro como Premium y los
          // importados cuestan hasta 10 veces más que los propios, así que la
          // propuesta salía con 2 importados y 1 ZOOM aunque el motor devolviera
          // los propios en cabeza. Si hay 3 o más propios cotizables, el modelo
          // solo recibe propios: no puede ofrecer lo que no se le entregó.
          const propiosCotizables = matches.filter((m: any) => m.es_propio && m.has_pricing);
          if (propiosCotizables.length >= 3) {
            const soloPropios = matches.filter((m: any) => m.es_propio);
            logger.info('searchCatalog: propuesta restringida a producción propia ZOOM', {
              query: rawQuery, propios: soloPropios.length, descartados: matches.length - soloPropios.length,
            });
            matches = soloPropios;
            // El Premium se recalcula dentro del conjunto entregado.
            for (const m of matches) m.is_most_expensive = false;
            matches = await annotateMatchesWithPricing(supabase, matches);
            matches = await adjuntarGuiaDeVenta(matches, orgId);
            matches.sort((a: any, b: any) => (Number(b.has_pricing) - Number(a.has_pricing)) || ((b.score || 0) - (a.score || 0)));
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
          name: row.name,
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
        matches = await adjuntarGuiaDeVenta(matches, orgId);

        // Reordenar
        matches.sort((a: any, b: any) => (Number(b.has_pricing) - Number(a.has_pricing)));
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
