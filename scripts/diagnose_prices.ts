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

async function diagnose() {
  console.log('=== DIAGNÓSTICO COMPLETO DE PRECIOS ===\n');

  // 1. Count products and price_tiers
  const { count: prodCount } = await supabase.from('products').select('*', { count: 'exact', head: true });
  console.log(`Total productos en DB: ${prodCount}`);

  const { count: tierCount } = await supabase.from('price_tiers').select('*', { count: 'exact', head: true });
  console.log(`Total price_tiers en DB: ${tierCount}`);

  // 2. Check specific products
  const refs = ['MU-298', 'MU-279', 'MU-145'];
  for (const ref of refs) {
    console.log(`\n--- Buscando ${ref} ---`);
    
    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, name, reference, category_id')
      .eq('reference', ref);
    
    if (prodErr) {
      console.log(`  ERROR buscando producto: ${prodErr.message}`);
      continue;
    }
    
    console.log(`  Productos encontrados: ${products?.length || 0}`);
    
    if (products && products.length > 0) {
      for (const p of products) {
        console.log(`  UUID: ${p.id} | Nombre: ${p.name} | Ref: ${p.reference}`);
        
        // Check price_tiers for this product
        const { data: tiers, error: tierErr } = await supabase
          .from('price_tiers')
          .select('*')
          .eq('product_id', p.id);
        
        if (tierErr) {
          console.log(`    ERROR buscando precios: ${tierErr.message}`);
        } else {
          console.log(`    Price tiers: ${tiers?.length || 0}`);
          if (tiers && tiers.length > 0) {
            for (const t of tiers) {
              console.log(`      Variante: ${t.variant} | min_qty: ${t.min_qty} | max_qty: ${t.max_qty} | price: $${t.price} | basis: ${t.price_basis}`);
            }
          }
        }
      }
    }
  }

  // 3. Test RPC function
  console.log('\n=== PROBANDO FUNCIÓN RPC get_product_price_tiers ===');
  const { data: testProd } = await supabase
    .from('products')
    .select('id, name')
    .eq('reference', 'MU-145')
    .limit(1);
  
  if (testProd && testProd.length > 0) {
    const testId = testProd[0].id;
    console.log(`Probando RPC con UUID: ${testId} (${testProd[0].name})`);
    
    const { data: rpcResult, error: rpcErr } = await (supabase as any).rpc('get_product_price_tiers', {
      p_product_id: testId
    });
    
    if (rpcErr) {
      console.log(`RPC ERROR: ${rpcErr.message}`);
      console.log(`RPC ERROR CODE: ${rpcErr.code}`);
    } else {
      console.log(`RPC resultado: ${JSON.stringify(rpcResult)}`);
    }
  } else {
    console.log('No se encontró MU-145 para probar RPC');
  }

  // 4. Check for duplicate products
  console.log('\n=== DUPLICADOS ===');
  const { data: allMugs } = await supabase
    .from('products')
    .select('id, name, reference')
    .ilike('name', '%zenith%');
  
  console.log(`Productos con "zenith" en el nombre: ${allMugs?.length}`);
  allMugs?.forEach(m => console.log(`  ${m.id} | ${m.reference} | ${m.name}`));
}

diagnose().catch(console.error);
