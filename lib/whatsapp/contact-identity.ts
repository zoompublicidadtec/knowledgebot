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
