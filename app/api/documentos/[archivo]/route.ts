import { NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DOS DOCUMENTOS DEL PROYECTO, SERVIDOS DESDE EL PANEL.
 *
 * POR QUÉ NO VAN EN `public/`
 * ---------------------------
 * Lo que se pone en `public/` queda **abierto a internet**: cualquiera con la
 * dirección lo abre, sin sesión. El grafo del código no puede estar así, y el
 * manual tampoco tiene por qué. Aquí cada uno pasa por su portero.
 *
 * POR QUÉ SE LEEN DEL DISCO Y NO SE COPIAN A LA IMAGEN
 * ---------------------------------------------------
 * El grafo **se regenera** cada vez que cambia el código (`graphify update`).
 * Si viviera dentro de la imagen habría que reconstruir la app para verlo al
 * día. Montados como volumen, el panel siempre muestra el último.
 *
 * QUIÉN VE QUÉ
 * ------------
 *   manual → cualquiera con sesión. Es para quien usa la plataforma.
 *   grafo  → solo el `owner`. Es una herramienta de desarrollo.
 */
const DOCUMENTOS: Record<string, { archivo: string; soloDueño: boolean }> = {
  manual: { archivo: 'MANUAL_KNOWLEDGEBOT.html', soloDueño: false },
  grafo: { archivo: 'graphify-out/graph.html', soloDueño: true },
};

/** Raíz de los documentos dentro del contenedor (ver docker-compose.yml). */
const RAIZ = '/data/documentos';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ archivo: string }> },
) {
  try {
    const { archivo } = await params;
    const doc = DOCUMENTOS[archivo];
    // Lista blanca: solo se sirven los dos nombres conocidos. Así no hay forma
    // de pedir «../../.env.production» ni ningún otro archivo del servidor.
    if (!doc) {
      return NextResponse.json({ error: 'Documento no encontrado.' }, { status: 404 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
    }

    if (doc.soloDueño) {
      const admin = createAdminClient();
      const { data: profile } = await (admin as any)
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile?.role !== 'owner') {
        return NextResponse.json({ error: 'No disponible.' }, { status: 404 });
      }
    }

    const ruta = path.join(RAIZ, doc.archivo);
    try {
      await stat(ruta);
    } catch {
      logger.warn('Documento del panel no encontrado en disco', { archivo: doc.archivo, ruta });
      return new NextResponse(
        `<!doctype html><meta charset="utf-8">
         <body style="background:#0b1016;color:#e2e8f0;font-family:system-ui;padding:40px;line-height:1.6">
         <h2>Este documento todavía no está en el servidor</h2>
         <p>Falta <code>${doc.archivo}</code>. Se sirve desde el disco del VPS,
            no desde la imagen de la app.</p></body>`,
        { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      );
    }

    const html = await readFile(ruta, 'utf-8');
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Sin caché: el grafo cambia con cada regeneración.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logger.error('No se pudo servir el documento del panel', { error: String(err) });
    return NextResponse.json({ error: 'No se pudo abrir el documento.' }, { status: 500 });
  }
}
