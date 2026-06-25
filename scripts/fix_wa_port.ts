import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fixWaConfig() {
  const { data: orgs } = await supabase.from('organizations').select('id');
  if (orgs && orgs.length > 0) {
    const orgId = orgs[0].id;
    console.log('Org ID:', orgId);
    
    const { error } = await supabase
      .from('whatsapp_configs')
      .update({ openwa_api_url: 'http://localhost:2785' })
      .eq('organization_id', orgId);
      
    if (error) {
      console.error('Error updating:', error);
    } else {
      console.log('Successfully updated wa-server URL to port 2785!');
    }
  }
}

fixWaConfig();
