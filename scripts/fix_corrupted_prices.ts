/**
 * fix_corrupted_prices.ts
 * 
 * Diagnóstico y corrección de precios corruptos en Supabase.
 * 
 * CAUSA RAÍZ: El campo "price" en all_products.json NO es siempre un valor simple
 * como "$1.795". Muchos productos tienen bloques de texto con múltiples precios,
 * variantes y descripciones. El parser original hacía:
 *   parseInt(priceStr.replace(/[^0-9]/g, ''))
 * lo que concatenaba TODOS los dígitos del bloque en un número astronómico.
 * 
 * SOLUCIÓN: Extraer SOLO el primer precio válido en formato colombiano ($X.XXX)
 * y recalcular el precio correcto para cada producto afectado.
 */

import './load-env';
import { createAdminClient } from '../lib/supabase/admin';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Extrae el primer precio válido en COP de un string de precio crudo.
 * 
 * Formatos que maneja:
 *   "$1.795"           → 1795
 *   "$19.230"          → 19230
 *   "$1.300.000"       → 1300000
 *   "$2.750 Colores sólidos$3.020 Fibra..." → 2750 (toma el primero)
 *   "Precio de 10 a 99 unidades: $44.240..." → 44240 (toma el primero)
 *   "$495 unidad..."   → 495
 *   "200-999 unidades $525 solo la marca" → 525 (toma el primer $)
 */
function parseFirstPrice(raw: string): number {
  if (!raw || raw.trim() === '' || raw === '$0') return 0;

  // Buscar todos los patrones de precio con signo $ seguido de dígitos y puntos
  // Formato colombiano: $1.795 = 1795 COP (el punto es separador de miles)
  const priceMatches = raw.match(/\$[\d]+(?:\.[\d]{3})*/g);

  if (priceMatches && priceMatches.length > 0) {
    // Tomar el PRIMER precio encontrado
    const firstMatch = priceMatches[0];
    // Quitar $ y puntos de miles, quedarnos con el número limpio
    const cleaned = firstMatch.replace('$', '').replace(/\./g, '');
    const num = parseInt(cleaned, 10);
    if (!isNaN(num) && num > 0 && num < 50_000_000) {
      return num;
    }
  }

  // Fallback: buscar números precedidos de $ sin formato de miles
  // Ej: "$495 unidad" o "$340 Litoresina"
  const simpleMatch = raw.match(/\$([\d]+)/);
  if (simpleMatch) {
    const num = parseInt(simpleMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 50_000_000) {
      return num;
    }
  }

  return 0;
}

