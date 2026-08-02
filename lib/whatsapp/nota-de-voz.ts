import { spawn } from 'child_process';

/**
 * DE LO QUE GRABA EL NAVEGADOR A LO QUE ENTIENDE WHATSAPP.
 *
 * Una nota de voz no es «un audio adjunto». Para que WhatsApp la pinte como la
 * onda que se oye de un toque, tiene que llegar en **ogg/opus** y marcada como
 * `ptt`. El navegador de Windows graba en **webm/opus**: mismo sonido dentro,
 * otro envase. Con el envase equivocado el cliente recibe un archivo que tiene
 * que descargar y abrir aparte, que es peor que no mandar nada.
 *
 * Se convierte AQUI, en la app, y no en el puente, por dos razones:
 *   1. Lo que queda guardado en el almacenamiento ya sirve para todos: el panel
 *      lo reproduce igual en Chrome que en un iPhone.
 *   2. Si la conversion falla, se corta ANTES de que nada salga a WhatsApp y se
 *      le dice al asesor. Nunca se manda media nota de voz.
 *
 * Se trabaja por tuberias, sin archivos temporales: entra por `pipe:0` y sale
 * por `pipe:1`. El contenedor ogg admite escritura en tuberia (mp4 no).
 */

/** Tope de seguridad: una nota de voz de 5 minutos convierte en menos de 5 s. */
const TOPE_MS = 30_000;

const ARGUMENTOS = [
  '-hide_banner',
  '-loglevel', 'error',
  '-i', 'pipe:0',
  '-vn',                    // por si el navegador mete una pista de video vacia
  '-c:a', 'libopus',
  '-b:a', '32k',            // voz: mas bitrate no se oye mejor y pesa el doble
  '-ar', '48000',           // opus trabaja a 48 kHz
  '-ac', '1',               // mono, como toda nota de voz
  '-f', 'ogg',
  'pipe:1',
];

export async function convertirANotaDeVoz(entrada: Buffer): Promise<Buffer> {
  if (!entrada || entrada.length === 0) {
    throw new Error('La grabacion llego vacia.');
  }

  return new Promise<Buffer>((resolve, reject) => {
    const ff = spawn('ffmpeg', ARGUMENTOS);
    const salida: Buffer[] = [];
    const quejas: Buffer[] = [];
    let terminado = false;

    const fallar = (motivo: string) => {
      if (terminado) return;
      terminado = true;
      try { ff.kill('SIGKILL'); } catch { /* ya habia muerto */ }
      reject(new Error(motivo));
    };

    const reloj = setTimeout(
      () => fallar(`La conversion del audio paso de ${TOPE_MS / 1000} segundos.`),
      TOPE_MS,
    );

    ff.stdout.on('data', (trozo: Buffer) => salida.push(trozo));
    ff.stderr.on('data', (trozo: Buffer) => quejas.push(trozo));

    ff.on('error', (e: Error) => {
      clearTimeout(reloj);
      fallar(`No se pudo ejecutar ffmpeg: ${e.message}`);
    });

    ff.on('close', (codigo: number | null) => {
      clearTimeout(reloj);
      if (terminado) return;
      terminado = true;

      const bytes = Buffer.concat(salida);
      if (codigo !== 0 || bytes.length === 0) {
        const detalle = Buffer.concat(quejas).toString().trim().slice(0, 300);
        return reject(new Error(detalle || `ffmpeg termino con codigo ${codigo}`));
      }
      resolve(bytes);
    });

    // Si ffmpeg muere antes de leerlo todo, la tuberia se rompe: el codigo de
    // salida ya lo cuenta, aqui solo se evita que el error tumbe el proceso.
    ff.stdin.on('error', () => { /* lo reporta `close` */ });
    ff.stdin.end(entrada);
  });
}

/** El tipo exacto que WhatsApp espera en una nota de voz. */
export const MIME_NOTA_DE_VOZ = 'audio/ogg; codecs=opus';
