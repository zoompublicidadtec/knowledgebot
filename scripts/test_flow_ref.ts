import './load-env';
import { runAgentForMessage } from '../lib/agent';

async function testRefFlow() {
  console.log('--- INICIANDO PRUEBA DE FLUJO DE DIÁLOGO (CON REFERENCIAS) ---\n');

  const conversationId = 'ref-test-' + Date.now();
  const orgId = '06b603de-24cb-4771-9719-1a6e0578a35d';

  // Mensaje 1: Disparar oferta de esferos
  console.log('👤 Cliente: hola necesito unos esferitos para regalarle a mis 28 empleados y unos dos para mi');
  let response = await runAgentForMessage({
    message: 'hola necesito unos esferitos para regalarle a mis 28 empleados y unos dos para mi',
    conversationId,
    orgId
  });
  console.log(`🤖 Oscar Herrera: ${response.message}\n`);

  // Mensaje 2: Solicitar recomendación
  console.log('👤 Cliente: el color no importa que me puedes recomendar que sean bonitos y economicos');
  response = await runAgentForMessage({
    message: 'el color no importa que me puedes recomendar que sean bonitos y economicos',
    conversationId,
    orgId
  });
  console.log(`🤖 Oscar Herrera: ${response.message}\n`);

  // Mensaje 3: Preguntar precio
  console.log('👤 Cliente: que precio tienen?');
  response = await runAgentForMessage({
    message: 'que precio tienen?',
    conversationId,
    orgId
  });
  console.log(`🤖 Oscar Herrera: ${response.message}\n`);

  console.log('--- PRUEBA DE FLUJO FINALIZADA ---');
}

testRefFlow().catch(console.error);
