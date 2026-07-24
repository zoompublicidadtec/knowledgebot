import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Cargar .env.local si existe
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://moaekovebocnagxkkiwm.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseKey) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY no está configurada.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function getCategoryPrefix(name: string, notes: string): string {
  const text = `${name} ${notes}`.toUpperCase();
  if (text.includes('MUG') || text.includes('POCILLO') || text.includes('VASO') || text.includes('TERMO')) return 'MUG';
  if (text.includes('CUADERNO') || text.includes('LIBRETA') || text.includes('AGENDA')) return 'CUA';
  if (text.includes('BOTON') || text.includes('BOTÓN') || text.includes('PIN')) return 'BOT';
  if (text.includes('PAD MOUSE') || text.includes('MOUSE PAD') || text.includes('MOUSEPAD')) return 'PAD';
  if (text.includes('TARJETA') || text.includes('VOLANTE') || text.includes('AFICHE') || text.includes('PENDON') || text.includes('PENDÓN')) return 'TAR';
  if (text.includes('GORRA') || text.includes('CAMISETA') || text.includes('BUZO') || text.includes('HOODIE') || text.includes('CHAQUETA') || text.includes('TEXTIL')) return 'TEX';
  if (text.includes('BOLIGRAFO') || text.includes('BOLÍGRAFO') || text.includes('ESFERO') || text.includes('LAPICERO') || text.includes('LAPIZ') || text.includes('LÁPIZ')) return 'ESF';
  if (text.includes('USB') || text.includes('MEMORIA') || text.includes('TECNOLOGIA') || text.includes('TECNOLOGÍA')) return 'TEC';
  if (text.includes('LLAVERO')) return 'LLA';
  return 'GEN';
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function run() {
  console.log('=== INICIANDO ASIGNACIÓN DE REFERENCIAS COMERCIALES A PRODUCTOS ZOOM ===');

  // 1. Cargar all_products.json para tener categorías detalladas
  const ragJsonPath = path.resolve(process.cwd(), 'Motor de Conocimiento/data/products/all_products.json');
  let ragProducts: any[] = [];
  const categoryMapByUuid = new Map<string, string>();
  if (fs.existsSync(ragJsonPath)) {
    ragProducts = JSON.parse(fs.readFileSync(ragJsonPath, 'utf8'));
    for (const rp of ragProducts) {
      if (rp.product_id) {
        categoryMapByUuid.set(rp.product_id, `${rp.category || ''} ${rp.subcategory || ''}`);
      }
    }
  }

  // 2. Obtener todos los productos de Supabase
  let allProducts: any[] = [];
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await (supabase as any)
      .from('products')
      .select('id, reference, name, notes')
      .range(from, from + step - 1);

    if (error) {
      console.error('Error leyendo productos de Supabase:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allProducts = allProducts.concat(data);
    if (data.length < step) break;
    from += step;
  }

  console.log(`Total productos en Supabase: ${allProducts.length}`);

  // Contadores por prefijo
  const counters: Record<string, number> = {};

  // 3. Identificar cuáles productos ya tienen referencia ZM- existente
  for (const p of allProducts) {
    const ref = (p.reference || '').trim();
    if (ref && !UUID_REGEX.test(ref) && ref.startsWith('ZM-')) {
      const parts = ref.split('-');
      if (parts.length >= 3) {
        const cat = parts[1];
        const num = parseInt(parts[2], 10);
        if (!isNaN(num)) {
          counters[cat] = Math.max(counters[cat] || 0, num);
        }
      }
    }
  }

  // 4. Asignar referencias a los productos que las tienen nulas, vacías o igual a UUID
  const updatesToDb: { id: string; reference: string }[] = [];
  const refMapByUuid = new Map<string, string>();

  for (const p of allProducts) {
    const rawRef = (p.reference || '').trim();
    const isMissingRef = !rawRef || UUID_REGEX.test(rawRef);

    if (isMissingRef) {
      const extraCat = categoryMapByUuid.get(p.id) || '';
      const catPrefix = getCategoryPrefix(p.name || '', `${p.notes || ''} ${extraCat}`);
      const nextNum = (counters[catPrefix] || 0) + 1;
      counters[catPrefix] = nextNum;
      const cleanRef = `ZM-${catPrefix}-${String(nextNum).padStart(3, '0')}`;

      updatesToDb.push({ id: p.id, reference: cleanRef });
      refMapByUuid.set(p.id, cleanRef);
    } else {
      refMapByUuid.set(p.id, rawRef);
    }
  }

  console.log(`Productos que recibirán nueva referencia comercial: ${updatesToDb.length}`);

  // 5. Actualizar Supabase en lotes
  const batchSize = 50;
  for (let i = 0; i < updatesToDb.length; i += batchSize) {
    const batch = updatesToDb.slice(i, i + batchSize);
    for (const item of batch) {
      const { error } = await (supabase as any)
        .from('products')
        .update({ reference: item.reference })
        .eq('id', item.id);

      if (error) {
        console.error(`Error actualizando producto ${item.id}:`, error.message);
      }
    }
    if ((i + batchSize) % 500 === 0 || i + batchSize >= updatesToDb.length) {
      console.log(`Actualizado lote Supabase ${Math.min(i + batch.length, updatesToDb.length)}/${updatesToDb.length}`);
    }
  }

  console.log('✅ Base de datos Supabase actualizada correctamente.');

  // 6. Actualizar all_products.json para el motor RAG Python
  if (ragProducts.length > 0) {
    let updatedRagCount = 0;

    for (const item of ragProducts) {
      const pid = item.product_id;
      if (refMapByUuid.has(pid)) {
        const cleanRef = refMapByUuid.get(pid)!;
        if (item.reference !== cleanRef) {
          item.reference = cleanRef;
          updatedRagCount++;
        }
      }
    }

    fs.writeFileSync(ragJsonPath, JSON.stringify(ragProducts, null, 2), 'utf8');
    console.log(`✅ all_products.json actualizado con ${updatedRagCount} referencias nuevas.`);
  }

  console.log('=== PROCESO DE POBLADO DE REFERENCIAS COMPLETADO CON ÉXITO ===');
}

run().catch((err) => {
  console.error('Fallo en la ejecución:', err);
  process.exit(1);
});
