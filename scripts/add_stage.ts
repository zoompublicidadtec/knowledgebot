import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function addStageColumn() {
  const { error } = await supabase.rpc('exec_sql', {
    sql: `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS stage text DEFAULT 'inbox';`
  });
  
  if (error) {
    console.error('Failed using RPC (might not exist):', error.message);
    console.log('Will try updating metadata directly or recommend running manually in Supabase SQL editor.');
  } else {
    console.log('Added column successfully via RPC.');
  }
}

addStageColumn();
