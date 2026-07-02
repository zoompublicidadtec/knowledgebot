import './load-env';
import { createAdminClient } from '../lib/supabase/admin';

async function main() {
  const supabase = createAdminClient();
  
  // Buscar productos con la palabra 'mug' en su name o search_text
  const { data, error } = await supabase
    .from('products')
    .select('name, search_text, description')
    .ilike('search_text', '%mug%')
    .limit(20);
    
  if (error) {
    console.error('Error al consultar:', error.message);
    process.exit(1);
  }
  
  console.log(`\n🔍 Encontrados ${data?.length || 0} productos tipo Mug:`);
  data?.forEach((p, idx) => {
    console.log(`\n[${idx + 1}] Nombre: ${p.name}`);
    console.log(`    Descripción: ${p.description}`);
    console.log(`    Texto de búsqueda: ${p.search_text}`);
  });
}

main().catch(console.error);
