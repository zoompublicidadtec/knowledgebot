import { Fragment, type ReactNode } from 'react';

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
 * El delimitador no puede tocar una letra ni un digito, ni por delante ni por
 * detras. Es la misma regla de WhatsApp, y aqui importa especialmente: sin
 * ella, `linea_1 y linea_2` o `business_info` — palabras que este negocio
 * escribe a diario — salian en cursiva a mitad de palabra.
 */
const ANTES = String.raw`(?<![\p{L}\p{N}])`;
const DESPUES = String.raw`(?![\p{L}\p{N}])`;

/** `*negrita*`, `_cursiva_`, `~tachado~`: mismo molde, distinto delimitador. */
function marcaDeParaje(delimitador: string): RegExp {
  const d = `\\${delimitador}`;
  return new RegExp(`${ANTES}${d}(\\S(?:[^${d}\\n]*\\S)?)${d}${DESPUES}`, 'u');
}

const MARCAS: Marca[] = [
  {
    // ```monoespaciado```
    re: /```([\s\S]+?)```/u,
    literal: true,
    pinta: (c) => <code className="font-mono text-[0.9em]">{c}</code>,
  },
  {
    re: marcaDeParaje('*'),
    pinta: (c) => <strong className="font-semibold">{c}</strong>,
  },
  {
    re: marcaDeParaje('_'),
    pinta: (c) => <em className="italic">{c}</em>,
  },
  {
    re: marcaDeParaje('~'),
    pinta: (c) => <s className="opacity-70">{c}</s>,
  },
];

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
