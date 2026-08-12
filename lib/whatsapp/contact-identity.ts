/**
 * Identidad del contacto: una persona, una ficha.
 *
 * EL FALLO QUE ESTO CIERRA
 * ------------------------
 * `webhook-processor` buscaba y guardaba el contacto por `wa_phone` tal como
 * lo entregaba el puente, sin canonizar. Cada puente nombra al mismo cliente
 * distinto, así que la misma persona terminaba con varias fichas y el bot
 * perdía su historial.
 *
 * Medido en producción el 2026-07-30 sobre 13 contactos:
 *   - `victor ramirez` tenía TRES fichas: `18129…961` sin sufijo y
 *     `18129…961@lid` — las dos en linea_1 — más `57301…403@c.us`.
 *   - `VRS Digital` tenía DOS: `87252…039` sin sufijo y `87252…039@lid`.
 *   - Reparto de sufijos: 6 `@lid`, 5 sin sufijo, 2 `@c.us`.
 *
 * Y Baileys añade un cuarto formato, `@s.whatsapp.net`, así que sin esta
 * compuerta migrar una línea duplicaba a todos sus clientes.
 *
 * CRITERIO
 * --------
 * Dos identificadores son la misma persona si comparten los dígitos. El
 * sufijo solo dice por qué puerta entró el mensaje:
 *
 *   573001112233        \
 *   573001112233@c.us    >  la misma persona
 *   573001112233@s.whatsapp.net
 *
 * Los `@lid` son identificadores internos de WhatsApp de 14-15 dígitos, no
 * teléfonos, así que NO se pueden emparejar con un teléfono por su valor: de
 * `18129…961@lid` no se deduce `57301…403`. Se comparan por dígitos igual que
 * los demás, lo que une `…961@lid` con `…961` a secas, y se deja quieto lo
 * que no se puede demostrar.
 *
 * LO QUE ESTO NO HACE
 * -------------------
 * No cambia el valor guardado en `wa_phone`. El identificador completo, con
 * su sufijo, es lo que los puentes necesitan para ENVIAR (a un `@lid` no se
 * le puede escribir como si fuera un teléfono), así que se conserva. Aquí
 * solo se resuelve a QUIÉN pertenece un mensaje entrante.
 */

/** Dígitos de un identificador de WhatsApp, sin sufijo, signos ni sufijo de dispositivo. */
export function waDigits(waId: string | null | undefined): string {
  const raw = String(waId || '').trim();
  if (!raw) return '';
  // Se corta en la arroba y en los dos puntos del dispositivo (`:12@…`).
  const user = raw.split('@')[0].split(':')[0];
  return user.replace(/\D/g, '');
}

/**
 * Dominios de WhatsApp que pertenecen a una PERSONA:
 *
 *   - `s.whatsapp.net` — teléfono, la forma normal de Baileys
 *   - `c.us`           — la misma persona vista por whatsapp-web.js
 *   - `lid`            — persona que oculta su teléfono (privacidad)
 */
const DOMINIOS_DE_PERSONA = new Set(['s.whatsapp.net', 'c.us', 'lid']);

/** El sufijo de un identificador de WhatsApp, en minúsculas y sin la arroba. */
export function dominioWa(waId: string | null | undefined): string {
  const raw = String(waId || '').trim();
  const idx = raw.lastIndexOf('@');
  return idx === -1 ? '' : raw.slice(idx + 1).toLowerCase();
}

/**
 * ¿Este identificador es una PERSONA a la que se le puede vender?
 *
 * EL FALLO QUE ESTO CIERRA
 * ------------------------
 * El 02-ago-2026 entró `120363315571514607@newsletter` —un canal de WhatsApp,
 * no una persona— y el CRM le abrió ficha SIN NOMBRE y conversación en
 * `linea_3`: 1 mensaje, 0 respuestas. En el panel se veía como un cliente más,
 * y el dueño no tenía forma de saber que no lo era.
 *
 * El puente descartaba por LISTA NEGRA —grupos, difusiones, estados— y todo lo
 * demás pasaba. Tapar solo `@newsletter` habría sido corregir el síntoma:
 * WhatsApp estrena tipos de chat cada tanto (canales, comunidades, chats de
 * IA) y cada uno volvería a colarse igual, de a uno, hasta que alguien lo note.
 *
 * Se invierte la regla: **pasa lo que SÍ es una persona, y nada más.**
 *
 * EL RIESGO DE INVERTIRLA, Y POR QUÉ SE ASUME IGUAL
 * -------------------------------------------------
 * Una lista blanca puede dejar fuera EN SILENCIO a un cliente real si WhatsApp
 * estrena un dominio nuevo para personas. Ese error ya se cometió aquí,
 * enumerando las líneas una por una: cualquier línea nueva quedaba fuera sin
 * avisar. La diferencia es cuál conjunto es abierto. Las líneas son un conjunto
 * ABIERTO que crece con el negocio; estos dominios son un conjunto CERRADO que
 * define el protocolo de WhatsApp, no el dueño.
 *
 * Aun así el descarte NO es mudo: quien llama a esta función deja constancia en
 * el log y en el contador por dominio de `/diagnostic`. Un dominio nuevo se ve
 * el mismo día en vez de descubrirse por un cliente que nunca fue respondido.
 */
