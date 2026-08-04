'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Cada pantalla nueva empieza arriba, como toca.
 *
 * POR QUE HACE FALTA. El marco de la aplicacion pone `overflow-auto` en su
 * `<main>`, asi que el que se desplaza es ESE recuadro y no la ventana. Y el
 * marco no se vuelve a montar al cambiar de pestaña: sobrevive a la navegacion
 * con la posicion que traia. El «volver arriba» que trae Next.js por su cuenta
 * mueve la VENTANA, que en este panel nunca se desplaza, asi que no servia de
 * nada.
 *
 * Resultado, reportado por el dueño el 04-ago-2026: «el panel de
 * personalizacion siempre que lo abro se carga en la mitad de la pantalla y no
 * en el comienzo». No era de personalizacion: pasaba en cualquier pantalla
 * larga, y se notaba ahi porque es de las mas largas.
 *
 * Se corrige aqui y no quitando el `overflow-auto` porque ese recuadro es lo
 * que mantiene la barra de arriba fija y la lista de chats con su propio
 * desplazamiento. Cambiarlo tocaria el aspecto de todas las pantallas; esto
 * solo mueve una barra que ya estaba mal puesta.
 */
export function VolverArriba() {
  const ruta = usePathname();

  useEffect(() => {
    const main = document.querySelector('main');
    // `auto` y no `smooth`: al abrir una pantalla nueva el salto no se ve, y
    // una animacion aqui solo agrega un parpadeo.
    if (main) main.scrollTo({ top: 0, behavior: 'auto' });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [ruta]);

  return null;
}
