/**
 * ============================================================================
 * INDEX.TS — Orquestador del Agente Conversacional ("Oscar")
 * ============================================================================
 *
 * ── DOCTRINA ANTI-ALUCINACIÓN (leer antes de tocar este archivo) ────────────
 * Fundamento teórico: "Mitigación de Alucinaciones en RAG" (PDF del proyecto).
 *
 * 1. EL PROMPT DE OSCAR (system-prompt.ts) NO SE TOCA. Nada. Ni una coma.
 *    Razón: a MENOS tokens/palabras en el prompt = MENOS alucinaciones. El PDF
 *    (pag.9) lo define como pilar estratégico: "abandonar el prompt engineering
 *    y transitar hacia la ingeniería robusta de datos y software defensivo".
 *    Las instrucciones comerciales NO van en el prompt: viajan con los DATOS
 *    (búsqueda/petición) para no saturar la ventana del LLM. Agregar reglas al
 *    prompt induce alucinaciones de fidelidad (el LLM ignora el contexto).
 *
 * 2. EL CANDADO v4 (applyOutputGuardrail) = Output Guardrail propio. Es la
 *    capa defensiva que exige el PDF (pag.8): "rechazar declaraciones de
 *    precios que no coincidan con los IdeaBlocks de referencia". En este
 *    sistema los "IdeaBlocks" son los tiers de precio de Supabase, y el
 *    candado exige que el bot los consulte con getProductPrice antes de
 *    cotizar. Detalle crítico: NO valida VALORES, solo valida USO de la
 *    calculadora (ver docstring de la función).
 *
 * 3. ANCLAJE FÁCTICO: la fuente canónica de precios es Supabase (RPC
 *    get_product_price_tiers), NO el JSON legacy ni la memoria del LLM.
 *
 * 4. MODEL: google/gemini-2.5-flash vía OpenRouter. OpenRouter es solo
 *    enrutador de API, NO es la IA.
 * ============================================================================
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs } from 'ai';
import { createAdminClient } from '../supabase/admin';
import { buildSystemPrompt } from './system-prompt';
import { isRealColombianName } from './colombian-names';
import { getAvailableSlotsTool } from './tools/get-available-slots';
import { bookAppointmentTool } from './tools/book-appointment';
import { cancelAppointmentTool } from './tools/cancel-appointment';
import { rescheduleAppointmentTool } from './tools/reschedule-appointment';
import { queryKnowledgeBaseTool } from './tools/query-knowledge-base';
import { searchCatalogTool } from './tools/search-catalog';
import { getProductPriceTool } from './tools/get-product-price';
import { saveContactInfoTool } from './tools/save-contact-info';
import { requestHumanHandoffTool } from './tools/request-human-handoff';
import { calculateCustomPriceTool } from './tools/calculate-custom-price';
import { updatePipelineStageTool } from './tools/update-pipeline-stage';
import { logger } from '../logger';
import type { AgentConfig } from '../database.types';

/**
 * STRIP THOUGHT TAGS (Pilar 3 — Chain of Thought)
 * ------------------------------------------------
 * Elimina el bloque interno <thought>...</thought> que el LLM emite como parte
 * de su razonamiento, ANTES de que el texto llegue al Output Guardrail y al
 * cliente por WhatsApp.
 *
 * Es deliberadamente tolerante: cubre mayúsculas/minúsculas, saltos de línea
 * dentro del bloque, múltiples bloques, y limpiezas de espacios en blanco
 * sobrantes que deja el tag al removerse.
 *
 * NO TOCA el Candado Antialucinación (applyOutputGuardrail): esta función se
 * ejecuta en primer lugar y devuelve texto "limpio" que luego entra al
 * guardrail tal cual.
 */
// ============================================================================
// REGISTRO TEMPORAL DE FOTOS+PRECIOS (para el repartidor de fotos del webhook)
// Vive en memoria RAM. Se llena con el rastro del bot (result.steps) y se borra
// solo a los 10 minutos. NO es historial, NO toca searchCatalog, NO gasta tokens.
// ============================================================================
interface CachedPhoto { reference: string; name: string; image_url: string; unit_price: number | null; }
const photosByConversation = new Map<string, CachedPhoto[]>();

