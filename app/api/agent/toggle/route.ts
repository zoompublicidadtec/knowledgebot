import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * GET: Lee el estado actual del interruptor general del bot.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const adminClient = await createAdminClient();
    const { data: profile } = await (adminClient as any)
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Sin perfil' }, { status: 403 });
    }

    const { data: config } = await (adminClient as any)
      .from('agent_configs')
      .select('bot_globally_enabled')
      .eq('organization_id', profile.organization_id)
      .single();

    return NextResponse.json({
      bot_globally_enabled: config?.bot_globally_enabled ?? true,
    });
  } catch (err) {
    logger.error('Error reading bot global toggle', { error: String(err) });
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

/**
 * POST: Cambia el estado del interruptor general del bot.
 * Body: { enabled: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const body = await request.json() as { enabled: boolean };
    const enabled = !!body.enabled;

    const adminClient = await createAdminClient();
    const { data: profile } = await (adminClient as any)
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: 'Sin perfil' }, { status: 403 });
    }

    const { error } = await (adminClient as any)
      .from('agent_configs')
      .update({ bot_globally_enabled: enabled })
      .eq('organization_id', profile.organization_id);

    if (error) {
      logger.error('Error updating bot global toggle', { error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logger.info('Bot global toggle changed', {
      orgId: profile.organization_id,
      enabled,
      changedBy: user.id,
    });

    return NextResponse.json({ success: true, bot_globally_enabled: enabled });
  } catch (err) {
    logger.error('Error updating bot global toggle', { error: String(err) });
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
