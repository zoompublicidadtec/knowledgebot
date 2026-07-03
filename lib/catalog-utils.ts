/**
 * Pure client-safe helpers for the catalog UI.
 *
 * IMPORTANT: This file must NOT be marked 'use server', because it is imported
 * by client components (CatalogTable etc.). The 'use server' actions module
 * cannot export sync functions for client use, so pure utilities live here.
 */

export function computeDisplayPrice(
  tiers:
    | Array<{
        variant?: string;
        min_qty?: number | string;
        max_qty?: number | string | null;
        price?: number | string | null;
        price_basis?: string | null;
      }>
    | undefined
    | null
): { price: number; basis: string } | null {
  if (!tiers || tiers.length === 0) return null;
  const clean = tiers
    .map((t) => ({
      variant: t.variant || 'Estándar',
      min_qty: Number(t.min_qty ?? 1),
      price: Number(t.price ?? 0),
      basis: t.price_basis || 'unitario',
    }))
    .filter((t) => Number.isFinite(t.price) && t.price > 0 && t.price < 1e9);
  if (clean.length === 0) return null;
  // Prefer "Estándar" variant, then the entry-level (smallest min_qty) tier.
  const estandar = clean.filter(
    (t) => t.variant.toLowerCase() === 'estándar' || t.variant.toLowerCase() === 'estandar'
  );
  const pool = estandar.length > 0 ? estandar : clean;
  const entry = pool.reduce((best, cur) => (cur.min_qty < best.min_qty ? cur : best), pool[0]);
  return { price: entry.price, basis: entry.basis };
}
