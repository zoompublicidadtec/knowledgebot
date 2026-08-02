import type { Message } from '@/lib/database.types';

/**
 * Como se lee un mensaje: una sola regla para todo el panel.
 *
 * POR QUE EXISTE ESTE ARCHIVO
 * ---------------------------
 * La burbuja del chat y la fila de la lista tienen que contar lo mismo. Si la
 * burbuja pinta un reproductor de audio, la fila tiene que decir "Nota de
 * voz" — no la transcripcion cruda mezclada con etiquetas internas del
 * puente, ni un renglon vacio. Antes cada componente clasificaba el mensaje
 * por su cuenta, con su propia lista de tipos y sus propias expresiones
 * regulares, y las dos vistas se contradecian en cuanto el puente cambiaba un
 * nombre de campo.
 *
 * Aqui vive la unica regla. Misma idea que `contact-identity.ts` para los
 * nombres y telefonos: la presentacion se decide en un solo sitio.
 */

/** Lo que el puente dejo en `raw` sobre el adjunto de un mensaje. */
export interface MediaDelMensaje {
  esImagen: boolean;
  esAudio: boolean;
  /**
   * Video o GIF. En WhatsApp un GIF NO viaja como .gif: viaja como un mp4
   * corto, así que los dos caen aquí y se pintan con el mismo reproductor.
   */
  esVideo: boolean;
  /**
   * Sticker. Llega como `image/webp`, así que también es imagen y se pinta
   * como tal — solo que en pequeño, porque un sticker a ancho completo se ve
   * como una foto y no lo es.
   */
  esSticker: boolean;
  mimeType: string;
  /** El tipo que declara el puente: `image`, `ptt`, `audio`… */
  declaredType: string;
  sizeKB: number | null;
  /** Clave del objeto en R2. Hay que cambiarla por una URL firmada. */
  r2Key: string | null;
  /** Direccion que ya se puede usar tal cual (ruta de la app o URL absoluta). */
  directUrl: string | null;
  /** El puente nunca pudo descargar el archivo. */
  mediaError: boolean;
  /** Texto del mensaje al que este responde, si es una respuesta. */
  citado: string | null;
}

/**
 * Lo minimo que hace falta para responder CITANDO a un mensaje.
 *
 * El panel ya sabia PINTAR una cita (la caja gris con el mensaje al que se
 * responde), porque el puente la extrae de lo que llega. Lo que no se podia era
 * CREAR una: elegir en el panel a que mensaje se le responde.
 *
 * WhatsApp no cita por texto sino por identificador: hay que decirle cual era
 * el mensaje (`id`) y de quien (`fromMe`). El texto viaja solo para que el
 * telefono del cliente pinte la vista previa mientras resuelve el original.
 */
export interface MensajeCitado {
  /** `wa_message_id`: el identificador que le puso WhatsApp. */
  id: string;
  /** true si lo escribimos nosotros (el bot o un asesor). */
  fromMe: boolean;
  /** Vista previa de lo citado. */
  texto: string;
}

/**
 * Arma la cita a partir de un mensaje del panel.
 *
 * Devuelve null si el mensaje no tiene identificador de WhatsApp: sin el no hay
 * a que citar, y es mejor no ofrecer el boton que ofrecer uno que falla.
 */
export function citaDesdeMensaje(
  m: Pick<Message, 'wa_message_id' | 'direction' | 'content' | 'raw'>,
): MensajeCitado | null {
  if (!m.wa_message_id) return null;

  const media = leerMedia(m);
  const escrito = quitarCita(m.content);
  // El sticker se mira ANTES que la imagen: un sticker tambien es image/webp.
  const texto =
    escrito ||
    (media.esSticker ? '[Sticker]'
      : media.esAudio ? '[Nota de voz]'
      : media.esVideo ? '[Video]'
      : media.esImagen ? '[Foto]'
      : '[Archivo]');

  return {
    id: m.wa_message_id,
    fromMe: m.direction === 'outbound',
    texto: texto.slice(0, 300),
  };
}

