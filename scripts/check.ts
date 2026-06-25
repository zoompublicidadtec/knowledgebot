import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = fs.readFileSync(envPath, 'utf8');
for (const line of envConfig.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function check() {
  const { data: orgs } = await supabase.from('organizations').select('id, name, slug');
  console.log('Organizations:', orgs);

  const { data: docs } = await supabase.from('knowledge_documents').select('id, organization_id, title');
  console.log('Docs:', docs);

  const { count: chunksCount } = await supabase.from('knowledge_chunks').select('*', { count: 'exact', head: true });
  console.log('Total chunks:', chunksCount);

  // Check the specific query
  const query = "Si quiero mandar hacer unos cuadernos";
  
  // We need to embed it to check the RPC
  const { pipeline } = require('@xenova/transformers');
  const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  const output = await extractor(query, { pooling: 'mean', normalize: true });
  const embedding = Array.from(output.data);

  if (orgs && orgs.length > 0) {
    const orgId = orgs[0].id;
    const { data: rpcData, error } = await supabase.rpc('match_knowledge_chunks', {
      target_organization_id: orgId,
      query_embedding: embedding,
      match_count: 5,
      match_threshold: 0.3
    });
    console.log('RPC Error:', error);
    console.log('RPC Results:', rpcData?.length || 0);
  }
}
check();
