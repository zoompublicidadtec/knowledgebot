import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Endpoint to serve catalog product images dynamically from the Docker volume
 * mount /data/imagenes_productos (which binds to the host's directory).
 * 
 * Example URL: /api/catalog-images/VA-666
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;

  if (!reference) {
    return NextResponse.json({ error: 'Missing reference' }, { status: 400 });
  }

  // Clean reference: lowercase, trim, and replace multiple spaces with single space
  const cleanRef = decodeURIComponent(reference).toLowerCase().trim().replace(/\s+/g, ' ');
  if (!cleanRef) {
    return NextResponse.json({ error: 'Invalid reference' }, { status: 400 });
  }

  // Base directory inside Docker where images are mounted
  const volumeBase = process.env.VOLUME_PATH || '/data';
  const imagesDir = path.join(volumeBase, 'imagenes_productos');

  if (!fs.existsSync(imagesDir)) {
    console.error(`[CATALOG IMAGE] Directory not found: ${imagesDir}`);
    return NextResponse.json({ error: 'Images directory not mounted' }, { status: 500 });
  }

  try {
    const folders = fs.readdirSync(imagesDir);
    let matchedFolder: string | null = null;

    // We want to try matching in a few ways:
    // 1. Exact reference token match in the folder name, e.g. "va-258_ag" or "adva_2-1"
    // Let's create variations of cleanRef:
    const variations = [
      cleanRef,                               // e.g. "adva 2-1" or "va-258 ag"
      cleanRef.replace(/ /g, '_'),             // e.g. "adva_2-1" or "va-258_ag"
      cleanRef.replace(/ /g, '-'),             // e.g. "adva-2-1" or "va-258-ag"
      cleanRef.replace(/ /g, ''),              // e.g. "adva2-1" or "va-258ag"
      cleanRef.replace(/[^a-z0-9]/g, ''),      // e.g. "adva21" or "va258ag" (ultra-clean)
    ];

    for (const folder of folders) {
      const folderLower = folder.toLowerCase();
      
      // Check if folder contains any of our variations as a distinct product reference segment
      // Folder names are like: 2185_VA-258_AG__Agarradera_para_Bolso_Compacto
      const isMatch = variations.some(variant => {
        if (!variant) return false;
        // Match with prefix/suffix separators to be precise: e.g. _va-258_ag__ or _va-258_ag_
        return (
          folderLower.includes(`_${variant}__`) ||
          folderLower.includes(`_${variant}_`) ||
          folderLower.includes(`__${variant}__`) ||
          folderLower.includes(`_${variant}`) ||
          // Fallback: simple check if it ends or starts with the variant
          folderLower === variant ||
          folderLower.includes(variant)
        );
      });

      if (isMatch) {
        matchedFolder = folder;
        break;
      }
    }

    if (!matchedFolder) {
      // Return 404 or a placeholder image if not found
      return NextResponse.json({ error: 'Product folder not found' }, { status: 404 });
    }

    const folderPath = path.join(imagesDir, matchedFolder);
    const files = fs.readdirSync(folderPath);

    // Prioritize principal.jpg, then search for other common formats
    let imageFilename: string | null = null;
    const prioritized = ['principal.jpg', 'principal.jpeg', 'principal.png', 'principal.webp'];
    
    for (const name of prioritized) {
      if (files.map(f => f.toLowerCase()).includes(name)) {
        imageFilename = files.find(f => f.toLowerCase() === name) || name;
        break;
      }
    }

    // Fallback to the first image file if principal is missing
    if (!imageFilename) {
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const imageFile = files.find(file => 
        imageExtensions.includes(path.extname(file).toLowerCase())
      );
      if (imageFile) {
        imageFilename = imageFile;
      }
    }

    if (!imageFilename) {
      return NextResponse.json({ error: 'No image found in product folder' }, { status: 404 });
    }

    const imageFilePath = path.join(folderPath, imageFilename);
    if (!fs.existsSync(imageFilePath)) {
      return NextResponse.json({ error: 'Image file does not exist' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(imageFilePath);
    const contentType = getContentType(imageFilename);

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200',
      },
    });

  } catch (err: any) {
    console.error('[CATALOG IMAGE] Error processing request:', err);
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
