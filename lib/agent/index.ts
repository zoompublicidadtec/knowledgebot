import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs } from 'ai';
import { createAdminClient } from '../supabase/admin';
import { buildSystemPrompt, resolvePersona } from './system-prompt';
import { isRealColombianName } from './colombian-names';
import { getAvailableSlotsTool } from './tools/get-available-slots';
import { bookAppointmentTool } from './tools/book-appointment';
import { cancelAppointmentTool } from './tools/cancel-appointment';
import { rescheduleAppointmentTool } from './tools/reschedule-appointment';
import { queryKnowledgeBaseTool } from './tools/query-knowledge-base';
import { searchCatalogTool, runCatalogSearch } from './tools/search-catalog';
import { getProductPriceTool } from './tools/get-product-price';
import { saveContactInfoTool } from './tools/save-contact-info';
import {
  requestHumanHandoffTool,
  clientePideUnaPersona,
  ejecutarTraspasoAHumano,
} from './tools/request-human-handoff';
import { calculateCustomPriceTool } from './tools/calculate-custom-price';
import { updatePipelineStageTool } from './tools/update-pipeline-stage';
import { etapaPorHechos, moverEtapaSiAvanza } from './pipeline-automatico';
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
  return cleaned;
}

/**
 * GUARDRAIL DE IDENTIDAD (determinista, 0 tokens)
 * ------------------------------------------------
 * Elimina la oración completa donde el modelo se declara IA en lugar de
 * intentar parchearla. En producción se registraron mensajes como "como soy un
 * modelo de lenguaje, no puedo mostrarla" y "como soy un asistente de texto":
 * la oración entera sobra, porque el sistema sí envía la foto por otro canal.
 */
const IDENTITY_MARKERS =
  /(asistente virtual|inteligencia artificial|modelo de lenguaje|soy una? ia\b|soy un bot\b|chatbot|asistente de texto|no puedo mostrar|no puedo enviar imágenes|no puedo ver|imagina que la imagen|te transfiero con un humano|hablar con un humano|con un asesor humano)/i;

function sanitizeIdentity(text: string, agentName: string): { text: string; hit: boolean } {
  if (!text || !IDENTITY_MARKERS.test(text)) return { text, hit: false };

  const kept = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(s => s.trim() && !IDENTITY_MARKERS.test(s));

  let out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (out.length < 25) {
    out = `Claro que sí. Dame un segundo y te confirmo con producción. Mientras tanto, cuéntame qué cantidad necesitas y te armo la cotización, habla con ${agentName.split(' ')[0]}.`;
  }
  return { text: out, hit: true };
}

/**
 * Reconstruye la respuesta completa a partir de todos los pasos.
 *
 * `result.text` solo trae el texto del ÚLTIMO paso, así que cuando el modelo
 * escribe algo, llama a una herramienta y luego sigue escribiendo, la primera
 * parte se perdía: el cliente recibía frases cortadas ("...no los manejamos.
 * Pero con") o cotizaciones sin la frase de reconducción que las introducía.
 */
function assembleText(finalText: string, steps: any[]): string {
  const tail = (finalText || '').trim();

  // Una respuesta cerrada termina en signo de puntuación o paréntesis.
  const estaCompleta = (t: string) => t.length >= 40 && /[.!?:;)\]"'*]$/.test(t);

  // Caso normal: el último paso ya trae el mensaje definitivo, y los pasos
  // previos son borradores suyos. Concatenarlos duplicaría el texto.
  if (estaCompleta(tail)) return tail;

  // El último paso quedó cortado o vacío: se recupera el fragmento completo
  // más largo que el modelo llegó a escribir.
  const candidatos = (steps || [])
    .map((s: any) => (s?.text || '').trim())
    .filter(Boolean);
  if (tail) candidatos.push(tail);

  const completos = candidatos.filter(estaCompleta);
  if (completos.length > 0) {
    return completos.reduce((a, b) => (b.length > a.length ? b : a));
  }
  return candidatos.reduce((a, b) => (b.length > a.length ? b : a), tail);
}

/** "$77900" -> "$77.900". El modelo escribe la cifra cruda de la calculadora. */
function formatPricesForColombia(text: string): string {
  if (!text) return text;
  return text.replace(/\$\s?(\d{4,})(?![\d.,])/g, (_m, digits: string) =>
    '$' + Number(digits).toLocaleString('es-CO')
  );
}

/** Referencias reales que searchCatalog devolvió en este turno. */
function collectAllowedReferences(steps: any[]): Set<string> {
  const allowed = new Set<string>();
  for (const step of steps || []) {
    for (const tr of step.toolResults || []) {
      if (tr.toolName !== 'searchCatalog') continue;
      const raw = (tr as any).output ?? (tr as any).result;
      if (!raw) continue;
      try {
        const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
        for (const m of r?.matches || []) {
          if (m.product_id) allowed.add(String(m.product_id).toUpperCase());
          if (m.reference) allowed.add(String(m.reference).toUpperCase());
        }
      } catch { /* resultado no parseable: se ignora */ }
    }
  }
  return allowed;
}

/**
 * Referencias que el bot escribió al cliente, como "(Ref: MU-152)".
 *
 * La palabra "Referencia" escrita completa se leía a sí misma como una
 * referencia inventada: "Ref" casaba con el patrón y "erencia" quedaba como el
 * código. Medido el 01-ago-2026, el candado bloqueó dos intentos seguidos por
 * las referencias fantasma "ERENCIA" y "ERENCIAS", gastando los reintentos que
 * hacían falta para corregir el fallo de verdad. Se exige que la palabra
 * termine ahí y que el código traiga un dígito o un guion, como todos los del
 * catálogo (ZM-MUG-004, OF-448, HELIX-BAM).
 */
