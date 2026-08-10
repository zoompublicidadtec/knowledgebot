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
import {
  searchCatalogTool,
  runCatalogSearch,
  buscarPorReferencia,
  referenciasEnElTexto,
} from './tools/search-catalog';
import { hojaParaLoQueDijoElCliente, comoSeBusca } from './hojas';
import { getProductPriceTool } from './tools/get-product-price';
import { saveContactInfoTool } from './tools/save-contact-info';
import {
  requestHumanHandoffTool,
  clientePideUnaPersona,
  ejecutarTraspasoAHumano,
  elBotNoAvanza,
  RESPALDO_PREGUNTAR,
  RESPALDO_COTIZAR,
  RESPALDO_ERROR,
} from './tools/request-human-handoff';
import { calculateCustomPriceTool } from './tools/calculate-custom-price';
import { buildQuoteTool } from './tools/build-quote';
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
 * Elimina la oración completa donde el modelo se delata, en lugar de intentar
 * parchearla. En producción se registraron mensajes como "como soy un modelo de
 * lenguaje, no puedo mostrarla" y "como soy un asistente de texto": la oración
 * entera sobra, porque el sistema sí envía la foto por otro canal.
 *
 * SON DOS FAMILIAS DISTINTAS, y hasta el 02-ago-2026 solo estaba la primera.
 * Por eso este mensaje llegó entero a un cliente:
 *
 *   «Para darte el precio exacto del Cuaderno Argollado - Base 120 hojas
 *    (Ref: ZM-CUA-012) en tamaño 1/2 Carta para 18 unidades, necesito
 *    EJECUTAR LA HERRAMIENTA DE BÚSQUEDA.»
 *
 * Ninguno de los 14 marcadores que había lo tapaba: los 14 hablaban de lo que
 * el bot ES ("soy un bot", "inteligencia artificial") y ninguno de lo que el
 * bot HACE. Un asesor de verdad jamás diría "ejecutar la herramienta", "la base
 * de datos" ni "procesar tu consulta".
 *
 * CUIDADO CON LOS FALSOS POSITIVOS. "Herramienta" a secas es una categoría del
 * catálogo de ZOOM: hay sets y kits de herramientas a la venta. Por eso no se
 * tapa la palabra suelta, se exige el contexto de máquina —un verbo de ejecutar
 * delante, o "de búsqueda/consulta/precios" detrás—. "Set de Herramientas 12
 * piezas" pasa entero, como debe ser. Lo mismo con "sistema": "el sistema de
 * impresión DTF" es lenguaje de producto y no se toca; "el sistema no me deja"
 * es lenguaje de máquina y sí.
 */

/** Familia 1 — lo que el bot ES. */
const MARCADORES_DE_IDENTIDAD = [
  'asistente virtual',
  'inteligencia artificial',
  'modelo de lenguaje',
  'soy una? ia\\b',
  'soy un bot\\b',
  'chatbot',
  'asistente de texto',
  'no puedo mostrar',
  'no puedo enviar imágenes',
  'no puedo ver',
  'imagina que la imagen',
  'te transfiero con un humano',
  'hablar con un humano',
  'con un asesor humano',
];

/** Familia 2 — lo que el bot HACE. Vocabulario de máquina, siempre con contexto. */
const MARCADORES_DE_MAQUINA = [
  // "necesito ejecutar la herramienta", "voy a usar la función de búsqueda"
  '\\b(?:ejecut|utiliz|invoc)\\w*\\s+(?:la|el|mi|una?)?\\s*(?:herramienta|función|funcion)\\b',
  '\\b(?:us(?:ar|ando|o)|llam(?:ar|ando)|corr(?:er|iendo)|activ(?:ar|ando)|lanz(?:ar|ando)|consult(?:ar|ando))\\s+(?:la|el|mi|una?)\\s+(?:herramienta|función|funcion)\\b',
  // "la herramienta de búsqueda", aunque no lleve verbo delante
  'herramientas?\\s+de\\s+(?:búsqueda|busqueda|consulta|precios?|cotización|cotizacion|catálogo|catalogo|cálculo|calculo)',
  'base de datos',
  '\\bAPI\\b',
  '\\bendpoint\\b',
  '\\bbackend\\b',
  '\\balgoritmo\\b',
  'mi (?:función|funcion|programación|programacion|entrenamiento|base de conocimiento)',
  '(?:fui|he sido|estoy) (?:entrenad|programad|diseñad|configurad)',
  // "procesar tu consulta" / "estoy procesando tu consulta". "Solicitud" y
  // "pedido" quedan FUERA a propósito: "estamos procesando tu pedido" es
  // lenguaje normal de un vendedor.
  'proces(?:ar|ando|o|amos)\\s+(?:la|tu|su)\\s+(?:consulta|petición|peticion)',
  /**
   * «El sistema» a secas es lenguaje de máquina y no lo dice ningún vendedor.
   * Con «de» detrás es lenguaje de producto —«el sistema de impresión DTF»,
   * «sistema de cierre hermético»— y ESO no se toca.
   *
   * Antes esto era una lista de verbos («el sistema no me deja…»), y se le
   * escapó la frase que vio el dueño el 03-ago: «El sistema se encarga de
   * enviarlas automáticamente». Enumerar los verbos era jugar al gato y al
   * ratón; la marca real es la palabra sin el «de».
   */
  '\\b(?:el|mi|nuestro) sistemas?\\b(?!\\s+de\\b)',
  'consultar (?:el|mi|nuestro) sistema',
];

/**
 * Familia 3 — LA FONTANERÍA. El bot contando cómo se entregan los mensajes.
 *
 * EL FALLO QUE ESTO CIERRA (captura del dueño, 03-ago-2026)
 * --------------------------------------------------------
 * El bot le escribió a un cliente:
 *   «Disculpa, parece que hubo un problema y no se adjuntó la foto.
 *    El sistema se encarga de enviarlas automáticamente.»
 *
 * Dos cosas mal en dos renglones. Suena a máquina, y además —palabras del
 * dueño— **si la foto se envió, decirlo sobra**: es información que al cliente
 * no le sirve de nada y gasta tokens en cada mensaje.
 *
 * La marca de esta familia es la voz impersonal sobre el mecanismo: «se
 * adjuntó», «se envían solas», «el sistema se encarga». Un vendedor de verdad
 * habla en primera persona —«te la mando», «te adjunto el diseño»— y eso pasa
 * entero: es exactamente el discriminante que se usa aquí.
 *
 * OJO CON LA TILDE: «envían» y «envío» llevan í; «enviarlas» y «envió» no.
 * `env[íi]` cubre las cuatro. Sin eso, «se envían solas» se colaba.
 */
