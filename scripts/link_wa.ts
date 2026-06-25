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

async function setup() {
  // Get org
  const { data: orgData } = await supabase.from('organizations').select('id').eq('slug', 'knowledgebot-default').single();
  if (!orgData) return console.log('Org not found');

  const orgId = orgData.id;

  // Insert whatsapp config
  await supabase.from('whatsapp_configs').upsert({
    organization_id: orgId,
    provider: 'openwa',
    openwa_api_url: 'http://localhost:3004', // The local WA server port
    openwa_session_id: 'knowledge_session'
  });

  // Insert basic agent config just in case
  await supabase.from('agent_configs').upsert({
    organization_id: orgId,
    system_prompt: 'Eres un experto en tu empresa. Tu trabajo principal es responder preguntas basado estrictamente en tu base de conocimiento.'
  });

  console.log('¡Configuración de WhatsApp guardada en la base de datos con éxito!');
}
setup();
