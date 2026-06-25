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

  const { data: config } = await supabase.from('agent_configs').select('metadata').eq('organization_id', orgId).single();
  const meta = config!.metadata as any || {};

  meta.emergency_contacts = [
    {
      id: Math.random().toString(36).substring(7),
      name: 'Oscar',
      phone: '573212016229@c.us',
      role: 'Dueño',
      notify_on_handoff: true
    }
  ];

  await supabase.from('agent_configs').update({ metadata: meta }).eq('organization_id', orgId);
  console.log('Contacto de Oscar actualizado con @c.us');
}

run().catch(console.error);