const MARCADORES_DE_FONTANERIA = [
  'no se (?:adjunt|env[íi]|carg|pud|compart)',
  '\\bse (?:encarga|encargan) de (?:env[íi]|adjunt|mand|compart)',
  '\\b(?:env[íi]|mand|adjunt|carg)\\w*\\s+(?:de (?:forma|manera) )?autom',
  '\\bse (?:adjunt|env[íi]|carg)\\w*\\s+(?:de (?:forma|manera) )?autom',
  'hubo un (?:problema|error) (?:al|con la|con el|y no se)\\s*(?:adjunt|env[íi]|carg|mostr|proces)',
];

const IDENTITY_MARKERS = new RegExp(
  '(' +
    MARCADORES_DE_IDENTIDAD
      .concat(MARCADORES_DE_MAQUINA)
      .concat(MARCADORES_DE_FONTANERIA)
      .join('|') +
    ')',
  'i'
);

/**
 * ¿Lo que queda después de tapar la frase sigue sirviendo de respuesta?
 *
 * Borrar la oración delatora puede dejar al cliente colgado. En el caso medido,
 * quitar «necesito ejecutar la herramienta de búsqueda» dejaba solo «Mil
 * disculpas, tienes toda la razón. Me equivoqué al darte el precio sin
 * consultarlo adecuadamente»: una disculpa sin ningún paso siguiente, que es
 * casi peor que la frase original.
 *
 * Sirve si hace algo por el cliente: da un precio, pregunta, o promete un paso.
 */
function respuestaSirve(t: string): boolean {
  if (t.length < 25) return false;
  if (/\$\s?\d/.test(t)) return true;
  if (/\?/.test(t)) return true;
  return /(te (?:lo )?(?:confirmo|aviso|paso|env[íi]o|armo|cotizo|mando)|dame un (?:segundo|momento|minuto)|en un momento|enseguida|ya mismo)/i.test(t);
}

function sanitizeIdentity(text: string, agentName: string): { text: string; hit: boolean } {
  if (!text || !IDENTITY_MARKERS.test(text)) return { text, hit: false };

  const kept = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(s => s.trim() && !IDENTITY_MARKERS.test(s));

  let out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();

  if (!respuestaSirve(out)) {
    out = out.length >= 25
      // Quedó algo con sentido, pero sin paso siguiente: se le añade el paso.
      ? `${out} Dame un segundo y te confirmo la cotización exacta.`
      // No quedó nada aprovechable: la frase de respaldo de siempre.
      : `Claro que sí. Dame un segundo y te confirmo con producción. Mientras tanto, cuéntame qué cantidad necesitas y te armo la cotización, habla con ${agentName.split(' ')[0]}.`;
  }
  return { text: out, hit: true };
}

/**
 * NO SE INVENTA LA POLÍTICA DE MARCACIÓN. Nuevo el 10-ago-2026.
 *
 * Medido ese día: a «¿los mugs ya vienen con mi logo impreso?» el bot contestó
 * «los precios de catálogo no incluyen la marcación del logo, esta se cotiza
 * aparte según la técnica, tamaño y número de tintas». **Nadie le dijo eso.**
 * No hay hoja de Mugs, así que se lo inventó con total seguridad — y encima
 * preguntando por técnica y tintas, que es justo lo que la hoja de Cuadernos
 * prohíbe preguntar.
 *
 * Es el mismo fallo que DEFAULT_PERSONA: un dato del negocio que el bot rellena
 * solo cuando el dueño no lo escribió. Se aplica la misma regla — si nadie lo
 * dijo, la frase entera se cae y el bot ofrece consultarlo. **No se bloquea**
 * la respuesta: bloquear gasta un intento de los tres y ya está medido que los
 * candados se pelean entre sí. Se quita la oración y lo demás sale.
 */
const AFIRMA_POLITICA_DE_MARCACION =
  /(no incluyen? la marcaci[óo]n|se cotiza aparte|marcaci[óo]n (?:se cobra|va) aparte|no incluye el logo|el logo se cobra|aparte seg[úu]n la t[ée]cnica|sin incluir la marcaci[óo]n|incluye la marcaci[óo]n|marcaci[óo]n (?:est[áa] )?incluida|ya viene(?:n)? marcad)/i;

/** ¿Alguna hoja del dueño habló de la marcación en este turno? */
function politicaDeMarcacionRespaldada(steps: any[]): boolean {
  for (const step of steps || []) {
    for (const tr of (step.toolResults || []) as any[]) {
      const crudo = (tr as any).output ?? (tr as any).result;
      if (!crudo) continue;
      const texto = typeof crudo === 'string' ? crudo : JSON.stringify(crudo);
      if (/INCLUIDO EN EL PRECIO|SE COTIZA APARTE|NO SE IMPRIME NADA|Sobre lo que se imprime/i.test(texto)) {
        return true;
      }
    }
  }
  return false;
}

function quitarPoliticaInventada(text: string, steps: any[]): { text: string; hit: boolean } {
  if (!text || !AFIRMA_POLITICA_DE_MARCACION.test(text)) return { text, hit: false };
  if (politicaDeMarcacionRespaldada(steps)) return { text, hit: false };

  const kept = text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => s.trim() && !AFIRMA_POLITICA_DE_MARCACION.test(s));

  let out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();

  /**
   * Si lo que queda no lleva un precio, el cliente sigue sin respuesta: preguntó
   * por la marcación y le quitamos justo esa frase. Medido el 10-ago: al quitar
   * la política inventada quedó **solo el saludo**, y `respuestaSirve` lo dio
   * por bueno porque el saludo termina en pregunta. Así que aquí no se consulta
   * a `respuestaSirve`: sin cifra, siempre se añade el paso siguiente.
   */
  if (!/\$\s?\d/.test(out)) {
    out = out.length >= 25
      ? `${out} Lo de la marcación lo confirmo con producción y te digo enseguida.`
      : 'Eso de la marcación lo confirmo con producción y te aviso enseguida. Cuéntame qué cantidad necesitas y te armo la cotización.';
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

/**
 * «4 insertos y 2 insertos» → «6 insertos».
 *
 * EL FALLO QUE ESTO CIERRA (captura del dueño, 03-ago-2026)
 * --------------------------------------------------------
 * El catálogo NO tiene un producto de 6 insertos: el precio se arma sumando
 * 4 + 2, y por eso el prompt manda desglosar. Pero **ese desglose es cuenta
 * NUESTRA**: el cliente pidió 6 y tiene que leer 6. Palabras del dueño:
 * «dividió los insertos para el cliente y eso no es lo correcto».
 *
 * SE HACE AQUÍ, EN CÓDIGO, Y NO PIDIÉNDOSELO AL MODELO. Se intentó primero
 * por el prompt —se le añadió «el desglose es para calcular, no para contar»,
 * se desplegó, y siguió partiéndolos igual—. Es la regla del proyecto
 * demostrada sobre sí misma: lo que obliga son los guardrails deterministas,
 * no las instrucciones.
 *
 * Va DESPUÉS del candado, junto al formato de las cifras: para entonces las
 * referencias ya se verificaron, así que quitar las de los componentes no
 * debilita ninguna comprobación.
 *
 * Solo une lo que está en la MISMA línea (`[ \t]`, nunca `\s`): una lista de
 * opciones en renglones distintos —«- 4 insertos» / «- 2 insertos»— son dos
 * opciones, no una suma.
 */
const PAR_DE_INSERTOS =
  /(\d+)[ \t]+insertos?(?:[ \t]*\([ \t]*Ref[^)]*\))?[ \t]*(?:,|y)[ \t]+(\d+)[ \t]+insertos?(?:[ \t]*\([ \t]*Ref[^)]*\))?/gi;

