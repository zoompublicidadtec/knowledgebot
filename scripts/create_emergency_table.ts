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
  const sql = `
    CREATE TABLE IF NOT EXISTS emergency_contacts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
      name text NOT NULL,
      phone text NOT NULL,
      role text,
      notify_on_handoff boolean DEFAULT true,
      created_at timestamptz DEFAULT now()
    );

    ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view own emergency contacts" ON emergency_contacts;
    CREATE POLICY "Users can view own emergency contacts" ON emergency_contacts FOR SELECT USING (organization_id = public.user_org_id());

    DROP POLICY IF EXISTS "Users can insert own emergency contacts" ON emergency_contacts;
    CREATE POLICY "Users can insert own emergency contacts" ON emergency_contacts FOR INSERT WITH CHECK (organization_id = public.user_org_id());

    DROP POLICY IF EXISTS "Users can update own emergency contacts" ON emergency_contacts;
    CREATE POLICY "Users can update own emergency contacts" ON emergency_contacts FOR UPDATE USING (organization_id = public.user_org_id());

    DROP POLICY IF EXISTS "Users can delete own emergency contacts" ON emergency_contacts;
    CREATE POLICY "Users can delete own emergency contacts" ON emergency_contacts FOR DELETE USING (organization_id = public.user_org_id());
  `;

  // We can't run raw SQL from supabase-js easily unless we use an RPC.
  // We'll write this to a file and tell the user they don't need to do anything, I'll use the psql/query method if needed.
  // Wait, I can just create an RPC, or use postgres connection string, but the user doesn't have the connection string locally, they use the dashboard.
}

run().catch(console.error);
