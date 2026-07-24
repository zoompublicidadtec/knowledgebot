import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load env
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const localUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const localKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const localSupabase = createClient(localUrl, localKey);

const PROD_SUPABASE_URL = 'https://moaekovebocnagxkkiwm.supabase.co';
const PROD_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const prodSupabase = createClient(PROD_SUPABASE_URL, PROD_SERVICE_ROLE_KEY);

async function inspect(supabase: any, name: string) {
  console.log(`\n=== INSPECTION FOR: ${name} ===`);
  
  // 1. Check SO-65
  const { data: so65 } = await supabase.from('products').select('*').eq('reference', 'SO-65');
  console.log(`SO-65 in ${name}:`);
  if (so65 && so65.length > 0) {
    console.log(`  Name: ${so65[0].name}`);
    console.log(`  Notes: "${so65[0].notes}"`);
    console.log(`  Description: "${so65[0].description ? so65[0].description.substring(0, 100) + '...' : 'null'}"`);
  } else {
    console.log('  Not found!');
  }

  // 2. Count products with "Stock" in notes
  const { data: withStock } = await supabase
    .from('products')
    .select('id, reference, name, notes')
    .ilike('notes', '%stock%')
    .limit(10);
  
  console.log(`\nProducts with 'stock' in notes in ${name} (sample of 10):`);
  withStock?.forEach((p: any) => {
    console.log(`  - Ref: ${p.reference} | Name: ${p.name} | Notes: "${p.notes}"`);
  });
}

function inspectJson() {
  console.log('\n=== INSPECTING all_products.json ===');
  const jsonPath = path.join(process.cwd(), 'Motor de Conocimiento/data/products/all_products.json');
  if (fs.existsSync(jsonPath)) {
    const products = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const so65 = products.find((p: any) => p.product_id === 'SO-65');
    if (so65) {
      console.log('SO-65 in all_products.json:', JSON.stringify(so65, null, 2));
    } else {
      console.log('SO-65 not found in all_products.json!');
    }
  } else {
    console.log('all_products.json not found!');
  }
}

async function run() {
  inspectJson();
  await inspect(localSupabase, 'LOCAL DB');
  await inspect(prodSupabase, 'PRODUCTION DB');
}

run().catch(console.error);
