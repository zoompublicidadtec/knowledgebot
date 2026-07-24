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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://moaekovebocnagxkkiwm.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('=== APLICANDO MIGRACIÓN 00007 TRIGGER A SUPABASE ===');
  const sqlPath = path.resolve(process.cwd(), 'supabase/migrations/00007_auto_generate_product_reference.sql');
  const sqlContent = fs.readFileSync(sqlPath, 'utf8');

  // Intentar ejecutar mediante RPC exec_sql si existe, o notificar
  const { error } = await (supabase as any).rpc('exec_sql', { sql: sqlContent });
  if (error) {
    console.log('Nota exec_sql RPC (si no existe):', error.message);
    console.log('La migración SQL quedó guardada en supabase/migrations/00007_auto_generate_product_reference.sql');
  } else {
    console.log('✅ Trigger autogenerador de referencias instalado exitosamente en Supabase.');
  }
}

run();
