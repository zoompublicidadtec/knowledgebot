import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Parse CSV manually since papaparse is failing TS check in Next.js environment
function parseCSV(content: string) {
  const lines = content.split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const results = [];
  
  for (let i = 1; i < lines.length; i++) {
    // Regex to split by comma except inside quotes
    const regex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;
    const values = lines[i].split(regex).map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"'));
    if (values.length < 2) continue; // Skip empty rows
    
    const row: any = {};
    headers.forEach((h, index) => {
      row[h] = values[index] !== undefined ? values[index] : null;
      if (row[h] === '') row[h] = null;
    });
    results.push(row);
  }
  return results;
}

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
  console.log('Iniciando importación del catálogo...');
  
  const productsCsv = fs.readFileSync('products.csv', 'utf8');
  const productsData = parseCSV(productsCsv);
  
  const priceTiersCsv = fs.readFileSync('price_tiers.csv', 'utf8');
  const priceTiersData = parseCSV(priceTiersCsv);
  
  const rulesCsv = fs.readFileSync('area_pricing_rules.csv', 'utf8');
  const rulesData = parseCSV(rulesCsv);

  // 1. Extraer y crear categorias
  console.log('Creando categorias...');
  const uniqueCategories = [...new Set(productsData.map(p => p.category).filter(Boolean))];
  
  for (const catName of uniqueCategories) {
    // Intentar insertar ignorando conflictos (necesita constraint unique)
    // Como no sabemos si hay constraint unique en name, buscamos primero
    const { data: existing } = await supabase.from('categories').select('id').eq('name', catName).single();
    if (!existing) {
      await supabase.from('categories').insert({ name: catName });
    }
  }
  
  const { data: categories } = await supabase.from('categories').select('*');
  const catMap = new Map(categories!.map(c => [c.name, c.id]));

  // 2. Insertar productos
  console.log('Insertando productos...');
  const productsToInsert = productsData.map(p => ({
    id: p.id,
    category_id: catMap.get(p.category),
    name: p.name,
    description: p.description,
    unit: p.unit,
    notes: p.notes,
    price_includes_iva: p.price_includes_iva === 'True' || p.price_includes_iva === 'true',
    min_order_qty: p.min_order_qty ? parseInt(p.min_order_qty) : null,
    search_text: p.search_text
  }));
  
  // Limpiar antes por si acaso
  // await supabase.from('area_pricing_rules').delete().neq('product_id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('price_tiers').delete().neq('product_id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');

  // Insertar en baches de 100
  for (let i = 0; i < productsToInsert.length; i += 100) {
    const batch = productsToInsert.slice(i, i + 100);
    const { error } = await supabase.from('products').insert(batch);
    if (error) console.error('Error insertando productos:', error);
  }

  // 3. Insertar price_tiers
  console.log('Insertando niveles de precios...');
  const tiersToInsert = priceTiersData.map(t => ({
    product_id: t.product_id,
    variant: t.variant || 'Estándar',
    min_qty: parseInt(t.min_qty),
    max_qty: t.max_qty && t.max_qty !== 'null' && t.max_qty !== '' ? parseInt(t.max_qty) : null,
    price: parseFloat(t.price),
    price_basis: t.price_basis || 'unitario',
    currency: t.currency || 'COP',
    source_sheet: t.source_sheet || null
  }));
  
  for (let i = 0; i < tiersToInsert.length; i += 100) {
    const batch = tiersToInsert.slice(i, i + 100);
    const { error } = await supabase.from('price_tiers').insert(batch);
    if (error) console.error('Error insertando precios:', error);
  }

  console.log('¡Catálogo importado exitosamente!');
}

run().catch(console.error);
