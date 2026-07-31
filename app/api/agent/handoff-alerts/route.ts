import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth/actions';

export const dynamic = 'force-dynamic';

/**
 * GET /api/agent/handoff-alerts
 *
 * QUÉ VIGILA LA CAMPANA, Y POR QUÉ CAMBIÓ
 * ---------------------------------------
 * Antes preguntaba una sola cosa: `bot_active = false`. O sea, vigilaba un
 * INTERRUPTOR, no una situación. Con 8 líneas corporativas eso es inservible:
 * varias se usan para procesos internos de la empresa, no tienen por qué estar
 * atendidas por el bot, y quedaban notificando para siempre. Una campana que
 * siempre está encendida no avisa de nada.
 *
 * Ahora vigila **quién necesita a una persona ahora mismo**, y eso no depende
 * del interruptor:
 *
 *   - `angry`  → un cliente molesto necesita a alguien, con bot o sin bot.
 *   - `sold`   → aceptó comprar; alguien tiene que completar el pedido.
 *   - ayuda    → pidió hablar con un humano (el bot quedó apagado).
 *   - `ignore` → NUNCA notifica. Es la etapa de los chats internos.
 *
 * Solo se miran los últimos 14 días, para que el contador no crezca sin fin.
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

    // Se traen las conversaciones recientes y se clasifican aquí: el filtro
    // depende de la etapa del contacto Y del interruptor del bot a la vez, y
    // eso no se expresa bien en una sola consulta.
    const { data: alerts, error } = await (supabase as any)
      .from('conversations')
      .select(`
        id,
        bot_active,
        last_message_at,
        created_at,
        contacts (
          id,
          full_name,
          wa_phone,
          metadata
        ),
        messages (
          content,
          direction,
          created_at
        )
      `)
      .eq('organization_id', orgId)
      .gte('last_message_at', fourteenDaysAgo)
      .order('last_message_at', { ascending: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const formattedAlerts = (alerts || [])
      .map((conv: any) => {
        const etapa = conv.contacts?.metadata?.stage || 'inbox';

        // Los chats internos no avisan nunca. Es la razón de ser de 'ignore'.
        if (etapa === 'ignore') return null;

        // Prioridad: primero quien está molesto, luego quien va a pagar, y por
        // último quien pidió ayuda. Un cliente enfadado no puede quedar debajo
        // de una conversación cualquiera con el bot apagado.
        let tipo: 'molesto' | 'listo' | 'ayuda' | null = null;
        if (etapa === 'angry') tipo = 'molesto';
        else if (etapa === 'sold') tipo = 'listo';
        else if (conv.bot_active === false) tipo = 'ayuda';

        if (!tipo) return null;

        const msgs = (conv.messages || []).sort(
          (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const lastMsg = msgs[0];
        return {
          conversationId: conv.id,
          tipo,
          etapa,
          botActive: conv.bot_active !== false,
          contactName: conv.contacts?.full_name || null,
          contactPhone: conv.contacts?.metadata?.telefono || conv.contacts?.wa_phone || '',
          lastMessageAt: conv.last_message_at,
          lastMessage: lastMsg?.content || '',
          lastMessageDirection: lastMsg?.direction || 'inbound',
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        const orden = { molesto: 0, listo: 1, ayuda: 2 } as Record<string, number>;
        if (orden[a.tipo] !== orden[b.tipo]) return orden[a.tipo] - orden[b.tipo];
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      })
      .slice(0, 50);

    const porTipo = {
      molesto: formattedAlerts.filter((a: any) => a.tipo === 'molesto').length,
      listo: formattedAlerts.filter((a: any) => a.tipo === 'listo').length,
      ayuda: formattedAlerts.filter((a: any) => a.tipo === 'ayuda').length,
    };

    return NextResponse.json({
      alerts: formattedAlerts,
      count: formattedAlerts.length,
      porTipo,
    });
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