/** Clasifica el adjunto de un mensaje. No decide nada de como se pinta. */
export function leerMedia(message: Pick<Message, 'raw'>): MediaDelMensaje {
  const rawObj = message.raw as any;
  const inbound = rawObj?.data?.message;
  const media = inbound?.media;
  // Las fotos de producto que envia el bot se guardan en la raiz de `raw`, con
  // una ruta que sirve la propia app; esas no pasan por R2.
  const outboundMedia = rawObj?.media;

  const mimeType: string = media?.mimetype || '';
  const declaredType: string = inbound?.mediaType || inbound?.type || outboundMedia?.type || '';

  return {
    esImagen: mimeType.startsWith('image/') || declaredType === 'image' || declaredType === 'sticker',
    esAudio: mimeType.startsWith('audio/') || declaredType === 'ptt' || declaredType === 'audio',
    /**
     * EL FALLO QUE ESTO CIERRA
     * ------------------------
     * El puente descarga y guarda los videos desde siempre (`classifyMedia`
     * los reconoce), pero el panel solo sabía pintar dos cosas: imagen y
     * audio. Un video o un GIF se bajaban, ocupaban su espacio en el
     * almacenamiento… y en pantalla no aparecía nada. El dueño veía la
     * burbuja y no entendía qué le habían mandado.
     */
    esVideo: mimeType.startsWith('video/') || declaredType === 'video',
    esSticker: declaredType === 'sticker' || mimeType === 'image/webp',
    mimeType,
    declaredType,
    sizeKB: media?.size_bytes ? Math.max(1, Math.round(media.size_bytes / 1024)) : null,
    r2Key:
      media?.r2_key ||
      (typeof media?.url === 'string' && media.url.startsWith('media/') ? media.url : null),
    directUrl:
      (typeof outboundMedia?.url === 'string' && outboundMedia.url) ||
      (typeof media?.url === 'string' && /^(https?:\/\/|\/)/.test(media.url) ? media.url : null) ||
      null,
    mediaError: inbound?.mediaError === true,
    citado: rawObj?.data?.message?.quoted?.body || null,
  };
}

/**
 * Quita la cita que el puente incrusta dentro del texto.
 *
 * El puente escribe `[En respuesta a: "…"]` dentro del contenido porque el
 * agente necesita el referente para entender "de ese, cuanto por 200". Para
 * mostrarlo sobra: la cita se pinta aparte, en su propia caja.
 */
export function quitarCita(content: string | null | undefined): string {
  return (content || '').replace(/\n?\[En respuesta a: "[\s\S]*?"\]/g, '').trim();
}

/**
 * Parte el texto de una imagen en pie de foto y analisis de IA.
 *
 * El servidor anota las fotos del cliente de dos maneras distintas
 * (`[Foto del cliente: …]` y `[Imagen adjunta de cliente: …]`): las dos
 * significan lo mismo y las dos se reconocen aqui.
 *
 * Sin etiqueta, el texto ES el pie de foto. Eso importa para las fotos de
 * producto que manda el bot, que llevan nombre, referencia y precio en el
 * texto: tirarlas dejaba al dueno viendo la imagen desnuda mientras el
 * cliente si recibia la informacion en WhatsApp.
 */
export function separarPieYAnalisis(texto: string): { pie: string; analisis: string } {
  const marca = texto.match(/\[(?:Foto del cliente|Imagen adjunta de cliente):([\s\S]*?)\]/);
  if (!marca) return { pie: texto, analisis: '' };
  return {
    pie: texto.replace(marca[0], '').trim(),
    analisis: marca[1].trim(),
  };
}

/**
 * LAS MARCAS DE FORMATO DE WHATSAPP, EN UN SOLO SITIO
 * ---------------------------------------------------
 * `*negrita*`, `_cursiva_`, `~tachado~` y ```monoespaciado```.
 *
 * El delimitador no puede tocar una letra ni un digito, ni por delante ni por
 * detras — es la regla de WhatsApp, y aqui hace falta de verdad: sin ella,
 * `linea_1` o `business_info` salian en cursiva a mitad de palabra.
 *
 * ⚠ CUIDADO CON LA BARRA. En modo unicode (bandera `u`) solo se pueden escapar
 * los caracteres de sintaxis de las expresiones regulares. `\_` y `\~` NO son
 * escapes validos: el motor lanza «Invalid escape» al CONSTRUIR la expresion,
 * antes de usarla siquiera. Eso tumbo la pantalla de Conversaciones el
 * 01-ago-2026 — un generador que le ponia barra a los tres delimitadores por
 * igual. De los tres, solo `*` la lleva.
 *
 * Y se construyen UNA vez, al cargar el modulo, no dentro de cada funcion: asi
 * un error como aquel revienta al arrancar y no a mitad de un renglon de la
 * lista, donde tarda en aparecer y se lleva la pagina entera por delante.
 */