export function esChatDePersona(waId: string | null | undefined): boolean {
  const raw = String(waId || '').trim();
  if (!raw) return false;

  const dominio = dominioWa(raw);
  // Sin sufijo: los puentes entregan dígitos sueltos, y eso sí es una persona.
  if (!dominio) return /^\+?\d{7,20}$/.test(raw);

  return DOMINIOS_DE_PERSONA.has(dominio);
}

/**
 * Todas las formas con las que los puentes pueden nombrar al mismo contacto.
 * Se usa para buscar en `contacts` sin depender del sufijo que llegó hoy.
 */
export function contactIdVariants(waId: string | null | undefined): string[] {
  const raw = String(waId || '').trim();
  const digits = waDigits(raw);
  if (!digits) return raw ? [raw] : [];

  const variants = new Set<string>([
    raw,
    digits,
    `+${digits}`,
    `${digits}@c.us`,
    `${digits}@s.whatsapp.net`,
    `${digits}@lid`,
  ]);
  variants.delete('');
  return [...variants];
}

/** Ficha de contacto, con lo mínimo que hace falta para elegir la canónica. */
export interface ContactRow {
  id: string;
  full_name?: string | null;
  wa_phone?: string | null;
  created_at?: string | null;
  /**
   * Datos que no enrutan nada. Aquí vive `telefono`: el teléfono real del
   * cliente cuando `wa_phone` es un `@lid` y por tanto no es un número.
   */
  metadata?: Record<string, unknown> | null;
}

/**
 * Cómo se muestra un contacto en el panel: su nombre y su teléfono.
 *
 * REGLA ÚNICA PARA TODAS LAS PANTALLAS. Antes cada vista hacía su propia
 * mezcla de `full_name || wa_phone`, y como `wa_phone` puede ser un `@lid`, el
 * dueño veía `181290854776961@lid` donde esperaba un teléfono.
 *
 * - `telefono`: el número real si se conoce; si no, se prefiere no enseñar un
 *   identificador interno disfrazado de teléfono.
 * - `nombre`: el nombre del contacto y, si aún no lo sabemos, el teléfono, para
 *   que la cabecera nunca quede vacía ni muestre un `@lid`.
 */
export function mostrarContacto(contacto: ContactRow | null | undefined): {
  nombre: string;
  telefono: string;
} {
  const real = String((contacto?.metadata as any)?.telefono || '').replace(/\D/g, '');
  const bruto = contacto?.wa_phone || '';

  // `wa_phone` solo sirve para mostrar si de verdad parece un teléfono: un
  // `@lid` tiene 14-15 dígitos y no lo es.
  const digitosBrutos = bruto.replace(/\D/g, '');
  const brutoEsTelefono = !bruto.includes('@lid') && /^\d{7,15}$/.test(digitosBrutos);

  const telefono = real || (brutoEsTelefono ? digitosBrutos : '');
  // «Desconocido» suena a que el sistema fallo. No fallo: es un contacto del
  // que todavia no sabemos como se llama, y en cuanto escriba se sabra.
  const nombre = contacto?.full_name?.trim() || telefono || 'Sin nombre';

  return { nombre, telefono };
}

/**
 * De varias fichas que resultaron ser la misma persona, elige la que manda.
 *
 * Prioridad:
 *   1. La que coincide exactamente con el identificador que acaba de llegar.
 *   2. La más antigua, que es la que ya tiene el historial de la conversación.
 */
export function pickCanonicalContact(
  candidates: ContactRow[],
  incomingWaId: string
): ContactRow | null {
  if (!candidates || candidates.length === 0) return null;

  const exact = candidates.find(c => c.wa_phone === incomingWaId);
  if (exact) return exact;

  return [...candidates].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : Number.MAX_SAFE_INTEGER;
    const tb = b.created_at ? Date.parse(b.created_at) : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  })[0];
}
