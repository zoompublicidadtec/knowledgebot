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

  // 1. Obtener productos y categorías existentes en la BD con paginación (PostgREST limita a 1000 por request)
  let existingProducts: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('products').select('id, reference').range(from, from + 999);
    if (error) {
      console.error('Error consultando productos existentes:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    existingProducts.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const existingIds = new Set((existingProducts || []).map(p => p.id).filter(Boolean));
  const existingRefs = new Set((existingProducts || []).map(p => p.reference).filter(Boolean));
  
  let existingCategories: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await supabase.from('categories').select('id, name').range(from, from + 999);
    if (error) {
      console.error('Error consultando categorías existentes:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    existingCategories.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const catMap = new Map((existingCategories || []).map(c => [c.name.toUpperCase(), c.id]));

  // 2. Cargar JSON local
  const jsonPath = path.join(process.cwd(), 'Motor de Conocimiento/data/products/all_products.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('No se encontró all_products.json en la ruta:', jsonPath);
    process.exit(1);
  }
  const ragProducts = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`Productos en JSON: ${ragProducts.length}. Ya existentes en BD (por ID o Ref): ${existingIds.size + existingRefs.size}`);

  const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);

  // Filtrar solo los nuevos
  const newProducts = ragProducts.filter((p: any) => p.product_id && !existingIds.has(p.product_id) && !existingRefs.has(p.product_id));
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

  // 4. Preparar baches evitando duplicados internos
  const seenIds = new Set<string>();
  const seenRefs = new Set<string>();
  const productsToInsert: any[] = [];
  const tiersToInsert: any[] = [];

  for (const p of newProducts) {
    const isIdUuid = isUUID(p.product_id);
    const uuid = isIdUuid ? p.product_id : generateUUID();
    const ref = isIdUuid ? (p.reference || null) : p.product_id;

    if (seenIds.has(uuid) || (ref && seenRefs.has(ref))) {
      continue;
    }
    seenIds.add(uuid);
    if (ref) seenRefs.add(ref);
    const catId = catMap.get((p.category || '').toUpperCase()) || null;
    const priceStr = String(p.price || "$0");
    const priceNum = parseInt(priceStr.replace(/[^0-9]/g, ''), 10) || 0;
    
    productsToInsert.push({
      id: uuid,
      category_id: catId,
      name: p.name,
      reference: ref,
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