type MarcaDeFormato = '*' | '_' | '~';

const LIMITE_IZQUIERDO = String.raw`(?<![\p{L}\p{N}])`;
const LIMITE_DERECHO = String.raw`(?![\p{L}\p{N}])`;

function expresionDeMarca(marca: MarcaDeFormato, banderas: string): RegExp {
  // La unica que necesita barra, y por eso no se genera con una plantilla ciega.
  const d = marca === '*' ? '\\*' : marca;
  return new RegExp(`${LIMITE_IZQUIERDO}${d}(\\S(?:[^${d}\\n]*\\S)?)${d}${LIMITE_DERECHO}`, banderas);
}

const MONOESPACIADO = /```([\s\S]+?)```/u;

/** Para PINTAR: se busca la primera de cada tipo y se parte el texto ahi. */
export const MARCAS_DE_FORMATO: { tipo: 'mono' | 'negrita' | 'cursiva' | 'tachado'; re: RegExp }[] = [
  { tipo: 'mono', re: MONOESPACIADO },
  { tipo: 'negrita', re: expresionDeMarca('*', 'u') },
  { tipo: 'cursiva', re: expresionDeMarca('_', 'u') },
  { tipo: 'tachado', re: expresionDeMarca('~', 'u') },
];

/** Para LIMPIAR: las mismas, en global. */
const MARCAS_GLOBALES: RegExp[] = [
  /```([\s\S]+?)```/gu,
  expresionDeMarca('*', 'gu'),
  expresionDeMarca('_', 'gu'),
  expresionDeMarca('~', 'gu'),
];

/**
 * Quita las marcas de formato y deja el texto pelado.
 *
 * En la burbuja esas marcas se pintan (ver `components/chat/whatsapp-text.tsx`),
 * pero en el renglon de la lista no hay negritas: alli lo unico que harian los
 * asteriscos es gastar los pocos caracteres que caben.
 */
export function quitarFormato(texto: string): string {
  let limpio = texto;
  for (const re of MARCAS_GLOBALES) limpio = limpio.replace(re, '$1');
  return (
    limpio
      // Un mensaje largo llega con saltos de linea; en un renglon van como espacios.
      .replace(/\s*\n+\s*/g, ' ')
      .trim()
  );
}

/** Un mensaje resumido a un renglon, para la lista de chats. */
export interface ResumenDeMensaje {
  /** Simbolo que adelanta de que tipo es, como en WhatsApp. */
  icono: string;
  /** El texto ya limpio de etiquetas internas. */
  texto: string;
}

/**
 * Resume un mensaje en el renglon que se ve bajo el nombre, en la lista.
 *
 * Nunca devuelve texto crudo con etiquetas del puente dentro, y nunca devuelve
 * un renglon vacio cuando si habia algo: un adjunto sin texto se anuncia por
 * lo que es ("Foto", "Nota de voz").
 */
export function resumirMensaje(
  message: Pick<Message, 'raw' | 'content'> | null | undefined
): ResumenDeMensaje | null {
  if (!message) return null;

  const media = leerMedia(message);
  const texto = quitarFormato(quitarCita(message.content));

  if (media.mediaError) {
    return { icono: '⚠️', texto: 'Archivo que no se pudo descargar' };
  }

  if (media.esSticker) {
    return { icono: '🎨', texto: 'Sticker' };
  }

  if (media.esImagen) {
    const { pie } = separarPieYAnalisis(texto);
    return { icono: '📷', texto: pie || 'Foto' };
  }

  if (media.esVideo) {
    const { pie } = separarPieYAnalisis(texto);
    return { icono: '🎬', texto: pie || 'Video' };
  }

  if (media.esAudio) {
    // El texto de un audio ES su transcripcion. Cuando el motor no pudo
    // transcribir deja su propia marca entre corchetes, que no se muestra.
    const esMarcaInterna = texto === '[Mensaje de voz]' || texto === '[Error al procesar mensaje de voz]';
    return { icono: '🎤', texto: !texto || esMarcaInterna ? 'Nota de voz' : texto };
  }

  return { icono: '', texto };
}