function extractCitedReferences(text: string): string[] {
  const out: string[] = [];
  const re = /\bref(?:erencias?|s)?\b[:.]?\s*([A-Z0-9][A-Z0-9._\- ]{1,24}?)\s*[)\],.]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ref = m[1].trim().toUpperCase();
    if (/[-0-9]/.test(ref)) out.push(ref);
  }
  return out;
}

/**
 * Detecta el patrón "pregunta y pregunta sin vender": el bot responde sin haber
 * ejecutado searchCatalog y sin dar un solo precio, mientras el cliente ya
 * expresó una necesidad. Es el fallo que agota tokens sin llegar a la venta.
 */
function isInterrogationOnly(text: string, steps: any[]): boolean {
  const searched = (steps || []).some(s =>
    (s.toolResults || []).some((t: any) => t.toolName === 'searchCatalog')
  );
  if (searched) return false;
  if (/\$\s?[\d.,]+/.test(text)) return false;
  return /\?/.test(text);
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
 */
async function applyOutputGuardrail(
  responseText: string,
  steps: any[],
  questionStreak = 0,
  approvedPrices: Set<number> = new Set(),
  catalogHits: any[] = [],
  fraseOfftopic = '',
  palabrasPedidas: Set<string> = new Set()
): Promise<{ blocked: boolean; reason: string }> {
  try {
    // 1. Toda referencia citada al cliente tiene que existir de verdad. En
    //    producción el bot ofreció MP-001/MP-002/MP-003 y BP-005, referencias
    //    que no están en el catálogo. Se aceptan las que devolvió searchCatalog
    //    en este turno y, para las demás (p. ej. un producto cotizado antes en
    //    la misma conversación), se comprueba contra la base.
    const cited = extractCitedReferences(responseText);

    // 0.0 BUSCÓ OTRA COSA. Va PRIMERO a propósito: es la causa, y los demás
    //     candados solo ven sus síntomas. Medido el 31-jul-2026, el cliente
    //     escribió "quiero unos avisos para mi local" y el rastro del modelo fue
    //     `searchCatalog("mug")` —lo que se hablaba antes—, así que le cotizó
    //     mugs. Medido el 01-ago, ese mismo mensaje se fue por el candado de
    //     referencias inventadas, que bloqueaba sin decirle nunca cuál era el
    //     problema real: seguía hablando de lo que el cliente ya no pidió.
    //
    //     Solo se aplica cuando el modelo SÍ buscó: si no buscó nada está
    //     rematando algo ya cotizado ("sí, los de 120 hojas") y ahí no hay nada
    //     que reprochar. Basta con que UNA de sus búsquedas tenga que ver con lo
    //     que el cliente acaba de escribir.
    if (palabrasPedidas.size > 0) {
      const consultas = consultasDeCatalogo(steps);
      const alTema = consultas.some((q) =>
        coincideAlgunaPalabra(palabrasPedidas, palabrasDeContenido(q))
      );
      if (consultas.length > 0 && !alTema) {
        logger.error('GUARDRAIL: buscó algo distinto de lo que pidió el cliente', {
          consultas, pidio: [...palabrasPedidas].join(','),
        });
        return { blocked: true, reason: 'search-off-topic' };
      }
    }

    // 0. RAIL DE RECUPERACIÓN: negar un producto que SÍ está en el catálogo es
    //    el fallo más caro, porque el cliente se va creyendo que no lo tenemos.
    //    Solo bloquea si además no ofreció ninguna referencia: "no manejamos esa
    //    medida exactamente, pero tengo esta otra" es correcto y debe pasar.
    // La frase plantilla de "fuera de alcance" es falsa si el catálogo sí tiene
    // lo que pidió: se bloquea aunque la respuesta cite productos, porque decir
    // "eso no lo manejamos" y ofrecer tres opciones acto seguido no vende nada.
    if (catalogHits.length > 0 && fraseOfftopic.length >= 12) {
      const plana = sinAcentos(responseText.toLowerCase());
      const plantilla = sinAcentos(fraseOfftopic.toLowerCase()).slice(0, 40);
      if (plana.includes(plantilla)) {
        logger.error('GUARDRAIL: usó la frase de fuera-de-alcance teniéndolo en catálogo', {
          coincidencias: catalogHits.length, ejemplo: catalogHits[0]?.name || '',
        });
        return { blocked: true, reason: 'denied-with-catalog-hits' };
      }
    }

    if (catalogHits.length > 0 && cited.length === 0 && NEGACION_DE_CATALOGO.test(responseText)) {
      logger.error('GUARDRAIL: negó un producto que sí está en el catálogo', {
        coincidencias: catalogHits.length,
        ejemplo: catalogHits[0]?.name || '',
      });
      return { blocked: true, reason: 'denied-with-catalog-hits' };
    }

    if (cited.length > 0) {
      const allowed = collectAllowedReferences(steps);
      const unverified = cited.filter(r => !allowed.has(r));

      if (unverified.length > 0) {
        const supabase = createAdminClient();
        const { data: found } = await (supabase as any)
          .from('products')
          .select('reference')
          .in('reference', unverified)
          .eq('active', true);

        const real = new Set((found || []).map((p: any) => String(p.reference).toUpperCase()));
        const invented = unverified.filter(r => !real.has(r));

        if (invented.length > 0) {
          logger.error('GUARDRAIL: referencias inventadas', { invented, fromTool: allowed.size });
          return { blocked: true, reason: 'invented-reference' };
        }
      }
    }

    // 2. Una propuesta de productos sin precio no sirve para vender: si el bot
    //    presenta dos o más productos, tiene que traer sus cifras.
    const mentionedPrices = responseText.match(/\$[\d.,]+/g) || [];
    if (cited.length >= 2 && mentionedPrices.length === 0) {
      logger.warn('GUARDRAIL: propuesta sin precios', { cited: cited.length });
      return { blocked: true, reason: 'offer-without-price' };
    }

    // 3. El bot lleva 2 turnos seguidos solo preguntando: tiene que ofertar.
    if (questionStreak >= 2 && isInterrogationOnly(responseText, steps)) {
      logger.warn('GUARDRAIL: interrogatorio sin oferta', { questionStreak });
      return { blocked: true, reason: 'interrogation-no-offer' };
    }

    // 4. Precios: solo valen los que salieron de la calculadora en este turno.
    if (mentionedPrices.length === 0) {
      return { blocked: false, reason: 'no-prices' };
    }

    // calculateCustomPrice es la calculadora válida para lo que se cobra por
    // área o metro lineal (DTF UV, DTF Textil, vinilos, screen). Sin incluirla
    // aquí, toda cotización de esos servicios se bloqueaba aunque fuera correcta.
    const PRICE_TOOLS = new Set(['getProductPrice', 'calculateCustomPrice']);
    const priceToolCalled = (steps || []).some(step =>
      (step.toolResults || []).some((t: any) => PRICE_TOOLS.has(t.toolName))
    );

    if (!priceToolCalled) {
      /**
       * Cifras que vienen de lo que el DUENO configuro en el panel.
       *
       * Una politica puede llevar un monto ("envio gratis sobre $200.000",
       * "anticipo minimo de $50.000"). Ese numero no sale de la calculadora de
       * productos, y el candado lo bloqueaba: el bot no podia responder algo
       * que el propio dueno habia escrito.
       *
       * No es un agujero. Solo se aceptan las cifras que aparecen en el texto
       * devuelto por queryKnowledgeBase EN ESTE MISMO TURNO, es decir las que
       * el dueno escribio en el panel. Un precio de producto sigue exigiendo
       * la calculadora.
       */
      const desdeElPanel = new Set<number>();
      for (const step of steps || []) {
        for (const t of (step.toolResults || []) as any[]) {
          if (t.toolName !== 'queryKnowledgeBase') continue;
          const texto = JSON.stringify(t.result ?? t.output ?? '');
          for (const monto of texto.match(/\$\s?[\d.,]+/g) || []) {
            const n = parseCOP(monto);
            if (n > 0) desdeElPanel.add(n);
          }
        }
      }

      // Si todas las cifras ya se le dieron al cliente antes en esta misma
      // conversación, es el bot confirmando lo cotizado (típico del cierre),
      // no inventando precios.
      const todasConocidas = mentionedPrices.every(
        p => approvedPrices.has(parseCOP(p)) || desdeElPanel.has(parseCOP(p))
      );
      if (todasConocidas) {
        logger.info('CANDADO v4: precios ya aprobados en la conversación', {
          count: mentionedPrices.length,
        });
        return { blocked: false, reason: 'previously-approved' };
      }
      logger.error('CANDADO v4: Precios sin calculadora en el turno', { mentionedPrices });
      return { blocked: true, reason: 'no-calculator' };
    }

    return { blocked: false, reason: 'calculator-used' };
  } catch (err) {
    logger.error('Error in output guardrail', { error: String(err) });
    return { blocked: false, reason: 'error-fail-open' }; // Fail-open
  }
}

/** "$1.843.500" -> 1843500 */
function parseCOP(s: string): number {
  return Number(String(s).replace(/[^\d]/g, '')) || 0;
}

/**
 * Precios que el bot ya entregó antes en esta conversación y que, por tanto,
 * pasaron el candado en su momento. Repetirlos no es hablar de memoria: es
 * continuidad. Sin esto, al cerrar la venta ("me quedo con esos, ¿cómo pago?")
 * el bot volvía a cotizar en lugar de pedir los datos y explicar el pago.
 */
function collectApprovedPrices(messages: { role: string; content: string }[]): Set<number> {
  const out = new Set<number>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const p of m.content.match(/\$\s?[\d.,]+/g) || []) {
      const n = parseCOP(p);
      if (n <= 0) continue;
      out.add(n);
      // El anticipo y el saldo son la mitad exacta de un total ya aprobado.
      if (n % 2 === 0) out.add(n / 2);
    }
  }
  return out;
}

