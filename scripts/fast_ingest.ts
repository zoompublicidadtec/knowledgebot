import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
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
  console.log('Starting fast ingest...');
  const filePath = 'd:\\AUTOMATIZACIONES WHATSAPP\\base_datos_zoom_publicidad.csv';
  const title = path.basename(filePath);

  const { data: orgData } = await supabase.from('organizations').select('id').limit(1);
  const orgId = orgData![0].id;

  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
  
  const chunks = parsed.data.map((row: any) => {
    return `Producto: ${row.Producto || ''}. Precio Mínimo: $${row.Precio_Min || ''}, Precio Máximo: $${row.Precio_Max || ''}. ID del producto: ${row.ID || ''}`;
  }).filter(c => c.length > 20);

  console.log(`Parsed ${chunks.length} products`);

  const { data: docData } = await supabase.from('knowledge_documents').select('id').eq('organization_id', orgId).limit(1).single();
  const documentId = docData!.id;

  console.log('Loading AI model...');
  const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');
  console.log('Model loaded.');

  const batchSize = 100;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    console.log(`Batch ${i}/${chunks.length}`);
    
    const embeddings = await Promise.all(batch.map(async text => {
       const output = await extractor(text, { pooling: 'mean', normalize: true });
       return Array.from(output.data);
    }));
    
    const rows = batch.map((text, idx) => ({
      organization_id: orgId,
      document_id: documentId,
      content: text,
      embedding: embeddings[idx],
      token_count: Math.ceil(text.length / 4)
    }));

    const { error } = await supabase.from('knowledge_chunks').insert(rows);
    if (error) console.error('Insert error:', error.message);
  }

  console.log('DONE!');
}

run().catch(console.error);
