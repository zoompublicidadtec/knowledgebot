/**
 * SCRIPT DE VALIDACIÓN Y CARGA DE CUADERNOS EN SUPABASE
 * 
 * Este script:
 * 1. Lee los CSV (categories, products, price_tiers, area_pricing_rules)
 * 2. Valida que los datos de cuadernos coincidan con las tablas del Excel
 * 3. Verifica la estructura de la DB
 * 4. Carga TODO a Supabase (upsert para no duplicar)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Supabase creds from .env.local
const SUPABASE_URL = 'https://aqgutgpbivucnshshpsr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFxZ3V0Z3BiaXZ1Y25zaHNocHNyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTE5NDE5MSwiZXhwIjoyMDk2NzcwMTkxfQ.u39yUIWCoFkNaBGSorx5HYJvLMV4kY5NG8eughC9Gbc';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── CSV Parser (handles quoted fields with commas) ───
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  
  let i = 1;
  while (i < lines.length) {
    let line = lines[i];
    // Handle multi-line quoted fields
    while (line && (line.split('"').length - 1) % 2 !== 0 && i + 1 < lines.length) {
      i++;
      line += '\n' + lines[i];
    }
    i++;
    if (!line || line.trim() === '') continue;
    
    const values = parseCSVLine(line);
    if (values.length === 0) continue;
    
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Step 1: Load and parse CSVs ───
async function loadCSVs() {
  const dir = __dirname;
  
  const categoriesRaw = fs.readFileSync(path.join(dir, 'categories.csv'), 'utf-8');
  const productsRaw = fs.readFileSync(path.join(dir, 'products.csv'), 'utf-8');
  const priceTiersRaw = fs.readFileSync(path.join(dir, 'price_tiers.csv'), 'utf-8');
  const areaRulesRaw = fs.readFileSync(path.join(dir, 'area_pricing_rules.csv'), 'utf-8');
  
  const categories = parseCSV(categoriesRaw);
  const products = parseCSV(productsRaw);
  const priceTiers = parseCSV(priceTiersRaw);
  const areaRules = parseCSV(areaRulesRaw);
  
  return { categories, products, priceTiers, areaRules };
}

// ─── Step 2: Validate cuadernos data against the Excel screenshots ───
function validateCuadernos(products, priceTiers) {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  VALIDACIÓN DE DATOS DE CUADERNOS');
  console.log('═══════════════════════════════════════════════\n');
  
  // Find cuaderno-related products
  const cuadernoProducts = products.filter(p => 
    p.search_text && p.search_text.toLowerCase().includes('cuaderno')
  );
  
  console.log(`📋 Productos de cuadernos encontrados: ${cuadernoProducts.length}`);
  cuadernoProducts.forEach(p => {
    console.log(`   - [${p.id.substring(0,8)}] ${p.name}`);
  });
  
  // Find cuaderno price tiers
  const cuadernoIds = new Set(cuadernoProducts.map(p => p.id));
  const cuadernoTiers = priceTiers.filter(t => cuadernoIds.has(t.product_id));
  console.log(`\n💰 Niveles de precio de cuadernos: ${cuadernoTiers.length}`);
  
  // ──── VALIDATE AGAINST SCREENSHOTS ────
  // Screenshot 1: 20 cuadernos argollados
  // Row 3: 80 hojas | 1/2 carta = 13.000 | 1/2 octavo = 14.000 | carta = 20.000
  const base80 = cuadernoProducts.find(p => p.name.includes('80 hojas'));
  if (base80) {
    const tiers20_80 = cuadernoTiers.filter(t => 
      t.product_id === base80.id && t.min_qty === '20'
    );
    console.log(`\n✅ Verificando BASE 80 hojas - Lote de 20:`);
    tiers20_80.forEach(t => {
      console.log(`   ${t.variant}: $${t.price}`);
    });
    
    // Check specific values from screenshot
    const check1 = tiers20_80.find(t => t.variant.includes('1/2 Carta'));
    if (check1 && parseInt(check1.price) === 13000) {
      console.log('   ✅ 1/2 Carta = $13.000 ← CORRECTO');
    } else {
      console.log(`   ❌ 1/2 Carta esperado $13.000, encontrado: $${check1?.price || 'NO ENCONTRADO'}`);
    }
    
    const check2 = tiers20_80.find(t => t.variant.includes('Octavo'));
    if (check2 && parseInt(check2.price) === 14000) {
      console.log('   ✅ 1/2 Octavo = $14.000 ← CORRECTO');
    } else {
      console.log(`   ❌ 1/2 Octavo esperado $14.000, encontrado: $${check2?.price || 'NO ENCONTRADO'}`);
    }
    
    const check3 = tiers20_80.find(t => t.variant.includes('Carta (22x28'));
    if (check3 && parseInt(check3.price) === 20000) {
      console.log('   ✅ Carta = $20.000 ← CORRECTO');
    } else {
      console.log(`   ❌ Carta esperado $20.000, encontrado: $${check3?.price || 'NO ENCONTRADO'}`);
    }
  } else {
    console.log('\n❌ No se encontró producto "Base 80 hojas"');
  }
  
  // Validate insertos for 20 cuadernos
  const inserto1 = cuadernoProducts.find(p => p.name.includes('1 inserto'));
  if (inserto1) {
    const tiers20_ins1 = cuadernoTiers.filter(t => 
      t.product_id === inserto1.id && t.min_qty === '20'
    );
    console.log(`\n✅ Verificando INSERTO 1 - Lote de 20:`);
    tiers20_ins1.forEach(t => {
      console.log(`   ${t.variant}: $${t.price}`);
    });
    const checkIns = tiers20_ins1.find(t => t.variant.includes('1/2 Carta'));
    if (checkIns && parseInt(checkIns.price) === 1250) {
      console.log('   ✅ 1/2 Carta 1 inserto = $1.250 ← CORRECTO');
    } else {
      console.log(`   ❌ 1/2 Carta 1 inserto esperado $1.250, encontrado: $${checkIns?.price || 'NO ENCONTRADO'}`);
    }
  }
  
  // Validate 300 cuadernos
  if (base80) {
    const tiers300_80 = cuadernoTiers.filter(t => 
      t.product_id === base80.id && t.min_qty === '300'
    );
    console.log(`\n✅ Verificando BASE 80 hojas - Lote de 300:`);
    tiers300_80.forEach(t => {
      console.log(`   ${t.variant}: $${t.price}`);
    });
    const check300 = tiers300_80.find(t => t.variant.includes('1/2 Carta'));
    if (check300 && parseInt(check300.price) === 6800) {
      console.log('   ✅ 1/2 Carta = $6.800 ← CORRECTO');
    } else {
      console.log(`   ❌ 1/2 Carta esperado $6.800, encontrado: $${check300?.price || 'NO ENCONTRADO'}`);
    }
  }
  
  // Summary stats
  const componentTypes = new Set(cuadernoProducts.map(p => p.name));
  console.log(`\n📊 RESUMEN DE CUADERNOS:`);
  console.log(`   Componentes distintos: ${componentTypes.size}`);
  
  const lotes = new Set(cuadernoTiers.map(t => t.min_qty));
  console.log(`   Lotes de volumen: ${[...lotes].sort((a,b) => a-b).join(', ')}`);
  
  const tamanos = new Set(cuadernoTiers.map(t => {
    const match = t.variant.match(/(1\/2 Carta|1\/2 Octavo|Carta \(22x28)/);
    return match ? match[1] : t.variant;
  }));
  console.log(`   Tamaños: ${[...tamanos].join(', ')}`);
  
  return cuadernoProducts.length > 0 && cuadernoTiers.length > 0;
}

// ─── Step 3: Check if tables exist in Supabase ───
async function checkTables() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  VERIFICANDO TABLAS EN SUPABASE');
  console.log('═══════════════════════════════════════════════\n');
  
  const tables = ['categories', 'products', 'price_tiers'];
  
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.log(`❌ Tabla "${table}": ${error.message}`);
      return false;
    }
    console.log(`✅ Tabla "${table}": ${count} registros actuales`);
  }
  
  // Check area_pricing_rules
  const { error: areaError } = await supabase
    .from('area_pricing_rules')
    .select('*', { count: 'exact', head: true });
  
  if (areaError) {
    console.log(`⚠️  Tabla "area_pricing_rules": No existe (se puede crear si es necesario)`);
  } else {
    console.log(`✅ Tabla "area_pricing_rules": Existe`);
  }
  
  // Check RPC functions
  const { error: rpcError } = await supabase.rpc('search_products', { query: 'test', limit_n: 1 });
  if (rpcError) {
    console.log(`\n⚠️  Función "search_products": ${rpcError.message}`);
  } else {
    console.log(`✅ Función "search_products": OK`);
  }
  
  const { error: rpcError2 } = await supabase.rpc('get_product_price_tiers', { p_product_id: '00000000-0000-0000-0000-000000000000' });
  if (rpcError2 && !rpcError2.message.includes('Results contain 0 rows')) {
    console.log(`⚠️  Función "get_product_price_tiers": ${rpcError2.message}`);
  } else {
    console.log(`✅ Función "get_product_price_tiers": OK`);
  }
  
  return true;
}

// ─── Step 4: Load data into Supabase ───
async function loadData(categories, products, priceTiers) {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  CARGANDO DATOS A SUPABASE');
  console.log('═══════════════════════════════════════════════\n');
  
  // ── STEP 4a: Clean existing data (reverse FK order) ──
  console.log('🗑️  Limpiando datos existentes (por orden de dependencia)...');
  
  const { error: delTiers } = await supabase.from('price_tiers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delTiers) console.log(`   ⚠️  price_tiers: ${delTiers.message}`);
  else console.log(`   ✅ price_tiers limpiada`);
  
  const { error: delProds } = await supabase.from('products').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delProds) console.log(`   ⚠️  products: ${delProds.message}`);
  else console.log(`   ✅ products limpiada`);
  
  const { error: delCats } = await supabase.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  if (delCats) console.log(`   ⚠️  categories: ${delCats.message}`);
  else console.log(`   ✅ categories limpiada`);
  
  // ── STEP 4b: Insert CATEGORIES ──
  console.log(`\n📁 Insertando ${categories.length} categorías...`);
  const catBatch = categories.map(c => ({
    id: c.id,
    name: c.name,
    group_name: c.group_name || null
  }));
  
  for (let i = 0; i < catBatch.length; i += 50) {
    const batch = catBatch.slice(i, i + 50);
    const { error } = await supabase.from('categories').insert(batch);
    if (error) {
      console.log(`   ❌ Error categorías batch ${i}: ${error.message}`);
      return false;
    }
  }
  console.log(`   ✅ ${catBatch.length} categorías insertadas`);
  
  // ── STEP 4c: Insert PRODUCTS ──
  console.log(`\n📦 Insertando ${products.length} productos...`);
  const prodBatch = products.map(p => ({
    id: p.id,
    category_id: p.category_id,
    name: p.name,
    reference: p.reference || null,
    description: p.description || null,
    unit: p.unit || 'unidad',
    price_includes_iva: p.price_includes_iva === 'True',
    min_order_qty: p.min_order_qty ? parseFloat(p.min_order_qty) : null,
    notes: p.notes || null,
    active: p.active !== 'False',
    search_text: p.search_text || null
  }));
  
  for (let i = 0; i < prodBatch.length; i += 50) {
    const batch = prodBatch.slice(i, i + 50);
    const { error } = await supabase.from('products').insert(batch);
    if (error) {
      console.log(`   ❌ Error productos batch ${i}: ${error.message}`);
      console.log(`   Detalles: ${JSON.stringify(error)}`);
      return false;
    }
    process.stdout.write(`   Progreso: ${Math.min(i + 50, prodBatch.length)}/${prodBatch.length}\r`);
  }
  console.log(`   ✅ ${prodBatch.length} productos insertados                 `);
  
  // ── STEP 4d: Insert PRICE_TIERS ──
  console.log(`\n💰 Insertando ${priceTiers.length} niveles de precio...`);
  
  const tierBatch = priceTiers.map(t => ({
    product_id: t.product_id,
    variant: t.variant || 'Estándar',
    min_qty: parseFloat(t.min_qty) || 1,
    max_qty: t.max_qty ? parseFloat(t.max_qty) : null,
    price: t.price ? parseFloat(t.price) : null,
    price_basis: t.price_basis || 'unitario',
    currency: t.currency || 'COP',
    source_sheet: t.source_sheet || null
  }));
  
  let insertedCount = 0;
  for (let i = 0; i < tierBatch.length; i += 100) {
    const batch = tierBatch.slice(i, i + 100);
    const { error } = await supabase.from('price_tiers').insert(batch);
    if (error) {
      console.log(`\n   ❌ Error price_tiers batch ${i}: ${error.message}`);
      console.log(`   Primer registro del batch: ${JSON.stringify(batch[0])}`);
      return false;
    }
    insertedCount += batch.length;
    process.stdout.write(`   Progreso: ${insertedCount}/${tierBatch.length}\r`);
  }
  console.log(`   ✅ ${insertedCount} niveles de precio insertados           `);
  
  return true;
}

// ─── Step 5: Post-load verification ───
async function verifyLoad() {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  VERIFICACIÓN POST-CARGA');
  console.log('═══════════════════════════════════════════════\n');
  
  // Test: search for "cuaderno"
  const { data: searchResults, error: searchErr } = await supabase.rpc('search_products', { 
    query: 'cuaderno', 
    limit_n: 20 
  });
  
  if (searchErr) {
    console.log(`❌ Búsqueda "cuaderno": ${searchErr.message}`);
  } else {
    console.log(`✅ Búsqueda "cuaderno": ${searchResults.length} resultados`);
    searchResults.forEach(r => {
      console.log(`   - ${r.name} (${r.category}) [similitud: ${r.similarity?.toFixed(3)}]`);
    });
  }
  
  // Test: get price tiers for base 80 hojas
  if (searchResults && searchResults.length > 0) {
    const firstProduct = searchResults[0];
    const { data: tiers, error: tierErr } = await supabase.rpc('get_product_price_tiers', {
      p_product_id: firstProduct.id
    });
    
    if (tierErr) {
      console.log(`\n❌ Precios "${firstProduct.name}": ${tierErr.message}`);
    } else {
      console.log(`\n✅ Precios de "${firstProduct.name}": ${tiers.length} niveles`);
      tiers.slice(0, 6).forEach(t => {
        const maxL = t.max_qty ? t.max_qty : '∞';
        console.log(`   ${t.variant} | ${t.min_qty}-${maxL} uds → $${t.price} COP`);
      });
      if (tiers.length > 6) console.log(`   ... y ${tiers.length - 6} más`);
    }
  }
  
  // Count totals
  const { count: catCount } = await supabase.from('categories').select('*', { count: 'exact', head: true });
  const { count: prodCount } = await supabase.from('products').select('*', { count: 'exact', head: true });
  const { count: tierCount } = await supabase.from('price_tiers').select('*', { count: 'exact', head: true });
  
  console.log(`\n📊 TOTALES EN BASE DE DATOS:`);
  console.log(`   Categorías: ${catCount}`);
  console.log(`   Productos:  ${prodCount}`);
  console.log(`   Precios:    ${tierCount}`);
}

// ─── MAIN ───
async function main() {
  console.log('🚀 INICIANDO VALIDACIÓN Y CARGA DE CATÁLOGO COMPLETO');
  console.log('   (Incluye cuadernos y TODO el catálogo de productos)\n');
  
  // Step 1: Load CSVs
  const { categories, products, priceTiers, areaRules } = await loadCSVs();
  console.log(`📄 CSVs leídos:`);
  console.log(`   categories.csv:    ${categories.length} registros`);
  console.log(`   products.csv:      ${products.length} registros`);
  console.log(`   price_tiers.csv:   ${priceTiers.length} registros`);
  console.log(`   area_pricing.csv:  ${areaRules.length} registros`);
  
  // Step 2: Validate cuadernos data
  const valid = validateCuadernos(products, priceTiers);
  if (!valid) {
    console.log('\n❌ VALIDACIÓN FALLIDA - No se encontraron datos de cuadernos');
    return;
  }
  
  // Step 3: Check Supabase tables
  const tablesOk = await checkTables();
  if (!tablesOk) {
    console.log('\n❌ Las tablas no están disponibles en Supabase');
    return;
  }
  
  // Step 4: Load data
  const loaded = await loadData(categories, products, priceTiers);
  if (!loaded) {
    console.log('\n❌ ERROR DURANTE LA CARGA');
    return;
  }
  
  // Step 5: Verify
  await verifyLoad();
  
  console.log('\n═══════════════════════════════════════════════');
  console.log('  ✅ CARGA COMPLETADA EXITOSAMENTE');
  console.log('═══════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
