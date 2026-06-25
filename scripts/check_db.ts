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
  const { data: products } = await supabase.from('products').select('id, name').ilike('name', '%polo dama%');
  
  for (let p of products) {
    const { data: tiers } = await supabase.from('price_tiers').select('*').eq('product_id', p.id).order('min_qty');
    console.log(`Product: ${p.name}`);
    console.log(tiers?.map(t => `${t.variant}: ${t.min_qty} - ${t.max_qty || '++'} => $${t.price} (${t.price_basis})`).join('\n'));
    console.log('---');
  }
}
run();
