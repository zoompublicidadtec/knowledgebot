import { createAdminClient } from '../supabase/admin';
import { logger } from '../logger';

/**
 * LAS HOJAS DE CATEGORÍA, del lado del bot.
 *
 * La hoja la escribe el dueño en el panel (Conocimiento → Hojas de categoría) y
 * dice qué hace falta para cotizar esa familia de productos y cómo pedírselo al
 * cliente sin interrogarlo.
 *
 * DÓNDE ENTRA. Se le adjunta a cada producto que devuelve `searchCatalog`, en el
 * campo `guia_de_venta`. Es **dato de recuperación**, no una instrucción metida
 * en el prompt: es la R de RAG, exactamente lo que la regla del proyecto pide
 * (los guardrails obligan, el prompt no crece).
 *
 * Y llena un hueco que llevaba meses vacío: hasta el 03-ago-2026 el prompt le
 * ordenaba DOS VECES al bot obedecer las `instrucciones_venta` de cada producto,
 * y ese campo **no existía** — ni columna ni respuesta del buscador. Se le
 * mandaba obedecer un papel que nunca llegaba, que es justo el escenario que lo
 * hace inventar. Este es el papel.
 *
 * CACHÉ CORTA. 60 segundos. Sin ella, cada búsqueda haría dos consultas más a la
 * base; con ella, el dueño ve el efecto de lo que guarda en menos de un minuto.
 */

export interface HojaDeCategoria {
  id: string;
  nombre: string;
  categorias: string[];
  general?: boolean;
  preguntar: string;
  no_preguntar: string;
  como_preguntar: string;
  /**
   * CÓMO LO LLAMA EL CLIENTE. Campo nuevo del 10-ago-2026, y el que cierra el
   * circuito: sin él, la hoja solo se podía encontrar DESPUÉS de buscar, por la
   * categoría del producto ya hallado. Con él, la hoja se encuentra por las
   * palabras que el cliente escribió, ANTES de buscar, y su `buscar_como` pasa
   * a mandar la consulta.
   *
   * Medido el 10-ago contra el buscador de producción: «esfero» puntúa 0,650 y
   * cuela una *Alcancía Esfera*; «boligrafo» puntúa 1,150 y trae bolígrafos.
   * La misma intención, un 77 % mejor encontrada con la palabra del catálogo.
   */
  dice_el_cliente: string;
  buscar_como: string;
  nunca_buscar: string;
  adicionales: string;
  marcacion: string;
  marcacion_nota: string;
  notas: string;
  /**
   * LA VENTA CRUZADA. Los dos campos del 11-ago-2026. Ver `venta-cruzada.ts`
   * para el porqué del diseño; aquí solo viven los datos que escribe el dueño.
   *
   * `ofrecer_al_cerrar` es la REFERENCIA del producto (el panel la guarda al
   * elegirlo de la lista, para que no haya dos candidatos posibles), y
   * `frase_al_cerrar` es la frase con la que se ofrece, en las palabras del
   * dueño, con {precio} o {total} donde va la cifra que calcula el código.
   *
   * Vacíos = no hay venta cruzada para esta familia, y el bot se comporta
   * exactamente como antes.
   */
  ofrecer_al_cerrar: string;
  frase_al_cerrar: string;
}

/** «Mugs Mágicos» y «mug magico» tienen que ser la misma palabra. */
function terminos(campo: string | null | undefined): string[] {
  return String(campo || '')
    .split(/[,;\n·|]|\s-\s/)
    .map((t) => normalizar(t))
    .filter((t) => t.length >= 3);
}

type Cache = {
  hasta: number;
  porNombreDeCategoria: Map<string, HojaDeCategoria>;
  /** palabra que usa el cliente -> hoja. Se arma con `dice_el_cliente`. */
  porPalabraDelCliente: Map<string, HojaDeCategoria>;
  general: HojaDeCategoria | null;
};

let cache: Cache | null = null;
const DURACION_CACHE_MS = 60 * 1000;

