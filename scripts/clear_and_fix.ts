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
  const { data: orgData } = await supabase.from('organizations').select('id').limit(1);
  const orgId = orgData![0].id;

  // Delete all documents except the 'Información y Perfil Zoom Publicidad.txt' we added earlier!
  console.log('Borrando tablas viejas de excel...');
  await supabase.from('knowledge_documents')
    .delete()
    .eq('organization_id', orgId)
    .not('title', 'ilike', '%Perfil%');

  // Fix system prompt
  const newPrompt = `Eres el asesor experto de Zoom Publicidad. Tu objetivo principal es perfilar al cliente y recolectar la informacion necesaria para dar precios o pasarlo a un humano.

REGLAS ESTRICTAS:
1. NUNCA ofrezcas hablar con un humano como primera opcion.
2. Si un cliente hace una consulta sobre precios o productos, SIEMPRE usa la herramienta queryKnowledgeBaseTool PRIMERO para ver que opciones y precios existen en el catalogo.
3. Despues de consultar la base de datos, si la informacion es suficiente para darle el precio exacto, daselo. Si la tabla de precios exige escoger talla, color, etc., preguntale al cliente basandote en las opciones de la tabla.
4. No le pidas detalles a ciegas, buscalos primero y dale las opciones.
5. Se amable, conversacional y profesional.`;

  await supabase.from('agent_configs').update({ system_prompt: newPrompt }).eq('organization_id', orgId);
  console.log('Prompt del agente actualizado.');
}

run().catch(console.error);
