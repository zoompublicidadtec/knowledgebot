import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Endpoint to serve catalog product images dynamically from the Docker volume
 * mount /data/imagenes_productos (which binds to the host's directory).
 *
 * If no image exists for the product, returns an inline SVG placeholder (200)
 * instead of a 404 — keeps the browser console clean.
 *
 * Example URL: /api/catalog-images/VA-666
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  const { reference } = await params;

  if (!reference) {
    return buildPlaceholder('---');
  }

  // Clean reference: decode, lowercase, trim
  const cleanRef = decodeURIComponent(reference).toLowerCase().trim().replace(/\s+/g, ' ');
  if (!cleanRef) {
    return buildPlaceholder('---');
  }

  // Base directory inside Docker where images are mounted
  const volumeBase = process.env.VOLUME_PATH || '/data';
  const imagesDir = path.join(volumeBase, 'imagenes_productos');

  if (!fs.existsSync(imagesDir)) {
    console.error(`[CATALOG IMAGE] Directory not found: ${imagesDir}`);
    return buildPlaceholder(cleanRef.toUpperCase());
  }

  try {
    const folders = fs.readdirSync(imagesDir);
    let matchedFolder: string | null = null;

    // Variations to try when matching the product reference to a folder name
    const variations = [
      cleanRef,
      cleanRef.replace(/ /g, '_'),
      cleanRef.replace(/ /g, '-'),
      cleanRef.replace(/ /g, ''),
      cleanRef.replace(/[^a-z0-9]/g, ''),
    ];

    for (const folder of folders) {
      const folderLower = folder.toLowerCase();
      const isMatch = variations.some(variant => {
        if (!variant) return false;
        return (
          folderLower.includes(`_${variant}__`) ||
          folderLower.includes(`_${variant}_`) ||
          folderLower.includes(`__${variant}__`) ||
          folderLower.includes(`_${variant}`) ||
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
      // No folder found → return SVG placeholder (200, no console error)
      return buildPlaceholder(cleanRef.toUpperCase());
    }

    const folderPath = path.join(imagesDir, matchedFolder);
    const files = fs.readdirSync(folderPath);

    // Prioritize principal.jpg, then any image file
    let imageFilename: string | null = null;
    const prioritized = ['principal.jpg', 'principal.jpeg', 'principal.png', 'principal.webp'];

    for (const name of prioritized) {
      if (files.map(f => f.toLowerCase()).includes(name)) {
        imageFilename = files.find(f => f.toLowerCase() === name) || name;
        break;
      }
    }

    if (!imageFilename) {
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
      const imageFile = files.find(file =>
        imageExtensions.includes(path.extname(file).toLowerCase())
      );
      if (imageFile) imageFilename = imageFile;
    }

    if (!imageFilename) {
      return buildPlaceholder(cleanRef.toUpperCase());
    }

    const imageFilePath = path.join(folderPath, imageFilename);
    if (!fs.existsSync(imageFilePath)) {
      return buildPlaceholder(cleanRef.toUpperCase());
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
    return buildPlaceholder(cleanRef.toUpperCase());
  }
}

/**
 * Generates an inline SVG image used as a placeholder when no product photo
 * exists. Returns HTTP 200 so the browser never logs a 404 error.
 */
function buildPlaceholder(label: string): NextResponse {
  // Truncate label to avoid overflowing the SVG
  const displayLabel = label.length > 12 ? label.slice(0, 12) + '…' : label;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" rx="8" fill="#1e1e2e"/>
  <rect x="1" y="1" width="118" height="118" rx="7" fill="none" stroke="#3b3b5a" stroke-width="1.5"/>
  <!-- camera icon -->
  <path d="M44 46h6l3-5h14l3 5h6a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H44a4 4 0 0 1-4-4V50a4 4 0 0 1 4-4z"
        fill="none" stroke="#4a4a72" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="60" cy="62" r="8" fill="none" stroke="#4a4a72" stroke-width="1.8"/>
  <!-- label -->
  <text x="60" y="100" font-family="monospace" font-size="9" fill="#6b6b9a"
        text-anchor="middle" dominant-baseline="middle">${displayLabel}</text>
</svg>`;

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=3600',
    },
  });
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
