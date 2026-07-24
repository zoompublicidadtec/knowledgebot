/**
 * ============================================================================
 * RUN_LOOP.TS — Orquestador principal del Bucle Ralph Conversacional
 * ============================================================================
 * Ejecuta el flujo completo del agente (system prompt real + LLM real +
 * guardrail real) contra Supabase de producción, para cada variante de
 * pregunta de cada categoría, y emite un diagnóstico determinista.
 *
 * Uso (desde la raíz del repo):
 *   npx tsx scripts/hallucination_loop/run_loop.ts
 *
 * No envía WhatsApp. No toca la estructura del bot. Cada turno usa un
 * conversation_id fresco (contexto limpio, principio Ralph).
 * ============================================================================
 */

import '../load-env';
import { CATEGORY_SEEDS, CategorySeed } from './products';
import { probeCategory, checkRagHealth, CatalogProduct } from './catalog_probe';
import { setupAgentContext, probeAgent, AgentContext } from './agent_probe';
import { verifyResponse } from './verifiers';
import { ReportBuilder, LoopReport } from './report';

// Tope duro de turnos (control de costo OpenRouter)
const MAX_TURNS = 20;
// Detención temprana si PASS >= 75% en 2 categorías consecutivas
const EARLY_STOP_PASS_RATE = 0.75;

function banner(msg: string) {
  console.log('\n' + '─'.repeat(78));
  console.log(msg);
  console.log('─'.repeat(78));
}

async function processVariant(
  ctx: AgentContext,
  seed: CategorySeed,
  realProducts: CatalogProduct[],
  variantLabel: string,
  question: string,
  report: ReportBuilder
): Promise<VerdictLite> {
  console.log(`\n👤 [${seed.name}/${variantLabel}] Cliente: "${question}"`);
  console.log('⏳ Inyectando por el flujo completo del agente (LLM + guardrail)...');

  const probe = await probeAgent(ctx, question);

  // Truncar respuesta larga para consola, pero guardar completa en el reporte
  const preview = (probe.response || '(sin respuesta)')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
  console.log(`🤖 Respuesta (${probe.latencyMs}ms): ${preview}${(probe.response || '').length > 200 ? '...' : ''}`);
  if (probe.error) {
    console.log(`⚠️  Error: ${probe.error}`);
  }

  const detail = verifyResponse(probe.response, realProducts);
  const emoji: Record<string, string> = {
    PASS: '✅',
    GUARDRAIL_BLOCK: '🛑',
    FROZEN: '❄️',
    HALLUCINATED_PRICE: '👻',
    NO_PRICE: '🚫',
  };
  console.log(`${emoji[detail.verdict]} VEREDICTO: ${detail.verdict}`);
  if (detail.mentionedPrices.length > 0) {
    console.log(`   Precios mencionados: ${detail.mentionedPrices.join(', ')}`);
  }
  if (detail.hallucinatedPrices.length > 0) {
    console.log(`   ⚠️  No válidos contra BD: ${detail.hallucinatedPrices.join(', ')}`);
  }
  console.log(`   Razón: ${detail.reason}`);

  report.addTurn({
    category: seed.name,
    pricingLogic: seed.pricingLogic,
    variantLabel,
    question,
    response: probe.response,
    latencyMs: probe.latencyMs,
    error: probe.error,
    verdict: detail.verdict,
    detail,
    realProductNames: realProducts.map((p) => p.name),
  });

  return { verdict: detail.verdict };
}

interface VerdictLite {
  verdict: string;
}

async function main() {
  const startedAt = new Date().toISOString();
  banner('🔁 BUCLE RALPH CONVERSACIONAL — Diagnóstico del "Guardrail Bloquea Todo"');
  console.log(`Inicio: ${startedAt}`);
  console.log(`Modelo: ${process.env.CHAT_MODEL || 'google/gemini-2.5-flash'}`);
  console.log(`Tope de turnos: ${MAX_TURNS}`);

  // 0. Health check del RAG (Causa C)
  banner('Paso 0: Health check del servicio RAG (:8001)');
  const ragHealth = await checkRagHealth();
  console.log(`RAG: ${ragHealth.online ? `✅ ONLINE (${ragHealth.latencyMs}ms)` : '❌ CAÍDO (searchCatalog caerá al fallback SQL)'}`);

  // 1. Contexto del agente (org + contacto de prueba + agentConfig real)
  banner('Paso 1: Resolviendo contexto del agente contra Supabase de producción');
  let ctx: AgentContext;
  try {
    ctx = await setupAgentContext();
    console.log(`✅ Org: ${ctx.orgId}`);
    console.log(`✅ Contacto de prueba: ${ctx.contactName} (${ctx.contactId})`);
    console.log(`✅ agentConfig cargado (system_prompt: ${ctx.agentConfig.system_prompt?.length || 0} chars)`);
  } catch (err: any) {
    console.error('❌ No se pudo preparar el contexto:', err.message);
    process.exit(1);
  }

  const report = new ReportBuilder();
  let totalTurns = 0;
  let consecutivePassCategories = 0;

  // 2. Iterar categorías
  for (const seed of CATEGORY_SEEDS) {
    if (totalTurns >= MAX_TURNS) {
      console.log(`\n⛔ Tope de turnos (${MAX_TURNS}) alcanzado. Deteniendo.`);
      break;
    }

    banner(`Paso 2: Categoría "${seed.name}" (lógica: ${seed.pricingLogic})`);

    // 2a. Probe del catálogo: leer productos REALES de Supabase
    console.log(`🔍 Buscando productos reales para: ${seed.searchTerms.join(', ')}`);
    const realProducts = await probeCategory(seed, 3);
    if (realProducts.length === 0) {
      console.log(`⚠️  No se encontraron productos para "${seed.name}". Saltando categoría.`);
      continue;
    }
    console.log(`📦 Productos reales encontrados (${realProducts.length}):`);
    for (const p of realProducts) {
      console.log(`   - ${p.name} | ref=${p.reference || '(sin ref)'} | unit=${p.unit} | cotizable=${p.has_pricing} | maxPrice=$${p.maxPrice} | tiers=${p.tiers.length}`);
    }

    // 2b. Ejecutar cada variante de pregunta
    let categoryPasses = 0;
    let categoryTotal = 0;
    for (const variant of seed.variants) {
      if (totalTurns >= MAX_TURNS) break;
      const result = await processVariant(ctx, seed, realProducts, variant.label, variant.text, report);
      totalTurns++;
      categoryTotal++;
      if (result.verdict === 'PASS') categoryPasses++;
    }

    // 2c. Detención temprana si 2 categorías consecutivas >= 75% PASS
    const catRate = categoryTotal > 0 ? categoryPasses / categoryTotal : 0;
    if (catRate >= EARLY_STOP_PASS_RATE) {
      consecutivePassCategories++;
      if (consecutivePassCategories >= 2) {
        console.log(`\n🎉 Detención temprana: 2 categorías consecutivas >= ${(EARLY_STOP_PASS_RATE * 100)}% PASS. El bot funciona.`);
        break;
      }
    } else {
      consecutivePassCategories = 0;
    }
  }

  // 3. Construir y emitir el reporte
  banner('Paso 3: Construyendo reporte y diagnóstico de causa raíz');
  const finalReport: LoopReport = report.build(ragHealth, startedAt);
  report.writeAndPrint(finalReport);
}

main().catch((err) => {
  console.error('\n💥 Error fatal del bucle:', err);
  process.exit(1);
});
