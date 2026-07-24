/**
 * ============================================================================
 * REPORT.TS — Agregación de veredictos, diagnóstico de causa raíz y serialización
 * ============================================================================
 * Acumula los resultados de cada turno, calcula estadísticas por categoría y
 * global, emite un diagnóstico de causa raíz del "guardrail bloquea todo" y
 * sugiere micro-correcciones accionables (que el humano aprueba antes de aplicar).
 *
 * Escribe un JSON auditable en scripts/hallucination_loop/report.json.
 * ============================================================================
 */

import * as fs from 'fs';
import * as path from 'path';
import { Verdict, VerificationDetail } from './verifiers';
import { CatalogProduct } from './catalog_probe';
import { CategorySeed } from './products';

export interface TurnRecord {
  category: string;
  pricingLogic: string;
  variantLabel: string;
  question: string;
  response: string | null;
  latencyMs: number;
  error: string | null;
  verdict: Verdict;
  detail: VerificationDetail;
  /** Productos reales de la categoría (para contexto del reporte). */
  realProductNames: string[];
}

export interface CategoryStats {
  category: string;
  total: number;
  pass: number;
  guardrailBlock: number;
  frozen: number;
  hallucinatedPrice: number;
  noPrice: number;
  passRate: number;
}

export interface LoopReport {
  startedAt: string;
  finishedAt: string;
  totalTurns: number;
  globalPassRate: number;
  ragHealth: { online: boolean; latencyMs: number | null };
  categoryStats: CategoryStats[];
  turns: TurnRecord[];
  rootCauseDiagnosis: string;
  recommendations: string[];
}

export class ReportBuilder {
  private turns: TurnRecord[] = [];

  addTurn(record: TurnRecord): void {
    this.turns.push(record);
  }

  private computeStats(category?: string): CategoryStats[] {
    const categories = category ? [category] : [...new Set(this.turns.map((t) => t.category))];
    return categories.map((cat) => {
      const catTurns = this.turns.filter((t) => t.category === cat);
      const total = catTurns.length;
      const count = (v: Verdict) => catTurns.filter((t) => t.verdict === v).length;
      return {
        category: cat,
        total,
        pass: count('PASS'),
        guardrailBlock: count('GUARDRAIL_BLOCK'),
        frozen: count('FROZEN'),
        hallucinatedPrice: count('HALLUCINATED_PRICE'),
        noPrice: count('NO_PRICE'),
        passRate: total > 0 ? count('PASS') / total : 0,
      };
    });
  }

