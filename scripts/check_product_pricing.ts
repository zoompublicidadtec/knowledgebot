import { createClient } from '@supabase/supabase-js';

const PROD_SUPABASE_URL = 'https://moaekovebocnagxkkiwm.supabase.co';
const PROD_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(PROD_SUPABASE_URL, PROD_SERVICE_ROLE_KEY);

async function run() {
  console.log('=== BUSCANDO EN BASE DE DATOS DE PRODUCCIÓN ===');

  // 1. Check MU-337 specifically
  console.log('\n--- Buscando MU-337 ---');
  const { data: mu337 } = await supabase.from('products').select('*').eq('reference', 'MU-337');
  console.log(`Registros de MU-337: ${mu337?.length || 0}`);
  if (mu337 && mu337.length > 0) {
    console.log(JSON.stringify(mu337[0], null, 2));
    const { data: tiers } = await supabase.from('price_tiers').select('*').eq('product_id', mu337[0].id);
    console.log(`Tiers de precio para MU-337:`, tiers);
  }

  // 2. Search for "Botilito" in production
  console.log('\n--- Buscando productos con "botilito" en el nombre ---');
  const { data: botilitos } = await supabase
    .from('products')
    .select('id, reference, name, active')
    .ilike('name', '%botilito%')
    .limit(10);
  
  console.log(`Encontrados ${botilitos?.length || 0} botilitos en prod DB:`);
  for (const b of botilitos || []) {
    const { data: tiers } = await supabase.from('price_tiers').select('price').eq('product_id', b.id);
    const prices = (tiers || []).map(t => `$${t.price}`);
    console.log(`  - Ref: ${b.reference} | Nombre: ${b.name} | Precios: ${prices.join(', ') || 'Sin precio'}`);
  }

  // 3. Let's see what are the cheapest products in the "TERMOS Y BOTILITOS" or similar categories
  console.log('\n--- Productos más baratos con precio ---');
  const { data: cheapTiers } = await supabase
    .from('price_tiers')
    .select('product_id, price, products(name, reference)')
    .order('price', { ascending: true })
    .limit(10);
  
  for (const t of cheapTiers || []) {
    const p: any = t.products;
    console.log(`  - Price: $${t.price} | Ref: ${p?.reference} | Nombre: ${p?.name}`);
  }
}

run().catch(console.error);
