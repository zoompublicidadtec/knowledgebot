/**
 * Pipeline de Importación Masiva y Normalización (Fase 4)
 * 
 * Este script está diseñado para leer el JSON/CSV que genere la otra IA
 * desde el web scraping. Valida los datos, asigna categorías/subcategorías
 * dinámicamente, e inserta todo en Supabase.
 * 
 * Uso: node scripts/import_products.js <ruta-al-json-scraped>
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function normalizeAndImport(filePath) {
  console.log(`🚀 Iniciando pipeline de importación masiva desde: ${filePath}`);
  
  if (!fs.existsSync(filePath)) {
    console.error('❌ Error: Archivo no encontrado.');
    return;
  }

  const rawData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`📦 Encontrados ${rawData.length} productos para procesar.`);

  let successCount = 0;
  let errorCount = 0;

  for (const item of rawData) {
    try {
      // 1. Normalización de Categoría
      // Si el scraper entrega "Bolígrafos > Plásticos", lo separamos
      let catName = item.categoria || 'Generales';
      let subName = item.subcategoria || 'Estándar';

      if (item.categoria && item.categoria.includes('>')) {
        const parts = item.categoria.split('>');
        catName = parts[0].trim();
        subName = parts[1].trim();
      }

      // Buscar o crear Categoría Padre
      let { data: catData } = await supabase.from('categories').select('id').eq('name', catName).single();
      if (!catData) {
        const { data: newCat } = await supabase.from('categories').insert({ name: catName }).select('id').single();
        catData = newCat;
        console.log(`📁 Nueva categoría creada: ${catName}`);
      }

      // Buscar o crear Subcategoría
      let { data: subData } = await supabase.from('subcategories')
        .select('id').eq('category_id', catData.id).eq('name', subName).single();
      if (!subData) {
        const { data: newSub } = await supabase.from('subcategories')
          .insert({ category_id: catData.id, name: subName }).select('id').single();
        subData = newSub;
      }

      // 2. Normalización de Precio y Prevención de $0
      let basePrice = parseFloat(item.precio) || 0;
      if (basePrice <= 0) {
        console.warn(`⚠️ Advertencia: El producto "${item.nombre}" tiene precio 0. Se ignorará la tabla de precios.`);
      }

      // 3. Crear Producto
      const searchText = `${catName} - ${subName} - ${item.nombre} - ${item.descripcion || ''}`.trim();
      
      const { data: productData, error: prodErr } = await supabase.from('products').insert({
        category_id: catData.id,
        subcategory_id: subData.id,
        name: item.nombre,
        reference: item.referencia || null,
        description: item.descripcion || null,
        unit: item.unidad || 'unidad',
        min_order_qty: item.cantidad_minima || 1,
        active: true,
        search_text: searchText
      }).select('id').single();

      if (prodErr) throw prodErr;

      // 4. Crear Atributos de Producto (Material, Tamaño, etc)
      if (item.atributos && typeof item.atributos === 'object') {
        const attrsToInsert = Object.entries(item.atributos).map(([key, value]) => ({
          product_id: productData.id,
          attribute_key: key,
          attribute_value: String(value)
        }));
        if (attrsToInsert.length > 0) {
          await supabase.from('product_attributes').insert(attrsToInsert);
        }
      }

      // 5. Crear Tabla de Precios Básica
      if (basePrice > 0) {
        await supabase.from('price_tiers').insert({
          product_id: productData.id,
          variant: 'Estándar',
          min_qty: item.cantidad_minima || 1,
          max_qty: null,
          price: basePrice,
          price_basis: 'unitario'
        });
      }

      successCount++;
    } catch (err) {
      console.error(`❌ Error procesando producto "${item.nombre}":`, err.message);
      errorCount++;
    }
  }

  console.log('=========================================');
  console.log(`✅ Importación completada: ${successCount} exitosos, ${errorCount} errores.`);
  console.log('=========================================');
}

// Ejemplo de formato JSON esperado:
/*
[
  {
    "nombre": "Bolígrafo Parker",
    "referencia": "BP-01",
    "categoria": "Bolígrafos > Metálicos",
    "descripcion": "Bolígrafo de lujo con estuche",
    "precio": 15000,
    "unidad": "unidad",
    "cantidad_minima": 10,
    "atributos": {
      "material": "Metal",
      "color": "Azul"
    }
  }
]
*/

const targetFile = process.argv[2];
if (targetFile) {
  normalizeAndImport(targetFile);
} else {
  console.log('Ejecuta el script enviando la ruta al archivo JSON.');
}
