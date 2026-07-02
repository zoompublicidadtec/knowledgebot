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
  const { data: allProducts, error } = await supabase.from('products').select('name, description');
  if (error) {
    console.error('Error:', error);
    return;
  }
  const lines = allProducts.map(p => `- ${p.name} | Description: ${p.description}`);
  fs.writeFileSync('all_product_names.txt', lines.join('\n'), 'utf8');
  console.log(`Wrote ${allProducts.length} product names to all_product_names.txt`);
}
run();
