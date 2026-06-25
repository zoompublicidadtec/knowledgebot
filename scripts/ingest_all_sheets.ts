import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as xlsx from 'xlsx';
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
  const { data: orgData } = await supabase.from('organizations').select('id').limit(1);
  const orgId = orgData![0].id;

  const filePath = 'D:\\AUTOMATIZACIONES WHATSAPP\\PRECIOS Y PRODUCTOS JUNIO 11 2026.xlsx';
  const workbook = xlsx.readFile(filePath);

  let allTextChunks: string[] = [];

  // Recorrer TODAS las hojas
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    // Leer como matriz 2D
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
    
    let sheetText = `TABLA DE PRECIOS - CATEGORIA: ${sheetName.toUpperCase()}\n`;
    let rowCount = 0;

    for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
      const row = data[rowIndex];
      if (!row || row.length === 0) continue;
      
      const rowValues = row.filter(val => val !== null && val !== undefined && val !== '').map(String);
      if (rowValues.length > 0) {
        sheetText += rowValues.join(' | ') + '\n';
        rowCount++;
      }
      
      // Si la hoja es muy larga, la partimos para no exceder tokens
      if (rowCount > 40) {
        allTextChunks.push(sheetText);
        sheetText = `TABLA DE PRECIOS - CATEGORIA: ${sheetName.toUpperCase()} (Continuacion)\n`;
        rowCount = 0;
      }
    }
    
    if (rowCount > 0) {
      allTextChunks.push(sheetText);
    }
  }

  // Filtrar chunks muy cortos
  allTextChunks = allTextChunks.filter(c => c.length > 15);

  console.log(`Extraídos ${allTextChunks.length} fragmentos de todas las hojas.`);

  const { data: doc } = await supabase.from('knowledge_documents').insert({
    organization_id: orgId,
    title: 'Catalogo Completo Multiohoja Excel',
    source_type: 'manual',
    source_url: filePath,
  }).select('id').single();

  const documentId = doc!.id;

  console.log('Cargando motor de IA...');
  const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');

  const batchSize = 100;
  for (let i = 0; i < allTextChunks.length; i += batchSize) {
    const batch = allTextChunks.slice(i, i + batchSize);
    console.log(`Inyectando lote ${i} a ${i + batch.length} de ${allTextChunks.length}...`);
    
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

    await supabase.from('knowledge_chunks').insert(rows);
  }

  console.log('¡INYECCIÓN DEL EXCEL MULTIHOJA COMPLETA!');
}

run().catch(console.error);
