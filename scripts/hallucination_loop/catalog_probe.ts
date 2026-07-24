/**
 * ============================================================================
 * CATALOG_PROBE.TS — Lectura de productos REALES de Supabase de producción
 * ============================================================================
 * Para cada categoría del seed, consulta la tabla `products` + `price_tiers`
 * de Supabase y devuelve los productos cotizables con sus precios reales.
 *
 * Estos datos son la VERDAD que los verificadores usarán para decidir si
 * el bot alucinó o si el guardrail disparó un falso positivo.
 *
 * NO escribe en la base de datos. Solo SELECT.
 * ============================================================================
 */

import { createAdminClient } from '../../lib/supabase/admin';
import { CategorySeed } from './products';

export interface PriceTier {
  variant: string;
  min_qty: number;
  max_qty: number | null;
  price: number;
  price_basis: string;
  currency: string;
}

export interface CatalogProduct {
  product_id: string;   // UUID real de Supabase
  reference: string | null;
  name: string;
  unit: string;
  has_pricing: boolean;
  /** Todos los precios válidos del producto (para validación del guardrail). */
  realPrices: number[];
  /** Precio unitario máximo (para ordenar y comparar). */
  maxPrice: number;
  tiers: PriceTier[];
}

/**
 * Convierte un tier crudo de Supabase en un número saneado.
 * Descarta precios corruptos (>$1e9, negativos, no finitos) — mismo criterio
 * que la salvaguarda anti-precio-corrupto de getProductPriceTool.
 */
function sanePrice(p: any): number | null {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0 || n > 1e9) return null;
  return n;
}

/**
 * Para una categoría dada, busca productos en Supabase cuyo nombre/search_text
 * coincida con alguno de los searchTerms, y los enriquece con sus price_tiers.
 *
 * Devuelve hasta `limit` productos ordenados por: tener precio (desc) y luego
 * por precio máximo (desc) — mismo criterio de relevancia del bot.
 */
export async function probeCategory(seed: CategorySeed, limit = 3): Promise<CatalogProduct[]> {
  const supabase = createAdminClient();

  // 1. Buscar productos por OR de ILIKE sobre todos los searchTerms
  const orFilter = seed.searchTerms
    .map((t) => `name.ilike.%${t}%,search_text.ilike.%${t}%`)
    .join(',');

  const { data: products, error } = await (supabase as any)
    .from('products')
    .select('id, reference, name, unit, search_text')
    .or(orFilter)
    .eq('active', true)
    .limit(50);

  if (error || !products || products.length === 0) {
    console.warn(`[catalog_probe] Sin productos para "${seed.name}" (${seed.searchTerms.join(', ')})`);
    return [];
  }

  // 2. Traer los price_tiers de TODOS los productos encontrados en una sola query
  const ids = products.map((p: any) => p.id);
  const { data: tiers, error: tierErr } = await (supabase as any)
    .from('price_tiers')
    .select('product_id, variant, min_qty, max_qty, price, price_basis, currency')
    .in('product_id', ids);

  if (tierErr) {
    console.warn(`[catalog_probe] Error leyendo price_tiers: ${tierErr.message}`);
  }

  // 3. Agrupar tiers por product_id y construir CatalogProduct[]
  const tiersByProduct = new Map<string, PriceTier[]>();
  for (const t of tiers || []) {
    const price = sanePrice(t.price);
    if (price === null) continue; // descartar corruptos
    const arr = tiersByProduct.get(t.product_id) || [];
    arr.push({
      variant: t.variant,
      min_qty: Number(t.min_qty),
      max_qty: t.max_qty ? Number(t.max_qty) : null,
      price,
      price_basis: t.price_basis,
      currency: t.currency,
    });
    tiersByProduct.set(t.product_id, arr);
  }

  const result: CatalogProduct[] = products.map((p: any) => {
    const productTiers = tiersByProduct.get(p.id) || [];
    const realPrices = productTiers.map((t) => t.price);
    const maxPrice = realPrices.length > 0 ? Math.max(...realPrices) : 0;
    return {
      product_id: p.id,
      reference: p.reference,
      name: p.name,
      unit: p.unit || 'unidad',
      has_pricing: realPrices.length > 0,
      realPrices,
      maxPrice,
      tiers: productTiers,
    };
  });

  // 4. Ordenar: con precio primero, luego por precio máximo descendente
  result.sort((a, b) => {
    if (a.has_pricing !== b.has_pricing) return a.has_pricing ? -1 : 1;
    return b.maxPrice - a.maxPrice;
  });

  return result.slice(0, limit);
}

/**
 * Verifica salud del servicio RAG (puerto 8001) sin fallar si no responde.
 * Útil para diagnosticar la Causa C (RAG caído en producción).
 */
export async function checkRagHealth(): Promise<{ online: boolean; latencyMs: number | null }> {
  const ragUrl = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8001';
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${ragUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return { online: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { online: false, latencyMs: null };
  }
}
