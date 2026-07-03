import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data, error } = await supabase
      .from('categories')
      .select('id, name, group_name, synonyms, subcategories(id, name, synonyms)')
      .order('name', { ascending: true });
      
  console.log('Error:', error);
  console.log('Data len:', data?.length);
  
  if (error) {
    const { data: fallbackData, error: fallbackError } = await supabase
          .from('categories')
          .select('id, name, group_name')
          .order('name', { ascending: true });
    console.log('Fallback Error:', fallbackError);
    console.log('Fallback Data len:', fallbackData?.length);
  }
}

main();
