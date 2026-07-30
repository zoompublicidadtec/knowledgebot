import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchMergedBridgeState } from '@/lib/whatsapp/bridge';
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
    const { data: lines, error } = await (adminSupabase as any)
      .from('whatsapp_lines')
      .select('line_key, status')
      .eq('organization_id', profile.organization_id);

    if (error) {
       console.error('API Sync Error:', error.message);
       return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!lines || lines.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    // Estado real de todos los puentes, unido por línea. Antes se preguntaba
    // solo al puente por defecto: con la migración a Baileys eso habría puesto
    // en 'disconnected' las líneas del otro puente, que están perfectamente
    // conectadas.
    const bridgeState = await fetchMergedBridgeState(5000);
    const bridgeSessions = bridgeState.sessions;

    for (const p of bridgeState.probes) {
      if (!p.reachable) {
        logger.warn('Sync: puente inalcanzable', { url: p.url, lines: p.lines, error: p.error });
      }
    }

    // Con TODOS los puentes caídos no se sabe nada del runtime: tocar la base
    // aquí marcaría como perdidas líneas que quizá están bien. Mejor no hacer nada.
    if (!bridgeState.anyReachable) {
      logger.warn('Sync abortado: ningún puente responde', { total: lines.length });
      return NextResponse.json({ synced: 0, total: lines.length, bridgeReachable: false });
    }

    let syncedCount = 0;
    for (const line of lines) {
      const bridgeState = bridgeSessions[line.line_key];

      // El estado unido siempre devuelve un objeto para una línea con puente
      // asignado, incluso para decir que ese puente no responde. Así que la
      // condición no puede ser "no hay dato": hay que mirar el estado.
      const connectedInBridge = bridgeState?.status === 'connected';
      const bridgeUnknown = !bridgeState || bridgeState.status === 'bridge_unreachable';
      const lostInBridge = !!bridgeState && !bridgeUnknown && !connectedInBridge;

      if (connectedInBridge && line.status !== 'connected') {
        // El puente la tiene viva y la base no lo sabía: se corrige.
        await (adminSupabase as any)
          .from('whatsapp_lines')
          .update({ status: 'connected', qr_code: null })
          .eq('line_key', line.line_key);
        syncedCount++;
      } else if ((lostInBridge || !bridgeState) && line.status === 'connected') {
        // La base la da por conectada y el puente que la atiende dice que no.
        // Con el puente inalcanzable NO se toca: no se sabe, y marcarla caída
        // sería inventar. El diagnóstico ya la reporta como tal.
        await (adminSupabase as any)
          .from('whatsapp_lines')
          .update({ status: 'disconnected', qr_code: null })
          .eq('line_key', line.line_key);
        syncedCount++;
      } else if ((lostInBridge || !bridgeState) && line.status === 'awaiting_qr' && line.qr_code) {
        // QR viejo sin sesión activa: se limpia para poder pedir uno nuevo.
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
