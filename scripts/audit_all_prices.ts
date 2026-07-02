/**
 * audit_all_prices.ts
 * 
 * Auditoría TOTAL de precios en Supabase.
 * 
 * Revisa TODOS los productos y clasifica cada uno en:
 *   ✅ OK          — tiene price_tier con precio razonable (1 - 50,000,000 COP)
 *   ⚠️  SOSPECHOSO — precio demasiado bajo (<100) o demasiado alto (>5,000,000)
 *   🔴 SIN PRECIO  — no tiene price_tier → se crea con precio temporal 9999
 *   🟡 PRECIO CERO  — tiene price_tier pero price=0 → se actualiza a 9999
 *   🔵 CORRUPTO     — precio > 50,000,000 → se intenta reparar del JSON original
 */

import './load-env';
import { createAdminClient } from '../lib/supabase/admin';
import * as fs from 'fs';
import * as path from 'path';

const PLACEHOLDER_PRICE = 9999;

function parseFirstPrice(raw: string): number {
  if (!raw || raw.trim() === '' || raw === '$0') return 0;
  const priceMatches = raw.match(/\$[\d]+(?:\.[\d]{3})*/g);
  if (priceMatches && priceMatches.length > 0) {
    const cleaned = priceMatches[0].replace('$', '').replace(/\./g, '');
    const num = parseInt(cleaned, 10);
    if (!isNaN(num) && num > 0 && num < 50_000_000) return num;
  }
  const simpleMatch = raw.match(/\$([\d]+)/);
  if (simpleMatch) {
    const num = parseInt(simpleMatch[1], 10);
    if (!isNaN(num) && num > 0 && num < 50_000_000) return num;
  }
  return 0;
}