export function getPhotosForConversation(conversationId: string): CachedPhoto[] {
  return photosByConversation.get(conversationId) || [];
}
export function clearPhotosForConversation(conversationId: string) {
  photosByConversation.delete(conversationId);
}

function stripThoughtTags(text: string): string {
  if (!text) return text;
  let cleaned = text.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  cleaned = cleaned.replace(/<thought>[\s\S]*$/gi, '');
  cleaned = cleaned.replace(/<\/??thought>/gi, '');
  cleaned = cleaned.replace(/^\s+/, '');

  // SANITIZADOR REGEX DETERMINISTA: Interceptar cualquier UUID de 36 caracteres y convertirlos a ref corta
  cleaned = cleaned.replace(/\b([0-9a-f]{8})-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, (match, prefix) => {
    return `REF-${prefix.toUpperCase()}`;
  });

  // SANITIZADOR DE IDENTIDAD: Eliminar referencias a "asistente virtual", "bot", "inteligencia artificial" o "IA"
  cleaned = cleaned.replace(/\b(como|soy|un|una)\s+(asistente\s+virtual|bot|inteligencia\s+artificial|ia|modelo\s+de\s+lenguaje)\b/gi, '');
  cleaned = cleaned.replace(/\b(asistente\s+virtual|inteligencia\s+artificial|modelo\s+de\s+lenguaje)\b/gi, 'asesor comercial');

  // SANITIZADOR DE TEXTO DE RELLENO: Eliminar frases alucinadas sobre no poder mostrar imágenes
  cleaned = cleaned.replace(/\([^)]*(modelo\s+de\s+lenguaje|no\s+puedo\s+mostrar|imagina\s+que)[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\[[^\]]*(modelo\s+de\s+lenguaje|no\s+puedo\s+mostrar|imagina\s+que)[^\]]*\]/gi, '');

  return cleaned;
}

/**
 * CANDADO ANTIALUCINACIÓN v4 (Output Guardrail)
 * --------------------------------------------------------------------------
 * ESTRATEGIA SIMPLE Y DIRECTA: confiar en la calculadora (getProductPrice).
 *
 * REGLAS (solo 3):
 * 1. Si el bot NO menciona precios (saludos, preguntas) → PASA.
 * 2. Si el bot menciona precios Y usó getProductPrice en este turno → PASA.
 *    (La calculadora ya leyó de Supabase y calculó totales/áreas/millares.
 *     No se compara contra listas fijas, eso rompía los totales calculados.)
 * 3. Si el bot menciona precios PERO NO usó getProductPrice → BLOQUEA.
 *    (Escribió de memoria, no consultó la base de datos.)
 *
 * Esto elimina el bucle de "verifico la tarifa..." en ventas legítimas donde
 * el bot calculó correctamente pero el total no estaba literal en price_tiers.
 * --------------------------------------------------------------------------
 *
 * ── ANTI-SUPOSICIÓN CRÍTICA ──────────────────────────────────────
 * Este guardrail NO valida VALORES de precio. Solo verifica QUE se llamó a
 * la herramienta getProductPrice en el turno (reason: 'calculator-used').
 * NO compara el número que el bot escribió contra el que devolvió la
 * calculadora. La confianza es: "¿usó la calculadora?" y nada más.
 *
 * Por qué así y no validando valores: getProductPrice calcula totales
 * (área m², millares, rollos optimizados) que no son literales en los
 * tiers de la BD, así que comparar el texto del bot contra un valor fijo
 * rompería cotizaciones legítimas. La mitigación de alucinación viene del
 * HECHO de consultar la BD, no de re-verificar el resultado.
 *
 * Fundamento teórico PDF pag.8: "Output Rails rechazan declaraciones de
 * precios que no coincidan con los IdeaBlocks de referencia". Acá la
 * exigencia es de USO (calculator-used), no de coincidencia literal.
 * ─────────────────────────────────────────────────────────────────
 */
