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

const localSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const PROD_SUPABASE_URL = 'https://moaekovebocnagxkkiwm.supabase.co';
const PROD_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const prodSupabase = createClient(PROD_SUPABASE_URL, PROD_SERVICE_ROLE_KEY);

async function inspectProduct(reference: string) {
  console.log(`\n================ INSPECTING: ${reference} ================`);
  
  // Local
  const { data: localProds } = await localSupabase.from('products').select('*').eq('reference', reference);
  if (localProds && localProds.length > 0) {
    const lp = localProds[0];
    console.log('LOCAL DB:');
    console.log(`  Name: ${lp.name}`);
    console.log(`  Notes: "${lp.notes}"`);
    const { data: tiers } = await localSupabase.from('price_tiers').select('*').eq('product_id', lp.id).order('min_qty');
    console.log('  Price Tiers:');
    tiers?.forEach(t => console.log(`    - Variant: ${t.variant} | Qty: ${t.min_qty}-${t.max_qty || '∞'} | Price: $${t.price} ${t.currency}`));
  } else {
    console.log('LOCAL DB: Product not found!');
  }

  // Production
  const { data: prodProds } = await prodSupabase.from('products').select('*').eq('reference', reference);
  if (prodProds && prodProds.length > 0) {
    const pp = prodProds[0];
    console.log('PRODUCTION DB:');
    console.log(`  Name: ${pp.name}`);
    console.log(`  Notes: "${pp.notes}"`);
    const { data: tiers } = await prodSupabase.from('price_tiers').select('*').eq('product_id', pp.id).order('min_qty');
    console.log('  Price Tiers:');
    tiers?.forEach(t => console.log(`    - Variant: ${t.variant} | Qty: ${t.min_qty}-${t.max_qty || '∞'} | Price: $${t.price} ${t.currency}`));
  } else {
    console.log('PRODUCTION DB: Product not found!');
  }
}

async function inspectProfiles() {
  console.log('\n================ UPDATING ADMIN PASSWORD ================');
  const { data, error } = await localSupabase.auth.admin.updateUserById('212a0677-69a9-4111-8679-9ca057a98d3f', {
    password: 'admin123'
  });
  if (error) {
    console.error('Error updating password:', error.message);
  } else {
    console.log('Password updated successfully for admin@knowledgebot.com to "admin123"');
  }
}

async function run() {
  await inspectProfiles();
  const ref = process.argv[2] || 'OF-202';
  await inspectProduct(ref);
  if (process.argv[2] === undefined) {
    await inspectProduct('CAP-20');
    await inspectProduct('VA-666');
  }
}

run().catch(console.error);
