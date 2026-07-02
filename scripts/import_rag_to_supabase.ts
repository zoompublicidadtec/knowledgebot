import { createAdminClient } from '../lib/supabase/admin';
import * as fs from 'fs';
import * as path from 'path';

// Cargar variables de entorno desde .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function run() {
  console.log('Iniciando importación del catálogo RAG a Supabase...');
  const supabase = createAdminClient();

  // 1. Obtener productos y categorías existentes en la BD para evitar duplicados
  const { data: existingProducts, error: prodFetchError } = await supabase.from('products').select('reference');
  if (prodFetchError) {
    console.error('Error consultando productos existentes:', prodFetchError.message);
    process.exit(1);
  }
  const existingRefs = new Set((existingProducts || []).map(p => p.reference).filter(Boolean));
  
  const { data: existingCategories, error: catFetchError } = await supabase.from('categories').select('id, name');
  if (catFetchError) {
    console.error('Error consultando categorías existentes:', catFetchError.message);
    process.exit(1);
  }
  const catMap = new Map((existingCategories || []).map(c => [c.name.toUpperCase(), c.id]));

  // 2. Cargar JSON local
  const jsonPath = path.join(process.cwd(), 'Motor de Conocimiento/data/products/all_products.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('No se encontró all_products.json en la ruta:', jsonPath);
    process.exit(1);
  }
  const ragProducts = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Productos en JSON: ${ragProducts.length}. Ya existentes en BD: ${existingRefs.size}`);

  // Filtrar solo los nuevos
  const newProducts = ragProducts.filter((p: any) => p.product_id && !existingRefs.has(p.product_id));
  console.log(`Productos nuevos a importar: ${newProducts.length}`);

  if (newProducts.length === 0) {
    console.log('No hay productos nuevos para importar.');
    return;
  }

  // 3. Crear categorías nuevas
  const uniqueCategories = Array.from(new Set(newProducts.map((p: any) => p.category).filter(Boolean) as string[]));
  for (const catName of uniqueCategories) {
    const key = catName.toUpperCase();
    if (!catMap.has(key)) {
      const { data: newCat, error } = await supabase.from('categories').insert({ name: catName }).select('id').single();
      if (newCat) {
        catMap.set(key, newCat.id);
        console.log(`Categoría creada: ${catName}`);
      } else {
        console.error(`Error creando categoría ${catName}:`, error?.message);
      }
    }
  }

  // 4. Preparar baches
  const productsToInsert: any[] = [];
  const tiersToInsert: any[] = [];

  for (const p of newProducts) {
    const uuid = generateUUID();
    const catId = catMap.get((p.category || '').toUpperCase()) || null;
    const priceStr = p.price || "$0";
    const priceNum = parseInt(priceStr.replace(/[^0-9]/g, ''), 10) || 0;
    
    productsToInsert.push({
      id: uuid,
      category_id: catId,
      name: p.name,
      reference: p.product_id, // Código del catálogo (ej: Bol Flaggy, ASTON-ECO)
      description: p.description || null,
      unit: p.unit || 'unidad',
      active: true,
      search_text: `${p.category || ''} - ${p.subcategory || ''} - ${p.name} - ${p.description || ''}`
    });

    if (priceNum > 0) {
      tiersToInsert.push({
        product_id: uuid,
        variant: 'Estándar',
        min_qty: 1,
        max_qty: null,
        price: priceNum,
        price_basis: 'unitario',
        currency: 'COP'
      });
    }
  }

  // 5. Insertar productos en lotes de 100
  console.log(`Insertando ${productsToInsert.length} productos a la base de datos...`);
  for (let i = 0; i < productsToInsert.length; i += 100) {
    const batch = productsToInsert.slice(i, i + 100);
    const { error } = await supabase.from('products').insert(batch);
    if (error) {
      console.error(`Error insertando lote de productos (${i}-${i + batch.length}):`, error.message);
    } else {
      console.log(`Productos insertados: ${i + batch.length}/${productsToInsert.length}`);
    }
  }

  // 6. Insertar precios en lotes de 100
  console.log(`Insertando ${tiersToInsert.length} registros de precios a la base de datos...`);
  for (let i = 0; i < tiersToInsert.length; i += 100) {
    const batch = tiersToInsert.slice(i, i + 100);
    const { error } = await supabase.from('price_tiers').insert(batch);
    if (error) {
      console.error(`Error insertando lote de precios (${i}-${i + batch.length}):`, error.message);
    } else {
      console.log(`Precios insertados: ${i + batch.length}/${tiersToInsert.length}`);
    }
  }

  console.log('¡Importación masiva a Supabase completada con éxito!');
}

run().catch(console.error);
