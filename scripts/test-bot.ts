import './load-env';
import { createAdminClient } from '../lib/supabase/admin';
import { runAgentForMessage } from '../lib/agent';
import readline from 'readline';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Error: NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY deben estar configuradas en el archivo .env.local.');
  process.exit(1);
}

/**
 * test-bot.ts — Entorno único de validación del bot "Oscar Herrera".
 *
 * Modos de uso:
 *   1. REPL interactivo (por defecto):  npx tsx scripts/test-bot.ts
 *   2. Consulta única (una sola tirada): npx tsx scripts/test-bot.ts "pocillos pal tinto"
 *   3. Lote de consultas en bucle:      npx tsx scripts/test-bot.ts --batch "q1" "q2" ...
 *
 * El modo no interactivo (2 y 3) ejecuta cada consulta en una conversación
 * LIMPIA y sin memoria previa, para poder auditar la recuperación del RAG de
 * forma determinista. Es el modo que usa el bucle de calibración.
 */

async function setupTestContext() {
  const supabase = createAdminClient();

  const { data: orgData, error: orgErr } = await supabase.from('organizations').select('id, name').limit(1).single();
  if (orgErr || !orgData) {
    console.error('❌ Error: No se encontró la organización en la base de datos.');
    process.exit(1);
  }

  const orgId = orgData.id;
  console.log(`\n🏢 Empresa cargada: ${orgData.name}`);

  const testPhone = '573000000000';
  let { data: contact } = await supabase
    .from('contacts')
    .select('id, full_name')
    .eq('organization_id', orgId)
    .eq('wa_phone', testPhone)
    .maybeSingle();

  if (!contact) {
    const { data: newContact, error: cErr } = await supabase
      .from('contacts')
      .insert({
        organization_id: orgId,
        wa_phone: testPhone,
        full_name: 'Cliente Prueba Local',
        metadata: {}
      })
      .select('id, full_name')
      .single();

    if (cErr || !newContact) {
      console.error('❌ Error al crear el contacto de prueba:', cErr?.message);
      process.exit(1);
    }
    contact = newContact;
  }

  const { data: agentConfig, error: configErr } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  if (configErr || !agentConfig) {
    console.error('❌ Error al cargar la configuración del agente:', configErr?.message);
    process.exit(1);
  }

  return { supabase, orgId, contact, agentConfig };
}

async function freshConversation(supabase: any, orgId: string, contactId: string) {
  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .insert({
      organization_id: orgId,
      contact_id: contactId,
      bot_active: true,
      line_key: 'test-local-cli'
    })
    .select('id')
    .single();

  if (convErr || !conversation) {
    console.error('❌ Error al crear la conversación de prueba:', convErr?.message);
    process.exit(1);
  }
  return conversation.id;
}

async function runOneQuery(
  supabase: any,
  orgId: string,
  contactPhone: string,
  contactName: string,
  conversationId: string,
  agentConfig: any,
  messageText: string
): Promise<string | null> {
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
  }
  return response;
}

async function main() {
  const argv = process.argv.slice(2);
  const ctx = await setupTestContext();
  const { supabase, orgId, contact, agentConfig } = ctx;
  const testPhone = '573000000000';

  // ---- MODO LOTE (--batch q1 q2 ...) ----
  if (argv[0] === '--batch') {
    const queries = argv.slice(1).filter(Boolean);
    if (queries.length === 0) {
      console.error('❌ --batch requiere al menos una consulta.');
      process.exit(1);
    }
    console.log(`🧪 Modo lote: ${queries.length} consultas (conversación limpia cada una).\n`);
    for (const q of queries) {
      const conversationId = await freshConversation(supabase, orgId, contact!.id);
      console.log(`──────────────────────────────────────────────`);
      console.log(`👤 Tú: ${q}`);
      try {
        const resp = await runOneQuery(supabase, orgId, testPhone, contact!.full_name, conversationId, agentConfig, q);
        console.log(`\n🤖 Oscar Herrera: ${resp ?? '[El bot decidió no responder]'}\n`);
      } catch (error) {
        console.error('❌ Ocurrió un error:', error);
      }
    }
    console.log(`──────────────────────────────────────────────`);
    console.log('✅ Lote finalizado.');
    process.exit(0);
  }

  // ---- MODO CONVERSACIÓN MULTI-TURNO (--script q1 q2 q3 ...) ----
  // Ejecuta una secuencia de mensajes en la MISMA conversación (con memoria),
  // para simular un embudo completo end-to-end: oferta → objeción → cierre.
  if (argv[0] === '--script') {
    const queries = argv.slice(1).filter(Boolean);
    if (queries.length === 0) {
      console.error('❌ --script requiere al menos un mensaje.');
      process.exit(1);
    }
    const conversationId = await freshConversation(supabase, orgId, contact!.id);
    console.log(`🎭 Modo conversación: ${queries.length} turnos en una sola charla.\n`);
    for (const q of queries) {
      console.log(`──────────────────────────────────────────────`);
      console.log(`👤 Tú: ${q}`);
      try {
        const resp = await runOneQuery(supabase, orgId, testPhone, contact!.full_name, conversationId, agentConfig, q);
        console.log(`\n🤖 Oscar Herrera: ${resp ?? '[El bot decidió no responder]'}\n`);
      } catch (error) {
        console.error('❌ Ocurrió un error:', error);
      }
    }
    console.log(`──────────────────────────────────────────────`);
    console.log('✅ Conversación finalizada.');
    process.exit(0);
  }

  // ---- MODO CONSULTA ÚNICA (un argumento) ----
  if (argv.length >= 1) {
    const messageText = argv.join(' ');
    const conversationId = await freshConversation(supabase, orgId, contact!.id);
    console.log(`👤 Tú: ${messageText}`);
    try {
      const resp = await runOneQuery(supabase, orgId, testPhone, contact!.full_name, conversationId, agentConfig, messageText);
      console.log(`\n🤖 Oscar Herrera: ${resp ?? '[El bot decidió no responder]'}\n`);
    } catch (error) {
      console.error('❌ Ocurrió un error:', error);
    }
    process.exit(0);
  }

  // ---- MODO REPL INTERACTIVO (por defecto) ----
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const conversationId = await freshConversation(supabase, orgId, contact!.id);

  console.log('🤖 Bot "Oscar Herrera" inicializado en consola.');
  console.log('📝 Escribe lo que quieras probar (ejemplo: "pocillo pal tinto").');
  console.log('🚪 Escribe "salir" para terminar.\n');

  const askQuestion = () => {
    rl.question('👤 Tú: ', async (userInput) => {
      const cleanInput = userInput.trim();

      if (cleanInput.toLowerCase() === 'salir') {
        console.log('\n👋 Sesión de pruebas finalizada. ¡Hasta luego!');
        rl.close();
        process.exit(0);
      }

      if (!cleanInput) {
        askQuestion();
        return;
      }

      try {
        const resp = await runOneQuery(supabase, orgId, testPhone, contact!.full_name, conversationId, agentConfig, cleanInput);
        if (resp) {
          console.log(`\n🤖 Oscar Herrera: ${resp}\n`);
        } else {
          console.log('\n🤖 Oscar Herrera: [El bot decidió no responder]\n');
        }
      } catch (error) {
        console.error('\n❌ Ocurrió un error:', error);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch((err) => {
  console.error('❌ Error fatal al iniciar:', err);
  process.exit(1);
});
