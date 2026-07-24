import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Parse CSV manually
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
  console.log('Cargando catálogo completo desde data/catalogo_productos.csv...');
  
  const csvPath = path.resolve(process.cwd(), 'data', 'catalogo_productos.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');
  const allProducts = parseCSV(csvContent);
  
  console.log(`Leídos ${allProducts.length} productos del CSV.`);

  // Get existing products by reference to avoid duplicates
  const { data: existingProducts } = await supabase.from('products').select('reference');
  const existingRefs = new Set(existingProducts?.map(p => p.reference));

  const newProducts = allProducts.filter(p => !existingRefs.has(p.referencia));
  console.log(`${newProducts.length} productos son nuevos y serán insertados.`);

  if (newProducts.length === 0) {
    console.log('No hay productos nuevos para insertar.');
    return;
  }

  // 1. Crear categorias
  const uniqueCategories = [...new Set(newProducts.map(p => p.categoria).filter(Boolean))];
  for (const catName of uniqueCategories) {
    const { data: existing } = await supabase.from('categories').select('id').eq('name', catName).single();
    if (!existing) {
      await supabase.from('categories').insert({ name: catName });
    }
  }
  
  const { data: categories } = await supabase.from('categories').select('*');
  const catMap = new Map(categories!.map(c => [c.name, c.id]));

  // 2. Insertar productos
  console.log('Insertando productos faltantes...');
  const productsToInsert = newProducts.map(p => {
    let minQty = null;
    const desc = p.descripcion || '';
    const match = desc.match(/Venta m.nima.*caja de (\d+)/i);
    if (match) minQty = parseInt(match[1]);

    return {
      reference: p.referencia,
      category_id: catMap.get(p.categoria),
      name: p.nombre,
      description: p.descripcion,
      notes: p.marca_tecnica,
      min_order_qty: minQty,
      search_text: `${p.referencia} ${p.nombre} ${p.categoria} ${p.descripcion}`.substring(0, 500)
    };
  });

  const insertedProductsMap = new Map<string, string>(); // ref -> uuid

  for (let i = 0; i < productsToInsert.length; i += 100) {
    const batch = productsToInsert.slice(i, i + 100);
    const { data, error } = await supabase.from('products').insert(batch).select('id, reference');
    if (error) {
        console.error('Error insertando productos:', error);
    } else if (data) {
        data.forEach(d => insertedProductsMap.set(d.reference!, d.id));
    }
  }

  // 3. Insertar price_tiers
  console.log('Insertando niveles de precios de los productos nuevos...');
  const tiersToInsert: any[] = [];
  
  for (const p of newProducts) {
    if (!p.precio) continue;
    const uuid = insertedProductsMap.get(p.referencia);
    if (!uuid) continue;

    // Parse price: $18.900 -> 18900
    let priceStr = p.precio.replace('$', '').replace(/\./g, '').trim();
    let priceNum = parseFloat(priceStr);
    
    if (isNaN(priceNum)) continue;

    let minQty = 1;
    const desc = p.descripcion || '';
    const match = desc.match(/Venta m.nima.*caja de (\d+)/i);
    if (match) minQty = parseInt(match[1]);

    tiersToInsert.push({
      product_id: uuid,
      variant: 'Estándar',
      min_qty: minQty,
      max_qty: null,
      price: priceNum,
      price_basis: 'unitario',
      currency: 'COP',
      source_sheet: 'catalogo_productos.csv'
    });
  }

  for (let i = 0; i < tiersToInsert.length; i += 100) {
    const batch = tiersToInsert.slice(i, i + 100);
    const { error } = await supabase.from('price_tiers').insert(batch);
    if (error) console.error('Error insertando precios:', error);
  }

  console.log('¡Catálogo completo importado exitosamente!');
}

run().catch(console.error);
