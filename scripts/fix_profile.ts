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

async function fixProfile() {
  // Find the user by email via admin api
  const { data: { users }, error: uErr } = await supabase.auth.admin.listUsers();
  if (uErr) return console.error(uErr);

  const adminUser = users.find(u => u.email === 'admin@knowledgebot.com');
  if (!adminUser) return console.log('Admin user not found in auth');

  // Find org
  const { data: orgData } = await supabase.from('organizations').select('id').eq('slug', 'knowledgebot-default').single();
  if (!orgData) return console.log('Org not found');

  // Create profile
  const { error: pErr } = await supabase.from('profiles').upsert({
    id: adminUser.id,
    organization_id: orgData.id,
    full_name: 'Admin',
    role: 'owner'
  });

  if (pErr) console.error('Error creating profile:', pErr);
  else console.log('¡Perfil creado exitosamente! El usuario ya puede iniciar sesión.');
}

fixProfile();
