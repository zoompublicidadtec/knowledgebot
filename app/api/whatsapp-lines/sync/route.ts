import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBridgeUrl, bridgeHeaders } from '@/lib/whatsapp/bridge';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp-lines/sync
 * Synchronizes the DB line statuses with the REAL state of the bridge.
 * This fixes lines stuck in 'awaiting_qr' even though the bridge already
 * connected (or vice versa). Called automatically when the panel loads.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminSupabase = createAdminClient();
    const { data: profile } = await (adminSupabase as any)
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();
    if (!profile) return NextResponse.json({ error: 'No org' }, { status: 401 });

    // Get all lines for this org
    const { data: lines } = await (supabase as any)
      .from('whatsapp_lines')
      .select('line_key, status')
      .eq('organization_id', profile.organization_id);

    if (!lines || lines.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    const baseUrl = getBridgeUrl();
    const headers = bridgeHeaders({});
    const adminSupabase = createAdminClient();

    // First, get the full bridge status in one call (health endpoint)
    let bridgeSessions: Record<string, any> = {};
    try {
      const healthRes = await fetch(`${baseUrl}/health`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        bridgeSessions = healthData.sessions || {};
      }
    } catch (e) {
      logger.warn('Bridge health check failed during sync', { error: String(e) });
    }

    let syncedCount = 0;
    for (const line of lines) {
      const bridgeState = bridgeSessions[line.line_key];

      if (bridgeState?.status === 'connected' && line.status !== 'connected') {
        // Bridge says connected but DB doesn't — fix it
        await (adminSupabase as any)
          .from('whatsapp_lines')
          .update({ status: 'connected', qr_code: null })
          .eq('line_key', line.line_key);
        syncedCount++;
      } else if (!bridgeState && line.status === 'connected') {
        // DB says connected but bridge has no session — it was lost
        await (adminSupabase as any)
          .from('whatsapp_lines')
          .update({ status: 'disconnected', qr_code: null })
          .eq('line_key', line.line_key);
        syncedCount++;
      } else if (!bridgeState && line.status === 'awaiting_qr' && line.qr_code) {
        // Stale QR with no active bridge session — clear it so the user can re-request
        await (adminSupabase as any)
          .from('whatsapp_lines')
          .update({ qr_code: null })
          .eq('line_key', line.line_key);
        syncedCount++;
      }
    }

    logger.info('WhatsApp lines sync complete', { total: lines.length, synced: syncedCount });
    return NextResponse.json({ synced: syncedCount, total: lines.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
