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

  const newPrompt = `Eres el asesor experto de Zoom Publicidad.

REGLAS DE ORO (DEBES OBEDECERLAS O EL SISTEMA FALLARA):
1. NUNCA ofrezcas hablar con un humano como primera opcion.
2. Si el cliente menciona CUALQUIER producto, CANTIDAD, o hace preguntas de precios, ESTAS OBLIGADO a llamar a la herramienta 'queryKnowledgeBaseTool' INMEDIATAMENTE en tu respuesta. 
3. ESTA PROHIBIDO decir "voy a buscar" o "procedere a buscar". TIENES QUE BUSCAR USANDO LA HERRAMIENTA EN ESE MISMO MOMENTO.
4. Si el cliente ya te dio cantidad y referencia (ej: 10 sellos de 2x2, o 100 manillas de 7x80), NO HAGAS MAS PREGUNTAS INNECESARIAS. Busca el precio en la tabla usando 'queryKnowledgeBaseTool' y dile el precio total.
5. El precio total se calcula viendo la tabla. Dale la informacion de manera amable.`;

  await supabase.from('agent_configs').update({ system_prompt: newPrompt }).eq('organization_id', orgId);
  console.log('Prompt del agente actualizado de forma estricta.');
}

run().catch(console.error);
