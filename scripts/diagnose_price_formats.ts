import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SCRIPT DE DIAGNÓSTICO - SOLO LECTURA LOCAL
 * 
 * Este script:
 * 1. Lee el CSV maestro
 * 2. Parsea TODOS los formatos de precio (simple y por rangos de volumen)
 * 3. Compara con lo que hay en la DB de producción
 * 4. Muestra qué falta y por qué falló
 * 
 * NO ESCRIBE NADA EN LA BASE DE DATOS.
 */

// PROD database (read-only in this script)
const PROD_URL = 'https://moaekovebocnagxkkiwm.supabase.co';
const PROD_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(PROD_URL, PROD_KEY);

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

/**
 * Parsea el campo 'precio' del CSV en un array de price_tiers.
 * 
 * Formatos detectados:
 * 1) Simple: "$18.900" → 1 tier
 * 2) Rangos: "Precio de 10 a 99 unidades: $33.390 | Precio de 100 a 300 unidades: $31.790 | ..."
 * 3) Con texto extra: "$18.900Venta mínima..." → 1 tier (limpia el texto)
 */
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
    // FORMATO RANGOS: "Precio de X a Y unidades: $Z.ZZZ | ..."
    const segments = precioRaw.split('|').map(s => s.trim());
    
    for (const seg of segments) {
      // Match: "Precio de 10 a 99 unidades: $33.390"
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

      // Match: "Precio de 1.501 unidades en adelante: $27.700"
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

  // If we got tiers from ranges, return them
  if (tiers.length > 0) return tiers;

  // FORMATO SIMPLE: "$18.900" or "$18.900Venta mínima..."
  // Extract the first price found
  const simpleMatch = precioRaw.match(/\$([\d.]+)/);
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

async function run() {
  console.log('=== DIAGNÓSTICO DE PRECIOS (SOLO LECTURA) ===\n');

  // Load CSV
  const csvPath = path.resolve(process.cwd(), 'data', 'catalogo_productos.csv');
  const csv = parseCSV(fs.readFileSync(csvPath, 'utf8'));

  // Deduplicate by reference
  const uniqueByRef = new Map<string, any>();
  for (const p of csv) {
    if (p.referencia && !uniqueByRef.has(p.referencia)) {
      uniqueByRef.set(p.referencia, p);
    }
  }

  // Parse all prices
  let simple = 0, ranged = 0, noPrice = 0, parseError = 0;
  const allParsed = new Map<string, any[]>();

  for (const [ref, p] of uniqueByRef) {
    const desc = p.descripcion || '';
    const minQtyMatch = desc.match(/Venta m.nima.*caja de (\d+)/i);
    const minQty = minQtyMatch ? parseInt(minQtyMatch[1]) : null;

    const tiers = parsePriceTiers(p.precio, minQty);
    allParsed.set(ref, tiers);

    if (tiers.length === 0) {
      if (p.precio) parseError++;
      else noPrice++;
    } else if (tiers.length === 1) {
      simple++;
    } else {
      ranged++;
    }
  }

  console.log(`Total productos únicos: ${uniqueByRef.size}`);
  console.log(`  Con precio simple (1 tier): ${simple}`);
  console.log(`  Con rangos de volumen (2+ tiers): ${ranged}`);
  console.log(`  Sin precio en CSV: ${noPrice}`);
  console.log(`  Con precio pero no parseado: ${parseError}`);

  // Show specific product: SO-65
  console.log('\n=== CASO SO-65 (Paraguas Kenny) ===');
  const so65csv = uniqueByRef.get('SO-65');
  if (so65csv) {
    console.log(`Nombre: ${so65csv.nombre}`);
    console.log(`Precio raw: ${so65csv.precio}`);
    const so65tiers = allParsed.get('SO-65')!;
    console.log(`Tiers parseados: ${so65tiers.length}`);
    for (const t of so65tiers) {
      console.log(`  ${t.min_qty} - ${t.max_qty || '∞'} uds → $${t.price.toLocaleString('es-CO')} (${t.price_basis})`);
    }
  }

  // Check what's in PROD DB for SO-65 (READ ONLY)
  console.log('\n=== SO-65 EN BASE DE DATOS PRODUCCIÓN ===');
  const { data: so65db } = await supabase.from('products').select('id, name, reference').eq('reference', 'SO-65');
  console.log(`Registros en DB: ${so65db?.length || 0}`);
  if (so65db && so65db.length > 0) {
    const { data: dbTiers } = await supabase.from('price_tiers').select('*').eq('product_id', so65db[0].id);
    console.log(`Price tiers en DB: ${dbTiers?.length || 0}`);
    dbTiers?.forEach(t => console.log(`  ${t.variant}: ${t.min_qty}-${t.max_qty || '∞'} → $${t.price}`));
  }

  // Count how many products with ranged pricing are missing tiers in DB
  console.log('\n=== PRODUCTOS CON RANGOS DE VOLUMEN SIN PRECIOS EN DB ===');
  const { data: dbProductsWithTiers } = await supabase.from('price_tiers').select('product_id');
  const dbProductIdsWithTiers = new Set((dbProductsWithTiers || []).map(t => t.product_id));

  const allDbProds = await supabase.from('products').select('id, reference');
  const dbRefToId = new Map<string, string>();
  (allDbProds.data || []).forEach(p => { if (p.reference) dbRefToId.set(p.reference, p.id); });

  let missingRanged = 0;
  const missingExamples: string[] = [];
  for (const [ref, tiers] of allParsed) {
    if (tiers.length > 1) {
      const dbId = dbRefToId.get(ref);
      if (dbId && !dbProductIdsWithTiers.has(dbId)) {
        missingRanged++;
        if (missingExamples.length < 5) missingExamples.push(`${ref} (${tiers.length} rangos)`);
      }
    }
  }
  console.log(`Productos con rangos de volumen que NO tienen precios en DB: ${missingRanged}`);
  missingExamples.forEach(e => console.log(`  Ejemplo: ${e}`));

  // Also count simple-price products missing
  let missingSimple = 0;
  for (const [ref, tiers] of allParsed) {
    if (tiers.length === 1) {
      const dbId = dbRefToId.get(ref);
      if (dbId && !dbProductIdsWithTiers.has(dbId)) {
        missingSimple++;
      }
    }
  }
  console.log(`Productos con precio simple que NO tienen precios en DB: ${missingSimple}`);
  console.log(`\nTOTAL productos sin precio en DB que SÍ tienen precio en CSV: ${missingRanged + missingSimple}`);

  // Show some parse errors for debugging
  if (parseError > 0) {
    console.log('\n=== EJEMPLOS DE PRECIOS NO PARSEADOS ===');
    let shown = 0;
    for (const [ref, p] of uniqueByRef) {
      if (p.precio && allParsed.get(ref)!.length === 0) {
        console.log(`  ${ref}: "${p.precio.substring(0, 100)}"`);
        shown++;
        if (shown >= 10) break;
      }
    }
  }
}

run().catch(console.error);
