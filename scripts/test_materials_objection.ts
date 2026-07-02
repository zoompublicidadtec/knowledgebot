import './load-env';
import { createAdminClient } from '../lib/supabase/admin';
import { runAgentForMessage } from '../lib/agent';

async function setupTestContext() {
  const supabase = createAdminClient();
  const { data: orgData } = await supabase.from('organizations').select('id, name').limit(1).single();
  const orgId = orgData.id;
  const testPhone = '573000000000';
  let { data: contact } = await supabase
    .from('contacts')
    .select('id, full_name')
    .eq('organization_id', orgId)
    .eq('wa_phone', testPhone)
    .maybeSingle();

  if (!contact) {
    const { data: newContact } = await supabase
      .from('contacts')
      .insert({
        organization_id: orgId,
        wa_phone: testPhone,
        full_name: 'Cliente Prueba Local',
        metadata: {}
      })
      .select('id, full_name')
      .single();
    contact = newContact;
  }

  const { data: agentConfig } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  return { supabase, orgId, contact, agentConfig };
}

async function freshConversation(supabase: any, orgId: string, contactId: string) {
  const { data: conversation } = await supabase
    .from('conversations')
    .insert({
      organization_id: orgId,
      contact_id: contactId,
      bot_active: true,
      line_key: 'test-local-cli'
    })
    .select('id')
    .single();
  return conversation.id;
}

async function runQuery(
  supabase: any,
  orgId: string,
  contactPhone: string,
  contactName: string,
  conversationId: string,
  agentConfig: any,
  messageText: string
): Promise<string | null> {
  console.log(`\n👤 Cliente: ${messageText}`);
  console.log('⏳ Oscar está pensando...');

  const waMessageId = `test-in-${Date.now()}`;
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    organization_id: orgId,
    wa_message_id: waMessageId,
    direction: 'inbound',
    sender: 'contact',
    content: messageText
  });

  const response = await runAgentForMessage({
    orgId,
    contactPhone,
    contactName,
    conversationId,
    messageText,
    agentConfig
  });

  if (response) {
    const botMessageId = `test-out-${Date.now()}`;
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      organization_id: orgId,
      wa_message_id: botMessageId,
      direction: 'outbound',
      sender: 'bot',
      content: response
    });
    console.log(`🤖 Oscar Herrera: ${response}`);
  }
  return response;
}

async function test() {
  console.log('--- INICIANDO PRUEBA DE OBJECIÓN DE MATERIALES ---');
  const ctx = await setupTestContext();
  const { supabase, orgId, contact, agentConfig } = ctx;
  const testPhone = '573000000000';
  const conversationId = await freshConversation(supabase, orgId, contact!.id);

  // Turno 1: Cliente saluda e indica que quiere pocillos
  await runQuery(supabase, orgId, testPhone, contact!.full_name, conversationId, agentConfig, 
    "hola me dieron este numero por que hay puedo mandar hacer unos posillos para mis empleados"
  );

  // Turno 2: Cliente indica volumen
  await runQuery(supabase, orgId, testPhone, contact!.full_name, conversationId, agentConfig, 
    "tengo 23 empleados mas yo y una mas por si acaso cuanto valen esos que dices que cambian de color?"
  );

  // Turno 3: Objeción de material: no quiere plástico ni metal
  await runQuery(supabase, orgId, testPhone, contact!.full_name, conversationId, agentConfig, 
    "no quiero nada de plastico ni de metal"
  );

  console.log('\n--- PRUEBA DE OBJECIÓN FINALIZADA ---');
}

test().catch(console.error);
