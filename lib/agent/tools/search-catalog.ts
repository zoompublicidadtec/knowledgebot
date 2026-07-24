/**
 * ============================================================================
 * SEARCH-CATALOG.TS — Búsqueda del Catálogo (cliente del Motor RAG Python)
 * ============================================================================
 *
 * ── VERDADES ARQUITECTÓNICAS ───────────────────────────────────────────────
 * 1. Llama al Motor RAG Python en http://127.0.0.1:8001/query (POST {query,
 *    top_k:15}). Si ese servicio cae, hace fallback a la RPC search_products
 *    de Supabase (búsqueda trigram/tsvector, NO vectorial).
 *
 * 2. El campo `price` que devuelve el Motor Python es DECORATIVO: viene del
 *    JSON legacy (all_products.json) y NO se usa para ranking ni pricing. El
 *    ranking real y el flag has_pricing/is_most_expensive se calculan acá en
 *    annotateMatchesWithricing() consultando la tabla price_tiers de Supabase.
 *    La fuente canónica de precios SIEMPRE es getProductPrice (otra tool).
 *
 * 3. La noción de "preferente" del Motor Python (UUID = producción propia de
 *    ZOOM) NO viaja hasta acá: este archivo no lee ni escribe `preferente`.
 *    El reordenamiento que hace el bot es por has_pricing + score.
 * ============================================================================
 */

import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

function removeAccentsSimple(t: string): string {
  return (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
      .select('product_id, price')
      .in('product_id', resolvedUuids)
      .limit(5000);

    const isSane = (p: any) => { const n = Number(p); return Number.isFinite(n) && n > 0 && n < 1e9; };

    const uuidMaxPrice = new Map<string, number>();
    for (const t of (tiers || [])) {
      if (isSane(t.price)) {
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

export function searchCatalogTool() {
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
    execute: async (args: any) => {
      const rawQuery = String(args.query || '').trim();

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
            category: prod.category || '',
            name: prod.name,
            unit: prod.unit || 'unidad',
            price: prod.price || '',
            description: prod.description || '',
            instrucciones_venta: prod.instrucciones_venta || '',
            notes: prod.notes || '',
            requires_area: prod.requires_area || false,
            image_urls: prod.image_urls || [],
            score: prod.score,
            has_pricing: false,
            max_price: 0,
            is_most_expensive: false,
          }));

          matches = await annotateMatchesWithPricing(supabase, matches);

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
                      price: sp.price || '',
                      description: sp.description || '',
                      notes: sp.notes || '',
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
                    logger.info('Auto-redirect to sister category', { from: rawQuery, to: sister, added: sisterMatches.length });
                  }
                }
              } catch {}
            }
          }

          // Reordenar: primero los cotizables (con precio), luego el resto.
          matches.sort((a: any, b: any) => (Number(b.has_pricing) - Number(a.has_pricing)) || ((b.score || 0) - (a.score || 0)));

          // Si hay productos con precio, filtrar para no enviar productos incompletos/sin precio que causen evasivas
          const pricedMatches = matches.filter((m: any) => m.has_pricing);
          if (pricedMatches.length > 0) {
            matches = pricedMatches;
          }

          // Enmascarar product_id a la referencia comercial limpia (ZM-MUG-001, MU-302, etc.)
          const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
          matches = matches.map((m: any) => {
            const pid = String(m.product_id || '').trim();
            const refCorta = (m.reference && !isUUID(m.reference)) ? m.reference : (isUUID(pid) ? `REF-${pid.slice(0, 8).toUpperCase()}` : pid);
            return {
              ...m,
              product_id: refCorta,
              reference: refCorta,
            };
          });

          // Sanitizar rag_response para que el LLM jamás lea UUIDs en el texto crudo del RAG
          let cleanRagResponse = data.response || '';
          if (cleanRagResponse) {
            cleanRagResponse = cleanRagResponse.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, (uuidMatch: string) => {
              const matchedProd = matches.find((m: any) => m.product_id === uuidMatch || m.id === uuidMatch);
              return matchedProd?.reference || `REF-${uuidMatch.slice(0, 8).toUpperCase()}`;
            });
          }

          const cotizables = matches.filter((m: any) => m.has_pricing).length;
          logger.info('RAG microservice response success', { count: matches.length, cotizables });

          return {
            success: true,
            query: rawQuery,
            matches,
            rag_response: cleanRagResponse,
            note: 'Se ha realizado una búsqueda semántica usando el Motor de Conocimiento RAG. TU DEBES aplicar OBLIGATORIAMENTE la Fase 1 del Embudo Comercial: NO muestres todos los resultados. Selecciona y presenta EXACTAMENTE 3 opciones (Premium, Estándar, Económica) que apliquen a lo que pidió el cliente. PRIORIDAD OFICIAL ZOOM: Todos los productos presentados DEBEN tener has_pricing=true. Queda PROHIBIDO presentar productos sin tarifa o usar frases evasivas como "déjame confirmar con producción". FORMATO DE REFERENCIA: Muestra la referencia comercial limpia (ej: Ref: ZM-MUG-001 o Ref: MU-303-1). FOTOS E IMÁGENES: El sistema adjunta automáticamente la imagen por WhatsApp. Si el cliente pregunta por fotos o imágenes, responde afirmativamente con entusiasmo ("¡Claro que sí! Aquí te comparto la imagen del producto:") confirmando la foto adjunta.',
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

        let matches = data.slice(0, 100).map((row: any) => ({
          product_id: row.id,
          category: row.category,
          name: row.name,
          unit: row.unit,
          description: row.description,
          instrucciones_venta: row.instrucciones_venta || '',
          notes: row.notes,
          requires_area: row.requires_area,
          image_urls: [],
          has_pricing: false,
          max_price: 0,
          is_most_expensive: false,
        }));

        matches = await annotateMatchesWithPricing(supabase, matches);

        // Reordenar
        matches.sort((a: any, b: any) => (Number(b.has_pricing) - Number(a.has_pricing)));

        // Filtrar productos con precio si existen
        const pricedFallback = matches.filter((m: any) => m.has_pricing);
        if (pricedFallback.length > 0) {
          matches = pricedFallback;
        }

        // Enmascarar product_id a ref_corta
        const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
        matches = matches.map((m: any) => {
          const pid = String(m.product_id || '').trim();
          const refCorta = isUUID(pid) ? `REF-${pid.slice(0, 8).toUpperCase()}` : (m.reference || pid);
          return {
            ...m,
            product_id: refCorta,
            reference: refCorta,
          };
        });

        return {
          success: true,
          query,
          matches,
          note: 'OJO: He retornado resultados de la base de datos de fallback. Selecciona y presenta 3 opciones (Premium, Estándar, Económica) con has_pricing=true. FORMATO DE REFERENCIA: Usa la referencia corta (ej. Ref: REF-AE9573E1). FOTOS E IMÁGENES: El sistema adjunta automáticamente la imagen por WhatsApp. Responde con entusiasmo ("¡Claro que sí! Aquí te comparto la imagen del producto:").',
        };
      } catch (err: any) {
        logger.error('Search catalog exception', { error: String(err) });
        return { success: false, error: err.message || String(err) };
      }
    },
  } as any);
}
