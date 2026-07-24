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

function parseCSV(content: string) {
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const results = [];
  
  for (let i = 1; i < lines.length; i++) {
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    const values = lines[i].split(regex).map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (values.length < 2) continue;
    
    const row: any = {};
    headers.forEach((h, index) => {
      row[h] = values[index] !== undefined ? values[index] : null;
      if (row[h] === '') row[h] = null;
    });
    results.push(row);
  }
  return results;
}

async function fetchAllProducts() {
  const results: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, reference, name, notes')
      .range(from, from + pageSize - 1);
    if (error) {
      console.error('Error fetching products batch:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

async function run() {
  console.log('=== CLEANING NOTES IN LOCAL DATABASE ===');
  
  // 1. Load CSV
  const csvPath = path.resolve(process.cwd(), 'data', 'catalogo_productos.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const csvProducts = parseCSV(csvContent);
  
  const csvMap = new Map<string, string>(); // ref -> marca_tecnica
  for (const p of csvProducts) {
    if (p.referencia) {
      csvMap.set(p.referencia.toUpperCase().trim(), p.marca_tecnica || '');
    }
  }

  // 2. Fetch all local products (paginated)
  const dbProducts = await fetchAllProducts();
  console.log(`Encontrados ${dbProducts.length} productos en DB.`);

  let updatedCount = 0;
  for (const p of dbProducts) {
    const notesStr = p.notes || '';
    
    // Clean if it contains "stock" or "cataprom" or if it is empty/null and we have a CSV value
    const refKey = (p.reference || '').toUpperCase().trim();
    const csvMarca = csvMap.get(refKey);
    const targetNotes = csvMarca ? csvMarca.trim() : null;

    if (/stock/i.test(notesStr) || /cataprom/i.test(notesStr) || !p.notes) {
      if (targetNotes !== p.notes) {
        const { error: updateErr } = await supabase
          .from('products')
          .update({ notes: targetNotes })
          .eq('id', p.id);
        
        if (updateErr) {
          console.error(`Error updating notes for ${p.reference}:`, updateErr.message);
        } else {
          updatedCount++;
        }
      }
    }
  }

  console.log(`¡Limpieza completada! Se actualizaron notas para ${updatedCount} productos.`);
}

run().catch(console.error);
