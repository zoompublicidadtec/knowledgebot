import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Serves attachment files from the persistent Docker volume (/data/attachments/).
 * Files are saved there by webhook-processor.ts when WhatsApp media arrives.
 * This route is authenticated via the user's browser session (session cookie).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Sanitize: only allow safe filenames (alphanumeric, -, _, .)
  if (!/^[a-zA-Z0-9_.-]+$/.test(filename)) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  const volumeBase = process.env.VOLUME_PATH || '/data';
  const filePath = path.join(volumeBase, 'attachments', filename);

  if (!fs.existsSync(filePath)) {
    // Try fallback: legacy public/attachments path (for old messages)
    const legacyPath = path.join(process.cwd(), 'public', 'attachments', filename);
    if (!fs.existsSync(legacyPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    const legacyFile = fs.readFileSync(legacyPath);
    const contentType = getContentType(filename);
    return new NextResponse(legacyFile, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400',
      },
    });
  }

  const file = fs.readFileSync(filePath);
  const contentType = getContentType(filename);

  return new NextResponse(file, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'private, max-age=86400',
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
    ogg: 'audio/ogg',
    mp3: 'audio/mpeg',
    mpeg: 'audio/mpeg',
    mp4: 'video/mp4',
    webm: 'video/webm',
    bin: 'application/octet-stream',
  };
  return types[ext] || 'application/octet-stream';
}
