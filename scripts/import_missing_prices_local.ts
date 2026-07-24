import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load env from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

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

function parsePriceTiers(precioRaw: string | null, minOrderQty: number | null): Array<{
  variant: string;
  min_qty: number;
  max_qty: number | null;
  price: number;
  price_basis: string;
}> {
  if (!precioRaw) return [];

  const tiers: Array<{ variant: string; min_qty: number; max_qty: number | null; price: number; price_basis: string }> = [];

  // Check if it contains range patterns (pipe-separated tiers)
  if (precioRaw.includes('|') && precioRaw.includes('Precio de')) {
    const segments = precioRaw.split('|').map(s => s.trim());
    
    for (const seg of segments) {
      const rangeMatch = seg.match(/Precio de\s+([\d.]+)\s+a\s+([\d.]+)\s+unidades:\s*\$([\d.]+)/i);
      if (rangeMatch) {
        const minQ = parseInt(rangeMatch[1].replace(/\./g, ''));
        const maxQ = parseInt(rangeMatch[2].replace(/\./g, ''));
        const price = parseInt(rangeMatch[3].replace(/\./g, ''));
        if (!isNaN(price) && price > 0) {
          tiers.push({ variant: 'Estándar', min_qty: minQ, max_qty: maxQ, price, price_basis: 'unitario' });
        }
        continue;
      }

      const openMatch = seg.match(/Precio de\s+([\d.]+)\s+unidades?\s+en\s+adelante:\s*\$([\d.]+)/i);
      if (openMatch) {
        const minQ = parseInt(openMatch[1].replace(/\./g, ''));
        const price = parseInt(openMatch[2].replace(/\./g, ''));
        if (!isNaN(price) && price > 0) {
          tiers.push({ variant: 'Estándar', min_qty: minQ, max_qty: null, price, price_basis: 'unitario' });
        }
        continue;
      }
    }
  }

  if (tiers.length > 0) return tiers;

  // Simple and cleaned format (e.g. "$ 14.100" or "$14.100Venta minima")
  const simpleMatch = precioRaw.match(/\$\s*(\d{1,3}(?:\.\d{3})*)/);
  if (simpleMatch) {
    const priceStr = simpleMatch[1].replace(/\./g, '');
    const price = parseInt(priceStr);
    if (!isNaN(price) && price > 0 && price < 1e9) {
      tiers.push({
        variant: 'Estándar',
        min_qty: minOrderQty || 1,
        max_qty: null,
        price,
        price_basis: 'unitario',
      });
    }
  }

  return tiers;
}

async function fetchAll(table: string, select: string): Promise<any[]> {
  const results: any[] = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) { console.error(`Error fetching ${table}:`, error.message); break; }
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return results;
}

async function run() {
  console.log('=== TRABAJANDO EN ENTORNO LOCAL ===');
  console.log(`URL: ${supabaseUrl}\n`);

  // Load CSV
  const csvPath = path.resolve(process.cwd(), 'data', 'catalogo_productos.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const allCSVProducts = parseCSV(csvContent);
  console.log(`Productos en CSV: ${allCSVProducts.length}`);

  // Group CSV by reference
  const uniqueByRef = new Map<string, any>();
  for (const p of allCSVProducts) {
    if (p.referencia && !uniqueByRef.has(p.referencia)) {
      uniqueByRef.set(p.referencia, p);
    }
  }
  console.log(`Productos únicos en CSV: ${uniqueByRef.size}`);

  // Fetch local products
  const products = await fetchAll('products', 'id, reference');
  const prodMap = new Map(products.map(p => [p.reference, p.id]));
  console.log(`Productos en la base de datos local: ${products.length}`);

  // Delete all existing local price_tiers before reload
  console.log('Borrando price_tiers locales para recarga limpia...');
  const { error: delErr } = await supabase.from('price_tiers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delErr) {
    console.error('Error borrando price_tiers:', delErr.message);
  }

  // Populate price_tiers
  console.log('Procesando e insertando price_tiers con soporte para rangos de volumen...');
  const tiersToInsert: any[] = [];
  
  for (const [ref, p] of uniqueByRef) {
    const uuid = prodMap.get(ref);
    if (!uuid) continue; // Skip if product doesn't exist locally

    const desc = p.descripcion || '';
    const minQtyMatch = desc.match(/Venta m.nima.*caja de (\d+)/i);
    const minQty = minQtyMatch ? parseInt(minQtyMatch[1]) : null;

    const parsedTiers = parsePriceTiers(p.precio, minQty);
    for (const t of parsedTiers) {
      tiersToInsert.push({
        product_id: uuid,
        variant: t.variant,
        min_qty: t.min_qty,
        max_qty: t.max_qty,
        price: t.price,
        price_basis: t.price_basis,
        currency: 'COP',
        source_sheet: 'catalogo_productos.csv'
      });
    }
  }

  console.log(`Insertando ${tiersToInsert.length} price_tiers en la base de datos local...`);
  for (let i = 0; i < tiersToInsert.length; i += 100) {
    const batch = tiersToInsert.slice(i, i + 100);
    const { error } = await supabase.from('price_tiers').insert(batch);
    if (error) console.error(`Error en lote ${i}:`, error.message);
  }

  console.log('¡Importación local completada!');

  // Verify local SO-65
  console.log('\n=== VERIFICACIÓN LOCAL SO-65 (Paraguas Kenny) ===');
  const so65Id = prodMap.get('SO-65');
  if (so65Id) {
    const { data: dbTiers } = await supabase.from('price_tiers').select('*').eq('product_id', so65Id);
    console.log(`Price tiers en DB local para SO-65: ${dbTiers?.length || 0}`);
    dbTiers?.forEach(t => console.log(`  Cantidad ${t.min_qty} - ${t.max_qty || '∞'} → $${t.price} COP`));
    
    // Test RPC
    const { data: rpc } = await (supabase as any).rpc('get_product_price_tiers', { p_product_id: so65Id });
    console.log('Resultado RPC Local:', JSON.stringify(rpc));
  } else {
    console.log('SO-65 no existe en la base de datos local');
  }
}

run().catch(console.error);