function unificarInsertos(text: string): string {
  if (!text) return text;
  let antes = text;
  // Se repite para juntar tres piezas o más (8+1, 4+3, …).
  for (let i = 0; i < 3; i++) {
    const despues = antes.replace(
      PAR_DE_INSERTOS,
      (_m, a: string, b: string) => `${Number(a) + Number(b)} insertos`
    );
    if (despues === antes) break;
    antes = despues;
  }
  return antes;
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
 * NO SE LE PIDEN AL CLIENTE DATOS DE ALGO QUE NO SABEMOS COTIZAR.
 *
 * EL FALLO QUE ESTO CIERRA (captura del dueño, 03-ago-2026)
 * --------------------------------------------------------
 * El cliente preguntó «¿y ya vienen marcados?» y el bot abrió un camino sin
 * salida: le pidió el tamaño del logo, luego la técnica, luego el número de
 * colores —tres turnos— y terminó en «Disculpa, parece que hubo un error al
 * intentar cotizar la tampografía». Cinco mensajes gastados y cero venta.
 *
 * La causa está en los DATOS, no en el modelo: el catálogo **no tiene ninguna
 * marcación para cuadernos**. Los únicos servicios de marcación que existen son
 * bordado y dos tampografías atadas a otro producto («sobre manilla lisa»,
 * «sobre llavero»). El modelo se inventó el camino con su conocimiento general
 * de la industria, porque en publicidad «cuaderno + logo» suena a serigrafía.
 *
 * Lo que sí existe y sí tiene tarifa para un cuaderno son los adicionales:
 * insertos, filtro UV, guardas, cosido y diseño. **Eso es lo que hay que
 * ofrecer.**
 *
 * LA REGLA: si la respuesta le pide al cliente un dato de marcación —técnica,
 * tintas, tamaño del logo— y `searchCatalog` NO devolvió en este turno ningún
 * servicio de marcación, se bloquea. Si el catálogo SÍ devolvió uno (una
 * tampografía sobre llavero, un DTF, un bordado), preguntar está bien y pasa.
 *
 * Es el mismo principio que ya rige en `DEFAULT_PERSONA`: si el dato no está,
 * no se inventa; se dice que se consulta con el equipo.
 */
const PIDE_DATOS_DE_MARCACION =
  /(?:cuántos|cuantos|qué|que)\s+(?:colores|tintas)\b|(?:qué|que)\s+técnica|técnica\s+de\s+(?:marcaci|impresi|marcad)|(?:tamaño|medidas)\s+(?:de|del)\s+(?:tu\s+)?logo|serigrafía\s+o\s+tampografía|tampografía\s+o\s+serigrafía|te\s+cotice?\s+la\s+marcaci/i;

/** Nombres de servicio que SÍ respaldan una pregunta sobre marcación. */
const SERVICIO_DE_MARCACION = /tampograf|serigraf|bordad|marcaci|grabad|sublimac|screen|dtf|vinilo|l[áa]ser|estampad/i;

/** Nombres de producto que searchCatalog devolvió en este turno. */
function nombresDeCatalogo(steps: any[]): string[] {
  const out: string[] = [];
  for (const step of steps || []) {
    for (const tr of step.toolResults || []) {
      if (tr.toolName !== 'searchCatalog') continue;
      const raw = (tr as any).output ?? (tr as any).result;
      if (!raw) continue;
      try {
        const r = typeof raw === 'string' ? JSON.parse(raw) : raw;
        for (const m of r?.matches || []) if (m?.name) out.push(String(m.name));
      } catch { /* resultado no parseable: se ignora */ }
    }
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
  palabrasPedidas: Set<string> = new Set(),
  palabrasPrevias: Set<string> = new Set(),
  referenciasYaCotizadas: Set<string> = new Set(),
  referenciasResueltas: any[] = []
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
    //     CORREGIDO EL 10-AGO-2026. Tal como estaba, este candado castigaba al
    //     bot **por acertar**. Medido en los registros de producción del propio
    //     día, tres bloqueos seguidos, los tres injustos:
    //
    //       consultas ["mug"]         pidió "mugs"                    → BLOQUEADO
    //       consultas ["boligrafo"]   pidió "esferos"                 → BLOQUEADO
    //       consultas ["mug mágico"]  pidió "mugs cambien color agua" → BLOQUEADO
    //
    //     El primero por la longitud de la palabra (ver MULETILLAS_CORTAS). Los
    //     otros dos porque **traducir la jerga del cliente al nombre del
    //     catálogo es exactamente lo que queremos que haga**: «esfero» es
    //     bolígrafo y «mug que cambia de color» es el Mug Mágico. Comparar la
    //     consulta contra las palabras crudas del cliente convierte cada acierto
    //     en un bloqueo, y el bot gastaba dos de sus tres intentos ahí. Después
    //     de dos bloqueos entrega la respuesta de respaldo, que no vende nada.
    //
    //     El fallo que este candado existe para atajar es otro y muy concreto:
    //     **seguir hablando de lo de ANTES**. Así que ahora se bloquea solo
    //     cuando la consulta se parece al tema ANTERIOR y no al de ahora. Si no
    //     se parece a ninguno de los dos, es una traducción y pasa.
    if (palabrasPedidas.size > 0) {
      const consultas = consultasDeCatalogo(steps);
      const alTema = consultas.some((q) =>
        coincideAlgunaPalabra(palabrasPedidas, palabrasDeContenido(q))
      );
      const soloAlTemaViejo =
        palabrasPrevias.size > 0 &&
        consultas.length > 0 &&
        !alTema &&
        consultas.every((q) => coincideAlgunaPalabra(palabrasPrevias, palabrasDeContenido(q)));

      if (soloAlTemaViejo) {
        logger.error('GUARDRAIL: siguió con el tema anterior en vez de lo que pidió el cliente', {
          consultas, pidio: [...palabrasPedidas].join(','), antes: [...palabrasPrevias].join(','),
        });
        return { blocked: true, reason: 'search-off-topic' };
      }
      if (consultas.length > 0 && !alTema) {
        // No es el fallo que este candado persigue: se anota para poder medirlo,
        // pero no se bloquea. Casi siempre es una traducción correcta.
        logger.info('El bot buscó con otras palabras que las del cliente (traducción, no bloqueo)', {
          consultas, pidio: [...palabrasPedidas].join(','),
        });
      }
    }

    /**
     * 0.05 NEGAR UNA REFERENCIA QUE SÍ EXISTE. Nuevo el 10-ago-2026.
     *
     * Es la queja con la que el dueño abrió el día: pidió «10 mug metálicos ref
     * MU-303-1» y el bot le contestó que esa referencia no está en el catálogo.
     * Está: es el *Mug Metálico Wilem 380ml II*, activo, guardado como
     * `MU-303-1.` con un punto que dejó el Excel.
     *
     * Ya se resuelve el código y el producto se le entrega al modelo. Pero
     * entregárselo no basta —la regla del proyecto, otra vez—: en la prueba, el
     * modelo tenía el producto delante, buscó por su cuenta la palabra
     * «referencia», no encontró nada parecido y volvió a decir que no existe.
     * Aquí ya no puede: si el sistema resolvió el código, negarlo se bloquea.
     */
    if (referenciasResueltas.length > 0 && NIEGA_UNA_REFERENCIA.test(responseText)) {
      logger.error('GUARDRAIL: negó una referencia que el sistema sí resolvió', {
        resueltas: referenciasResueltas.map((p: any) => `${p.product_id}:${p.name}`),
      });
      return { blocked: true, reason: 'nego-referencia-que-existe' };
    }

    // 0.1 NO PIDAS DATOS DE UNA MARCACIÓN QUE NO SABEMOS COTIZAR. Va junto a
    //     los demás candados de causa, antes de mirar precios: el mal ya está
    //     hecho en el momento en que se le pregunta al cliente por la técnica.
    if (PIDE_DATOS_DE_MARCACION.test(responseText)) {
      const nombres = nombresDeCatalogo(steps);
      const respaldada = nombres.some((n) => SERVICIO_DE_MARCACION.test(n));
      if (!respaldada) {
        logger.error('GUARDRAIL: pide datos de una marcación que el catálogo no cotiza', {
          devolvio: nombres.slice(0, 6),
        });
        return { blocked: true, reason: 'servicio-sin-tarifa' };
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
      // Lo que el sistema ya resolvió por código cuenta como verificado: lo
      // encontró él mismo en la base hace tres líneas.
      for (const p of referenciasResueltas) {
        if (p?.product_id) allowed.add(String(p.product_id).toUpperCase());
      }
      const unverified = cited.filter(r => !allowed.has(r));

      if (unverified.length > 0) {
        const supabase = createAdminClient();
        const { data: found } = await (supabase as any)
          .from('products')
          .select('reference')
          .in('reference', unverified)
          .eq('active', true);

        const real = new Set((found || []).map((p: any) => String(p.reference).toUpperCase()));

        /**
         * Y OTRA VEZ EL PUNTO DE MÁS. La comparación exacta daba por inventada
         * la referencia `MU-303-1` porque el catálogo la guarda como
         * `MU-303-1.`. Es el último eslabón de la misma cadena: el código se
         * resolvía bien, la calculadora daba el precio bien, y el candado
         * antialucinación tumbaba la respuesta al final por un carácter.
         */
        const codigo = (t: string) => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const faltantes = unverified.filter((r) => !real.has(r));
        if (faltantes.length > 0) {
          const letras = [...new Set(
            faltantes.map((r) => (codigo(r).match(/^[A-Z]+/) || [''])[0]).filter((l) => l.length >= 2)
          )];
          if (letras.length > 0) {
            const { data: parecidos } = await (supabase as any)
              .from('products')
              .select('reference')
              .eq('active', true)
              .or(letras.map((l) => `reference.ilike.${l}*`).join(','))
              .limit(1000);
            const normReales = new Set((parecidos || []).map((p: any) => codigo(p.reference)));
            for (const r of faltantes) {
              if (normReales.has(codigo(r))) real.add(r);
            }
          }
        }

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
    const PRICE_TOOLS = new Set(['getProductPrice', 'calculateCustomPrice', 'buildQuote']);
    const priceToolCalled = (steps || []).some(step =>
      (step.toolResults || []).some((t: any) => PRICE_TOOLS.has(t.toolName))
    );

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
     *
     * Se calcula ANTES de la bifurcacion porque ahora hace falta en los dos
     * caminos: sin calculadora (para no bloquear una politica del panel) y
     * con calculadora (para no bloquear un total que en realidad es un monto
     * del panel, como un envio gratis mas caro que la cotizacion).
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

    if (!priceToolCalled) {
      // Si todas las cifras ya se le dieron al cliente antes en esta misma
      // conversación, es el bot confirmando lo cotizado (típico del cierre),
      // no inventando precios.
      const todasConocidas = mentionedPrices.every(
        p => approvedPrices.has(parseCOP(p)) || desdeElPanel.has(parseCOP(p))
      );

      /**
       * PERO SOLO SI SON LOS MISMOS PRODUCTOS. Corregido el 10-ago-2026.
       *
       * Esta puerta existe para el cierre: «me quedo con ese» y el bot repite el
       * total ya cotizado sin volver a calcular. El agujero era que aceptaba una
       * cifra vieja pegada a un producto NUEVO. Es el fallo que el dueño trajo
       * en una captura: pidió mugs metálicos y recibió MU-180 $235.000,
       * MU-439 $429.900 y MU-345 $589.000; un minuto después, otros tres mugs
       * completamente distintos con **las mismas tres cifras**. Comprobado
       * contra las tarifas: el Mug Tintero a 10 unidades vale $8.000, no
       * $23.500. Eran los precios del mensaje anterior, reciclados.
       *
       * Ahora, si la respuesta nombra una referencia que no se había cotizado
       * antes en esta conversación, la puerta se cierra y hay que calcular.
       */
      const referenciasNuevas = cited.filter((r) => !referenciasYaCotizadas.has(r));
      if (todasConocidas && referenciasNuevas.length > 0) {
        logger.error('CANDADO v4: precios viejos pegados a productos nuevos', {
          referenciasNuevas, cifras: mentionedPrices,
        });
        return { blocked: true, reason: 'precio-reciclado' };
      }

      if (todasConocidas) {
        logger.info('CANDADO v4: precios ya aprobados en la conversación', {
          count: mentionedPrices.length,
        });
        return { blocked: false, reason: 'previously-approved' };
      }
      logger.error('CANDADO v4: Precios sin calculadora en el turno', { mentionedPrices });
      return { blocked: true, reason: 'no-calculator' };
    }

    /**
     * EL TOTAL TAMBIÉN TIENE QUE HABER SALIDO DE LA CALCULADORA.
     *
     * Hasta el 03-ago-2026 este candado comprobaba DE DÓNDE salía cada precio
     * —que se hubiera llamado a la calculadora— y a partir de ahí dejaba pasar
     * CUALQUIER cifra. El agujero estaba en las cotizaciones armadas: en un
     * cuaderno con 6 insertos, cada pieza venía bien de la calculadora, pero
     * la SUMA y la MULTIPLICACIÓN las escribía el modelo de cabeza.
     *
     * Medido ese día, cinco corridas de la misma frase, contacto nuevo cada
     * vez: $487.000 ✔, $487.000 ✔, $427.000 ✘, $584.000 ✘, y una sin cotizar.
     * El candado aprobó las cinco.
     *   · $427.000 = se le olvidaron 2 de los 6 insertos.
     *   · $584.000 = partió el 6 como 8+2, o sea DIEZ insertos.
     * $157.000 de diferencia en el mismo pedido.
     *
     * Ahora la cifra MÁS ALTA de la respuesta —que es siempre el total, y la
     * única que decide lo que paga el cliente— tiene que ser una que alguna
     * herramienta de precio haya producido de verdad en este turno, o una ya
     * aprobada antes en la conversación, o un monto del panel.
     *
     * SOLO la más alta, a propósito. Las cifras de abajo (el unitario, el
     * anticipo, el saldo) son derivadas legítimas de una división, y exigirlas
     * todas bloquearía respuestas correctas. El total es lo que hay que blindar.
     */
    const cifrasDeHerramientas = new Set<number>();
    for (const step of steps || []) {
      for (const t of (step.toolResults || []) as any[]) {
        if (!PRICE_TOOLS.has(t.toolName)) continue;
        const texto = JSON.stringify(t.output ?? t.result ?? '');
        for (const trozo of texto.match(/\d[\d.,]*/g) || []) {
          const n = parseCOP(trozo);
          if (n > 0) cifrasDeHerramientas.add(n);
        }
      }
    }

    const totalDicho = mentionedPrices.reduce((mayor, p) => Math.max(mayor, parseCOP(p)), 0);
    if (
      totalDicho > 0 &&
      !cifrasDeHerramientas.has(totalDicho) &&
      !approvedPrices.has(totalDicho) &&
      !desdeElPanel.has(totalDicho)
    ) {
      logger.error('GUARDRAIL: el total no salió de la calculadora, lo sumó el modelo', {
        totalDicho,
        mentionedPrices,
      });
      return { blocked: true, reason: 'total-sin-calculadora' };
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

/**
 * Referencias que el bot YA cotizó antes en esta conversación. Es la otra mitad
 * de `collectApprovedPrices`: una cifra vieja solo vale si va con su producto.
 */
function referenciasYaCotizadas(messages: { role: string; content: string }[]): Set<string> {
  const out = new Set<string>();
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const r of extractCitedReferences(m.content)) out.add(r);
  }
  return out;
}

/**
 * ¿La respuesta se cortó a mitad de frase? Medido el 10-ago-2026: a «cuánto
 * vale un banner laminado de 200 x 100 cm» el cliente recibió literalmente
 * «...tiene un precio de *$» y nada más. Un mensaje partido en el precio es
 * peor que no contestar: parece una estafa a medio escribir.
 */
function respuestaCortada(t: string): boolean {
  const texto = String(t || '').trim();
  if (!texto) return true;
  // Termina en el símbolo de moneda o en una cifra a medio escribir. No se
  // mira la paridad de los asteriscos: el bot usa «* » como viñeta y daría
  // falsos positivos en cada propuesta de tres opciones.
  if (/[$*_]$/.test(texto)) return true;
  if (/\$\s?[\d.]{0,3}$/.test(texto)) return true;
  if (/\b(de|por|con|en|el|la|los|las|un|una|y|o|a)$/i.test(texto)) return true;
  // Guion, coma o dos puntos al final: la lista se quedó a medias. Visto el
  // 10-ago: «...te tengo estas opciones: * Cuaderno Argollado -» y ahí terminó.
  if (/[-–—,;:]$/.test(texto)) return true;
  return false;
}

/**
 * EL BOT QUE CONTESTA SOLO EL SALUDO — la causa, encontrada el 10-ago-2026.
 * ---------------------------------------------------------------------------
 * Estaba en la lista de pendientes como «reproducido, sin causa encontrada»: el
 * cliente escribía, el bot respondía «Hola, hablas con Oscar Herrera…» y nada
 * más, y había que mandarle un «?» para despertarlo.
 *
 * La causa estaba en el registro, a la vista: **`finishReason: "other"`**. El
 * proveedor avisa que la generación NO terminó de forma normal, y lo que llega
 * es un pedazo. A veces el pedazo se nota —«…50 esferos con el logo de tu
 * empresa:» y se acabó—, pero cuando lo poco que alcanzó a escribir fue el
 * saludo, el texto parece completo: termina en «?» y pasa todos los controles.
 * En una sola tanda de 15 pruebas apareció **4 veces**.
 *
 * Nadie miraba ese aviso. Ahora se mira: si la generación no terminó bien y lo
 * único que quedó es el saludo, se vuelve a pedir la respuesta.
 */
function seQuedoEnElSaludo(texto: string, saludo: string): boolean {
  const limpio = sinAcentos(String(texto || '').toLowerCase()).replace(/[^a-z0-9¿?]+/g, ' ').trim();
  const salu = sinAcentos(String(saludo || '').toLowerCase()).replace(/[^a-z0-9¿?]+/g, ' ').trim();
  if (!limpio) return true;
  const resto = salu ? limpio.replace(salu, '').trim() : limpio;
  return resto.length < 25;
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

/**
 * MULETILLAS DE TRES LETRAS.
 *
 * Hasta el 10-ago-2026 se descartaba TODA palabra de menos de 4 letras, y con
 * ella se iba **«mug»**, que es uno de los productos que más vende ZOOM. El
 * efecto medido en los registros de producción: el cliente escribía «20 mugs»,
 * el modelo buscaba «mug» —lo correcto— y el candado de «buscó otra cosa» lo
 * BLOQUEABA, porque al quitar las palabras cortas la consulta se quedaba sin
 * ninguna palabra que comparar. Dos intentos perdidos en cada mensaje de mugs.
 *
 * Ahora entran las de 3 letras y se descartan por lista, no por longitud.
 */
const MULETILLAS_CORTAS = new Set([
  'que', 'los', 'las', 'del', 'con', 'por', 'una', 'uno', 'sin', 'mas', 'muy',
  'son', 'sus', 'esa', 'ese', 'hay', 'para', 'pero', 'como', 'este', 'esta',
  'aca', 'ahi', 'asi', 'ver', 'dar', 'ser', 'tan', 'sea', 'les', 'nos', 'yo',
  'tu', 'el', 'la', 'lo', 'un', 'de', 'en', 'es', 'al', 'se', 'me', 'te', 'ya',
  'si', 'no', 'ok', 'oye', 'hoy', 'dia', 'vez', 'fin', 'don', 'sr', 'sra',
]);

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
    if (/^[0-9]+$/.test(w)) continue;
    if (PALABRAS_VACIAS.has(w) || MULETILLAS_CORTAS.has(w)) continue;
    if (w.length >= 3) out.add(w);
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
  historialCliente: string[] = [],
  orgId?: string
): Promise<{ relevant: any[]; total: number; hoja?: string }> {
  const texto = String(messageText || '');
  // Los avisos internos de media fallida no son una petición del cliente.
  if (texto.trim().startsWith('[El cliente envió')) return { relevant: [], total: 0 };

  /**
   * LA HOJA MANDA LA BÚSQUEDA. Nuevo el 10-ago-2026, y es el cambio de fondo.
   *
   * Hasta hoy el dueño escribía en el panel «busca en el catálogo con: cuaderno
   * 80 hojas» y «nunca busques con: agenda, grande, cosido» — y el sistema NO
   * usaba ni una ni otra para buscar: las convertía en texto y se las pegaba al
   * modelo como consejo, DESPUÉS de que la búsqueda ya había ocurrido. Le
   * decíamos con qué palabras buscar después de buscar.
   *
   * Ahora, si lo que escribió el cliente coincide con el vocabulario de una
   * hoja, la consulta la pone la hoja. Medido contra el buscador el mismo día:
   * «esfero» puntúa 0,650 y cuela una *Alcancía Esfera*; «boligrafo», 1,150 y
   * trae bolígrafos. La misma intención, un 77 % mejor encontrada.
   */
  if (orgId) {
    try {
      const cual = await hojaParaLoQueDijoElCliente(orgId, texto);
      const terminosDeLaHoja = comoSeBusca(cual?.hoja || null);
      if (cual && terminosDeLaHoja.length > 0) {
        for (const consulta of terminosDeLaHoja.slice(0, 2)) {
          const res: any = await runCatalogSearch(consulta, orgId);
          const matches: any[] = res?.matches || [];
          if (matches.length > 0) {
            logger.info('La hoja del panel mandó la búsqueda', {
              hoja: cual.hoja.nombre, dijoElCliente: cual.palabra,
              seBuscoCon: consulta, encontrados: matches.length,
            });
            return { relevant: matches, total: matches.length, hoja: cual.hoja.nombre };
          }
        }
      }
    } catch (err) {
      logger.warn('No se pudo usar la hoja para buscar; sigue el camino normal', {
        error: String(err),
      });
    }
  }

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

/** Frases con las que el bot niega tener una REFERENCIA concreta. */
const NIEGA_UNA_REFERENCIA =
  /(no encuentro|no la encuentro|no lo encuentro|no aparece|no est[áa] en (?:nuestro|mi|el) cat[áa]logo|no existe esa|no tengo esa|no manejamos esa|no tenemos esa|no la tengo|no lo tengo)/i;

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

    /**
     * Lo que el bot ya dijo antes, del más viejo al más nuevo. Es lo único que
     * hace falta para saber si se está trabando: no se guarda ningún contador.
     */
    const mensajesPreviosDelBot = [...(history || [])]
      .reverse()
      .filter((m: any) => m.direction !== 'inbound' && m.content)
      .map((m: any) => String(m.content));

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
    const catalogProbe = await probeCatalogo(messageText, historialCliente, orgId);

    /**
     * LA REFERENCIA QUE DIJO EL CLIENTE, RESUELTA COMO CÓDIGO Y ANTES DE TODO.
     *
     * Este rail borraba los códigos antes de poder usarlos: descarta las
     * palabras de menos de 4 letras y los números sueltos, así que de
     * «MU-303-1» no quedaba nada. El cliente pedía una referencia y el bot le
     * contestaba que no existe — comprobado el 10-ago: **existe, está activa**,
     * y está guardada como `MU-303-1.` con un punto de más que dejó el Excel.
     */
    const codigosPedidos = referenciasEnElTexto(messageText);
    let referenciasResueltas: any[] = [];
    if (codigosPedidos.length > 0) {
      const porCodigo = await buscarPorReferencia(codigosPedidos, orgId);
      referenciasResueltas = porCodigo;
      if (porCodigo.length > 0) {
        const yaEstan = new Set(
          catalogProbe.relevant.map((m: any) => String(m.product_id).toUpperCase())
        );
        catalogProbe.relevant = [
          ...porCodigo.filter((p: any) => !yaEstan.has(String(p.product_id).toUpperCase())),
          ...catalogProbe.relevant,
        ];
        logger.info('El cliente nombró una referencia y se resolvió exacta', {
          conversationId, pidio: codigosPedidos.join(','),
          encontro: porCodigo.map((p: any) => p.product_id).join(','),
        });
      } else {
        logger.info('El cliente nombró una referencia que no está en el catálogo', {
          conversationId, pidio: codigosPedidos.join(','),
        });
      }
    }
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

    // El código que escribió el cliente, ya resuelto, va aparte y arriba: en la
    // lista larga se perdía y el modelo terminaba buscando la palabra
    // «referencia» por su cuenta (medido el 10-ago). Es un dato, no una orden.
    if (referenciasResueltas.length > 0) {
      const resueltas = referenciasResueltas
        .map((p: any) =>
          `- El cliente escribió el código ${codigosPedidos[0]} y corresponde a este producto: ` +
          `product_id: ${p.product_id} | ${p.name}${p.has_pricing ? '' : ' | SIN TARIFA'}`
        )
        .join('\n');
      systemPromptFinal = `${systemPromptFinal}

## Referencia exacta que pidió el cliente (existe y está activa)
${resueltas}`;
    }

    // === BUQUE DE RECÁLCULO (obligar a usar la calculadora) ===
    // El bot genera respuesta → guardrail revisa → si bloquea, se le devuelve
    // una orden de recalcular → repite hasta 3 intentos. Escala en severidad.
    const MAX_RECALC_ATTEMPTS = 3;
    const RECALC_ORDERS: Record<string, string[]> = {
      'total-sin-calculadora': [
        'ALTO. El TOTAL que diste no lo calculó ninguna herramienta: lo sumaste tú, y por eso el mismo pedido da cifras distintas. Cuando el precio final es la SUMA de varias piezas (un producto base más sus adicionales), ejecuta buildQuote enviando SOLO qué lleva el pedido, sin una sola cifra, y responde con el total que devuelva.',
        'BLOQUEADO DE NUEVO. No sumes ni multipliques tú. Ejecuta buildQuote con la cantidad, la variante que eligió el cliente y la lista de piezas, y copia su total tal cual, sin recalcular.',
        'ÚLTIMO INTENTO. Ejecuta buildQuote AHORA y responde únicamente con el total que devuelva. Si buildQuote te pide un dato que falta, pregúntaselo al cliente en vez de inventarlo.',
      ],
      'precio-reciclado': [
        'ALTO. Le pusiste a un producto NUEVO las cifras de un producto que cotizaste antes en esta misma conversación. Cada producto tiene su propia tarifa. Ejecuta getProductPrice para CADA referencia que vas a nombrar, con la cantidad que pidió el cliente, y usa solo esas cifras.',
        'BLOQUEADO DE NUEVO. Ninguna cifra del historial sirve para un producto distinto. Calcula el precio de cada producto que menciones, uno por uno, en este turno.',
        'ÚLTIMO INTENTO. Ejecuta getProductPrice con cada product_id y responde únicamente con lo que devuelva. Si no puedes calcular alguno, no lo ofrezcas.',
      ],
      'nego-referencia-que-existe': [
        'ALTO. Le dijiste al cliente que esa referencia no existe y SÍ existe: {REFERENCIAS}. Úsala tal cual, ejecuta getProductPrice con ese product_id y la cantidad que pidió, y dale el precio. PROHIBIDO repetir que no la encuentras.',
        'BLOQUEADO DE NUEVO. El producto es {REFERENCIAS}. Cotízalo con getProductPrice y responde con su precio.',
        'ÚLTIMO INTENTO. Usa exactamente este product_id: {REFERENCIAS}. Ejecuta getProductPrice y entrega el precio.',
      ],
      'solo-el-saludo': [
        'Solo escribiste el saludo y el cliente se quedó sin respuesta. Contéstale lo que preguntó, en un mensaje corto y completo: si pidió productos, búscalos y dale las 3 opciones con su precio; si preguntó algo puntual, respóndelo.',
        'Otra vez te quedaste en el saludo. NO saludes: ve directo a lo que el cliente preguntó, con precios si pidió precios.',
        'ÚLTIMO INTENTO. Sin saludo. Una respuesta corta y completa a lo que el cliente acaba de escribir.',
      ],
      'respuesta-cortada': [
        'Tu mensaje salió cortado a la mitad, justo en el precio, y así no se le puede enviar al cliente. Vuelve a escribir la respuesta COMPLETA, terminando la frase y con todas las cifras.',
        'Otra vez quedó a medias. Escribe el mensaje entero de una sola vez, corto y cerrado, con el precio completo.',
        'ÚLTIMO INTENTO. Un mensaje breve, completo y con la cifra entera. No lo dejes a medias.',
      ],
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
      'servicio-sin-tarifa': [
        'ALTO. Le estás pidiendo al cliente datos de una marcación (técnica, tintas, tamaño del logo) que NO sabemos cotizar: searchCatalog no devolvió ningún servicio de marcación para este producto. No le pidas ni uno de esos datos. Dile en UNA línea que la marcación se cotiza aparte y que se la confirmas, y ofrécele los adicionales que SÍ existen para este producto —búscalos con searchCatalog y cotízalos con getProductPrice— con su precio.',
        'BLOQUEADO DE NUEVO. Nada de técnicas, tintas ni tamaños de logo. Ofrece únicamente los adicionales que devuelva searchCatalog para este producto, con su precio, y una sola línea diciendo que la marcación la confirmas aparte.',
        'ÚLTIMO INTENTO. Responde sin pedir un solo dato de marcación: los adicionales que existen con su precio, y una línea diciendo que la marcación la confirmas con el equipo.',
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
    // Y de qué se hablaba ANTES: es lo único que distingue «siguió con lo de
    // antes» —el fallo real— de «tradujo la jerga del cliente», que es un
    // acierto y hasta hoy se castigaba igual.
    const palabrasPreviasDelCliente = new Set<string>();
    for (const previo of historialCliente) {
      for (const w of palabrasDeContenido(previo)) {
        if (!palabrasPedidas.has(w)) palabrasPreviasDelCliente.add(w);
      }
    }
    // Referencias que ya se cotizaron en esta conversación: una cifra vieja solo
    // vale si va con el producto con el que se aprobó.
    const yaCotizadas = referenciasYaCotizadas(messages);
    // Cuando el bot buscó fuera de tema, preguntar deja de ser una falta: es
    // justo lo que le estamos pidiendo. Sin esto, el candado del interrogatorio
    // volvería a empujarlo a cotizar lo primero que tenga a mano.
    let permitirPreguntar = false;
    /**
     * Tras bloquear por pedir datos de una marcación que no sabemos cotizar, la
     * orden que se le da al modelo es «ofrece los adicionales que SÍ existen».
     * Buscar «inserto» o «filtro uv» cuando el cliente escribió «¿vienen
     * marcados?» dispararía el candado de «buscó otra cosa» — y se vio pasar:
     * los dos candados se peleaban, se agotaban los tres intentos y el cliente
     * recibía la respuesta de respaldo en vez de los adicionales con su precio.
     *
     * Con esta bandera, después de ese bloqueo el candado de tema se calla: lo
     * que el modelo está buscando es exactamente lo que se le mandó buscar.
     */
    let buscandoAdicionales = false;

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
          searchCatalog: searchCatalogTool(toolContext),
          getProductPrice: getProductPriceTool(),
          saveContactInfo: saveContactInfoTool(toolContext),
          queryKnowledgeBase: queryKnowledgeBaseTool(toolContext),
          requestHumanHandoff: requestHumanHandoffTool(toolContext),
          calculateCustomPrice: calculateCustomPriceTool(),
          buildQuote: buildQuoteTool(),
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

      // Una política de marcación que nadie escribió en el panel se cae, igual
      // que se cae una frase donde el bot se declara IA. Sin gastar intentos.
      const marcacion = quitarPoliticaInventada(cleanedResponse, result.steps || []);
      if (marcacion.hit) {
        cleanedResponse = marcacion.text;
        logger.warn('GUARDRAIL: se quitó una política de marcación que ninguna hoja respalda', {
          orgId, conversationId,
        });
      }

      // Revisar con el guardrail
      let guardrailResult = await applyOutputGuardrail(
        cleanedResponse, result.steps || [], permitirPreguntar ? 0 : questionStreak,
        approvedPrices, catalogProbe.relevant, fraseOfftopic,
        buscandoAdicionales ? new Set<string>() : palabrasPedidas,
        palabrasPreviasDelCliente, yaCotizadas, referenciasResueltas
      );

      // Un mensaje partido a la mitad del precio no puede salir jamás. Va
      // después del resto para no tapar una causa más informativa.
      const razonDeCorte = (result as any).finishReason;
      // El proveedor avisa que la generación no terminó bien. Si además el
      // texto no cierra con puntuación, es un pedazo: no puede salir así.
      const noCierra = !/[.!?…)\]»"'*]$/.test(cleanedResponse.trim());
      const seCortoAMedias =
        (razonDeCorte === 'other' || razonDeCorte === 'length') && noCierra;

      if (!guardrailResult.blocked && (respuestaCortada(cleanedResponse) || seCortoAMedias)) {
        logger.error('GUARDRAIL: la respuesta salió cortada a mitad de frase', {
          orgId, conversationId, finishReason: razonDeCorte, final: cleanedResponse.slice(-60),
        });
        guardrailResult = { blocked: true, reason: 'respuesta-cortada' };
      } else if (
        !guardrailResult.blocked &&
        palabrasPedidas.size > 0 &&
        seQuedoEnElSaludo(cleanedResponse, persona.greeting)
      ) {
        // No se exige que la generación viniera marcada como truncada: a veces
        // llega como terminada y aun así el bot solo saludó. Lo que decide es
        // el hecho — el cliente preguntó algo concreto y no recibió respuesta.
        logger.error('GUARDRAIL: el cliente preguntó y el bot solo saludó', {
          orgId, conversationId, finishReason: razonDeCorte, dijo: cleanedResponse.slice(0, 90),
        });
        guardrailResult = { blocked: true, reason: 'solo-el-saludo' };
      }

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
        finalResponse = unificarInsertos(formatPricesForColombia(cleanedResponse));
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
      if (guardrailResult.reason === 'servicio-sin-tarifa') buscandoAdicionales = true;

      const orders = RECALC_ORDERS[guardrailResult.reason] || RECALC_ORDERS['no-calculator'];
      const orderText = (orders[attempt] || orders[orders.length - 1])
        .replace('{PRODUCTOS}', catalogListado || 'los que devuelva searchCatalog')
        .replace('{BUSCADO}', consultasDeCatalogo(result.steps || []).join(' / ') || 'otra cosa')
        .replace('{PEDIDO}', messageText.trim().slice(0, 200))
        .replace(
          '{REFERENCIAS}',
          referenciasResueltas.map((p: any) => `${p.product_id} (${p.name})`).join(', ') ||
            'la que devolvió searchCatalog'
        );
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
        // Los textos viven en request-human-handoff.ts: la frase que se entrega
        // y la que detecta que el bot se trabó tienen que ser LA MISMA.
        finalResponse = permitirPreguntar ? RESPALDO_PREGUNTAR : RESPALDO_COTIZAR;

        /**
         * Salvo si lo único que falló fue el corte. Ahí hay una respuesta buena
         * hasta donde llegó, y tirarla para poner una frase de espera es peor:
         * el cliente ya tenía sus tres opciones y sus precios. Se recorta a la
         * última frase cerrada y se entrega, si lo que queda sirve.
         */
        if (guardrailResult.reason === 'respuesta-cortada') {
          const frases = cleanedResponse.split(/(?<=[.!?])\s+|\n+/);
          while (frases.length > 0 && respuestaCortada(frases.join(' '))) frases.pop();
          const recortada = frases.join(' ').replace(/\s{2,}/g, ' ').trim();
          if (recortada.length >= 40 && respuestaSirve(recortada) && !respuestaCortada(recortada)) {
            logger.warn('Respuesta cortada: se entrega recortada a la última frase completa', {
              orgId, conversationId, quedo: recortada.length,
            });
            finalResponse = formatPricesForColombia(recortada);
          }
        }
      }
    }

    /**
     * SI EL BOT NO AVANZA DOS TURNOS SEGUIDOS, QUE LO TOME UNA PERSONA.
     *
     * Va ANTES de mover la tarjeta a propósito. Si aquí se traspasa, la etapa
     * queda en «Sin Atender» —puesta por el sistema en nombre de una persona— y
     * `moverEtapaSiAvanza` se niega a tocarla. El orden es la garantía: al
     * revés, un turno trabado que igual soltó un precio se iría a «Ventas».
     *
     * El cliente ya recibió su respuesta; esto no la cambia. Solo apaga el bot,
     * mueve la conversación a «Sin Atender» y la hace sonar en la campana.
     */
    try {
      if (elBotNoAvanza({ respuesta: finalResponse, mensajesPreviosDelBot })) {
        const traspaso: any = await ejecutarTraspasoAHumano(toolContext, {
          reason: 'El bot no avanzó dos turnos seguidos: se repitió o no supo qué contestar',
          urgency: 'medium',
        });
        logger.warn('El bot no avanza: la conversación pasa a «Sin Atender»', {
          orgId, conversationId, contactId, traspasado: !!traspaso?.success,
        });
      }
    } catch (errTrabado) {
      // Que falle esto no puede dejar al cliente sin su respuesta.
      logger.error('No se pudo traspasar una conversación trabada', {
        error: String(errTrabado), orgId, conversationId,
      });
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
    return RESPALDO_ERROR;
  }
}
