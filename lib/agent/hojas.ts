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
  buscar_como: string;
  nunca_buscar: string;
  adicionales: string;
  marcacion: string;
  marcacion_nota: string;
  notas: string;
}

type Cache = {
  hasta: number;
  porNombreDeCategoria: Map<string, HojaDeCategoria>;
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
  const vacio: Cache = { hasta: Date.now() + DURACION_CACHE_MS, porNombreDeCategoria: new Map(), general: null };
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
    let general: HojaDeCategoria | null = null;

    for (const hoja of hojas) {
      if (hoja?.general) {
        general = hoja;
        continue;
      }
      for (const id of hoja?.categorias || []) {
        const nombre = nombrePorId.get(String(id));
        if (nombre) porNombre.set(normalizar(nombre), hoja);
      }
    }

    return { hasta: Date.now() + DURACION_CACHE_MS, porNombreDeCategoria: porNombre, general };
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
 * Arma el texto que ve el modelo. Lo que el dueño dejó vacío NO aparece: no se
 * rellena con un ejemplo, porque un ejemplo puesto para que no quede vacío se
 * convierte en una mentira dicha con total seguridad (la regla de DEFAULT_PERSONA).
 */
export function textoDeHoja(hoja: HojaDeCategoria | null): string {
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
  agregar('Se le puede sumar', hoja.adicionales);

  if (hoja.marcacion === 'incluida') {
    lineas.push(
      '- La marcación del logo YA ESTÁ INCLUIDA en el precio de este producto: ' +
        'NO preguntes técnica, ni número de tintas, ni tamaño del logo. Confírmalo y sigue.'
    );
  } else if (hoja.marcacion === 'aparte') {
    lineas.push('- La marcación del logo se cotiza APARTE de este producto.');
  } else if (hoja.marcacion === 'no_aplica') {
    lineas.push('- Este producto NO lleva marcación.');
  }
  agregar('Sobre la marcación', hoja.marcacion_nota);
  agregar('Ten en cuenta', hoja.notas);

  if (lineas.length === 0) return '';

  return (
    `GUÍA DE VENTA de "${hoja.nombre}" (la escribió el dueño del negocio en el panel; ` +
    `es la fuente oficial para esta categoría):\n${lineas.join('\n')}`
  );
}