/** Cuántos mensajes seguidos del bot fueron solo preguntas, sin precios. */
function countQuestionStreak(messages: { role: string; content: string }[]): number {
  let streak = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    if (m.content.includes('?') && !/\$\s?[\d.,]+/.test(m.content)) streak++;
    else break;
  }
  return streak;
}

const openrouter = createOpenAICompatible({
  name: 'openrouter',
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
});

// DeepSeek Chat is provided through OpenRouter for the conversational layer.
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
/**
 * RAIL DE RECUPERACIÓN DETERMINISTA (input guardrail)
 * --------------------------------------------------------------------------
 * El 29-jul-2026 un cliente pidió "bolsas de organza, unas 100 de 5x7" —un
 * producto que ZOOM fabrica y tiene cotizable— y el bot respondió "eso puntual
 * no lo manejamos", se inventó tres referencias y le ofreció maletines. El log
 * lo dejó claro: `fromTool: 0`, searchCatalog no se ejecutó nunca, y en el
 * reintento buscó con las palabras de su propio texto de alcance.
 *
 * La regla existía, pero solo como frase en el prompt. Aquí la búsqueda con las
 * palabras del cliente se ejecuta SIEMPRE en el servidor, antes de que el
 * modelo hable, y negar un producto que sí está en el catálogo pasa a ser un
 * bloqueo del guardrail, no una sugerencia.
 */