/** Quita tildes y baja a minúsculas, para que «Bolígrafos» encuentre «boligrafos». */
function normalizar(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

async function cargar(orgId: string): Promise<Cache> {
  const vacio: Cache = {
    hasta: Date.now() + DURACION_CACHE_MS,
    porNombreDeCategoria: new Map(),
    porPalabraDelCliente: new Map(),
    general: null,
  };
  try {
    const supabase = createAdminClient();

    const { data: config } = await (supabase as any)
      .from('agent_configs')
      .select('metadata')
      .eq('organization_id', orgId)
      .single();

    const hojas: HojaDeCategoria[] = Array.isArray((config?.metadata as any)?.hojas)
      ? (config!.metadata as any).hojas
      : [];
    if (hojas.length === 0) return vacio;

    const { data: cats } = await (supabase as any).from('categories').select('id, name');
    const nombrePorId = new Map<string, string>();
    for (const c of cats || []) nombrePorId.set(String(c.id), String(c.name || ''));

    const porNombre = new Map<string, HojaDeCategoria>();
    const porPalabra = new Map<string, HojaDeCategoria>();
    let general: HojaDeCategoria | null = null;

    for (const hoja of hojas) {
      // El vocabulario del cliente vale también para la hoja general: sirve
      // para traducir aunque la hoja no reclame ninguna categoría.
      // MANDA LA PRIMERA, igual que con las categorías: la hoja más nueva.
      for (const palabra of terminos(hoja?.dice_el_cliente)) {
        if (!porPalabra.has(palabra)) porPalabra.set(palabra, hoja);
      }
      if (hoja?.general) {
        general = hoja;
        continue;
      }
      for (const id of hoja?.categorias || []) {
        const nombre = nombrePorId.get(String(id));
        // MANDA LA MAS NUEVA. Las hojas nuevas se agregan al principio de la
        // lista, asi que la primera que reclame una categoria se queda con ella.
        // Antes ganaba la ultima del recorrido -o sea la mas VIEJA-, y el dueño
        // podia escribir una hoja entera, guardarla y no ver ningun efecto.
        if (!nombre) continue;
        const clave = normalizar(nombre);
        if (!porNombre.has(clave)) porNombre.set(clave, hoja);
      }
    }

    return {
      hasta: Date.now() + DURACION_CACHE_MS,
      porNombreDeCategoria: porNombre,
      porPalabraDelCliente: porPalabra,
      general,
    };
  } catch (err) {
    logger.warn('hojas: no se pudieron cargar, el bot sigue sin ellas', { error: String(err) });
    return vacio;
  }
}

/** Invalida la caché: el dueño acaba de guardar y quiere ver el efecto ya. */
export function olvidarHojas(): void {
  cache = null;
}

/**
 * Devuelve la hoja que le toca a una categoría, o la general si no tiene propia.
 * Sin hojas cargadas devuelve null y el bot se comporta exactamente como antes.
 */
export async function hojaDeCategoria(
  orgId: string,
  nombreDeCategoria: string | null | undefined
): Promise<HojaDeCategoria | null> {
  if (!orgId) return null;
  if (!cache || cache.hasta < Date.now()) cache = await cargar(orgId);

  const propia = cache.porNombreDeCategoria.get(normalizar(nombreDeCategoria || ''));
  return propia || cache.general || null;
}

/**
 * LA HOJA QUE LE TOCA A UN PRODUCTO ENCONTRADO — y por qué no basta con su
 * categoría.
 *
 * EL FALLO SILENCIOSO QUE ESTO CIERRA, medido el 11-ago-2026. De las 12 hojas
 * cargadas en el panel, **11 no tienen ninguna categoría marcada**: se
 * sembraron con el vocabulario del cliente, que es lo que traduce la búsqueda,
 * y eso funciona. Pero la guía de venta se le pegaba al producto mirando SOLO
 * su categoría, así que el dueño podía llenar entera la hoja de «Mugs y
 * pocillos» —qué preguntar, si la marcación va incluida— y **no pasaba nada**.
 * Escribir y no ver ningún efecto es lo que hace que se deje de usar el panel.
 *
 * Y no se arregla pidiéndole que marque las categorías, porque el catálogo no
 * está ordenado así. Medido el mismo día: los mugs activos viven en cuatro
 * categorías distintas —«MUGS, BOTILITOS, VASOS Y TERMOS» (43), «HOGAR» (36),
 * «Mugs» (6) y «ECO NATURE» (4)—, las gorras en otras cuatro y los bolígrafos
 * en cuatro más. Nadie puede mantener eso a mano.
 *
 * ORDEN DE PRIORIDAD, y es a propósito:
 *  1. La categoría, si el dueño le marcó una hoja: es lo que dijo EXPLÍCITAMENTE.
 *  2. Lo que pidió el cliente: pidió mugs, se le aplica la hoja de mugs.
 *  3. La hoja general.
 */
export async function hojaParaEsteProducto(
  orgId: string,
  nombreDeCategoria: string | null | undefined,
  textoDelCliente: string
): Promise<HojaDeCategoria | null> {
  if (!orgId) return null;
  if (!cache || cache.hasta < Date.now()) cache = await cargar(orgId);

  const propia = cache.porNombreDeCategoria.get(normalizar(nombreDeCategoria || ''));
  if (propia) return propia;

  const porLoQuePidio = await hojaParaLoQueDijoElCliente(orgId, textoDelCliente);
  if (porLoQuePidio) return porLoQuePidio.hoja;

  return cache.general || null;
}

/**
 * LA HOJA QUE LE TOCA A LO QUE ESCRIBIÓ EL CLIENTE — el circuito al revés.
 *
 * `hojaDeCategoria` encuentra la hoja por la categoría de un producto que YA se
 * encontró: llega tarde, y si la búsqueda trajo lo que no era, la guía llega
 * pegada al producto equivocado. Esta busca la hoja por las palabras del
 * cliente, ANTES de buscar, para que su `buscar_como` mande la consulta.
 *
 * Devuelve también qué palabra del cliente hizo la coincidencia, porque el
 * candado de «buscó otra cosa» la necesita para no castigar una traducción
 * correcta (medido el 10-ago: el modelo tradujo «esferos» a «boligrafo» y el
 * candado lo bloqueó por buscar «algo distinto de lo que pidió el cliente»).
 */
export async function hojaParaLoQueDijoElCliente(
  orgId: string,
  texto: string
): Promise<{ hoja: HojaDeCategoria; palabra: string } | null> {
  if (!orgId || !texto) return null;
  if (!cache || cache.hasta < Date.now()) cache = await cargar(orgId);
  if (cache.porPalabraDelCliente.size === 0) return null;

  const plano = normalizar(texto).replace(/[^a-z0-9ñ]+/g, ' ');

  // Gana la coincidencia MÁS LARGA: «mug que cambia de color» tiene que ganarle
  // a «mug» a secas, o la traducción se queda a medias y vuelve el fallo.
  let mejor: { hoja: HojaDeCategoria; palabra: string } | null = null;
  for (const [palabra, hoja] of cache.porPalabraDelCliente) {
    const suelta = new RegExp(`(^| )${palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(es|s)?( |$)`);
    if (!suelta.test(plano)) continue;
    if (!mejor || palabra.length > mejor.palabra.length) mejor = { hoja, palabra };
  }
  return mejor;
}

/**
 * TODAS las familias que el cliente nombró en un mismo mensaje.
 *
 * «Me interesa el botilito, pero también mándame fotos de gorras de dril» son
 * DOS cosas, y el bot atendía una y se olvidaba de la otra — no siempre, que es
 * lo peor: en cinco tandas de prueba falló una. Con esto el sistema sabe
 * cuántas familias hay sobre la mesa y puede exigir que estén todas.
 *
 * Solo devuelve más de una cuando el mensaje **suma** («y», «también»,
 * «además», «aparte»). Sin esa señal, «no quiero mugs, quiero gorras» nombra
 * dos familias y pide una sola.
 */
const SUMA_DOS_COSAS = /(\by\b|tambi[ée]n|adem[áa]s|aparte|de paso|igualmente|otra cosa)/i;

export async function familiasQuePidioElCliente(
  orgId: string | undefined,
  texto: string
): Promise<{ nombre: string; palabras: string[] }[]> {
  if (!orgId || !texto || !SUMA_DOS_COSAS.test(texto)) return [];
  if (!cache || cache.hasta < Date.now()) cache = await cargar(orgId);
  if (cache.porPalabraDelCliente.size === 0) return [];

  const plano = normalizar(texto).replace(/[^a-z0-9ñ]+/g, ' ');
  const porHoja = new Map<string, { nombre: string; palabras: string[] }>();

  for (const [palabra, hoja] of cache.porPalabraDelCliente) {
    const suelta = new RegExp(`(^| )${palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(es|s)?( |$)`);
    if (!suelta.test(plano)) continue;
    const clave = hoja.nombre || hoja.id;
    if (!porHoja.has(clave)) {
      porHoja.set(clave, {
        nombre: hoja.nombre,
        // Con cualquiera de estas palabras basta para dar la familia por
        // atendida en la respuesta: el nombre con que se busca y el que usa
        // el cliente.
        palabras: [...comoSeBusca(hoja), ...terminos(hoja.dice_el_cliente)].filter(Boolean),
      });
    }
  }

  const familias = [...porHoja.values()];
  return familias.length >= 2 ? familias : [];
}

/**
 * LOS EXTRAS DE LA FAMILIA QUE PIDIÓ EL CLIENTE.
 *
 * Los necesita el candado que impide ofrecerlos antes de cerrar la venta. Sale
 * de la hoja y no de una lista escrita en el código: cada negocio tiene los
 * suyos y el dueño los cambia desde el panel.
 */
export async function extrasDeLoQuePidio(
  orgId: string | undefined,
  texto: string
): Promise<string[]> {
  if (!orgId || !texto) return [];
  const cual = await hojaParaLoQueDijoElCliente(orgId, texto);
  return cual ? terminos(cual.hoja.adicionales) : [];
}

/** Con qué palabras hay que buscar esta familia. Vacío = el dueño no lo escribió. */
export function comoSeBusca(hoja: HojaDeCategoria | null): string[] {
  return hoja ? terminos(hoja.buscar_como) : [];
}

/** Palabras que NUNCA pueden entrar a una búsqueda de esta familia. */
export function loQueNuncaSeBusca(hoja: HojaDeCategoria | null): string[] {
  return hoja ? terminos(hoja.nunca_buscar) : [];
}

/**
 * TRADUCE UNA CONSULTA ANTES DE QUE SALGA HACIA EL CATÁLOGO.
 *
 * Sustituye SOLO la palabra del cliente por la del catálogo y deja el resto de
 * la frase intacta. Esa precisión importa: medido el 10-ago, «gorra de dril»
 * puntúa 2,97 y «gorra» a secas 2,79 — si al traducir se perdiera el «dril»,
 * arreglaríamos el sinónimo y romperíamos la búsqueda específica.
 *
 * Y quita las palabras que el dueño marcó como inexistentes en su catálogo.
 *
 * Se aplica también a lo que busca el MODELO por su cuenta. Sin eso el arreglo
 * queda a medias, y está medido: con la hoja puesta, el sistema buscó
 * «boligrafo» y trajo bolígrafos, pero el modelo buscó «esferos» por su lado,
 * se trajo una *Alcancía Esfera* y fue la que le ofreció al cliente.
 */
export async function traducirConsulta(
  orgId: string | undefined,
  consulta: string
): Promise<{ consulta: string; hoja: string | null; cambio: boolean }> {
  const original = String(consulta || '');
  if (!orgId || !original.trim()) return { consulta: original, hoja: null, cambio: false };

  try {
    const cual = await hojaParaLoQueDijoElCliente(orgId, original);
    if (!cual) return { consulta: original, hoja: null, cambio: false };

    let salida = original;
    const destino = comoSeBusca(cual.hoja)[0] || '';

    // 1. La palabra del cliente pasa a ser la del catálogo, en su mismo sitio.
    if (destino && normalizar(cual.palabra) !== normalizar(destino)) {
      const escapada = cual.palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const conPlural = new RegExp(`(^|\\s)${escapada}(es|s)?(?=\\s|$)`, 'i');
      salida = sinAcentos(salida).replace(conPlural, `$1${destino}`);
    }

    // 2. Fuera las palabras que no existen en el catálogo de este negocio.
    for (const veto of loQueNuncaSeBusca(cual.hoja)) {
      const escapada = veto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      salida = salida.replace(new RegExp(`(^|\\s)${escapada}(es|s)?(?=\\s|$)`, 'ig'), ' ');
    }

    salida = salida.replace(/\s{2,}/g, ' ').trim();
    if (!salida) salida = destino || original;

    return {
      consulta: salida,
      hoja: cual.hoja.nombre,
      cambio: normalizar(salida) !== normalizar(original),
    };
  } catch {
    return { consulta: original, hoja: null, cambio: false };
  }
}

/** Quita tildes sin tocar el resto, para comparar y sustituir. */
function sinAcentos(s: string): string {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Arma el texto que ve el modelo. Lo que el dueño dejó vacío NO aparece: no se
 * rellena con un ejemplo, porque un ejemplo puesto para que no quede vacío se
 * convierte en una mentira dicha con total seguridad (la regla de DEFAULT_PERSONA).
 */
/** Cómo pide un cliente que le sumen algo, sin nombrarlo. */
const PIDE_AGREGAR =
  /(agregar|agregarle|agreg[aá]|sumar|sumarle|a[ñn]adir|adicional|adicionales|\bextras?\b|incluir|incluye|que mas le|qu[eé] m[aá]s le|personaliz)/i;

export function textoDeHoja(hoja: HojaDeCategoria | null, loQuePidioElCliente?: string): string {
  if (!hoja) return '';
  const lineas: string[] = [];

  const agregar = (etiqueta: string, valor: string) => {
    const v = String(valor || '').trim();
    if (v) lineas.push(`- ${etiqueta}: ${v}`);
  };

  agregar('Para cotizar necesitas saber', hoja.preguntar);
  agregar('Pídeselo al cliente así', hoja.como_preguntar);
  agregar('NO le preguntes', hoja.no_preguntar);
  agregar('Busca en el catálogo con', hoja.buscar_como);
  agregar('NUNCA busques con estas palabras (no existen en el catálogo)', hoja.nunca_buscar);
  /**
   * LA LISTA DE EXTRAS SOLO SE ENTREGA CUANDO VIENE A CUENTO.
   *
   * Escrita siempre —«Se le puede sumar: insertos - filtro uv - guardas»— el
   * modelo la leía como una orden de ofrecerlos y cerraba la cotización con
   * «¿Te gustaría agregarle insertos, filtro UV o guardas?»: una lista, sin
   * precio, con palabras que el cliente no entiende y ANTES de cerrar la venta.
   * Las cuatro cosas que el dueño prohibió.
   *
   * Reescribirlo como orden («no los ofrezcas») NO funcionó — medido el
   * 11-ago-2026, los siguió enumerando. Es la Regla 1 del proyecto por séptima
   * vez: lo que obliga es el código. Así que la lista no se le entrega si el
   * cliente no la nombró ni preguntó por agregar algo. Lo que no está delante
   * no se puede ofrecer.
   *
   * Ofrecer es ahora trabajo del código, después del cierre y con el precio ya
   * hecho: ver `venta-cruzada.ts`.
   */
  const extras = String(hoja.adicionales || '').trim();
  if (extras) {
    const dijo = normalizar(loQuePidioElCliente || '');
    const nombraUnExtra = terminos(extras).some((t) => dijo.includes(t));
    const preguntaPorSumar = PIDE_AGREGAR.test(dijo);
    if (nombraUnExtra || preguntaPorSumar) {
      lineas.push(`- Estos extras existen y tienen precio: ${extras}.`);
    }
  }

  if (hoja.marcacion === 'incluida') {
    lineas.push(
      '- INCLUIDO EN EL PRECIO: lo que se imprima en el producto (logo, diseño, foto, ' +
        'personaje). Si el cliente pregunta, confírmaselo CON TUS PROPIAS PALABRAS y sigue ' +
        'cotizando. NO preguntes técnica, ni número de tintas, ni tamaño. NUNCA le leas ' +
        'esta línea al cliente.'
    );
  } else if (hoja.marcacion === 'aparte') {
    lineas.push('- SE COTIZA APARTE lo que se imprima en el producto (logo, diseño, foto). Díselo con tus palabras.');
  } else if (hoja.marcacion === 'no_aplica') {
    lineas.push('- NO SE IMPRIME NADA en este producto: no se marca ni se personaliza. Díselo con tus palabras.');
  }
  agregar('Sobre lo que se imprime', hoja.marcacion_nota);
  agregar('Ten en cuenta', hoja.notas);

  if (lineas.length === 0) return '';

  return (
    `GUÍA DE VENTA de "${hoja.nombre}" (la escribió el dueño del negocio en el panel; ` +
    `es la fuente oficial para esta categoría):\n${lineas.join('\n')}`
  );
}
