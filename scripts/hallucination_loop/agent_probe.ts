/**
 * ============================================================================
 * AGENT_PROBE.TS — Inyector del flujo COMPLETO del agente sin WhatsApp
 * ============================================================================
 * Envuelve `runAgentForMessage` para invocarlo desde el bucle, reproduciendo
 * el entorno de producción (system prompt real + LLM real + tools + guardrail).
 *
 * Sigue el patrón probado de scripts/test_flow.ts:
 *   - Usa el teléfono de prueba 573000000000 (no muta contactos reales).
 *   - Crea un conversation_id UUID fresco por turno (contexto limpio, Ralph).
 *   - Fetch del agentConfig REAL de agent_configs.
 *
 * NO envía nada por WhatsApp. NO inserta en messages salvo el par inbound/outbound
 * necesario para que el agente tenga contexto (controlado y aislado en una
 * conversación etiquetada 'hallucination-loop-test').
 * ============================================================================
 */

import { randomUUID } from 'crypto';
import { createAdminClient } from '../../lib/supabase/admin';
import { runAgentForMessage } from '../../lib/agent';

const TEST_PHONE = '573000000000';
const TEST_LINE_KEY = 'hallucination-loop-test';

export interface AgentContext {
  orgId: string;
  contactId: string;
  contactName: string;
  agentConfig: any;
}

/**
 * Prepara el contexto de prueba una sola vez al inicio del loop:
 * - Resuelve la organización (la primera activa en producción).
 * - Crea/recupera el contacto de prueba 573000000000.
 * - Obtiene el agentConfig real.
 */
export async function setupAgentContext(): Promise<AgentContext> {
  const supabase = createAdminClient();

  const { data: org, error: orgErr } = await (supabase as any)
    .from('organizations')
    .select('id, name')
    .limit(1)
    .single();
  if (orgErr || !org) {
    throw new Error(`No se pudo resolver la organización: ${orgErr?.message || 'sin datos'}`);
  }
  const orgId = org.id;

  // Recuperar o crear el contacto de prueba
  let { data: contact } = await (supabase as any)
    .from('contacts')
    .select('id, full_name')
    .eq('organization_id', orgId)
    .eq('wa_phone', TEST_PHONE)
    .maybeSingle();

  if (!contact) {
    const { data: newContact, error: cErr } = await (supabase as any)
      .from('contacts')
      .insert({ organization_id: orgId, wa_phone: TEST_PHONE, full_name: 'Loop Diagnostico', metadata: {} })
      .select('id, full_name')
      .single();
    if (cErr || !newContact) {
      throw new Error(`No se pudo crear contacto de prueba: ${cErr?.message}`);
    }
    contact = newContact;
  }

  // Fetch del agentConfig REAL (incluye el system_prompt base; buildSystemPrompt
  // le añade los ~350 renglones de embudo/guardrails al invocar runAgentForMessage)
  const { data: agentConfig, error: cfgErr } = await (supabase as any)
    .from('agent_configs')
    .select('*')
    .eq('organization_id', orgId)
    .single();
  if (cfgErr || !agentConfig) {
    throw new Error(`No se pudo obtener agentConfig: ${cfgErr?.message}`);
  }

  return { orgId, contactId: contact.id, contactName: contact.full_name || 'Loop', agentConfig };
}

export interface ProbeResult {
  response: string | null;
  latencyMs: number;
  error: string | null;
}

/**
 * Ejecuta UN turno del agente con contexto limpio (conversación nueva cada vez).
 * Inserta el mensaje inbound y el outbound en una conversación aislada para
 * que el agente tenga historial coherente, pero sin tocar conversaciones reales.
 */
export async function probeAgent(ctx: AgentContext, messageText: string): Promise<ProbeResult> {
  const supabase = createAdminClient();
  const start = Date.now();

  try {
    // Crear conversación aislada y fresca para este turno (principio Ralph)
    const { data: conversation, error: convErr } = await (supabase as any)
      .from('conversations')
      .insert({
        organization_id: ctx.orgId,
        contact_id: ctx.contactId,
        bot_active: true,
        line_key: TEST_LINE_KEY,
      })
      .select('id')
      .single();
    if (convErr || !conversation) {
      return { response: null, latencyMs: Date.now() - start, error: `conv: ${convErr?.message}` };
    }
    const conversationId = conversation.id;

    // Insertar el mensaje inbound (con wa_message_id único para idempotencia)
    const inMsgId = `loop-in-${randomUUID()}`;
    await (supabase as any).from('messages').insert({
      conversation_id: conversationId,
      organization_id: ctx.orgId,
      wa_message_id: inMsgId,
      direction: 'inbound',
      sender: 'contact',
      content: messageText,
      line_key: TEST_LINE_KEY,
    });

    // Invocar el flujo COMPLETO del agente
    const response = await runAgentForMessage({
      orgId: ctx.orgId,
      contactPhone: TEST_PHONE,
      contactName: ctx.contactName,
      conversationId,
      messageText,
      agentConfig: ctx.agentConfig,
    });

    // Insertar la respuesta outbound para que el historial quede coherente
    if (response) {
      const outMsgId = `loop-out-${randomUUID()}`;
      await (supabase as any).from('messages').insert({
        conversation_id: conversationId,
        organization_id: ctx.orgId,
        wa_message_id: outMsgId,
        direction: 'outbound',
        sender: 'bot',
        content: response,
        line_key: TEST_LINE_KEY,
      });
    }

    return { response, latencyMs: Date.now() - start, error: null };
  } catch (err: any) {
    return { response: null, latencyMs: Date.now() - start, error: String(err?.message || err) };
  }
}