async function applyOutputGuardrail(responseText: string, steps: any[]): Promise<{ blocked: boolean; reason: string }> {
  try {
    // 1. Extraer precios mencionados en la respuesta del bot
    const priceRegex = /\$[\d.,]+/g;
    const mentionedPrices = responseText.match(priceRegex) || [];

    // Si no hay precios → pasa (saludos, preguntas, etc.)
    if (mentionedPrices.length === 0) {
      return { blocked: false, reason: 'no-prices' };
    }

    // 2. ¿El bot llamó getProductPrice en este turno?
    let getProductPriceCalled = false;
    for (const step of (steps || [])) {
      for (const toolResult of (step.toolResults || [])) {
        if (toolResult.toolName === 'getProductPrice') {
          getProductPriceCalled = true;
          break;
        }
      }
      if (getProductPriceCalled) break;
    }

    // 3. Si mencionó precios PERO no usó la calculadora → bloquear
    if (!getProductPriceCalled) {
      logger.error('CANDADO v4: Precios sin getProductPrice en el turno', {
        mentionedPrices,
      });
      return { blocked: true, reason: 'no-calculator' };
    }

    // 4. Si usó la calculadora → pasa (confía en la calculadora)
    logger.info('CANDADO v4: Respuesta aprobada (getProductPrice fue usado)', {
      mentionedPricesCount: mentionedPrices.length,
    });
    return { blocked: false, reason: 'calculator-used' };

  } catch (err) {
    logger.error('Error in output guardrail', { error: String(err) });
    return { blocked: false, reason: 'error-fail-open' }; // Fail-open
  }
}

