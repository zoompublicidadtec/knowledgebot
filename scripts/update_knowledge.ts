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
  console.log('Iniciando actualizacion de base de datos y comportamiento...');
  
  const { data: orgData } = await supabase.from('organizations').select('id').limit(1);
  const orgId = orgData![0].id;

  // 1. Update system prompt
  const newPrompt = `Eres el asesor experto de Zoom Publicidad. Tu objetivo principal es perfilar al cliente y recolectar toda la informacion necesaria antes de dar precios o pasarlo a un humano.

REGLAS ESTRICTAS:
1. NUNCA ofrezcas hablar con un humano como primera opcion.
2. Si un cliente pide un producto (ej. camisetas, cuadernos, pendones), SIEMPRE haz preguntas para recopilar los requisitos exactos de cotizacion.
   Ejemplo para camisetas: Pregunta cantidad, color, talla, si es cuello redondo/V y tamaño del estampado.
   Ejemplo para cuadernos: Pregunta cantidad, tamaño, tipo de pasta (dura/blanda), cantidad de hojas.
3. Solo cuando tengas TODOS los datos necesarios, busca el producto en tu base de datos y arma una cotizacion aproximada o dile que con esos datos exactos un humano le dara el precio final.
4. Usa SIEMPRE la herramienta queryKnowledgeBaseTool para buscar los productos antes de responder.
5. Se amable, conversacional y profesional.`;

  await supabase.from('agent_configs').update({ system_prompt: newPrompt }).eq('organization_id', orgId);
  console.log('Prompt del agente actualizado.');

  // 2. Clear old knowledge
  console.log('Borrando base de datos vieja...');
  await supabase.from('knowledge_documents').delete().eq('organization_id', orgId);

  // 3. Read new Excel file
  console.log('Leyendo archivo Excel...');
  const filePath = 'D:\\AUTOMATIZACIONES WHATSAPP\\PRECIOS Y PRODUCTOS JUNIO 11 2026.xlsx';
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(worksheet);

  const chunks = data.map((row: any) => {
    let text = 'Producto en catálogo: ';
    for (const [key, value] of Object.entries(row)) {
      if (value) text += `${key}: ${value}. `;
    }
    return text.trim();
  }).filter(c => c.length > 20);

  console.log(`Encontrados ${chunks.length} productos en el Excel.`);

  const { data: doc } = await supabase.from('knowledge_documents').insert({
    organization_id: orgId,
    title: 'PRECIOS Y PRODUCTOS JUNIO 11 2026.xlsx',
    source_type: 'manual',
    source_url: filePath,
  }).select('id').single();

  const documentId = doc!.id;

  console.log('Cargando motor de IA...');
  const extractor = await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2');

  const batchSize = 100;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    console.log(`Inyectando lote ${i} a ${i + batch.length} de ${chunks.length}...`);
    
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

  console.log('¡ACTUALIZACION COMPLETA!');
}

run().catch(console.error);
