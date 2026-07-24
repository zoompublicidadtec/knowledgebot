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

async function run() {
  console.log('=== PRODUCTOS MÁS BARATOS CON PRECIO EN DB LOCAL ===');
  const { data: cheapTiers } = await supabase
    .from('price_tiers')
    .select('product_id, price, products(name, reference)')
    .order('price', { ascending: true })
    .limit(15);
  
  for (const t of cheapTiers || []) {
    const p: any = t.products;
    console.log(`  - Price: $${t.price} | Ref: ${p?.reference} | Nombre: ${p?.name}`);
  }
}

run().catch(console.error);