const openrouter = createOpenAICompatible({
  name: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

// ── MODELO: google/gemini-2.5-flash vía OpenRouter ──────────────
// El comentario viejo decía "DeepSeek Chat" — FALSO. El modelo real es
// google/gemini-2.5-flash (overridable con CHAT_MODEL). OpenRouter es solo
// el enrutador de la API, NO es la IA. Gemini se eligió porque el PDF
// (pag.3) muestra que modelos que no pueden abstenerse (ej GPT-5.5) son
// inaceptables para ventas; Gemini prioriza abstenerse ante la duda.
const model = openrouter.chatModel(process.env.CHAT_MODEL || 'google/gemini-2.5-flash');

/**
 * Removes consecutive duplicate assistant messages from the conversation history.
 * OpenRouter's loop detection triggers when it sees near-identical assistant
 * responses in sequence (common when the bot repeats similar info).
 */
function deduplicateHistory(messages: { role: string; content: string }[]) {
  return messages.filter((msg, idx) => {
    if (idx === 0) return true;
    const prev = messages[idx - 1];
    if (
      msg.role === 'assistant' &&
      prev.role === 'assistant' &&
      msg.content.trim() === prev.content.trim()
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Runs the AI agent for an inbound WhatsApp message.
 * Returns the agent's text response or null if no response.
 */
export async function runAgentForMessage(params: {
  orgId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
  messageText: string;
  agentConfig: AgentConfig;
}): Promise<string | null> {
  const { orgId, contactPhone, contactName, conversationId, messageText, agentConfig } = params;

  try {
    const supabase = createAdminClient();

    // Load last 10 messages only — reduces loop detection risk from long histories
    const { data: history } = await (supabase as any)
      .from('messages')
      .select('direction, sender, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(10);

    const rawMessages: { role: string; content: string }[] = [];

    if (history) {
      const chronologicalHistory = [...history].reverse();
      for (const msg of chronologicalHistory) {
        if (!msg.content) continue;
        rawMessages.push({
          role: msg.direction === 'inbound' ? 'user' : 'assistant',
          content: msg.content,
        });
      }
    }

    // Add current message if not already the last one in history
    const lastMsg = rawMessages[rawMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== messageText) {
      rawMessages.push({ role: 'user', content: messageText });
    }

    // Deduplicate consecutive identical assistant messages
    const messages = deduplicateHistory(rawMessages);

    // Get organization timezone and contact metadata
    const [orgResult, contactResult] = await Promise.all([
      (supabase as any)
        .from('organizations')
        .select('timezone')
        .eq('id', orgId)
        .single(),
      (supabase as any)
        .from('contacts')
        .select('id, metadata')
        .eq('organization_id', orgId)
        .eq('wa_phone', contactPhone)
        .single(),
    ]);

    const timeZone = orgResult.data?.timezone || 'America/Bogota';
    const contactMetadata = contactResult.data?.metadata || {};
    const contactId = contactResult.data?.id || '';

    // Detect trigger 'oscar' (case-insensitive) in current message or recent history
    const hasOscarTrigger = messageText.toLowerCase().includes('oscar') ||
      messages.some(m => m.role === 'user' && m.content.toLowerCase().includes('oscar'));

    // Check if the contact name is a valid Colombian name
    const isValidColombianName = contactName ? isRealColombianName(contactName) : false;

    const systemPrompt = buildSystemPrompt(
      agentConfig,
      contactName,
      contactPhone,
      timeZone,
      contactMetadata,
      hasOscarTrigger,
      isValidColombianName
    );

    const toolContext = { orgId, contactId, contactPhone, contactName, conversationId };

    // === BUQUE DE RECÁLCULO (obligar a usar la calculadora) ===
    // El bot genera respuesta → guardrail revisa → si bloquea, se le devuelve
    // una orden de recalcular → repite hasta 3 intentos. Escala en severidad.
    const MAX_RECALC_ATTEMPTS = 3;
    const RECALC_ORDERS = [
      'ALTO. Tu respuesta anterior fue BLOQUEADA porque mencionaste precios sin usar la herramienta getProductPrice. Está PROHIBIDO dar precios de memoria. Vuelve a empezar: ejecuta searchCatalog para encontrar productos y getProductPrice para calcular el precio EXACTO antes de responder. No repitas precios del historial.',
      'BLOQUEADO DE NUEVO. No respondas de memoria. Es OBLIGATORIO ejecutar getProductPrice para CADA producto que menciones con precio. Busca con searchCatalog, calcula con getProductPrice, y SOLO entonces responde con los precios que la herramienta te devolvió.',
      'ÚLTIMO INTENTO. Llevas 3 bloqueos. Tienes más de 7.000 productos en el catálogo. Revisa qué estás haciendo mal: DEBES ejecutar getProductPrice antes de escribir cualquier cifra. Sin la herramienta, no hay respuesta válida. Ejecuta searchCatalog + getProductPrice AHORA.',
    ];

    let finalResponse: string | null = null;
    let loopMessages = [...messages];

    for (let attempt = 0; attempt < MAX_RECALC_ATTEMPTS; attempt++) {
      const result = await generateText({
        model,
        system: systemPrompt,
        messages: loopMessages,
        tools: {
          getAvailableSlots: getAvailableSlotsTool(toolContext),
          bookAppointment: bookAppointmentTool(toolContext),
          cancelAppointment: cancelAppointmentTool(toolContext),
          rescheduleAppointment: rescheduleAppointmentTool(toolContext),
          searchCatalog: searchCatalogTool(),
          getProductPrice: getProductPriceTool(),
          saveContactInfo: saveContactInfoTool(toolContext),
          queryKnowledgeBase: queryKnowledgeBaseTool(toolContext),
          requestHumanHandoff: requestHumanHandoffTool(toolContext),
          calculateCustomPrice: calculateCustomPriceTool(),
          updatePipelineStage: updatePipelineStageTool(toolContext),
        },
        stopWhen: stepCountIs(50),
        maxSteps: 50,
        temperature: 0.4,
      } as any);

      logger.info('Agent finished', { orgId, conversationId, steps: result.steps?.length || 0, attempt: attempt + 1 });

      let responseText = result.text;
      if (!responseText?.trim()) {
        logger.warn('Agent returned empty response', { orgId, conversationId, attempt: attempt + 1 });
        finalResponse = null;
        break;
      }

      // Limpiar thought tags
      const cleanedResponse = stripThoughtTags(responseText);
      if (cleanedResponse !== responseText) {
        logger.info('Thought tags limpiados de la respuesta', { orgId, conversationId });
      }

      // Revisar con el guardrail
      const guardrailResult = await applyOutputGuardrail(cleanedResponse, result.steps || []);

      // === REPARTIDOR DE FOTOS: capturar fotos+precios del rastro del bot ===
      try {
        // 1. Recolectar fotos de searchCatalog
        const collectedPhotos: CachedPhoto[] = [];
        for (const step of (result.steps || [])) {
          for (const tr of (step.toolResults || [])) {
            if (tr.toolName === 'searchCatalog') {
              const raw = (tr as any).output || (tr as any).result;
              if (!raw) continue;
              const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
              if (r && r.matches) {
                for (const m of r.matches) {
                  const imageUrl = m.image_url || (m.image_urls && m.image_urls[0]);
                  const ref = m.reference || m.product_id;
                  if (imageUrl && ref) {
                    collectedPhotos.push({ reference: String(ref), name: m.name || '', image_url: imageUrl, unit_price: null });
                  }
                }
              }
            }
          }
        }

        // 2. Recolectar precios de getProductPrice y emparejarlos por nombre
        for (const step of (result.steps || [])) {
          for (const tr of (step.toolResults || [])) {
            if (tr.toolName === 'getProductPrice') {
              const raw = (tr as any).output || (tr as any).result;
              if (!raw) continue;
              const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
              if (r && r.success && r.opciones && r.opciones.length > 0) {
                // Extraer el nombre del producto del message ("PRODUCTO: XXX")
                let prodName = '';
                if (r.message) {
                  // Extraer "PRODUCTO: XXX" del message
                  const NL = String.fromCharCode(10);
                  const prodLine = String(r.message).split(NL).find((l: string) => l.startsWith('PRODUCTO:'));
                  if (prodLine) prodName = prodLine.replace('PRODUCTO:', '').trim().toLowerCase();
                }
                const unitPrice = Number(r.opciones[0].price) || null;
                // Emparejar por nombre
                for (const cp of collectedPhotos) {
                  if (cp.unit_price === null && prodName && cp.name.toLowerCase() === prodName) {
                    cp.unit_price = unitPrice;
                  }
                }
              }
            }
          }
        }

        // 3. Guardar en el registro en memoria
        if (collectedPhotos.length > 0) {
          photosByConversation.set(conversationId, collectedPhotos);
          setTimeout(() => photosByConversation.delete(conversationId), 10 * 60 * 1000);
          logger.info('Fotos+precios capturados del rastro', { conversationId, count: collectedPhotos.length, conPrecio: collectedPhotos.filter(p => p.unit_price !== null).length });
        }
      } catch (photoCaptureErr) {
        logger.error('Error capturando fotos del rastro', { error: String(photoCaptureErr) });
      }
      // === FIN REPARTIDOR DE FOTOS ===


      if (!guardrailResult.blocked) {
        // Pasó → entregar al cliente
        finalResponse = cleanedResponse;
        logger.info('CANDADO v4: Respuesta APROBADA en el intento', { attempt: attempt + 1, reason: guardrailResult.reason });
        break;
      }

      // Bloqueado → preparar el siguiente intento
      logger.warn('CANDADO v4: Respuesta bloqueada, preparando recálculo', {
        attempt: attempt + 1,
        reason: guardrailResult.reason,
        orgId,
        conversationId,
      });

      // Añadir la respuesta bloqueada del bot + la orden de recalcular al historial
      loopMessages = [...loopMessages,
        { role: 'assistant', content: cleanedResponse },
        { role: 'user', content: RECALC_ORDERS[attempt] || RECALC_ORDERS[RECALC_ORDERS.length - 1] },
      ];

      // Si es el último intento, entregar respuesta de respaldo
      if (attempt === MAX_RECALC_ATTEMPTS - 1) {
        logger.error('CANDADO v4: Máximo de recálculos alcanzado, entregando respuesta de respaldo', {
          orgId, conversationId,
        });
        finalResponse = 'Déjame verificar los detalles de esta referencia y en un momento te comparto la información exacta.';
      }
    }

    return finalResponse;
  } catch (err) {
    logger.error('Agent error', {
      error: String(err),
      orgId,
      conversationId,
    });
    return 'dame un momento por favor voy a revisar';
  }
}
