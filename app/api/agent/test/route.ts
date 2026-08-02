import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runAgentForMessage } from '@/lib/agent';
import { getBridgeApiKey } from '@/lib/whatsapp/bridge';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * POST /api/agent/test
 * Simulador del agente SIN WhatsApp: ejecuta el mismo `runAgentForMessage` que
 * el webhook y guarda los dos mensajes en la conversación.
 *
 * DOS PUERTAS DE ENTRADA
 * ----------------------
 * 1. **Con sesión del panel** (lo de siempre): el simulador de Personalización.
 *    Requiere usuario autenticado y que la conversación sea de su organización.
 *
 * 2. **Con la llave del puente** (`x-bridge-key`), servidor a servidor. Es la
 *    MISMA llave que ya autentica el webhook de WhatsApp, así que no se abre
 *    ninguna puerta nueva: quien la tuviera ya podía inyectar mensajes.
 *
 *    Existe para poder correr tandas de prueba —decenas de conversaciones
 *    completas, con sus etapas del pipeline— sin que una persona las escriba a
 *    mano una por una, sin gastar mensajes reales y sin arriesgar el bloqueo de
 *    un número. Es el mismo bot, el mismo catálogo y los mismos guardrails: lo
 *    único que cambia es quién escribe el mensaje del cliente.
 *
 * Por la puerta 2 se puede indicar `contactPhone`, `contactName` y `lineKey`, y
 * la conversación se crea si no existe, agrupada por contacto Y línea igual que
 * en el webhook. Por la puerta 1 se sigue exigiendo un `conversationId` que ya
 * pertenezca a la organización.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      message: string;
      conversationId?: string;
      orgId: string;
      contactPhone?: string;
      contactName?: string;
      lineKey?: string;
    };
    const { message, orgId, contactPhone, contactName, lineKey } = body;
    let conversationId = body.conversationId;

    if (!message || !orgId) {
      return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 });
    }

    const bridgeKey = getBridgeApiKey();
    const incomingKey = request.headers.get('x-bridge-key') || '';
    const porLlave = !!bridgeKey && incomingKey === bridgeKey;

    if (!porLlave) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

      const { data: profile } = await (supabase as any)
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();

      if (!profile || profile.organization_id !== orgId) {
        return NextResponse.json({ error: 'No autorizado para esta organización' }, { status: 403 });
      }

      if (!conversationId) {
        return NextResponse.json({ error: 'Falta conversationId' }, { status: 400 });
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
    }

    const adminSupabase = createAdminClient();

    const { data: agentConfig } = await (adminSupabase as any)
      .from('agent_configs')
      .select('*')
      .eq('organization_id', orgId)
      .single();

    if (!agentConfig) {
      return NextResponse.json({ error: 'Configuración no encontrada' }, { status: 404 });
    }

    // Sin conversación indicada: se busca o se crea el contacto y su chat en la
    // línea pedida, con el mismo criterio de agrupación que usa el webhook.
    if (!conversationId) {
      if (!contactPhone) {
        return NextResponse.json({ error: 'Falta contactPhone o conversationId' }, { status: 400 });
      }

      const { data: existente } = await (adminSupabase as any)
        .from('contacts')
        .select('id')
        .eq('organization_id', orgId)
        .eq('wa_phone', contactPhone)
        .limit(1)
        .maybeSingle();

      let contactId: string | null = existente?.id || null;
      if (!contactId) {
        const { data: nuevo, error: errContacto } = await (adminSupabase as any)
          .from('contacts')
          .insert({ organization_id: orgId, wa_phone: contactPhone, full_name: contactName || null })
          .select('id')
          .single();
        if (errContacto || !nuevo) {
          return NextResponse.json(
            { error: `No se pudo crear el contacto: ${errContacto?.message}` }, { status: 500 }
          );
        }
        contactId = nuevo.id;
      }

      let convQuery = (adminSupabase as any)
        .from('conversations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('contact_id', contactId);
      convQuery = lineKey ? convQuery.eq('line_key', lineKey) : convQuery.is('line_key', null);
      const { data: convRows } = await convQuery.order('created_at', { ascending: true });

      conversationId = (convRows || [])[0]?.id;
      if (!conversationId) {
        const { data: nuevaConv, error: errConv } = await (adminSupabase as any)
          .from('conversations')
          .insert({
            organization_id: orgId,
            contact_id: contactId,
            line_key: lineKey || null,
            bot_active: true,
          })
          .select('id')
          .single();
        if (errConv || !nuevaConv) {
          return NextResponse.json(
            { error: `No se pudo crear la conversación: ${errConv?.message}` }, { status: 500 }
          );
        }
        conversationId = nuevaConv.id;
      }
    }

    await (adminSupabase as any)
      .from('messages')
      .insert({
        conversation_id: conversationId,
        organization_id: orgId,
        direction: 'inbound',
        sender: 'contact',
        content: message,
        ...(lineKey ? { line_key: lineKey } : {}),
      });

    const responseText = await runAgentForMessage({
      orgId,
      contactPhone: contactPhone || '+10000000000',
      contactName: contactName || 'Cliente Demo',
      conversationId: conversationId!,
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
          ...(lineKey ? { line_key: lineKey } : {}),
        });
    }

    await (adminSupabase as any)
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    return NextResponse.json({ reply: responseText, conversationId });
  } catch (err: any) {
    logger.error('Simulador del agente: fallo', { error: String(err) });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
