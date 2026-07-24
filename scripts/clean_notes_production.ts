import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Production credentials
const PROD_SUPABASE_URL = 'https://moaekovebocnagxkkiwm.supabase.co';
const PROD_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(PROD_SUPABASE_URL, PROD_SERVICE_ROLE_KEY);

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
  const isApply = process.argv.includes('--apply');
  console.log('=== CLEANING NOTES IN PRODUCTION DATABASE ===');
  console.log(`Mode: ${isApply ? 'APPLY CHANGES (WRITE)' : 'DRY RUN (READ-ONLY)'}`);
  
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

  // 2. Fetch all products (paginated)
  const dbProducts = await fetchAllProducts();
  console.log(`Encontrados ${dbProducts.length} productos en producción.`);

  let matchCount = 0;
  let updateCount = 0;

  for (const p of dbProducts) {
    const notesStr = p.notes || '';
    
    // Clean if it contains "stock" or "cataprom"
    if (/stock/i.test(notesStr) || /cataprom/i.test(notesStr)) {
      matchCount++;
      
      const refKey = (p.reference || '').toUpperCase().trim();
      const csvMarca = csvMap.get(refKey);
      const targetNotes = csvMarca ? csvMarca.trim() : null;

      if (targetNotes !== p.notes) {
        if (isApply) {
          const { error: updateErr } = await supabase
            .from('products')
            .update({ notes: targetNotes })
            .eq('id', p.id);
          
          if (updateErr) {
            console.error(`Error updating notes for ${p.reference}:`, updateErr.message);
          } else {
            updateCount++;
          }
        } else {
          console.log(`[DRY RUN] Would update Ref: ${p.reference} | Name: ${p.name}`);
          console.log(`   Old: "${p.notes}"`);
          console.log(`   New: "${targetNotes}"`);
          updateCount++;
        }
      }
    }
  }

  console.log(`\nScan complete:`);
  console.log(`- Products with stock notes: ${matchCount}`);
  console.log(`- Products ${isApply ? 'updated' : 'that would be updated'}: ${updateCount}`);
}

run().catch(console.error);