const PALABRAS_VACIAS = new Set([
  'para', 'este', 'esta', 'esos', 'esas', 'como', 'pero', 'porque', 'cuando',
  'donde', 'cuanto', 'cuantos', 'cuantas', 'necesito', 'necesita', 'quiero',
  'quisiera', 'busco', 'buscar', 'tienen', 'tiene', 'tienes', 'manejan',
  'manejas', 'hacen', 'haces', 'hola', 'buenas', 'favor', 'gracias', 'sale',
  'vale', 'valen', 'cuesta', 'cuestan', 'precio', 'precios', 'valor', 'cotizar',
  'cotizacion', 'unidades', 'unidad', 'sobre', 'algun', 'alguna', 'algunas',
  'algunos', 'todos', 'todas', 'mucho', 'mucha', 'poder', 'puedes', 'puede',
  'seria', 'estoy', 'tengo', 'saber', 'decir', 'dime', 'mandame', 'envia',
  'enviame', 'ustedes', 'nosotros', 'tipo', 'clase', 'mismo', 'misma',
  'ahora', 'luego', 'entonces', 'tambien', 'ademas', 'mejor', 'quizas',
  // "unos avisos" se consultaba como "unos avisos" y "unos": la muletilla
  // arrastraba la búsqueda a cualquier cosa del catálogo.
  'unos', 'unas', 'algo', 'cosa', 'cosas',
  'bueno', 'buenos', 'listo', 'verdad', 'señor', 'señora', 'senor', 'senora',
  'amigo', 'hermano', 'parcero', 'oiga', 'dijiste', 'dices', 'digame',
]);

function sinAcentos(text: string): string {
  return Array.from(String(text || '').normalize('NFD'))
    .filter((ch) => {
      const cp = ch.codePointAt(0) ?? 0;
      return cp < 0x300 || cp > 0x36f;
    })
    .join('');
}

function palabrasDeContenido(text: string): Set<string> {
  const out = new Set<string>();
  // Las medidas se escriben "20x30" en el catálogo y "20por30", "20 por 30" o
  // "20 x 30" en WhatsApp. Se normalizan para que coincidan.
  const conMedidas = sinAcentos(String(text || '').toLowerCase())
    .replace(/(\d+)\s*(?:por|x)\s*(\d+)/g, '$1x$2');
  const limpio = conMedidas.replace(/[^a-z0-9]+/g, ' ');
  for (const w of limpio.split(' ')) {
    // Se descartan los números sueltos (cantidades) pero NO las medidas como
    // "20x30", que identifican el producto exacto.
    const esMedida = /^[0-9]+x[0-9]+$/.test(w);
    if (esMedida) { out.add(w); continue; }
    if (w.length >= 4 && !PALABRAS_VACIAS.has(w) && !/^[0-9]+$/.test(w)) out.add(w);
  }
  return out;
}

/**
 * Cuántos productos activos contienen la palabra en su nombre. Es la medida de
 * cuán específica es: "organza" está en 7 productos, "bolsas" en cientos.
 * Consultar con la genérica hunde al producto correcto (medido: la bolsa de
 * organza 20x30 pasa de la posición 1 a la 9). Se cachea en memoria porque las
 * mismas palabras se repiten en todas las conversaciones.
 */
const frecuenciaCache = new Map<string, number>();

async function frecuenciaEnCatalogo(termino: string): Promise<number> {
  const cacheado = frecuenciaCache.get(termino);
  if (cacheado !== undefined) return cacheado;
  let n = 9999;
  try {
    const supabase = createAdminClient();
    const { count } = await (supabase as any)
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('active', true)
      .ilike('name', `%${termino}%`);
    if (typeof count === 'number') n = count === 0 ? 1 : count;
  } catch (err) {
    logger.warn('Rail de recuperación: no se pudo medir la palabra', {
      termino, error: String(err),
    });
  }
  frecuenciaCache.set(termino, n);
  return n;
}

/**
 * Busca en el catálogo con el mensaje literal del cliente y se queda con los
 * productos que comparten al menos una palabra de contenido con lo que pidió.
 * Ese cruce léxico es lo que separa "bolsas de organza" —donde la coincidencia
 * es real— de una pregunta fuera de catálogo, en la que la búsqueda vectorial
 * devuelve cualquier cosa. Sin él, el rail bloquearía respuestas legítimas.
 */
