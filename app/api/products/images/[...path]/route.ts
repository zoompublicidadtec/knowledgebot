import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serves product images directly from the local catalog directory on the VPS.
 * Matches routes like /api/products/images/5473_VA-432__Abanico_con_Mango_Stick_Produc/principal.jpg
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const resolvedParams = await params;
  const pathParts = resolvedParams.path;

  if (!pathParts || pathParts.length === 0) {
    return NextResponse.json({ error: 'Missing image path' }, { status: 400 });
  }

  // Sanitize path parts to prevent directory traversal
  const sanitizedParts = pathParts.map(part => 
    part.replace(/[^a-zA-Z0-9_.-]/g, '')
  );

  // Base directory inside Docker where images are mounted
  const volumeBase = process.env.VOLUME_PATH || '/data';
  const imagesDir = path.join(volumeBase, 'imagenes_productos');

  const fileDiskPath = path.join(imagesDir, ...sanitizedParts);

  if (!fs.existsSync(fileDiskPath)) {
    console.warn(`[PRODUCT IMAGE] File not found: ${fileDiskPath}`);
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }

  try {
    const fileBuffer = fs.readFileSync(fileDiskPath);
    const filename = sanitizedParts[sanitizedParts.length - 1];
    const contentType = getContentType(filename);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200',
      },
    });
  } catch (err: any) {
    console.error('[PRODUCT IMAGE] Error serving file:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}

function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
  };
  return types[ext] || 'image/jpeg';
}
