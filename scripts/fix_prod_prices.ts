import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// *** PRODUCTION DATABASE ***
const PROD_SUPABASE_URL = 'https://moaekovebocnagxkkiwm.supabase.co';
const PROD_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(PROD_SUPABASE_URL, PROD_SERVICE_ROLE_KEY);

function parseCSV(content: string) {
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const results = [];
  
  for (let i = 1; i < lines.length; i++) {
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    const values = lines[i].split(regex).map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (values.length < 2) continue;
    
    const row: any = {};
    headers.forEach((h, index) => {
      row[h] = values[index] !== undefined ? values[index] : null;
      if (row[h] === '') row[h] = null;
    });
    results.push(row);
  }
  return results;
}

async function fetchAll(table: string, select: string): Promise<any[]> {
  const results: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) { console.error(`Error fetching ${table}:`, error.message); break; }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

async function run() {
  console.log('=== CONECTANDO A BASE DE DATOS DE PRODUCCIÓN ===');
  console.log(`URL: ${PROD_SUPABASE_URL}\n`);

  // 1. Check current state
  const { count: prodCount } = await supabase.from('products').select('*', { count: 'exact', head: true });
  const { count: tierCount } = await supabase.from('price_tiers').select('*', { count: 'exact', head: true });
  const { count: catCount } = await supabase.from('categories').select('*', { count: 'exact', head: true });
  console.log(`Estado actual: ${prodCount} productos, ${tierCount} price_tiers, ${catCount} categorías`);

  // 2. Check if MU-145 exists and has prices
  const { data: zenith } = await supabase.from('products').select('id, name, reference').eq('reference', 'MU-145');
  console.log(`MU-145 registros actuales: ${zenith?.length || 0}`);
  
  if (zenith && zenith.length > 0) {
    for (const z of zenith) {
      const { data: tiers } = await supabase.from('price_tiers').select('*').eq('product_id', z.id);
      console.log(`  ${z.id}: ${tiers?.length || 0} price_tiers`);
    }
  }

  // 3. Check if the RPC function exists
  console.log('\n=== PROBANDO FUNCIÓN RPC ===');
  if (zenith && zenith.length > 0) {
    const { data: rpc, error: rpcErr } = await (supabase as any).rpc('get_product_price_tiers', { p_product_id: zenith[0].id });
    if (rpcErr) {
      console.log(`RPC ERROR: ${rpcErr.message} (code: ${rpcErr.code})`);
      console.log('La función RPC no existe en producción - necesitamos crearla');
    } else {
      console.log(`RPC resultado: ${JSON.stringify(rpc)}`);
    }
  }

  // 4. Now load the full catalog CSV and check what's missing
  console.log('\n=== ANALIZANDO CSV ===');
  const csvPath = path.resolve(process.cwd(), 'data', 'catalogo_productos.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const allCSVProducts = parseCSV(csvContent);
  console.log(`Productos en CSV: ${allCSVProducts.length}`);

  // Deduplicate CSV by reference first
  const uniqueByRef = new Map<string, any>();
  for (const p of allCSVProducts) {
    if (p.referencia && !uniqueByRef.has(p.referencia)) {
      uniqueByRef.set(p.referencia, p);
    }
  }
  console.log(`Productos únicos por referencia en CSV: ${uniqueByRef.size}`);

  // Check which refs already exist in DB
  const existingProducts = await fetchAll('products', 'id, reference');
  const existingRefs = new Set(existingProducts.map(p => p.reference));
  
  const newRefs = [...uniqueByRef.entries()].filter(([ref]) => !existingRefs.has(ref));
  console.log(`Productos nuevos para insertar: ${newRefs.length}`);

  // 5. Get or create categories
  const uniqueCategories = [...new Set([...uniqueByRef.values()].map(p => p.categoria).filter(Boolean))];
  for (const catName of uniqueCategories) {
    const { data: existing } = await supabase.from('categories').select('id').eq('name', catName).single();
    if (!existing) {
      await supabase.from('categories').insert({ name: catName });
    }
  }
  
  const { data: categories } = await supabase.from('categories').select('*');
  const catMap = new Map(categories!.map(c => [c.name, c.id]));

  // 6. Insert new products
  if (newRefs.length > 0) {
    console.log('\n=== INSERTANDO PRODUCTOS NUEVOS ===');
    const productsToInsert = newRefs.map(([ref, p]) => {
      let minQty: number | null = null;
      const desc = p.descripcion || '';
      const match = desc.match(/Venta m.nima.*caja de (\d+)/i);
      if (match) minQty = parseInt(match[1]);

      return {
        reference: p.referencia,
        category_id: catMap.get(p.categoria),
        name: p.nombre,
        description: p.descripcion,
        notes: p.marca_tecnica,
        min_order_qty: minQty,
        search_text: `${p.referencia} ${p.nombre} ${p.categoria} ${p.descripcion}`.substring(0, 500)
      };
    });

    const insertedMap = new Map<string, string>();
    for (let i = 0; i < productsToInsert.length; i += 100) {
      const batch = productsToInsert.slice(i, i + 100);
      const { data, error } = await supabase.from('products').insert(batch).select('id, reference');
      if (error) console.error(`Error batch ${i}:`, error.message);
      else data?.forEach(d => insertedMap.set(d.reference!, d.id));
      console.log(`  Insertados ${Math.min(i + 100, productsToInsert.length)}/${productsToInsert.length}`);
    }

    // 7. Insert price_tiers for new products
    console.log('\n=== INSERTANDO PRECIOS PARA PRODUCTOS NUEVOS ===');
    const tiersToInsert: any[] = [];
    for (const [ref, p] of newRefs) {
      if (!p.precio) continue;
      const uuid = insertedMap.get(ref);
      if (!uuid) continue;

      let priceStr = p.precio.replace('$', '').replace(/\./g, '').replace(/,/g, '').trim();
      let priceNum = parseFloat(priceStr);
      if (isNaN(priceNum) || priceNum <= 0) continue;

      let minQty = 1;
      const desc = p.descripcion || '';
      const match = desc.match(/Venta m.nima.*caja de (\d+)/i);
      if (match) minQty = parseInt(match[1]);

      tiersToInsert.push({
        product_id: uuid,
        variant: 'Estándar',
        min_qty: minQty,
        max_qty: null,
        price: priceNum,
        price_basis: 'unitario',
        currency: 'COP',
        source_sheet: 'catalogo_productos.csv'
      });
    }

    for (let i = 0; i < tiersToInsert.length; i += 100) {
      const batch = tiersToInsert.slice(i, i + 100);
      const { error } = await supabase.from('price_tiers').insert(batch);
      if (error) console.error(`Error tiers batch ${i}:`, error.message);
    }
    console.log(`  Insertados ${tiersToInsert.length} price_tiers`);
  }

  // 8. Also ensure EXISTING products that DON'T have price_tiers get them from the CSV
  console.log('\n=== RELLENANDO PRECIOS FALTANTES EN PRODUCTOS EXISTENTES ===');
  const allProductsFinal = await fetchAll('products', 'id, reference');
  const allTiersFinal = await fetchAll('price_tiers', 'product_id');
  const productsWithTiers = new Set(allTiersFinal.map(t => t.product_id));
  
  const missingPriceProducts = allProductsFinal.filter(p => !productsWithTiers.has(p.id) && p.reference);
  console.log(`Productos existentes sin precios: ${missingPriceProducts.length}`);

  const fillTiers: any[] = [];
  for (const p of missingPriceProducts) {
    const csvProduct = uniqueByRef.get(p.reference);
    if (!csvProduct || !csvProduct.precio) continue;

    let priceStr = csvProduct.precio.replace('$', '').replace(/\./g, '').replace(/,/g, '').trim();
    let priceNum = parseFloat(priceStr);
    if (isNaN(priceNum) || priceNum <= 0) continue;

    let minQty = 1;
    const desc = csvProduct.descripcion || '';
    const match = desc.match(/Venta m.nima.*caja de (\d+)/i);
    if (match) minQty = parseInt(match[1]);

    fillTiers.push({
      product_id: p.id,
      variant: 'Estándar',
      min_qty: minQty,
      max_qty: null,
      price: priceNum,
      price_basis: 'unitario',
      currency: 'COP',
      source_sheet: 'catalogo_productos.csv'
    });
  }

  if (fillTiers.length > 0) {
    for (let i = 0; i < fillTiers.length; i += 100) {
      const batch = fillTiers.slice(i, i + 100);
      const { error } = await supabase.from('price_tiers').insert(batch);
      if (error) console.error(`Error fill tiers batch ${i}:`, error.message);
    }
    console.log(`  Rellenados ${fillTiers.length} precios faltantes`);
  }

  // 9. DEDUP products
  console.log('\n=== DEDUPLICANDO PRODUCTOS ===');
  const allProdsForDedup = await fetchAll('products', 'id, reference');
  const byRefDedup = new Map<string, any[]>();
  for (const p of allProdsForDedup) {
    const ref = p.reference || p.id;
    if (!byRefDedup.has(ref)) byRefDedup.set(ref, []);
    byRefDedup.get(ref)!.push(p);
  }

  const allTiersForDedup = await fetchAll('price_tiers', 'id, product_id');
  const tiersByProd = new Map<string, any[]>();
  for (const t of allTiersForDedup) {
    if (!tiersByProd.has(t.product_id)) tiersByProd.set(t.product_id, []);
    tiersByProd.get(t.product_id)!.push(t);
  }

  const idsToDelete: string[] = [];
  for (const [ref, prods] of byRefDedup) {
    if (prods.length <= 1) continue;
    let keepIdx = 0;
    for (let i = 0; i < prods.length; i++) {
      if ((tiersByProd.get(prods[i].id) || []).length > 0) { keepIdx = i; break; }
    }
    const keepId = prods[keepIdx].id;
    for (let i = 0; i < prods.length; i++) {
      if (i === keepIdx) continue;
      // Move tiers to keeper
      const dupTiers = tiersByProd.get(prods[i].id) || [];
      for (const t of dupTiers) {
        await supabase.from('price_tiers').update({ product_id: keepId }).eq('id', t.id);
      }
      idsToDelete.push(prods[i].id);
    }
  }

  if (idsToDelete.length > 0) {
    console.log(`Eliminando ${idsToDelete.length} duplicados...`);
    for (let i = 0; i < idsToDelete.length; i += 100) {
      const batch = idsToDelete.slice(i, i + 100);
      await supabase.from('products').delete().in('id', batch);
    }
  }

  // 10. Dedup price_tiers
  console.log('\n=== DEDUPLICANDO PRICE_TIERS ===');
  const finalTiers = await fetchAll('price_tiers', 'id, product_id, variant, min_qty, max_qty, price, price_basis');
  const tierGroupsDedup = new Map<string, any[]>();
  for (const t of finalTiers) {
    const key = `${t.product_id}|${t.variant}|${t.min_qty}|${t.max_qty}|${t.price}|${t.price_basis}`;
    if (!tierGroupsDedup.has(key)) tierGroupsDedup.set(key, []);
    tierGroupsDedup.get(key)!.push(t);
  }
  const dupTierIds: string[] = [];
  for (const [, tiers] of tierGroupsDedup) {
    for (let i = 1; i < tiers.length; i++) dupTierIds.push(tiers[i].id);
  }
  if (dupTierIds.length > 0) {
    console.log(`Eliminando ${dupTierIds.length} tiers duplicados...`);
    for (let i = 0; i < dupTierIds.length; i += 200) {
      const batch = dupTierIds.slice(i, i + 200);
      await supabase.from('price_tiers').delete().in('id', batch);
    }
  }

  // 11. Final state
  const { count: fp } = await supabase.from('products').select('*', { count: 'exact', head: true });
  const { count: ft } = await supabase.from('price_tiers').select('*', { count: 'exact', head: true });
  console.log(`\n=== ESTADO FINAL ===`);
  console.log(`Productos: ${fp}`);
  console.log(`Price tiers: ${ft}`);

  // 12. Final verification
  console.log('\n=== VERIFICACIÓN FINAL ===');
  const refs = ['MU-145', 'MU-298', 'MU-279'];
  for (const ref of refs) {
    const { data } = await supabase.from('products').select('id, name').eq('reference', ref);
    if (data && data.length > 0) {
      const { data: rpc } = await (supabase as any).rpc('get_product_price_tiers', { p_product_id: data[0].id });
      console.log(`${ref} (${data[0].name}): ${data.length} registro(s), RPC: ${JSON.stringify(rpc)}`);
    } else {
      console.log(`${ref}: NO ENCONTRADO`);
    }
  }
}

run().catch(console.error);
