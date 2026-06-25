import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
const envConfig = fs.readFileSync(envPath, 'utf8');
for (const line of envConfig.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function createTempUser() {
  const email = 'admin@knowledgebot.com';
  const password = 'password123';

  // Create user
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (authErr) {
    console.error('Error creating user:', authErr.message);
    return;
  }

  const userId = authData.user.id;

  // Get org
  const { data: orgData } = await supabase.from('organizations').select('id').eq('slug', 'knowledgebot-default').single();
  
  if (orgData) {
    // Add user as owner
    await supabase.from('organization_members').insert({
      organization_id: orgData.id,
      user_id: userId,
      role: 'owner'
    });
  }

  console.log(`Usuario creado exitosamente: ${email} / ${password}`);
}

createTempUser();
