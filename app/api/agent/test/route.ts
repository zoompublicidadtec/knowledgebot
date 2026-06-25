import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgentForMessage } from '@/lib/agent';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/test
 * Sandbox endpoint to test the agent from the dashboard WITHOUT WhatsApp.
 * Authenticated + org-scoped: only the owner of the conversation can use it.
 */
export async function POST(request: NextRequest) {
  try {
    const { message, conversationId, orgId } = await request.json() as {
      message: string;
      conversationId: string;
      orgId: string;
    };

    if (!message || !conversationId || !orgId) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 });
    }

    // Authenticate the user
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    // Verify the conversation belongs to the user's org
    const { data: profile } = await (supabase as any)
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile || profile.organization_id !== orgId) {
      return NextResponse.json({ error: 'No autorizado para esta organización' }, { status: 403 });
    }

    const { data: conv } = await (supabase as any)
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', orgId)
      .single();

    if (!conv) {
      return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
    }

    const adminSupabase = createAdminClient();

    // Load agent config
    const { data: agentConfig } = await (adminSupabase as any)
      .from('agent_configs')
      .select('*')
      .eq('organization_id', orgId)
      .single();

    if (!agentConfig) {
      return NextResponse.json({ error: 'Configuración no encontrada' }, { status: 404 });
    }

    // Insert inbound sandbox message
    await (adminSupabase as any)
      .from('messages')
      .insert({
        conversation_id: conversationId,
        organization_id: orgId,
        direction: 'inbound',
        sender: 'contact',
        content: message,
      });

    // Run the agent
    const responseText = await runAgentForMessage({
      orgId,
      contactPhone: '+10000000000', // Mock sandbox number
      contactName: 'Cliente Demo',
      conversationId,
      messageText: message,
      agentConfig,
    });

    if (responseText) {
      await (adminSupabase as any)
        .from('messages')
        .insert({
          conversation_id: conversationId,
          organization_id: orgId,
          direction: 'outbound',
          sender: 'bot',
          content: responseText,
        });
    }

    return NextResponse.json({ reply: responseText });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
