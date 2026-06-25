import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from '@xenova/transformers';

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
  const query = process.argv[2] || "precio de 100 llaveros tipo manilla en material plastisol color blanco con 2 tintas y grabado pequeo de 7x80mm";
  
  const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  const output = await extractor(query, { pooling: 'mean', normalize: true });
  const embedding = Array.from(output.data);

  const { data: orgData } = await supabase.from('organizations').select('id').limit(1);
  const orgId = orgData![0].id;

  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: embedding,
    match_threshold: 0.1, // lowered to find everything
    match_count: 30,
    target_organization_id: orgId
  });

  if (error) {
    console.error('Error querying:', error);
    return;
  }

  console.log('Top 5 matches for:', query);
  data.forEach((d: any, i: number) => {
    console.log(`\nMatch ${i+1} (Similitud: ${d.similarity.toFixed(2)}):`);
    console.log(d.content);
  });
}

run().catch(console.error);
