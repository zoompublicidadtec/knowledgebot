import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBridgeUrl, bridgeHeaders } from '@/lib/whatsapp/bridge';

/**
 * GET /api/whatsapp-lines/[line_key]/qr
 * Proxy endpoint: pulls the current QR from the bridge and saves it to the DB.
 * Used as a fallback when the push callback from the bridge to Next.js fails.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ line_key: string }> }
) {
  try {
    const { line_key } = await params;

    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();
    if (!profile) return NextResponse.json({ error: 'No org' }, { status: 401 });

    // Bridge URL + key come from env (WHATSAPP_BRIDGE_URL / BRIDGE_API_KEY)
    const baseUrl = getBridgeUrl();

    // Pull QR from bridge
    const bridgeRes = await fetch(`${baseUrl}/api/sessions/${line_key}/qr`, {
      headers: bridgeHeaders({ 'Content-Type': 'application/json' }),
      signal: AbortSignal.timeout(5000),
    });

    // If the bridge returns 404, the session hasn't been started yet.
    // Return a clean status instead of a 502 error so the panel can show
    // the correct UI (e.g. "Solicitar QR" button).
    if (bridgeRes.status === 404) {
      return NextResponse.json({ status: 'not_started', qr: null, message: 'Session not started. Click "Solicitar QR" to begin.' });
    }

    if (!bridgeRes.ok) {
      return NextResponse.json({ error: `Bridge error: ${bridgeRes.status}` }, { status: 502 });
    }

    const bridgeData = await bridgeRes.json();
    const adminSupabase = createAdminClient();

    // If the bridge reports the session is already connected, sync the DB state.
    // This fixes lines stuck in 'awaiting_qr' even though WhatsApp is already linked.
    if (bridgeData.status === 'connected') {
      await (adminSupabase as any)
        .from('whatsapp_lines')
        .update({ status: 'connected', qr_code: null })
        .eq('line_key', line_key);
      return NextResponse.json({ status: 'connected', qr: null });
    }

    // If QR was returned, save it to DB so the panel can show it
    if (bridgeData.qr) {
      await (adminSupabase as any)
        .from('whatsapp_lines')
        .update({ status: 'awaiting_qr', qr_code: bridgeData.qr })
        .eq('line_key', line_key);
    }

    return NextResponse.json(bridgeData);
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.code === 'ECONNREFUSED') {
      return NextResponse.json({
        error: 'No se pudo contactar el bridge. Revisa WHATSAPP_BRIDGE_URL y que el servicio esté activo.'
      }, { status: 502 });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
