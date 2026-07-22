import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp-lines/errors
 *
 * Devuelve los errores operacionales recientes por línea de WhatsApp,
 * leídos desde la tabla `line_error_log`. Alimenta la sección
 * "Errores recientes" del panel "Líneas de WhatsApp".
 *
 * Solo el owner puede verlo (mismo gate que /diagnostic).
 *
 * Query params:
 *   - hours: ventana de tiempo en horas (default 24)
 *   - limit: máximo de errores a devolver (default 50)
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminSupabase = createAdminClient();
    const { data: profile } = await (adminSupabase as any)
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();
    if (!profile) return NextResponse.json({ error: 'No org' }, { status: 401 });

    if (profile.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parsear query params (con defaults seguros).
    const url = new URL(req.url);
    const hours = Math.min(Math.max(parseInt(url.searchParams.get('hours') || '24', 10) || 24, 1), 168);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);

    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const { data: errors, error } = await (adminSupabase as any)
      .from('line_error_log')
      .select('id, line_key, error_type, severity, message, context, created_at')
      .eq('organization_id', profile.organization_id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Errors endpoint: error leyendo line_error_log', { error: error.message });
      // Si la tabla no existe aún (migración no aplicada), devolver lista vacía
      // en vez de 500, para que el panel no se rompa.
      if (error.message.includes('relation') && error.message.includes('does not exist')) {
        return NextResponse.json({ errors: [], note: 'Tabla line_error_log aún no creada.' });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Resumen agregado por línea (para tarjetas de conteo en el panel).
    const byLine: Record<string, { total: number; errors: number; warns: number; lastAt: string | null }> = {};
    for (const e of errors || []) {
      if (!byLine[e.line_key]) {
        byLine[e.line_key] = { total: 0, errors: 0, warns: 0, lastAt: null };
      }
      byLine[e.line_key].total++;
      if (e.severity === 'error') byLine[e.line_key].errors++;
      else byLine[e.line_key].warns++;
      if (!byLine[e.line_key].lastAt || e.created_at > byLine[e.line_key].lastAt!) {
        byLine[e.line_key].lastAt = e.created_at;
      }
    }

    return NextResponse.json({
      errors: errors || [],
      summary: byLine,
      windowHours: hours,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('Errors endpoint: error inesperado', { error: err?.message || String(err) });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