async function fetchAllProducts(supabase: any): Promise<any[]> {
  const all: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, reference, category_id, active')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('Error paginando productos:', error.message); break; }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

async function fetchAllTiers(supabase: any): Promise<Map<string, { id: string; price: number }>> {
  const map = new Map<string, { id: string; price: number }>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('price_tiers')
      .select('id, product_id, price, variant')
      .eq('variant', 'Estándar')
      .range(offset, offset + PAGE - 1);
    if (error) { console.error('Error paginando tiers:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const t of data) {
      // Si ya hay uno para este product_id, quedarse con el que tenga precio más razonable
      const existing = map.get(t.product_id);
      if (!existing || (t.price > 0 && t.price < existing.price)) {
        map.set(t.product_id, { id: t.id, price: t.price });
      }
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return map;
}

async function run() {
  const supabase = createAdminClient();

  // Cargar JSON original para intentar reparar precios faltantes
  const jsonPath = path.join(process.cwd(), 'Motor de Conocimiento/data/products/all_products.json');
  const ragProducts: any[] = fs.existsSync(jsonPath)
    ? JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
    : [];
  const rawPriceMap = new Map<string, string>();
  for (const p of ragProducts) {
    if (p.product_id && p.price) rawPriceMap.set(p.product_id, p.price);
  }
  console.log(`📦 JSON original cargado: ${ragProducts.length} productos`);

  // Obtener todos los productos y todos los tiers
  console.log('📊 Cargando productos de Supabase...');
  const allProducts = await fetchAllProducts(supabase);
  console.log(`   Productos en BD: ${allProducts.length}`);

  console.log('💰 Cargando tabla de precios...');
  const tierMap = await fetchAllTiers(supabase);
  console.log(`   Tiers "Estándar" encontrados: ${tierMap.size}`);

  // Clasificar
  const stats = {
    ok: 0,
    suspicious_low: [] as { name: string; ref: string; price: number }[],
    suspicious_high: [] as { name: string; ref: string; price: number }[],
    missing: [] as { name: string; ref: string; assigned: number }[],
    zero: [] as { name: string; ref: string }[],
    corrupt: [] as { name: string; ref: string; was: number; now: number }[],
    errors: 0,
  };

  const tiersToInsert: any[] = [];
  const tiersToUpdate: { id: string; price: number }[] = [];

  for (const prod of allProducts) {
    const tier = tierMap.get(prod.id);
    const ref = prod.reference || '(sin ref)';

    if (!tier) {
      // SIN PRECIO — intentar extraer del JSON, si no, usar placeholder
      let assignedPrice = PLACEHOLDER_PRICE;
      if (prod.reference && rawPriceMap.has(prod.reference)) {
        const parsed = parseFirstPrice(rawPriceMap.get(prod.reference)!);
        if (parsed > 0) assignedPrice = parsed;
      }
      tiersToInsert.push({
        product_id: prod.id,
        variant: 'Estándar',
        min_qty: 1,
        max_qty: null,
        price: assignedPrice,
        price_basis: 'unitario',
        currency: 'COP'
      });
      stats.missing.push({ name: prod.name, ref, assigned: assignedPrice });
      continue;
    }

    const price = tier.price;

    if (price <= 0) {
      // PRECIO CERO — asignar placeholder
      let assignedPrice = PLACEHOLDER_PRICE;
      if (prod.reference && rawPriceMap.has(prod.reference)) {
        const parsed = parseFirstPrice(rawPriceMap.get(prod.reference)!);
        if (parsed > 0) assignedPrice = parsed;
      }
      tiersToUpdate.push({ id: tier.id, price: assignedPrice });
      stats.zero.push({ name: prod.name, ref });
      continue;
    }

    if (price > 50_000_000) {
      // CORRUPTO — intentar reparar
      let correctPrice = PLACEHOLDER_PRICE;
      if (prod.reference && rawPriceMap.has(prod.reference)) {
        const parsed = parseFirstPrice(rawPriceMap.get(prod.reference)!);
        if (parsed > 0) correctPrice = parsed;
      }
      tiersToUpdate.push({ id: tier.id, price: correctPrice });
      stats.corrupt.push({ name: prod.name, ref, was: price, now: correctPrice });
      continue;
    }

    // Precio existe y está en rango, clasificar
    if (price < 100) {
      stats.suspicious_low.push({ name: prod.name, ref, price });
    } else if (price > 5_000_000) {
      stats.suspicious_high.push({ name: prod.name, ref, price });
    } else {
      stats.ok++;
    }
  }

  // Aplicar correcciones en lotes
  if (tiersToInsert.length > 0) {
    console.log(`\n🔧 Insertando ${tiersToInsert.length} tiers faltantes...`);
    for (let i = 0; i < tiersToInsert.length; i += 100) {
      const batch = tiersToInsert.slice(i, i + 100);
      const { error } = await supabase.from('price_tiers').insert(batch);
      if (error) {
        console.error(`   Error en lote ${i}:`, error.message);
        stats.errors++;
      }
    }
  }

  if (tiersToUpdate.length > 0) {
    console.log(`🔧 Actualizando ${tiersToUpdate.length} tiers corruptos/cero...`);
    for (const upd of tiersToUpdate) {
      const { error } = await supabase.from('price_tiers').update({ price: upd.price }).eq('id', upd.id);
      if (error) {
        console.error(`   Error actualizando tier ${upd.id}:`, error.message);
        stats.errors++;
      }
    }
  }

  // REPORTE FINAL
  console.log('\n' + '='.repeat(60));
  console.log('         REPORTE DE AUDITORÍA COMPLETA DE PRECIOS');
  console.log('='.repeat(60));
  console.log(`Total productos en BD:          ${allProducts.length}`);
  console.log(`✅ Precios OK (100-5M COP):      ${stats.ok}`);
  console.log(`🔴 Sin precio (se asignó):       ${stats.missing.length}`);
  console.log(`🟡 Precio cero (se corrigió):    ${stats.zero.length}`);
  console.log(`🔵 Corruptos (se reparó):        ${stats.corrupt.length}`);
  console.log(`⚠️  Sospechosos bajos (<$100):    ${stats.suspicious_low.length}`);
  console.log(`⚠️  Sospechosos altos (>$5M):     ${stats.suspicious_high.length}`);
  console.log(`❌ Errores de escritura:          ${stats.errors}`);
  console.log('='.repeat(60));

  if (stats.missing.length > 0) {
    console.log('\n🔴 PRODUCTOS SIN PRECIO (se asignó precio):');
    const placeholders = stats.missing.filter(m => m.assigned === PLACEHOLDER_PRICE);
    const recovered = stats.missing.filter(m => m.assigned !== PLACEHOLDER_PRICE);
    if (recovered.length > 0) {
      console.log(`   Recuperados del JSON original: ${recovered.length}`);
      recovered.slice(0, 20).forEach(m => console.log(`     ${m.ref} | ${m.name} → $${m.assigned} COP`));
      if (recovered.length > 20) console.log(`     ... y ${recovered.length - 20} más`);
    }
    if (placeholders.length > 0) {
      console.log(`   Asignados con PLACEHOLDER $${PLACEHOLDER_PRICE}: ${placeholders.length}`);
      placeholders.slice(0, 30).forEach(m => console.log(`     ${m.ref} | ${m.name}`));
      if (placeholders.length > 30) console.log(`     ... y ${placeholders.length - 30} más`);
    }
  }

  if (stats.zero.length > 0) {
    console.log('\n🟡 PRODUCTOS CON PRECIO CERO (corregidos):');
    stats.zero.slice(0, 20).forEach(z => console.log(`   ${z.ref} | ${z.name}`));
    if (stats.zero.length > 20) console.log(`   ... y ${stats.zero.length - 20} más`);
  }

  if (stats.corrupt.length > 0) {
    console.log('\n🔵 PRECIOS CORRUPTOS REPARADOS:');
    stats.corrupt.slice(0, 20).forEach(c => console.log(`   ${c.ref} | ${c.name} | era ${c.was} → ahora $${c.now} COP`));
    if (stats.corrupt.length > 20) console.log(`   ... y ${stats.corrupt.length - 20} más`);
  }

  if (stats.suspicious_low.length > 0) {
    console.log('\n⚠️  PRECIOS SOSPECHOSAMENTE BAJOS (<$100 COP):');
    stats.suspicious_low.forEach(s => console.log(`   ${s.ref} | ${s.name} | $${s.price} COP`));
  }

  if (stats.suspicious_high.length > 0) {
    console.log('\n⚠️  PRECIOS SOSPECHOSAMENTE ALTOS (>$5,000,000 COP):');
    stats.suspicious_high.forEach(s => console.log(`   ${s.ref} | ${s.name} | $${s.price} COP`));
  }

  // Verificación final
  const { count: totalTiers } = await supabase.from('price_tiers').select('*', { count: 'exact', head: true });
  const { count: totalProds } = await supabase.from('products').select('*', { count: 'exact', head: true });
  console.log(`\n📈 Verificación final: ${totalTiers} tiers para ${totalProds} productos`);

  const { data: stillBad } = await supabase.from('price_tiers').select('product_id').gt('price', 50_000_000).limit(1);
  if (stillBad && stillBad.length > 0) {
    console.log('⚠️  Aún quedan precios > $50M COP');
  } else {
    console.log('🎉 ¡Cero precios corruptos restantes!');
  }
}

run().catch(console.error);
