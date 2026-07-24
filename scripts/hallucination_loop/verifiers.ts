/**
 * ============================================================================
 * VERIFIERS.TS — Checks deterministas exógenos (no prompts)
 * ============================================================================
 * Cuatro validadores independientes del LLM que clasifican la respuesta del bot.
 * Esta es la capa de "backpressure determinista" del Bucle Ralph: el veredicto
 * no depende de que el modelo se autocalifique, sino de hechos verificables.
 *
 * El orden de evaluación importa (precedencia de veredictos):
 *   1. FROZEN     → el bot ni siquiera produjo texto útil.
 *   2. GUARDRAIL_BLOCK → el candado reemplazó la respuesta (caso estrella).
 *   3. HALLUCINATED_PRICE → dio un precio que no existe en price_tiers.
 *   4. NO_PRICE   → describió producto(s) pero sin ninguna cifra.
 *   5. PASS       → respondió con precio(s) que coinciden con la BD.
 * ============================================================================
 */

import { CatalogProduct } from './catalog_probe';

export type Verdict =
  | 'PASS'
  | 'GUARDRAIL_BLOCK'
  | 'FROZEN'
  | 'HALLUCINATED_PRICE'
  | 'NO_PRICE';

export interface VerificationDetail {
  verdict: Verdict;
  mentionedPrices: number[];        // precios extraídos del texto del bot
  matchedRealPrices: number[];      // cuáles sí están en price_tiers
  hallucinatedPrices: number[];     // cuáles NO están en price_tiers
  mentionedProductIds: string[];    // refs/IDs mencionados en el texto
  guardrailTriggered: boolean;
  frozen: boolean;
  reason: string;                   // explicación humana del veredicto
}

// Frase exacta que emite applyOutputGuardrail (lib/agent/index.ts:165)
const GUARDRAIL_PHRASE = 'verifico la tarifa exacta en el sistema de producción';

// Frases que indican que el bot se "congeló" sin dar info útil
const FROZEN_PATTERNS = [
  /^dame un momento por favor/i,
  /^\s*$/,
];

/**
 * Extrae todos los precios ($X o $X.XXX o $X.XXX.XXX) del texto del bot.
 * Sigue el mismo patrón regex que usa applyOutputGuardrail internamente.
 */
export function extractPrices(text: string): number[] {
  const matches = text.match(/\$[\d.,]+/g) || [];
  return matches
    .map((m) => {
      // Normaliza: quita $ y separadores de miles/puntos
      const clean = m.replace(/[\$.,]/g, '');
      const n = parseInt(clean, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })
    .filter((n): n is number => n !== null);
}

/**
 * Construye el conjunto de precios válidos para un producto, INCLUYENDO
 * múltiplos comunes (2-10) — misma lógica que applyOutputGuardrail.
 * Esto es clave para detectar falsos positivos: si el bot menciona un total
 * que el guardrail considera válido pero que en realidad no corresponde al
 * producto, aquí lo atrapamos.
 */
function buildValidPriceSet(products: CatalogProduct[]): Set<number> {
  const valid = new Set<number>();
  for (const p of products) {
    for (const tier of p.tiers) {
      const price = Math.round(tier.price);
      valid.add(price);
      // Múltiplos 2-10 (igual que el guardrail: cubre totales por cantidad)
      for (let mult = 2; mult <= 10; mult++) {
        valid.add(price * mult);
      }
    }
  }
  return valid;
}

/**
 * Extrae referencias/IDs de producto mencionados en el texto.
 * Busca patrones comunes: (Ref: XX-123), product_id UUID, etc.
 */
export function extractProductRefs(text: string): string[] {
  const refs = new Set<string>();
  // Patrón "Ref: MU-152" o "(Ref: TJ-BR)"
  const refMatches = text.match(/Ref:?\s*([A-Z]{2,}-?[A-Z0-9]+)/gi) || [];
  for (const m of refMatches) {
    const clean = m.replace(/Ref:?\s*/i, '').trim();
    refs.add(clean);
  }
  // UUIDs
  const uuidMatches = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi) || [];
  for (const u of uuidMatches) refs.add(u);
  return Array.from(refs);
}

/**
 * Verifica la respuesta del bot contra los productos reales de la categoría.
 * Devuelve el veredicto con detalle completo para el reporte.
 */
export function verifyResponse(
  response: string | null,
  realProducts: CatalogProduct[]
): VerificationDetail {
  const text = (response || '').trim();

  // --- CHECK 1: FROZEN ---
  if (!text || FROZEN_PATTERNS.some((re) => re.test(text))) {
    return {
      verdict: 'FROZEN',
      mentionedPrices: [],
      matchedRealPrices: [],
      hallucinatedPrices: [],
      mentionedProductIds: [],
      guardrailTriggered: false,
      frozen: true,
      reason: 'El bot no produjo texto útil (vacío o solo "dame un momento").',
    };
  }

  // --- CHECK 2: GUARDRAIL_BLOCK ---
  const guardrailTriggered = text.includes(GUARDRAIL_PHRASE);
  if (guardrailTriggered) {
    // Aún extraemos precios por si el bot los mencionó antes del bloqueo
    const mentioned = extractPrices(text);
    return {
      verdict: 'GUARDRAIL_BLOCK',
      mentionedPrices: mentioned,
      matchedRealPrices: [],
      hallucinatedPrices: mentioned, // se asumen sospechosos hasta que el guardrail los valide
      mentionedProductIds: extractProductRefs(text),
      guardrailTriggered: true,
      frozen: false,
      reason: 'applyOutputGuardrail disparó el mensaje genérico: los precios mencionados no validaron contra price_tiers.',
    };
  }

  // --- A partir de aquí el guardrail NO bloqueó. Analizamos la calidad. ---
  const mentionedPrices = extractPrices(text);
  const mentionedProductIds = extractProductRefs(text);
  const validPrices = buildValidPriceSet(realProducts);

  const matchedRealPrices = mentionedPrices.filter((p) => validPrices.has(p));
  const hallucinatedPrices = mentionedPrices.filter((p) => !validPrices.has(p));

  // --- CHECK 3: HALLUCINATED_PRICE ---
  // El guardrail NO bloqueó pero hay precios que no están en la BD.
  // Esto señala que el guardrail dejó pasar una alucinación real (false negative).
  if (hallucinatedPrices.length > 0 && matchedRealPrices.length === 0) {
    return {
      verdict: 'HALLUCINATED_PRICE',
      mentionedPrices,
      matchedRealPrices,
      hallucinatedPrices,
      mentionedProductIds,
      guardrailTriggered: false,
      frozen: false,
      reason: `El bot mencionó precios que NO existen en price_tiers del producto: ${hallucinatedPrices.join(', ')}. El guardrail NO los atrapó (false negative).`,
    };
  }

  // --- CHECK 4: NO_PRICE ---
  // El bot respondió sin bloqueo pero no dio ninguna cifra.
  if (mentionedPrices.length === 0) {
    return {
      verdict: 'NO_PRICE',
      mentionedPrices,
      matchedRealPrices,
      hallucinatedPrices,
      mentionedProductIds,
      guardrailTriggered: false,
      frozen: false,
      reason: 'El bot describió producto(s) pero no dio ningún precio (no llamó getProductPrice o no lo mostró).',
    };
  }

  // --- CHECK 5: PASS ---
  return {
    verdict: 'PASS',
    mentionedPrices,
    matchedRealPrices,
    hallucinatedPrices,
    mentionedProductIds,
    guardrailTriggered: false,
    frozen: false,
    reason: `El bot respondió con ${matchedRealPrices.length} precio(s) válido(s) contra la BD.`,
  };
}
