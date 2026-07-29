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
 * Si el re-embed (nivel 3) falla, se revierte el cambio de image_url (nivel 2)
 * para no dejar el sistema en estado inconsistente (la foto aparece pero el
 * vector sigue siendo solo-texto). El archivo en disco se conserva (inócuo).
 *
 * multipart/form-data:
 *   - file: la imagen (cualquier formato: jpg/png/webp/gif/bmp/avif/heic...)
 *   - productId: UUID del producto en Supabase (products.id)
 *   - reference: referencia comercial (ej. "ZM-MUG-007")
 *   - name: nombre del producto (ej. "Mug Sencillo 11oz")
 */
export async function POST(request: NextRequest) {
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
    const slug = name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar acentos
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40) || 'producto';
    const refClean = reference.replace(/[^a-zA-Z0-9._-]/g, '');

    // NNNNN que no colisione con las ~6858 carpetas existentes
    fs.mkdirSync(imagesDir, { recursive: true });
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
    const fileName = 'principal.jpg';
    const diskPath = path.join(folderPath, fileName);
    fs.writeFileSync(diskPath, jpegBuf);
    logger.info('upload-image: archivo escrito', { diskPath, bytes: jpegBuf.length });

    // ── Nivel 2: image_url en Supabase ──────────────────────────────────────
    const imageUrl = `/api/products/images/${folderName}/${fileName}`;
    const admin = createAdminClient();
    const { error: updErr } = await (admin as any)
      .from('products')
      .update({ image_url: imageUrl })
      .eq('id', productId);

    if (updErr) {
      logger.error('upload-image: fallo update image_url (se conserva el archivo)', {
        productId, error: updErr.message,
      });
      return NextResponse.json(
        { error: 'No se pudo actualizar la base de datos: ' + updErr.message },
        { status: 500 }
      );
    }

    // ── Nivel 3: re-embed multimodal (inseparable del upload) ───────────────
    // El embedding es texto+imagen; sin re-embed el producto queda inconsistente.
    // Esperamos confirmación (no best-effort). Si falla, revertimos image_url.
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
      // Revertir image_url para no dejar inconsistencia (foto en BD pero vector viejo).
      logger.warn('upload-image: re-embed falló, revirtiendo image_url', {
        productId, reference, reembedError,
      });
      await (admin as any)
        .from('products')
        .update({ image_url: null })
        .eq('id', productId);
      return NextResponse.json(
        {
          error: 'La imagen se procesó pero el re-embed del RAG falló (' +
            reembedError + '). Se revirtió el cambio para evitar inconsistencia. ' +
            'Inténtalo de nuevo en unos segundos.',
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
    });
  } catch (err: any) {
    logger.error('upload-image: error inesperado', { error: err.message });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
