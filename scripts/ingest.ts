import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

// Load env from .env.local for local script execution
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const EMBEDDINGS_BASE_URL = (process.env.EMBEDDINGS_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
const EMBEDDINGS_API_KEY = process.env.EMBEDDINGS_API_KEY || '';
const EMBEDDINGS_MODEL = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-small';

if (!EMBEDDINGS_API_KEY) {
  console.error('Error: EMBEDDINGS_API_KEY is required. Set it in .env.local.');
  process.exit(1);
}

/**
 * Generate an embedding via the OpenAI-compatible API.
 */
async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${EMBEDDINGS_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${EMBEDDINGS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: text, model: EMBEDDINGS_MODEL }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  return data?.data?.[0]?.embedding || [];
}

// Chunk text with overlap
function chunkText(text: string, chunkSize: number = 800, overlap: number = 100): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + chunkSize, text.length);
    if (end < text.length) {
      const nextNewline = text.lastIndexOf('\n', end);
      const nextPeriod = text.lastIndexOf('.', end);
      const splitIndex = Math.max(nextNewline, nextPeriod);
      if (splitIndex > i + chunkSize / 2) {
        end = splitIndex + 1;
      }
    }
    chunks.push(text.slice(i, end).trim());
    i = end - overlap;
  }
  return chunks.filter(c => c.length > 0);
}

async function ingestFile(filePath: string) {
  const title = path.basename(filePath);

  // Find the first organization
  let { data: orgData } = await supabase.from('organizations').select('id').limit(1);
  let orgId = '';
  if (!orgData || orgData.length === 0) {
    const { data: newOrg } = await supabase.from('organizations').insert({
      name: 'KnowledgeBot Default Org',
      slug: 'knowledgebot-default'
    }).select('id').single();
    if (newOrg) orgId = newOrg.id;
  } else {
    orgId = orgData[0].id;
  }

  if (!orgId) throw new Error('No se pudo encontrar o crear una organización');

  const content = fs.readFileSync(filePath, 'utf-8');
  let textToProcess = '';

  if (filePath.toLowerCase().endsWith('.csv')) {
    const parsed = Papa.parse(content, { header: true, skipEmptyLines: true });
    textToProcess = parsed.data.map(row => JSON.stringify(row)).join('\n');
  } else {
    textToProcess = content;
  }

  console.log(`Procesando ${title}...`);
  console.log(`Modelo de embeddings: ${EMBEDDINGS_MODEL}`);

  const { data: doc, error: docError } = await supabase
    .from('knowledge_documents')
    .insert({
      organization_id: orgId,
      title,
      source_type: 'manual',
      source_url: filePath,
    })
    .select('id')
    .single();

  if (docError || !doc) {
    throw new Error(`Error insertando documento: ${docError?.message}`);
  }

  const documentId = doc.id;
  const chunks = chunkText(textToProcess);
  console.log(`Se crearon ${chunks.length} fragmentos. Generando embeddings via API...`);

  const batchSize = 20; // OpenAI supports batching via array input
  for (let i = 0; i < chunks.length; i += batchSize) {
    const chunkBatch = chunks.slice(i, i + batchSize);
    console.log(`Embeddings ${i + 1}-${Math.min(i + batchSize, chunks.length)} de ${chunks.length}...`);

    try {
      // Batch embed: send all texts in one API call
      const res = await fetch(`${EMBEDDINGS_BASE_URL}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${EMBEDDINGS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input: chunkBatch, model: EMBEDDINGS_MODEL }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`Error en batch de embeddings: ${errText}`);
        continue;
      }

      const data = (await res.json()) as { data?: { embedding: number[] }[] };
      const embeddings = data?.data || [];

      const rows = chunkBatch.map((chunkText, idx) => ({
        organization_id: orgId,
        document_id: documentId,
        content: chunkText,
        embedding: embeddings[idx]?.embedding || [],
        token_count: Math.ceil(chunkText.length / 4)
      }));

      const { error: insertError } = await supabase
        .from('knowledge_chunks')
        .insert(rows);

      if (insertError) {
        console.error(`Error guardando en BD: ${insertError.message}`);
      }
    } catch (e: any) {
      console.error(`Error en batch: ${e.message}`);
    }
  }

  console.log(`¡Memoria inyectada con éxito para "${title}"!`);
}

const targetPath = process.argv[2];
if (!targetPath) {
  console.log('Uso: npx tsx scripts/ingest.ts <ruta-archivo>');
  console.log('Ejemplo: npx tsx scripts/ingest.ts products.csv');
  process.exit(1);
}

ingestFile(targetPath).catch(console.error);
