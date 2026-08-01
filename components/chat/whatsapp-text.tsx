import { Fragment, type ReactNode } from 'react';
import { MARCAS_DE_FORMATO } from '@/lib/whatsapp/message-preview';

/**
 * El texto de un mensaje, con el formato de WhatsApp ya aplicado.
 *
 * POR QUE HACE FALTA
 * ------------------
 * El bot escribe sus cotizaciones con las marcas de WhatsApp:
 *
 *     *Valor unitario:* $11.000 COP
 *
 * En el telefono del cliente eso llega en negrita. En el panel se veia el
 * asterisco crudo, literal, en cada renglon — y una cotizacion de tres
 * productos son quince asteriscos sueltos. Por eso el chat se leia como un
 * volcado de texto y no como una conversacion: el dueno estaba viendo el
 * codigo fuente del mensaje, no el mensaje.
 *
 * Se reconocen las cuatro marcas de WhatsApp, con su misma regla: los
 * delimitadores tienen que abrazar texto, no espacios. Asi un precio como
 * `$7.000` o una referencia como `ZM-MUG-007` no se rompen.
 */

interface Marca {
  re: RegExp;
  /** `true` cuando lo de dentro se muestra tal cual, sin volver a interpretar. */
  literal?: boolean;
  pinta: (contenido: ReactNode) => ReactNode;
}

/**
 * Como se reconoce cada marca lo decide `message-preview.ts`, que es el mismo
 * sitio del que sale la version limpia para la lista. Aqui solo se dice como se
 * pinta cada una.
 *
 * Antes este archivo tenia su propia copia del generador de expresiones, y esa
 * copia traia el fallo que tumbo la pantalla el 01-ago-2026. Con una sola
 * definicion, un fallo asi no puede vivir en dos sitios a la vez.
 */
const COMO_SE_PINTA: Record<string, Marca['pinta']> = {
  mono: (c) => <code className="font-mono text-[0.9em]">{c}</code>,
  negrita: (c) => <strong className="font-semibold">{c}</strong>,
  cursiva: (c) => <em className="italic">{c}</em>,
  tachado: (c) => <s className="opacity-70">{c}</s>,
};

const MARCAS: Marca[] = MARCAS_DE_FORMATO.map(({ tipo, re }) => ({
  re,
  // Lo de dentro de ```mono``` se muestra tal cual, sin volver a interpretar.
  literal: tipo === 'mono',
  pinta: COMO_SE_PINTA[tipo],
}));

function interpretar(texto: string, semilla: string): ReactNode[] {
  // La marca que aparezca primero es la que manda. Si dos empiezan en el mismo
  // sitio gana la que se declaro antes, que es la de mayor precedencia.
  let elegida: { marca: Marca; hallazgo: RegExpExecArray } | null = null;
  for (const marca of MARCAS) {
    const hallazgo = marca.re.exec(texto);
    if (hallazgo && (!elegida || hallazgo.index < elegida.hallazgo.index)) {
      elegida = { marca, hallazgo };
    }
  }

  if (!elegida) return [texto];

  const { marca, hallazgo } = elegida;
  // Lo de antes no puede contener ninguna marca: si la tuviera, habria ganado.
  const antes = texto.slice(0, hallazgo.index);
  const despues = texto.slice(hallazgo.index + hallazgo[0].length);

  const dentro: ReactNode = marca.literal
    ? hallazgo[1]
    : interpretar(hallazgo[1], `${semilla}d`);

  return [
    ...(antes ? [antes] : []),
    <Fragment key={`${semilla}-${hallazgo.index}`}>{marca.pinta(dentro)}</Fragment>,
    ...(despues ? interpretar(despues, `${semilla}s`) : []),
  ];
}

export function TextoWhatsApp({ texto, className }: { texto: string; className?: string }) {
  return <p className={className}>{interpretar(texto, 't')}</p>;
}
