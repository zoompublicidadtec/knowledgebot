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

async function dedup() {
  console.log('=== LIMPIEZA DE DUPLICADOS Y CONSOLIDACIÓN DE PRECIOS ===\n');

  // 1. Get ALL products
  const { data: allProducts, error: prodErr } = await supabase
    .from('products')
    .select('id, name, reference, category_id, description, min_order_qty, notes, search_text, active')
    .order('reference', { ascending: true });

  if (prodErr || !allProducts) {
    console.error('Error cargando productos:', prodErr);
    return;
  }
  console.log(`Total productos antes de limpieza: ${allProducts.length}`);

  // 2. Group by reference (the unique identifier)
  const byRef = new Map<string, typeof allProducts>();
  for (const p of allProducts) {
    const ref = p.reference || p.id; // products without ref are unique
    if (!byRef.has(ref)) byRef.set(ref, []);
    byRef.get(ref)!.push(p);
  }

  const duplicatedRefs = [...byRef.entries()].filter(([, prods]) => prods.length > 1);
  console.log(`Referencias duplicadas: ${duplicatedRefs.length}`);
  console.log(`Total productos duplicados a eliminar: ${duplicatedRefs.reduce((sum, [, prods]) => sum + prods.length - 1, 0)}`);

  // 3. For each duplicated reference, keep the one that has price_tiers, delete the rest
  let deletedProducts = 0;
  let movedTiers = 0;

  for (const [ref, prods] of duplicatedRefs) {
    // Find which one has price_tiers
    let keepId: string | null = null;
    let keepProduct: any = null;
    const toDelete: string[] = [];

    for (const p of prods) {
      const { count } = await supabase
        .from('price_tiers')
        .select('*', { count: 'exact', head: true })
        .eq('product_id', p.id);

      if (count && count > 0 && !keepId) {
        keepId = p.id;
        keepProduct = p;
      } else {
        toDelete.push(p.id);
      }
    }

    // If none had prices, keep the first one
    if (!keepId) {
      keepId = prods[0].id;
      keepProduct = prods[0];
      toDelete.length = 0;
      for (let i = 1; i < prods.length; i++) {
        toDelete.push(prods[i].id);
      }
    }

    // Move any price_tiers from duplicates to the keeper (just in case)
    for (const delId of toDelete) {
      const { data: orphanTiers } = await supabase
        .from('price_tiers')
        .select('id')
        .eq('product_id', delId);
      
      if (orphanTiers && orphanTiers.length > 0) {
        await supabase
          .from('price_tiers')
          .update({ product_id: keepId! })
          .eq('product_id', delId);
        movedTiers += orphanTiers.length;
      }
    }

    // Delete duplicates (price_tiers cascade will handle cleanup)
    if (toDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('products')
        .delete()
        .in('id', toDelete);
      
      if (delErr) {
        console.error(`Error eliminando duplicados de ${ref}:`, delErr.message);
      } else {
        deletedProducts += toDelete.length;
      }
    }
  }

  console.log(`\nProductos duplicados eliminados: ${deletedProducts}`);
  console.log(`Price tiers reasignados: ${movedTiers}`);

  // 4. Now deduplicate price_tiers within each product
  console.log('\n=== DEDUPLICANDO PRICE_TIERS ===');
  const { data: allTiers } = await supabase
    .from('price_tiers')
    .select('id, product_id, variant, min_qty, max_qty, price, price_basis, currency');

  if (!allTiers) {
    console.log('No se pudieron cargar price_tiers');
    return;
  }

  console.log(`Total price_tiers antes de limpieza: ${allTiers.length}`);

  // Group by product_id + variant + min_qty + price (exact duplicates)
  const tierGroups = new Map<string, typeof allTiers>();
  for (const t of allTiers) {
    const key = `${t.product_id}|${t.variant}|${t.min_qty}|${t.max_qty}|${t.price}|${t.price_basis}`;
    if (!tierGroups.has(key)) tierGroups.set(key, []);
    tierGroups.get(key)!.push(t);
  }

  const dupTierIds: string[] = [];
  for (const [, tiers] of tierGroups) {
    if (tiers.length > 1) {
      // Keep the first, delete the rest
      for (let i = 1; i < tiers.length; i++) {
        dupTierIds.push(tiers[i].id);
      }
    }
  }

  console.log(`Price tiers duplicados a eliminar: ${dupTierIds.length}`);

  // Delete in batches
  for (let i = 0; i < dupTierIds.length; i += 200) {
    const batch = dupTierIds.slice(i, i + 200);
    const { error } = await supabase
      .from('price_tiers')
      .delete()
      .in('id', batch);
    if (error) console.error('Error eliminando tiers duplicados:', error.message);
  }

  // 5. Final counts
  const { count: finalProd } = await supabase.from('products').select('*', { count: 'exact', head: true });
  const { count: finalTier } = await supabase.from('price_tiers').select('*', { count: 'exact', head: true });
  console.log(`\n=== RESULTADO FINAL ===`);
  console.log(`Productos: ${finalProd}`);
  console.log(`Price tiers: ${finalTier}`);

  // 6. Verify MU-145
  console.log('\n=== VERIFICACIÓN MU-145 ===');
  const { data: zenith } = await supabase
    .from('products')
    .select('id, name, reference')
    .eq('reference', 'MU-145');
  
  if (zenith && zenith.length > 0) {
    console.log(`MU-145 encontrado: ${zenith.length} registro(s)`);
    for (const z of zenith) {
      console.log(`  UUID: ${z.id} | ${z.name}`);
      const { data: tiers } = await supabase
        .from('price_tiers')
        .select('*')
        .eq('product_id', z.id);
      console.log(`  Price tiers: ${tiers?.length || 0}`);
      tiers?.forEach(t => console.log(`    ${t.variant} | qty ${t.min_qty}-${t.max_qty || '∞'} | $${t.price}`));
    }
  }

  // Also test via RPC
  if (zenith && zenith.length > 0) {
    console.log('\n=== TEST RPC DESPUÉS DE LIMPIEZA ===');
    const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc('get_product_price_tiers', {
      p_product_id: zenith[0].id
    });
    console.log('RPC error:', rpcErr);
    console.log('RPC resultado:', JSON.stringify(rpcResult));
  }
}

dedup().catch(console.error);
