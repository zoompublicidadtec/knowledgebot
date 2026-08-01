/**
 * Las fechas del chat, con una sola zona horaria para todo el panel.
 *
 * POR QUE LA ZONA ES FIJA Y NO LA DEL EQUIPO
 * ------------------------------------------
 * El panel se pinta dos veces: primero en el servidor y despues en el
 * navegador. El contenedor del servidor no tiene zona horaria, asi que formatea
 * en UTC; el telefono del dueno formatea en Bogota. A partir de las 7 de la
 * noche los dos ya no coinciden ni en la hora ni en el dia — el servidor
 * escribe "manana" y el navegador "hoy" — y React tumba la hidratacion con el
 * error #418, que fue el que aparecia en la consola.
 *
 * Fijando Bogota, servidor y navegador escriben exactamente lo mismo, que
 * ademas es la hora que le sirve al dueno.
 *
 * Este archivo existe para que esa decision viva en UN sitio: cuando cada
 * componente traia su propia copia del formato, bastaba con que uno olvidara
 * `timeZone` para que volviera el error.
 */

export const ZONA_DEL_NEGOCIO = 'America/Bogota';

/** `YYYY-MM-DD` del dia calendario en Bogota. Comparable y restable. */
function diaCalendario(fecha: Date): string {
  return fecha.toLocaleDateString('en-CA', { timeZone: ZONA_DEL_NEGOCIO });
}

/** La hora de un mensaje: `3:25 p. m.` */
export function horaDelMensaje(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: ZONA_DEL_NEGOCIO,
  });
}

/**
 * Lo que va a la derecha de cada chat en la lista, con las mismas palabras que
 * usa WhatsApp: la hora si es de hoy, "Ayer", el dia de la semana si cae dentro
 * de la semana, y la fecha corta si es mas viejo.
 */
export function etiquetaDeFecha(iso: string): string {
  const fecha = new Date(iso);
  const ahora = new Date();
  const diaMensaje = diaCalendario(fecha);
  const diaHoy = diaCalendario(ahora);

  if (diaMensaje === diaHoy) return horaDelMensaje(iso);
  if (diaMensaje === diaCalendario(new Date(ahora.getTime() - 86400000))) return 'Ayer';

  // Los dos textos son medianoche UTC, asi que la resta da dias exactos.
  const diasAtras = (Date.parse(diaHoy) - Date.parse(diaMensaje)) / 86400000;
  if (diasAtras < 7) {
    return fecha.toLocaleDateString('es-CO', { weekday: 'long', timeZone: ZONA_DEL_NEGOCIO });
  }

  return fecha.toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    timeZone: ZONA_DEL_NEGOCIO,
  });
}

/**
 * El rotulo de la pastilla que separa los dias dentro de un chat
 * ("HOY", "AYER", "martes, 22 de julio"). Es lo que permite leer una
 * conversacion larga sin perder de vista cuando paso cada cosa.
 */
export function etiquetaDeDia(iso: string): string {
  const fecha = new Date(iso);
  const ahora = new Date();
  const diaMensaje = diaCalendario(fecha);

  if (diaMensaje === diaCalendario(ahora)) return 'Hoy';
  if (diaMensaje === diaCalendario(new Date(ahora.getTime() - 86400000))) return 'Ayer';

  return fecha.toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: ZONA_DEL_NEGOCIO,
  });
}

/** Dos mensajes caen bajo el mismo separador de dia. */
export function mismoDia(unIso: string, otroIso: string): boolean {
  return diaCalendario(new Date(unIso)) === diaCalendario(new Date(otroIso));
}
