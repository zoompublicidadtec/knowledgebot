import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBridgeUrl, bridgeHeaders } from '@/lib/whatsapp/bridge';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp-lines/diagnostic
 *
 * Panel de SEGUIMIENTO (solo lectura) del estado real de cada línea de WhatsApp.
 * Combina dos fuentes:
 *   1. La BD (whatsapp_lines): lo que el sistema "cree" que pasa.
 *   2. El puente (GET /diagnostic): lo que REALMENTE pasa en runtime
 *      (estado cargado en memoria, último error, desde cuándo, sesión en disco).
 *
 * No realiza ninguna acción sobre las sesiones. Solo observa y reporta, para que
 * el administrador pueda decidir qué hacer cuando una línea cae.
 */
export async function GET() {
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

    // Solo el owner puede ver el panel de seguimiento de líneas.
    if (profile.role !== 'owner') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 1) Líneas de la BD para esta organización.
    const { data: dbLines, error } = await (adminSupabase as any)
      .from('whatsapp_lines')
      .select('line_key, display_name, phone_number, status, last_connected_at')
      .eq('organization_id', profile.organization_id)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('Diagnostic: error leyendo whatsapp_lines', { error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const baseUrl = getBridgeUrl();
    const headers = bridgeHeaders({});

    // 2) Diagnóstico del puente (puede estar caído o inalcanzable).
    let bridgeDiagnostic: Record<string, any> = {};
    let bridgeReachable = true;
    let bridgeTime: string | null = null;
    try {
      const res = await fetch(`${baseUrl}/diagnostic`, {
        headers,
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = await res.json();
        bridgeDiagnostic = data.sessions || {};
        bridgeTime = data.bridgeTime || null;
      } else {
        bridgeReachable = false;
        logger.warn('Diagnostic: puente respondió con error HTTP', { status: res.status });
      }
    } catch (e) {
      bridgeReachable = false;
      logger.warn('Diagnostic: puente inalcanzable', { error: String(e) });
    }

    // 3) Combinar ambas fuentes por line_key.
    const lines = (dbLines || []).map((line: any) => {
      const bd = bridgeDiagnostic[line.line_key] || {};
      const loaded = bd.loaded === true;
      const dbStatus = line.status;
      const sessionOnDisk = bd.sessionOnDisk === true;

      // Señal clave: la BD dice "connected" pero el puente no la tiene cargada
      // en memoria = ZOMBIE (caída silenciosa, el caso típico del "detached Frame")
      // o la línea presenta 10+ errores de keep-alive / timeouts acumulados.
      const isZombie = dbStatus === 'connected' && (!loaded || (bd.keepAliveErrors || 0) >= 10);

      return {
        line_key: line.line_key,
        display_name: line.display_name,
        phone_number: bd.phoneNumber || line.phone_number || null,
        dbStatus,
        dbLastConnectedAt: line.last_connected_at || null,
        // Diagnóstico de runtime (del puente):
        loaded,
        runtimeStatus: bd.status || null,
        connectedAt: bd.connectedAt || null,
        lastError: bd.lastError || bd.lastDisconnectReason || null,
        lastErrorAt: bd.lastErrorAt || null,
        keepAliveErrors: bd.keepAliveErrors || 0,
        sessionOnDisk,
        isZombie,
      };
    });

    return NextResponse.json({
      lines,
      bridgeReachable,
      bridgeTime,
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('Diagnostic: error inesperado', { error: err?.message || String(err) });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
