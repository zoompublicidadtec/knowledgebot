import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/**
 * Notifica al motor RAG que el catálogo cambió (invalida su caché).
 * Best-effort: igual que hace search-catalog.ts, resolvemos la URL inline y
 * llamamos POST /reindex. No lanza si el motor está caído.
 */
async function notifyRagReindex(reason: string): Promise<void> {
  const ragUrl = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8001';
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    await fetch(`${ragUrl}/reindex`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    clearTimeout(to);
    logger.info('RAG reindex notificado', { reason });
  } catch (err) {
    logger.warn('RAG reindex best-effort falló', { reason, error: String(err) });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/products/upload-image
 *
 * Sube una imagen de producto (cualquier formato descargado de internet) y la
 * asocia al producto de forma ATÓMICA en los 3 niveles que el RAG necesita para
 * ser coherente (el embedding es MULTIMODAL texto+imagen):
 *
 *   1. Archivo en disco:  /data/imagenes_productos/{NNNN}_{REF}__{SLUG}/principal.jpg
 *      (convertido a JPEG con sharp, resize <=1024px — mismos parámetros que el
 *       pipeline de embeddings del RAG, para consistencia visual).
 *   2. image_url en Supabase:  /api/products/images/{carpeta}/principal.jpg
 *      → el loader lo refleja en local_image_paths → el RAG devuelve la ruta.
 *   3. Re-embed multimodal del producto (POST /reembed del RAG) → vector nuevo
 *      texto+imagen → el producto se ENCUENTRA por la imagen en búsquedas.
 *
 * Si algún nivel falla, se deshacen los anteriores: se RESTAURA el image_url
 * que tenía el producto (no se pone a null: eso borraría la foto que ya tenía)
 * y se elimina la carpeta que acabamos de crear, para no dejar basura en disco
 * ni el sistema en estado inconsistente (foto en la BD con vector solo-texto).
 *
 * multipart/form-data:
 *   - file: la imagen (cualquier formato: jpg/png/webp/gif/bmp/avif/heic...)
 *   - productId: UUID del producto en Supabase (products.id)
 *   - reference: referencia comercial (ej. "ZM-MUG-007")
 *   - name: nombre del producto (ej. "Mug Sencillo 11oz")
 */
export async function POST(request: NextRequest) {
  // Se rellenan en cuanto existen, para poder deshacer si un nivel posterior falla.
  let createdFolderPath: string | null = null;

  const cleanupFolder = () => {
    if (!createdFolderPath) return;
    try {
      fs.rmSync(createdFolderPath, { recursive: true, force: true });
      logger.info('upload-image: carpeta huérfana eliminada', { createdFolderPath });
    } catch (e: any) {
      logger.warn('upload-image: no se pudo eliminar la carpeta huérfana', {
        createdFolderPath, error: e.message,
      });
    }
  };

  try {
    // ── Auth: solo usuarios autenticados del panel ──────────────────────────
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ── Parse multipart ─────────────────────────────────────────────────────
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const productId = (formData.get('productId') as string | null)?.trim();
    const reference = (formData.get('reference') as string | null)?.trim();
    const name = (formData.get('name') as string | null)?.trim() || 'producto';

    if (!file || !productId || !reference) {
      return NextResponse.json(
        { error: 'Faltan campos: file, productId, reference son obligatorios.' },
        { status: 400 }
      );
    }

    // ── Validar tipo y tamaño ───────────────────────────────────────────────
    const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: 'La imagen supera el tamaño máximo de 10 MB.' },
        { status: 413 }
      );
    }
    const okMime = /^image\//i.test(file.type) || /(jpe?g|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i.test(file.name);
    if (!okMime) {
      return NextResponse.json(
        { error: 'El archivo no parece una imagen válida.' },
        { status: 415 }
      );
    }

    // ── Estado previo del producto (para poder deshacer sin perder datos) ───
    const admin = createAdminClient();
    const { data: prevRow, error: prevErr } = await (admin as any)
      .from('products')
      .select('image_url')
      .eq('id', productId)
      .maybeSingle();

    if (prevErr) {
      logger.error('upload-image: no se pudo leer el producto', {
        productId, error: prevErr.message,
      });
      return NextResponse.json(
        { error: 'No se pudo leer el producto: ' + prevErr.message },
        { status: 500 }
      );
    }
    if (!prevRow) {
      return NextResponse.json(
        { error: 'El producto no existe. Guárdalo antes de subirle una foto.' },
        { status: 404 }
      );
    }
    const previousImageUrl: string | null = prevRow.image_url ?? null;

    // ── Normalizar a JPEG con sharp (mismos params que el RAG) ──────────────
    const raw = Buffer.from(await file.arrayBuffer());
    let jpegBuf: Buffer;
    try {
      jpegBuf = await sharp(raw, { failOn: 'none' })
        .rotate() // respetar orientación EXIF
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }) // quitar transparencia → blanco
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer();
    } catch (e: any) {
      logger.error('upload-image: sharp no pudo procesar la imagen', { error: e.message });
      return NextResponse.json(
        { error: 'No se pudo procesar la imagen. Prueba con otro archivo (.jpg o .png).' },
        { status: 422 }
      );
    }
    if (!jpegBuf || jpegBuf.length === 0) {
      return NextResponse.json(
        { error: 'La imagen resultó vacía tras procesarla.' },
        { status: 422 }
      );
    }

    // ── Carpeta destino con la convención existente {NNNN}_{REF}__{SLUG} ────
    const volumeBase = process.env.VOLUME_PATH || '/data';
    const imagesDir = path.join(volumeBase, 'imagenes_productos');
    // NFD + descarte del bloque de diacríticos combinantes (U+0300–U+036F):
    // "Ergonómico" → "Ergonomico". Sin esto los acentos acaban como "_".
    const sinAcentos = Array.from(name.normalize('NFD'))
      .filter((ch) => {
        const cp = ch.codePointAt(0) ?? 0;
        return cp < 0x300 || cp > 0x36f;
      })
      .join('');
    const slug = sinAcentos
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'producto';
    const refClean = reference.replace(/[^a-zA-Z0-9._-]/g, '') || 'REF';

    // El volumen tiene que ser escribible: si está montado :ro no hay upload
    // posible, y el error de mkdir no lo explica. Lo decimos claro.
    try {
      fs.mkdirSync(imagesDir, { recursive: true });
      fs.accessSync(imagesDir, fs.constants.W_OK);
    } catch {
      logger.error('upload-image: el volumen de imágenes no es escribible', { imagesDir });
      return NextResponse.json(
        {
          error: 'El almacén de imágenes está montado en solo lectura, así que no ' +
            'se puede guardar la foto. Hay que montar ' +
            'catalogo_catalogospromocionales/imagenes_productos con permiso de ' +
            'escritura en docker-compose.yml y recrear el contenedor.',
        },
        { status: 500 }
      );
    }

    // NNNNN que no colisione con las ~6858 carpetas existentes
    let seq = 7000;
    let folderName = '';
    for (;;) {
      const candidate = `${String(seq).padStart(4, '0')}_${refClean}__${slug}`;
      if (!fs.existsSync(path.join(imagesDir, candidate))) {
        folderName = candidate;
        break;
      }
      seq += 1;
      if (seq > 99999) {
        // poco probable; caer a referencia + timestamp
        folderName = `${refClean}__${slug}__${Date.now()}`;
        break;
      }
    }

    const folderPath = path.join(imagesDir, folderName);
    fs.mkdirSync(folderPath, { recursive: true });
    createdFolderPath = folderPath;
    const fileName = 'principal.jpg';
    const diskPath = path.join(folderPath, fileName);
    fs.writeFileSync(diskPath, jpegBuf);
    logger.info('upload-image: archivo escrito', { diskPath, bytes: jpegBuf.length });

    // ── Nivel 2: image_url en Supabase ──────────────────────────────────────
    const imageUrl = `/api/products/images/${folderName}/${fileName}`;
    const { error: updErr } = await (admin as any)
      .from('products')
      .update({ image_url: imageUrl })
      .eq('id', productId);

    if (updErr) {
      logger.error('upload-image: fallo update image_url', {
        productId, error: updErr.message,
      });
      cleanupFolder();
      return NextResponse.json(
        { error: 'No se pudo actualizar la base de datos: ' + updErr.message },
        { status: 500 }
      );
    }

    // ── Nivel 3: re-embed multimodal (inseparable del upload) ───────────────
    // El embedding es texto+imagen; sin re-embed el producto queda inconsistente.
    // Esperamos confirmación (no best-effort). Si falla, deshacemos el nivel 2.
    const ragUrl = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8001';
    let reembedded = false;
    let reembedError: string | undefined;
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 45000); // el re-embed puede tardar
      const res = await fetch(`${ragUrl}/reembed`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        // El motor identifica los productos por su referencia comercial
        // (supabase_loader prefiere `reference` sobre el UUID), no por products.id.
        body: JSON.stringify({ product_id: reference }),
      });
      clearTimeout(to);
      if (res.ok) {
        const data = await res.json();
        reembedded = !!data?.success;
        if (!reembedded) reembedError = data?.detail || 'reembed sin success';
      } else {
        reembedError = `RAG /reembed HTTP ${res.status}`;
      }
    } catch (e: any) {
      reembedError = String(e);
    }

    if (!reembedded) {
      // Deshacer: RESTAURAR el image_url anterior (ponerlo a null borraría la
      // foto que el producto ya tenía) y borrar la carpeta nueva.
      logger.warn('upload-image: re-embed falló, restaurando estado anterior', {
        productId, reference, previousImageUrl, reembedError,
      });
      const { error: rollbackErr } = await (admin as any)
        .from('products')
        .update({ image_url: previousImageUrl })
        .eq('id', productId);
      if (rollbackErr) {
        logger.error('upload-image: fallo al restaurar image_url', {
          productId, previousImageUrl, error: rollbackErr.message,
        });
      }
      cleanupFolder();
      await notifyRagReindex('upload-image-rollback');
      return NextResponse.json(
        {
          error: 'La imagen se procesó pero el motor de búsqueda no pudo ' +
            're-indexarla (' + reembedError + '). Se deshizo el cambio para que ' +
            'no quede una foto sin vector. Inténtalo de nuevo en unos segundos.',
          reembedError,
        },
        { status: 502 }
      );
    }

    // ── Invalidar caché del catálogo RAG (igual que saveProduct) ────────────
    await notifyRagReindex('upload-image');

    logger.info('upload-image: OK completo (disco + bd + reembed)', {
      productId, reference, imageUrl, reembedded,
    });

    return NextResponse.json({
      success: true,
      imageUrl,
      reembedded: true,
      folderName,
      replacedImageUrl: previousImageUrl,
    });
  } catch (err: any) {
    logger.error('upload-image: error inesperado', { error: err.message });
    cleanupFolder();
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
