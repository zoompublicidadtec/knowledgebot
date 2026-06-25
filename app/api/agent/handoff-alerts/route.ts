import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth/actions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/handoff-alerts
 * Returns conversations where bot_active=false (require human attention).
 *
 * NOTE: only conversations updated in the last 14 days are considered "active"
 * handoffs. Older ones are treated as already-resolved to avoid the bell
 * badge growing forever.
 */
export async function GET() {
  try {
    const profile = await getCurrentUser();
    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const orgId = profile.organization_id;
    const supabase = createAdminClient();

    // Only show handoffs from the last 14 days (avoid infinite accumulation)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const { data: alerts, error } = await (supabase as any)
      .from('conversations')
      .select(`
        id,
        last_message_at,
        created_at,
        contacts (
          id,
          full_name,
          wa_phone
        ),
        messages (
          content,
          direction,
          created_at
        )
      `)
      .eq('organization_id', orgId)
      .eq('bot_active', false)
      .gte('last_message_at', fourteenDaysAgo)
      .order('last_message_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get the last message for each conversation
    const formattedAlerts = (alerts || []).map((conv: any) => {
      const msgs = (conv.messages || []).sort(
        (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      const lastMsg = msgs[0];
      return {
        conversationId: conv.id,
        contactName: conv.contacts?.full_name || null,
        contactPhone: conv.contacts?.wa_phone || '',
        lastMessageAt: conv.last_message_at,
        lastMessage: lastMsg?.content || '',
        lastMessageDirection: lastMsg?.direction || 'inbound',
      };
    });

    return NextResponse.json({ alerts: formattedAlerts, count: formattedAlerts.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/agent/handoff-alerts
 * Body: { conversationId }
 * Resolves a handoff alert by reactivating the bot (bot_active = true).
 * This is how an advisor "marks as attended" — the bot resumes handling the chat.
 */
export async function POST(request: NextRequest) {
  try {
    const profile = await getCurrentUser();
    if (!profile) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { conversationId } = await request.json();
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId es requerido' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Verify ownership before updating
    const { data: conv } = await (supabase as any)
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', profile.organization_id)
      .single();

    if (!conv) {
      return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
    }

    // Reactivate the bot → the alert disappears from the bell
    const { error } = await (supabase as any)
      .from('conversations')
      .update({ bot_active: true })
      .eq('id', conversationId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