async function probeCatalogo(
  messageText: string,
  historialCliente: string[] = []
): Promise<{ relevant: any[]; total: number }> {
  const texto = String(messageText || '');
  // Los avisos internos de media fallida no son una petición del cliente.
  if (texto.trim().startsWith('[El cliente envió')) return { relevant: [], total: 0 };

  // El motor puntúa por palabras clave: la frase entera lo diluye y una palabra
  // genérica lo desvía. Medido: la frase completa devolvía 0 bolsas de organza;
  // "bolsas organza" dejaba la de 20x30 en la posición 9; "organza 20x30" la
  // deja primera. Por eso se consulta con las palabras MÁS ESPECÍFICAS.
  const palabrasActuales = palabrasDeContenido(texto);

  // Contexto: "las de 20por30" no repite "organza", así que sin arrastrar los
  // mensajes anteriores el rail perdía el hilo y el bot cotizaba otra cosa.
  //
  // Pero el arrastre SOLO vale cuando el mensaje no nombra nada por sí mismo.
  // Medido el 01-ago-2026 con tres productos seguidos en la misma conversación:
  // ante "mejor dime que valen unos pocillos" la consulta salía como
  // "unos pocillos cuadernos" y devolvía 12 cuadernos y CERO pocillos, que se le
  // entregaban al modelo rotulados como "lo que pidió el cliente"; con "y unos
  // esferos que valen?", 4 cuadernos y cero esferos. Y con "avisos" —que no
  // existe en el catálogo— el arrastre era lo ÚNICO que quedaba: el bot cotizó
  // los mugs del mensaje anterior (registro del 31-jul, `query: "mug"`).
  //
  // "las de 20por30" sigue funcionando: ese mensaje no trae ninguna palabra con
  // letras, solo la medida, así que el hilo se arrastra igual que antes.
  const traePalabraPropia = [...palabrasActuales].some((w) => /[a-z]/.test(w));

  const palabrasPrevias = new Set<string>();
  if (!traePalabraPropia) {
    for (const previo of historialCliente) {
      if (String(previo || '').trim().startsWith('[El cliente envió')) continue;
      for (const w of palabrasDeContenido(previo)) {
        if (!palabrasActuales.has(w)) palabrasPrevias.add(w);
      }
    }
  }

  if (palabrasActuales.size === 0 && palabrasPrevias.size === 0) {
    return { relevant: [], total: 0 };
  }

  // Las palabras del mensaje actual son las que mandan en la consulta. Del
  // historial se arrastra UNA, alfabética (nunca una medida vieja: "las de
  // 20por30" no debe heredar el 12x15 del mensaje anterior).
  const ordenarPorEspecificidad = async (palabras: string[]) => {
    const conFrecuencia: { t: string; n: number }[] = [];
    for (const t of palabras.slice(0, 8)) {
      conFrecuencia.push({ t, n: await frecuenciaEnCatalogo(t) });
    }
    conFrecuencia.sort((a, b) => a.n - b.n);
    return conFrecuencia.map((x) => x.t);
  };

  const actualesOrdenadas = await ordenarPorEspecificidad([...palabrasActuales]);
  const historialAlfabetico = await ordenarPorEspecificidad(
    [...palabrasPrevias].filter((w) => !/[0-9]/.test(w))
  );

  const especificas = [...actualesOrdenadas.slice(0, 2)];
  if (historialAlfabetico.length > 0) especificas.push(historialAlfabetico[0]);
  if (especificas.length === 0) especificas.push(...historialAlfabetico.slice(0, 2));

  const consultas = [especificas.join(' ')];
  if (especificas.length > 1) consultas.push(especificas[0]);

  const medidas = new Set([...palabrasActuales].filter((w) => /^[0-9]+x[0-9]+$/.test(w)));
  const pedidas = new Set([...palabrasActuales, ...palabrasPrevias]);
  let vistos = 0;

  for (const consulta of consultas) {
    try {
      const res: any = await runCatalogSearch(consulta);
      const matches: any[] = res?.matches || [];
      vistos = matches.length;
      const relevant = matches.filter((m: any) =>
        coincideAlgunaPalabra(pedidas, palabrasDeContenido(`${m.name || ''} ${m.category || ''}`))
      );
      if (relevant.length > 0) {
        // El modelo suele tomar el primero de la lista: la ordenamos por
        // parecido real con lo que pidió, y una medida que coincide manda.
        relevant.sort((a: any, b: any) =>
          puntajeDeParecido(b, medidas, palabrasActuales, palabrasPrevias) -
          puntajeDeParecido(a, medidas, palabrasActuales, palabrasPrevias)
        );
        logger.info('Rail de recuperación: consulta usada', {
          consulta, especificas: especificas.join(','), relevantes: relevant.length,
          primero: relevant[0]?.name || '',
        });
        return { relevant, total: vistos };
      }
    } catch (err) {
      logger.warn('Rail de recuperación: la búsqueda previa falló', {
        consulta, error: String(err),
      });
      return { relevant: [], total: 0 };
    }
  }
  return { relevant: [], total: vistos };
}

/** Parecido de un producto con lo que pidió el cliente. La medida pesa el triple. */
function puntajeDeParecido(
  m: any,
  medidas: Set<string>,
  actuales: Set<string>,
  previas: Set<string>
): number {
  const suyas = palabrasDeContenido(`${m.name || ''} ${m.category || ''}`);
  let p = 0;
  // La medida que dio el cliente en ESTE mensaje identifica el producto exacto.
  for (const med of medidas) {
    if (suyas.has(med)) p += 4;
  }
  for (const t of actuales) {
    if (coincideAlgunaPalabra(new Set([t]), suyas)) p += 3;
  }
  // El historial solo desempata: si el cliente cambia de tema, no debe arrastrar
  // la lista hacia lo que se hablaba antes.
  for (const t of previas) {
    if (coincideAlgunaPalabra(new Set([t]), suyas)) p += 0.25;
  }
  if (m.has_pricing) p += 0.5;
  return p;
}

