import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  for (const line of envConfig.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Faltan credenciales de Supabase en .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log('--- Sincronizador de Imágenes de Catálogo ---');

  // Verify that the products table has the image_url column
  const { error: colCheckError } = await supabase
    .from('products')
    .select('image_url')
    .limit(1);

  if (colCheckError && colCheckError.message && colCheckError.message.includes('image_url')) {
    console.error('❌ Error: La columna "image_url" no existe en la tabla "products".');
    console.error('Por favor, ejecute primero esta consulta en el SQL Editor de Supabase:');
    console.error('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;');
    process.exit(1);
  }

  // Determine images directory path (handle both local and VPS volume layouts)
  let imagesDir = '';
  const possiblePaths = [
    path.resolve(process.cwd(), 'catalogo_catalogospromocionales', 'imagenes_productos'),
    path.resolve('/data', 'catalog', 'imagenes_productos'),
    path.resolve('/root/knowledgebot/catalogo_catalogospromocionales/imagenes_productos'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      imagesDir = p;
      break;
    }
  }

  if (!imagesDir) {
    console.error('❌ Error: No se encontró el directorio de imágenes del catálogo.');
    console.log('Rutas intentadas:');
    possiblePaths.forEach(p => console.log(`  - ${p}`));
    process.exit(1);
  }

  console.log(`Directorio de imágenes encontrado en: ${imagesDir}`);

  // Fetch all products from Supabase to match references
  console.log('Obteniendo productos de Supabase...');
  const { data: dbProducts, error: dbError } = await supabase
    .from('products')
    .select('id, reference, name, image_url');

  if (dbError) {
    console.error('❌ Error al obtener productos:', dbError.message);
    process.exit(1);
  }

  console.log(`Se obtuvieron ${dbProducts.length} productos de la base de datos.`);

  // Scan images directory
  const folders = fs.readdirSync(imagesDir);
  console.log(`Escaneando ${folders.length} carpetas de productos en el VPS...`);

  let matchedCount = 0;
  let updatedCount = 0;

  for (const folder of folders) {
    const folderPath = path.join(imagesDir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;

    // Parse reference from directory name (e.g., "0171_HO-318__Portacomidas_Eco_Denver" -> "HO-318")
    const match = folder.match(/^\d+_(.*?)__/);
    let reference = '';
    if (match && match[1]) {
      reference = match[1].trim();
    } else {
      const parts = folder.split('_');
      if (parts.length > 1) {
        reference = parts[1].trim();
      }
    }

    if (!reference) continue;

    // Find if we have main images (principal.jpg, principal.png, etc.)
    const possibleImages = ['principal.jpg', 'principal.png', 'galeria_1.jpg', 'galeria_1.png'];
    let selectedImage = '';
    for (const imgName of possibleImages) {
      if (fs.existsSync(path.join(folderPath, imgName))) {
        selectedImage = imgName;
        break;
      }
    }

    if (!selectedImage) {
      // Fallback: take the first file in the directory
      const files = fs.readdirSync(folderPath);
      const imgFile = files.find(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
      if (imgFile) {
        selectedImage = imgFile;
      }
    }

    if (!selectedImage) {
      // No image found in this folder
      continue;
    }

    // Match with products in database
    const matchedProducts = dbProducts.filter(
      p => p.reference && p.reference.toLowerCase().trim() === reference.toLowerCase()
    );

    if (matchedProducts.length > 0) {
      matchedCount++;
      // Set the path served by our /api/products/images/[...path] endpoint
      const remoteImageUrl = `/api/products/images/${folder}/${selectedImage}`;

      for (const prod of matchedProducts) {
        // Only update if it doesn't have the correct image URL already
        if (prod.image_url !== remoteImageUrl) {
          console.log(`Actualizando [${prod.reference}]: ${prod.name} -> ${remoteImageUrl}`);
          const { error: updateError } = await supabase
            .from('products')
            .update({ image_url: remoteImageUrl })
            .eq('id', prod.id);

          if (updateError) {
            console.error(`  ❌ Error al actualizar ${prod.reference}:`, updateError.message);
          } else {
            updatedCount++;
          }
        }
      }
    }
  }

  console.log('\n--- Sincronización Finalizada ---');
  console.log(`Productos mapeados con carpetas: ${matchedCount}`);
  console.log(`Productos actualizados en base de datos: ${updatedCount}`);
}

run().catch(console.error);
