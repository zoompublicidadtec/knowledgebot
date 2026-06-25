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
  const { data: products } = await supabase.from('products').select('id, name').ilike('name', '%mug%');
  
  if (!products) return;

  for (let p of products) {
    const { data: allTiers } = await supabase.from('price_tiers').select('*').eq('product_id', p.id);
    if (!allTiers || allTiers.length === 0) continue;
    
    // Find the tier with min_qty = 6 and update it to 1
    const firstTier = allTiers.find(t => t.min_qty === 6);
    if (firstTier) {
      console.log(`Updating ${p.name} first tier from 6 to 1`);
      await supabase.from('price_tiers').update({ min_qty: 1 }).eq('id', firstTier.id);
    }
  }
  console.log('Done!');
}

run();