/** Cruce de palabras tolerante a singular/plural: "bolsas" ↔ "bolsa". */
function coincideAlgunaPalabra(pedidas: Set<string>, delProducto: Set<string>): boolean {
  for (const w of pedidas) {
    if (delProducto.has(w)) return true;
    if (delProducto.has(`${w}s`) || delProducto.has(`${w}es`)) return true;
    if (w.endsWith('es') && delProducto.has(w.slice(0, -2))) return true;
    if (w.endsWith('s') && delProducto.has(w.slice(0, -1))) return true;
  }
  return false;
}

/**
 * Con qué palabras buscó el modelo en el catálogo durante este turno.
 *
 * Es el dato que delata el encierro: en el caso de los avisos el cliente
 * escribió "quiero unos avisos para mi local" y el rastro del modelo mostró
 * `searchCatalog("mug")`. Buscó lo de antes, no lo que le acababan de pedir.
 */
function consultasDeCatalogo(steps: any[]): string[] {
  const out: string[] = [];
  for (const step of steps || []) {
    for (const call of ((step.toolCalls || []) as any[])) {
      if (call.toolName !== 'searchCatalog') continue;
      // El SDK ha usado `args` y `input` según la versión: se aceptan las dos.
      const args = call.input ?? call.args ?? {};
      const q = typeof args === 'string' ? args : String(args.query || '');
      if (q.trim()) out.push(q.trim());
    }
  }
  return out;
}