async function run() {
  const supabase = createAdminClient();

  // 1. Cargar JSON original para tener el price crudo
  const jsonPath = path.join(process.cwd(), 'Motor de Conocimiento/data/products/all_products.json');
  const ragProducts: any[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  console.log(`📦 Productos en JSON: ${ragProducts.length}`);

  // Crear mapa: reference (product_id del RAG) → price string crudo
  const priceMap = new Map<string, string>();
  for (const p of ragProducts) {
    if (p.product_id && p.price) {
      priceMap.set(p.product_id, p.price);
    }
  }

  // 2. Obtener TODOS los productos importados del RAG (tienen reference no nulo)
  // Supabase limita a 1000 filas por consulta, así que paginamos
  const dbProducts: any[] = [];
  const PAGE_SIZE = 1000;
  let page = 0;
  while (true) {
    const { data: batch, error } = await supabase
      .from('products')
      .select('id, reference, name')
      .not('reference', 'is', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) {
      console.error('❌ Error consultando productos:', error.message);
      return;
    }
    if (!batch || batch.length === 0) break;
    dbProducts.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    page++;
  }

  console.log(`🗃️  Productos con reference en BD: ${dbProducts.length}`);

  // 3. Diagnosticar y corregir precios
  let correctedCount = 0;
  let skippedCount = 0;
  let zeroCount = 0;
  let errorCount = 0;
  const corrections: { product_id: string; ref: string; name: string; oldRaw: string; newPrice: number }[] = [];

  for (const prod of dbProducts) {
    const rawPrice = priceMap.get(prod.reference);
    if (!rawPrice) {
      skippedCount++;
      continue;
    }

    const correctPrice = parseFirstPrice(rawPrice);

    // Obtener precio actual en price_tiers
    const { data: tiers } = await (supabase as any)
      .from('price_tiers')
      .select('id, price')
      .eq('product_id', prod.id)
      .eq('variant', 'Estándar')
      .limit(1)
      .maybeSingle();

    if (!tiers) {
      // No tiene tier, si hay precio válido crear uno
      if (correctPrice > 0) {
        const { error: insertErr } = await (supabase as any)
          .from('price_tiers')
          .insert({
            product_id: prod.id,
            variant: 'Estándar',
            min_qty: 1,
            max_qty: null,
            price: correctPrice,
            price_basis: 'unitario',
            currency: 'COP'
          });
        if (!insertErr) {
          correctedCount++;
          corrections.push({ product_id: prod.id, ref: prod.reference, name: prod.name, oldRaw: '(sin tier)', newPrice: correctPrice });
        }
      }
      continue;
    }

    const currentPrice = tiers.price;

    // ¿El precio actual es razonable? (< 50 millones COP)
    if (currentPrice > 0 && currentPrice < 50_000_000) {
      // El precio actual parece correcto, verificar si coincide
      if (correctPrice > 0 && Math.abs(currentPrice - correctPrice) > 1) {
        // Hay diferencia, corregir
        const { error: updateErr } = await (supabase as any)
          .from('price_tiers')
          .update({ price: correctPrice })
          .eq('id', tiers.id);
        if (!updateErr) {
          correctedCount++;
          corrections.push({ product_id: prod.id, ref: prod.reference, name: prod.name, oldRaw: `${currentPrice} → ${correctPrice}`, newPrice: correctPrice });
        }
      }
      continue;
    }

    // Precio corrupto (> 50M o negativo)
    if (correctPrice > 0) {
      const { error: updateErr } = await (supabase as any)
        .from('price_tiers')
        .update({ price: correctPrice })
        .eq('id', tiers.id);
      if (!updateErr) {
        correctedCount++;
        corrections.push({ product_id: prod.id, ref: prod.reference, name: prod.name, oldRaw: `CORRUPTO ${currentPrice}`, newPrice: correctPrice });
      } else {
        errorCount++;
      }
    } else {
      // El precio no se puede parsear del JSON original, eliminar el tier corrupto
      await (supabase as any).from('price_tiers').delete().eq('id', tiers.id);
      zeroCount++;
    }
  }

  // 4. Reporte
  console.log('\n=========================================');
  console.log(`✅ Precios corregidos: ${correctedCount}`);
  console.log(`⏭️  Sin cambios necesarios: ${skippedCount}`);
  console.log(`🗑️  Tiers eliminados (precio no parseable): ${zeroCount}`);
  console.log(`❌ Errores: ${errorCount}`);
  console.log('=========================================');

  if (corrections.length > 0) {
    console.log('\n📋 Detalle de correcciones (primeras 50):');
    corrections.slice(0, 50).forEach(c => {
      console.log(`  ${c.ref} | ${c.name} | ${c.oldRaw} → $${c.newPrice} COP`);
    });
    if (corrections.length > 50) {
      console.log(`  ... y ${corrections.length - 50} más.`);
    }
  }

  // 5. Verificación final: ¿quedan precios > 50M?
  const { data: stillCorrupt } = await (supabase as any)
    .from('price_tiers')
    .select('product_id, price')
    .gt('price', 50_000_000)
    .limit(5);

  if (stillCorrupt && stillCorrupt.length > 0) {
    console.log(`\n⚠️  ADVERTENCIA: Aún quedan ${stillCorrupt.length}+ precios > $50M COP en price_tiers.`);
  } else {
    console.log('\n🎉 ¡Todos los precios están dentro del rango válido!');
  }
}

run().catch(console.error);
