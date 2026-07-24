import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function fetchAll(table: string, select: string): Promise<any[]> {
  const results: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

async function run() {
  console.log('=== NUCLEAR DEDUP: Cargando TODO ===\n');

  // Load all products
  const allProducts = await fetchAll('products', 'id, name, reference, category_id, description, min_order_qty');
  console.log(`Total productos: ${allProducts.length}`);

  // Load all price_tiers
  const allTiers = await fetchAll('price_tiers', 'id, product_id, variant, min_qty, max_qty, price, price_basis, currency');
  console.log(`Total price_tiers: ${allTiers.length}`);

  // Index tiers by product_id
  const tiersByProduct = new Map<string, any[]>();
  for (const t of allTiers) {
    if (!tiersByProduct.has(t.product_id)) tiersByProduct.set(t.product_id, []);
    tiersByProduct.get(t.product_id)!.push(t);
  }

  // Group products by reference
  const byRef = new Map<string, any[]>();
  for (const p of allProducts) {
    const ref = p.reference || p.id;
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref)!.push(p);
  }

  const duplicated = [...byRef.entries()].filter(([, prods]) => prods.length > 1);
  console.log(`\nReferencias con duplicados: ${duplicated.length}`);

  const idsToDelete: string[] = [];
  const tiersToReassign: { tierId: string; newProductId: string }[] = [];

  for (const [ref, prods] of duplicated) {
    // Pick the "keeper": prefer the one that has price_tiers, otherwise pick first
    let keepIdx = 0;
    for (let i = 0; i < prods.length; i++) {
      const tiers = tiersByProduct.get(prods[i].id);
      if (tiers && tiers.length > 0) {
        keepIdx = i;
        break;
      }
    }

    const keepId = prods[keepIdx].id;

    for (let i = 0; i < prods.length; i++) {
      if (i === keepIdx) continue;
      const dupId = prods[i].id;

      // Reassign any tiers from this duplicate to the keeper
      const dupTiers = tiersByProduct.get(dupId) || [];
      for (const t of dupTiers) {
        tiersToReassign.push({ tierId: t.id, newProductId: keepId });
      }

      idsToDelete.push(dupId);
    }
  }

  console.log(`Productos a eliminar: ${idsToDelete.length}`);
  console.log(`Tiers a reasignar: ${tiersToReassign.length}`);

  // Reassign tiers first
  for (const { tierId, newProductId } of tiersToReassign) {
    await supabase.from('price_tiers').update({ product_id: newProductId }).eq('id', tierId);
  }
  console.log('Tiers reasignados.');

  // Delete duplicate products in batches (cascade will delete any remaining tiers)
  for (let i = 0; i < idsToDelete.length; i += 100) {
    const batch = idsToDelete.slice(i, i + 100);
    const { error } = await supabase.from('products').delete().in('id', batch);
    if (error) console.error(`Error eliminando batch ${i}:`, error.message);
    else console.log(`Eliminados ${Math.min(i + 100, idsToDelete.length)}/${idsToDelete.length} duplicados`);
  }

  // Now dedup price_tiers within each product
  console.log('\n=== Deduplicando price_tiers ===');
  const remainingTiers = await fetchAll('price_tiers', 'id, product_id, variant, min_qty, max_qty, price, price_basis');
  console.log(`Total tiers restantes: ${remainingTiers.length}`);

  const tierGroups = new Map<string, any[]>();
  for (const t of remainingTiers) {
    const key = `${t.product_id}|${t.variant}|${t.min_qty}|${t.max_qty}|${t.price}|${t.price_basis}`;
    if (!tierGroups.has(key)) tierGroups.set(key, []);
    tierGroups.get(key)!.push(t);
  }

  const dupTierIds: string[] = [];
  for (const [, tiers] of tierGroups) {
    for (let i = 1; i < tiers.length; i++) {
      dupTierIds.push(tiers[i].id);
    }
  }

  console.log(`Tiers duplicados a eliminar: ${dupTierIds.length}`);
  for (let i = 0; i < dupTierIds.length; i += 200) {
    const batch = dupTierIds.slice(i, i + 200);
    await supabase.from('price_tiers').delete().in('id', batch);
  }

  // Final verification
  const { count: finalProd } = await supabase.from('products').select('*', { count: 'exact', head: true });
  const { count: finalTier } = await supabase.from('price_tiers').select('*', { count: 'exact', head: true });
  console.log(`\n=== RESULTADO FINAL ===`);
  console.log(`Productos únicos: ${finalProd}`);
  console.log(`Price tiers únicos: ${finalTier}`);

  // Verify MU-145
  console.log('\n=== VERIFICACIÓN MU-145 ===');
  const { data: zenith } = await supabase.from('products').select('id, name').eq('reference', 'MU-145');
  console.log(`MU-145 registros: ${zenith?.length}`);
  if (zenith && zenith.length > 0) {
    const { data: rpc } = await (supabase as any).rpc('get_product_price_tiers', { p_product_id: zenith[0].id });
    console.log(`RPC para ${zenith[0].id}: ${JSON.stringify(rpc)}`);
  }

  // Verify MU-298
  console.log('\n=== VERIFICACIÓN MU-298 ===');
  const { data: bamboo } = await supabase.from('products').select('id, name').eq('reference', 'MU-298');
  console.log(`MU-298 registros: ${bamboo?.length}`);
  if (bamboo && bamboo.length > 0) {
    const { data: rpc } = await (supabase as any).rpc('get_product_price_tiers', { p_product_id: bamboo[0].id });
    console.log(`RPC para ${bamboo[0].id}: ${JSON.stringify(rpc)}`);
  }
}

run().catch(console.error);