/** Frases con las que el bot niega tener un producto. */
const NEGACION_DE_CATALOGO =
  /(no lo manejamos|no la manejamos|no los manejamos|no las manejamos|no manejamos|no lo trabajamos|no la trabajamos|eso puntual no|no tenemos ese|no tenemos esa|no contamos con|no disponemos)/i;

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

    const persona = resolvePersona(agentConfig);
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

    /**
     * SI EL CLIENTE PIDE UNA PERSONA, SE LE DA — Y ANTES DE QUE EL MODELO HABLE.
     *
     * Medido el 02-ago-2026: ante «No me sirve el bot, quiero hablar con un
     * asesor humano de verdad por favor», el bot respondió «Jaja, soy Oscar,
     * del equipo comercial» y no traspasó nada. Quedó en «Entrada», con el bot
     * encendido y sin avisar a nadie.
     *
     * Va aquí arriba, y no como un candado de salida, por dos razones: el
     * modelo ya no puede contestarle otra cosa, y no se gasta una llamada al
     * modelo para algo que ya está decidido.
     *
     * La herramienta `requestHumanHandoff` sigue existiendo y sirve para lo que
     * esta regla no puede ver: una queja grave, un caso que el bot no resuelve.
     * Esto solo pone el piso — lo pedido con todas las letras.
     */
    if (clientePideUnaPersona(messageText)) {
      const traspaso: any = await ejecutarTraspasoAHumano(toolContext, {
        reason: 'El cliente pidió expresamente hablar con una persona',
        urgency: 'medium',
      });
      if (traspaso?.success) {
        logger.warn('El cliente pidió una persona: traspaso determinista, el modelo no interviene', {
          orgId, conversationId, contactId,
        });
        return traspaso.message;
      }
      // Si el traspaso falló, es preferible que conteste el bot a dejar al
      // cliente sin respuesta: se sigue con el turno normal.
      logger.error('No se pudo traspasar a una persona; sigue el bot', {
        orgId, conversationId, contactId,
      });
    }

    // === RAIL DE RECUPERACIÓN DETERMINISTA ===
    // La búsqueda con las palabras del cliente se ejecuta aquí, no cuando al
    // modelo le parezca. Es lo único que impide que niegue un producto que
    // tenemos sin haber mirado el catálogo.
    const historialCliente = messages
      .filter((m) => m.role === 'user' && m.content && m.content.trim() !== messageText.trim())
      .slice(-3)
      .map((m) => m.content);
    const catalogProbe = await probeCatalogo(messageText, historialCliente);
    // Frase plantilla de Personalización, sin el {scope}: es la que el modelo
    // usa para despachar lo que cree fuera del negocio.
    const fraseOfftopic = String(persona.offtopic_redirect || '').split('{scope}')[0].trim();
    const catalogListado = catalogProbe.relevant
      .slice(0, 12)
      .map((m: any) => `${m.product_id} (${m.name})`)
      .join(', ');

    let systemPromptFinal = systemPrompt;
    if (catalogProbe.relevant.length > 0) {
      const lineas = catalogProbe.relevant
        .slice(0, 12)
        .map((m: any) => `- product_id: ${m.product_id} | ${m.name}${m.has_pricing ? '' : ' | SIN TARIFA'}`)
        .join('\n');
      // Solo DATOS, ninguna instrucción: lo que el bot puede o no puede decir lo
      // impone el guardrail, no una frase más en el prompt.
      systemPromptFinal = `${systemPrompt}

## Productos del catálogo que coinciden con lo que pidió el cliente
${lineas}`;
      logger.info('Rail de recuperación: coincidencias con las palabras del cliente', {
        conversationId,
        total: catalogProbe.total,
        relevantes: catalogProbe.relevant.length,
      });
    }

    // === BUQUE DE RECÁLCULO (obligar a usar la calculadora) ===
    // El bot genera respuesta → guardrail revisa → si bloquea, se le devuelve
    // una orden de recalcular → repite hasta 3 intentos. Escala en severidad.
    const MAX_RECALC_ATTEMPTS = 3;
    const RECALC_ORDERS: Record<string, string[]> = {
      'no-calculator': [
        'ALTO. Tu respuesta fue BLOQUEADA porque diste precios sin usar la calculadora. Está PROHIBIDO dar precios de memoria. Ejecuta searchCatalog para encontrar el producto y luego getProductPrice (o calculateCustomPrice si se cobra por área o metro, como DTF, vinilos o screen) antes de responder. No repitas precios del historial.',
        'BLOQUEADO DE NUEVO. No respondas de memoria. Para CADA producto que menciones con precio ejecuta getProductPrice, o calculateCustomPrice si va por medidas. Solo entonces responde con las cifras que devolvió la herramienta.',
        'ÚLTIMO INTENTO. Sin ejecutar la calculadora no hay respuesta válida. Ejecuta searchCatalog y después getProductPrice o calculateCustomPrice AHORA.',
      ],
      'denied-with-catalog-hits': [
        'ALTO. Le dijiste al cliente que no manejamos lo que pidió, y SÍ lo tenemos en el catálogo: {PRODUCTOS}. Ejecuta getProductPrice con esos product_id y preséntale 3 opciones con su precio. PROHIBIDO repetir que no lo manejamos.',
        'BLOQUEADO DE NUEVO. Estos productos existen y son los que pidió: {PRODUCTOS}. Cotízalos con getProductPrice y responde con las cifras reales.',
        'ÚLTIMO INTENTO. Usa exactamente estos product_id: {PRODUCTOS}. Ejecuta getProductPrice con cada uno y entrega la propuesta con precios.',
      ],
      'invented-reference': [
        'ALTO. Tu respuesta fue BLOQUEADA porque citaste una referencia de producto que NO existe en el catálogo: la inventaste. Solo puedes nombrar productos que searchCatalog te devolvió en ESTE turno, con su product_id exacto. Ejecuta searchCatalog ahora y usa únicamente esos resultados.',
        'BLOQUEADO DE NUEVO por inventar una referencia. Copia el campo product_id tal cual viene de searchCatalog, carácter por carácter. Si la herramienta no devolvió un producto, ese producto NO existe y no puedes ofrecerlo.',
        'ÚLTIMO INTENTO. Ejecuta searchCatalog y responde SOLO con los productos y referencias que la herramienta devuelva. Nada de memoria.',
      ],
      'offer-without-price': [
        'ALTO. Presentaste productos SIN precio y así el cliente no puede decidir. Ejecuta getProductPrice para CADA uno de los productos que vas a ofrecer, con la cantidad que pidió el cliente (o una cantidad estimada si no la dio, aclarándolo en una línea), y vuelve a escribir la respuesta con el valor unitario y el total de cada opción.',
        'BLOQUEADO DE NUEVO: sigue faltando el precio. Cada opción que menciones debe llevar su valor unitario y su total, calculados con getProductPrice en este turno.',
        'ÚLTIMO INTENTO. Ninguna opción puede ir sin cifras. Ejecuta getProductPrice para cada producto y responde con los precios reales.',
      ],
      'interrogation-no-offer': [
        'ALTO. Llevas varios mensajes seguidos solo haciendo preguntas y el cliente se está enfriando. Está PROHIBIDO volver a preguntar. Ejecuta searchCatalog AHORA con lo que ya sabes, cotiza con getProductPrice y presenta las 3 opciones con precio en este mismo mensaje. Si falta un dato como la cantidad, cotiza sobre una cantidad estimada y acláralo en una línea.',
        'BLOQUEADO DE NUEVO. No preguntes nada. Busca, cotiza y muestra 3 opciones con precios reales ahora mismo.',
        'ÚLTIMO INTENTO. Ejecuta searchCatalog + getProductPrice y entrega 3 opciones con precio, sin una sola pregunta previa.',
      ],
      'search-off-topic': [
        'ALTO. Buscaste en el catálogo con {BUSCADO}, pero el cliente acaba de pedir: {PEDIDO}. Le estás ofreciendo lo de antes. Ejecuta searchCatalog con las palabras EXACTAS que él escribió. Si no aparece nada que sirva, NO repitas lo que ya ofreciste: dile con naturalidad que quieres entenderle bien y hazle 1 o 2 preguntas cortas sobre lo que necesita.',
        'BLOQUEADO DE NUEVO. Olvida los productos de los mensajes anteriores. El cliente pidió: {PEDIDO}. Búscalo con esas palabras, y si no hay resultados pregúntale a qué se refiere. PROHIBIDO volver a listar lo ya ofrecido.',
        'ÚLTIMO INTENTO. No cotices nada de lo anterior. Sobre {PEDIDO}: o lo encuentras con searchCatalog, o le preguntas al cliente qué necesita exactamente. Una respuesta con preguntas es válida aquí.',
      ],
    };

    const questionStreak = countQuestionStreak(messages);
    const approvedPrices = collectApprovedPrices(messages);
    let finalResponse: string | null = null;

    /**
     * El rastro del ULTIMO intento. Vive fuera del bucle porque la etapa del
     * Pipeline se decide al final, con lo que de verdad se le entrego al
     * cliente: si el candado bloqueo la respuesta y hubo recalculo, lo que
     * cuenta es el intento que salio, no los que se descartaron.
     */
    let pasosDelTurno: any[] = [];
    let loopMessages = [...messages];

    // Lo que el cliente acaba de escribir, para contrastarlo con lo que el
    // modelo fue a buscar al catálogo.
    const palabrasPedidas = palabrasDeContenido(messageText);
    // Cuando el bot buscó fuera de tema, preguntar deja de ser una falta: es
    // justo lo que le estamos pidiendo. Sin esto, el candado del interrogatorio
    // volvería a empujarlo a cotizar lo primero que tenga a mano.
    let permitirPreguntar = false;

    for (let attempt = 0; attempt < MAX_RECALC_ATTEMPTS; attempt++) {
      const result = await generateText({
        model,
        system: systemPromptFinal,
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

      pasosDelTurno = result.steps || [];

      logger.info('Agent finished', {
        orgId, conversationId,
        steps: result.steps?.length || 0,
        attempt: attempt + 1,
        finishReason: (result as any).finishReason,
      });

      let responseText = assembleText(result.text, result.steps || []);
      if (!responseText?.trim()) {
        logger.warn('Agent returned empty response', { orgId, conversationId, attempt: attempt + 1 });
        finalResponse = null;
        break;
      }

      // Limpiar thought tags
      let cleanedResponse = stripThoughtTags(responseText);
      if (cleanedResponse !== responseText) {
        logger.info('Thought tags limpiados de la respuesta', { orgId, conversationId });
      }

      // Guardrail de identidad: determinista y sin coste de tokens.
      const identity = sanitizeIdentity(cleanedResponse, persona.agent_name);
      if (identity.hit) {
        cleanedResponse = identity.text;
        logger.warn('GUARDRAIL: identidad de IA saneada en la respuesta', { orgId, conversationId });
      }

      // Revisar con el guardrail
      const guardrailResult = await applyOutputGuardrail(
        cleanedResponse, result.steps || [], permitirPreguntar ? 0 : questionStreak,
        approvedPrices, catalogProbe.relevant, fraseOfftopic, palabrasPedidas
      );

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
        finalResponse = formatPricesForColombia(cleanedResponse);
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
      if (guardrailResult.reason === 'search-off-topic') permitirPreguntar = true;

      const orders = RECALC_ORDERS[guardrailResult.reason] || RECALC_ORDERS['no-calculator'];
      const orderText = (orders[attempt] || orders[orders.length - 1])
        .replace('{PRODUCTOS}', catalogListado || 'los que devuelva searchCatalog')
        .replace('{BUSCADO}', consultasDeCatalogo(result.steps || []).join(' / ') || 'otra cosa')
        .replace('{PEDIDO}', messageText.trim().slice(0, 200));
      loopMessages = [...loopMessages,
        { role: 'assistant', content: cleanedResponse },
        { role: 'user', content: orderText },
      ];

      // Si es el último intento, entregar respuesta de respaldo
      if (attempt === MAX_RECALC_ATTEMPTS - 1) {
        logger.error('CANDADO v4: Máximo de recálculos alcanzado, entregando respuesta de respaldo', {
          orgId, conversationId,
        });
        // Si lo que falló fue que buscaba otra cosa, el respaldo NO puede
        // prometer una cotización: sería seguir hablando de lo que el cliente
        // no pidió. Se pregunta, que es lo que corresponde.
        finalResponse = permitirPreguntar
          ? 'Cuéntame un poco más de lo que necesitas para no ofrecerte algo que no era: ¿para qué lo vas a usar y qué tamaño o cantidad tienes en mente? Con eso lo reviso con el equipo y te confirmo.'
          : 'Ya estoy revisando eso con producción para darte el valor exacto. Cuéntame mientras qué cantidad manejas y te armo la cotización completa.';
      }
    }

    /**
     * LA TARJETA SE MUEVE SOLA, CON LO QUE PASO.
     *
     * Va aqui, al final del turno, porque solo aqui se sabe las dos cosas: lo
     * que el cliente escribio y lo que de verdad se le entrego. Va DESPUES del
     * candado a proposito: una cotizacion bloqueada no llego al cliente, asi
     * que no es una negociacion y no mueve nada.
     *
     * Si esto falla, el cliente igual recibe su respuesta. Una tarjeta en la
     * columna equivocada es un fastidio; quedarse sin contestar es perder al
     * cliente. Ver lib/agent/pipeline-automatico.ts.
     */
    try {
      const destino = etapaPorHechos({
        mensajeDelCliente: messageText,
        respuestaDelBot: finalResponse,
        steps: pasosDelTurno,
      });
      if (destino) {
        await moverEtapaSiAvanza({
          orgId,
          contactId,
          conversationId,
          destino,
          motivo: destino === 'sold'
            ? 'el cliente dijo que compra o pregunto donde pagar'
            : 'el bot entrego una cotizacion con precio',
        });
      }
    } catch (errEtapa) {
      logger.error('No se pudo mover la etapa del Pipeline', {
        error: String(errEtapa), orgId, conversationId,
      });
    }

    return finalResponse;
  } catch (err) {
    logger.error('Agent error', {
      error: String(err),
      orgId,
      conversationId,
    });
    return 'Dame un segundo que reviso eso y te confirmo.';
  }
}