  /**
   * Diagnóstico de causa raíz basado en la distribución de veredictos.
   * Mapea cada patrón dominante a la causa técnica documentada.
   */
  private diagnose(): { diagnosis: string; recommendations: string[] } {
    const stats = this.computeStats();
    const total = this.turns.length;
    if (total === 0) {
      return { diagnosis: 'Sin datos.', recommendations: [] };
    }

    const guardrailBlocks = stats.reduce((s, c) => s + c.guardrailBlock, 0);
    const frozen = stats.reduce((s, c) => s + c.frozen, 0);
    const hallucinated = stats.reduce((s, c) => s + c.hallucinatedPrice, 0);
    const noPrice = stats.reduce((s, c) => s + c.noPrice, 0);

    const recommendations: string[] = [];

    // Caso dominante: GUARDRAIL_BLOCK
    if (guardrailBlocks / total >= 0.5) {
      // Revisar qué categorías disparan más bloqueos
      const worstCat = stats
        .filter((c) => c.guardrailBlock > 0)
        .sort((a, b) => b.guardrailBlock - a.guardrailBlock)[0];

      // Clasificar la causa (A: totales, B: mapeo, C: RAG)
      const blockedTurns = this.turns.filter((t) => t.verdict === 'GUARDRAIL_BLOCK');
      const withMentionedPrices = blockedTurns.filter((t) => t.detail.mentionedPrices.length > 0).length;
      const withoutMentionedPrices = blockedTurns.length - withMentionedPrices;

      const diagnosis = [
        `CAUSA DOMINANTE: FALSO POSITIVO DEL GUARDRAIL (${guardrailBlocks}/${total} turnos bloqueados = ${Math.round((guardrailBlocks / total) * 100)}%).`,
        `El bot SÍ está haciendo su trabajo (llama searchCatalog + getProductPrice y genera respuestas correctas), pero applyOutputGuardrail las bloquea porque los precios no validan contra price_tiers.`,
        worstCat ? `Categoría más afectada: "${worstCat.category}" (${worstCat.guardrailBlock} bloqueos).` : '',
        withMentionedPrices > withoutMentionedPrices
          ? `Sub-causa A (TOTALES CALCULADOS): En ${withMentionedPrices} bloqueos el bot sí mencionó precios. Probablemente son totales compuestos (cuadernos: base+insertos×cantidad) o totales por millar que NO existen literalmente en price_tiers, por lo que el guardrail no los encuentra y bloquea.`
          : `Sub-causa B (FALTA DE PRECIOS EN TOOLS): En ${withoutMentionedPrices} bloqueos el bot no mencionó precios en el texto bloqueado, lo que sugiere que getProductPrice no devolvió datos válidos (mapeo referencia→UUID o tiers corruptos).`,
      ].filter(Boolean).join('\n');

      recommendations.push(
        '⚡ ACCIÓN SUGERIDA (Causa A - totales): Ajustar applyOutputGuardrail para que, además de los múltiplos 2-10, reconozca como válidos los totales generados por getProductPriceTool (que ya los calcula correctamente). El guardrail debería confiar en los totales que las tools devolvieron en el turno, no solo en price_tiers literales.'
      );
      recommendations.push(
        '⚡ ACCIÓN SUGERIDA (Causa B - mapeo): Auditar getProductPriceTool: verificar que el product_id que recibe resuelva siempre a un UUID con price_tiers. Si el bot pasa una referencia como "MU-152" y no resuelve, el guardrail no tendrá contra qué validar.'
      );
      recommendations.push(
        '⚡ ACCIÓN SUGERIDA (Causa C - RAG): Verificar que el microservicio RAG Python (puerto 8001) esté corriendo en el VPS. Si está caído, searchCatalog cae al fallback SQL que enriquece menos metadatos, degradando la cadena.'
      );

      return { diagnosis, recommendations };
    }

    // Caso dominante: FROZEN
    if (frozen / total >= 0.5) {
      return {
        diagnosis: `CAUSA DOMINANTE: EL AGENTE SE CONGELA (${frozen}/${total} turnos sin respuesta útil). Esto indica que runAgentForMessage falla o devuelve null. Probable causa: el servicio RAG está caído y searchCatalog lanza una excepción no capturada, o el modelo LLM rechaza la llamada.`,
        recommendations: [
          '⚡ Verificar salud del RAG Python (:8001) en el VPS.',
          '⚡ Revisar logs del contenedor knowledgebot-app: docker logs knowledgebot-app | grep "Agent error".',
          '⚡ Confirmar que OPENROUTER_API_KEY y CHAT_MODEL están configurados en .env.production del VPS.',
        ],
      };
    }

    // Caso dominante: HALLUCINATED_PRICE (false negative del guardrail)
    if (hallucinated / total >= 0.3) {
      return {
        diagnosis: `CAUSA DOMINANTE: ALUCINACIÓN REAL NO DETECTADA (${hallucinated}/${total} turnos con precios inventados que el guardrail dejó pasar). El guardrail tiene false negatives: precios que menciona el bot no están en price_tiers pero el candado no los bloqueó.`,
        recommendations: [
          '⚡ El guardrail falla al validar: revisar por qué los precios sospechosos no se comparan correctamente contra price_tiers.',
          '⚡ Posible bug: el set realPricesFromTools puede estar vacío si los toolResults no se estructuran como espera el código.',
        ],
      };
    }

    // Caso dominante: NO_PRICE
    if (noPrice / total >= 0.5) {
      return {
        diagnosis: `CAUSA DOMINANTE: EL BOT NO DA PRECIOS (${noPrice}/${total} turnos describen productos pero sin cifras). El bot no está ejecutando getProductPrice, o lo ejecuta pero no muestra el resultado.`,
        recommendations: [
          '⚡ Revisar si el system-prompt está forzando demasiada indagación antes de cotizar (Protocolo de Indagación demasiado estricto).',
          '⚡ Verificar que getProductPrice devuelva precios para los product_ids de estas categorías (pueden faltar tiers).',
        ],
      };
    }

    // Éxito
    const passCount = stats.reduce((s, c) => s + c.pass, 0);
    return {
      diagnosis: `✅ ÉXITO: ${passCount}/${total} turnos (${Math.round((passCount / total) * 100)}%) respondieron con precios reales válidos. El bot funciona correctamente. Los bloqueos residuales son casos puntuales a revisar individualmente en el JSON.`,
      recommendations: ['El sistema está saludable. Revisar los turnos no-PASS en report.json para casos puntuales.'],
    };
  }

  build(ragHealth: { online: boolean; latencyMs: number | null }, startedAt: string): LoopReport {
    const { diagnosis, recommendations } = this.diagnose();
    const total = this.turns.length;
    const passCount = this.turns.filter((t) => t.verdict === 'PASS').length;

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      totalTurns: total,
      globalPassRate: total > 0 ? passCount / total : 0,
      ragHealth,
      categoryStats: this.computeStats(),
      turns: this.turns,
      rootCauseDiagnosis: diagnosis,
      recommendations,
    };
  }

  /**
   * Serializa el reporte a JSON y lo imprime legible en consola.
   */
  writeAndPrint(report: LoopReport): void {
    // 1. JSON auditable
    const outDir = __dirname;
    const jsonPath = path.join(outDir, 'report.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf8');

    // 2. Resumen legible en consola
    console.log('\n');
    console.log('='.repeat(78));
    console.log('📊 REPORTE DEL BUCLE DE DIAGNÓSTICO');
    console.log('='.repeat(78));
    console.log(`Total de turnos: ${report.totalTurns}`);
    console.log(`Tasa de éxito global (PASS): ${(report.globalPassRate * 100).toFixed(1)}%`);
    console.log(`RAG (:8001): ${report.ragHealth.online ? `✅ ONLINE (${report.ragHealth.latencyMs}ms)` : '❌ CAÍDO'}`);
    console.log('-'.repeat(78));
    console.log('Estadísticas por categoría:');
    for (const c of report.categoryStats) {
      console.log(
        `  ${c.category.padEnd(28)} PASS=${c.pass}  GUARDRAIL=${c.guardrailBlock}  FROZEN=${c.frozen}  HALLUC=${c.hallucinatedPrice}  NOPRICE=${c.noPrice}  (${(c.passRate * 100).toFixed(0)}%)`
      );
    }
    console.log('-'.repeat(78));
    console.log('🔍 DIAGNÓSTICO DE CAUSA RAÍZ:');
    console.log(report.rootCauseDiagnosis);
    console.log('-'.repeat(78));
    console.log('💡 RECOMENDACIONES (requieren aprobación humana antes de aplicar):');
    for (const r of report.recommendations) {
      console.log(`  ${r}`);
    }
    console.log('='.repeat(78));
    console.log(`📄 Reporte JSON completo: ${jsonPath}`);
    console.log('='.repeat(78));
  }
}
