import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedMediaUrl, isR2Configured } from '@/lib/r2-storage';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/media/signed-url?key=<r2-key>
 *
 * FASE 2b — Devuelve una URL firmada (1h) para leer un objeto de R2.
 * El panel de Conversaciones llama a este endpoint con la key guardada en
 * messages.raw.media.url y obtiene una URL temporal para renderizar el
 * <img> o <audio>.
 *
 * Requiere sesión autenticada. La URL nunca se persiste.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'R2 no configurado en el servidor.' },
        { status: 503 },
      );
    }

    const key = request.nextUrl.searchParams.get('key');
    if (!key) {
      return NextResponse.json(
        { error: 'Falta el parámetro key.' },
        { status: 400 },
      );
    }

    // Seguridad básica: la key debe empezar con 'media/' (nuestro prefijo).
    // Evita pedir URLs arbitrarias del bucket.
    if (!key.startsWith('media/')) {
      return NextResponse.json(
        { error: 'Clave de objeto inválida.' },
        { status: 400 },
      );
    }

    const url = await getSignedMediaUrl(key);
    if (!url) {
      return NextResponse.json(
        { error: 'El archivo no existe o no está disponible.' },
        { status: 404 },
      );
    }

    logger.info('Signed URL emitida', { keyPrefix: key.slice(0, 20) });
    return NextResponse.json({ url });
  } catch (err: any) {
    logger.error('Error en /api/media/signed-url', {
      error: err?.message || String(err),
    });
    return NextResponse.json({ error: 'Error interno.' }, { status: 500 });
  }
}
