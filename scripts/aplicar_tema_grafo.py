#!/usr/bin/env python3
"""Le vuelve a poner al grafo el diseño del dueño después de regenerarlo.

POR QUE EXISTE: `graphify update .` reescribe `graphify-out/graph.html` desde
cero, con su plantilla de fábrica. El dueño le hizo un diseño propio —tipografía,
fondo, panel lateral y animación de las conexiones— y esa regeneración se lo
borraba entero, en silencio, cada vez.

COMO FUNCIONA: el diseño vive aparte, en `graphify-out/graph.plantilla.html`, y
este guion le inyecta los datos recién generados. Son tres renglones: la lista
de nodos, la de aristas y el contador que se ve abajo. El resto del archivo es
el diseño y no se toca.

USO, siempre después de regenerar:
    graphify update . && python3 scripts/aplicar_tema_grafo.py

Si algún día graphify cambia el nombre de esas variables, este guion avisa y no
escribe nada, en vez de dejar un archivo a medias.
"""
import io
import os
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GENERADO = os.path.join(RAIZ, 'graphify-out', 'graph.html')
PLANTILLA = os.path.join(RAIZ, 'graphify-out', 'graph.plantilla.html')

# Los tres renglones que llevan datos. Todo lo demás es diseño.
MARCAS = ['const RAW_NODES =', 'const RAW_EDGES =', '  <div id="stats">']


def renglones(ruta):
    with io.open(ruta, encoding='utf-8') as fh:
        return fh.read().split('\n')


def indice(lineas, marca, de_donde):
    for i, linea in enumerate(lineas):
        if linea.startswith(marca):
            return i
    sys.exit('No se encontró «%s» en %s. No se escribió nada.' % (marca, de_donde))


def main():
    if not os.path.exists(PLANTILLA):
        sys.exit('Falta %s: sin plantilla no hay diseño que aplicar.' % PLANTILLA)

    generado = renglones(GENERADO)
    plantilla = renglones(PLANTILLA)

    for marca in MARCAS:
        i_gen = indice(generado, marca, 'el grafo recién generado')
        i_pla = indice(plantilla, marca, 'la plantilla del diseño')
        plantilla[i_pla] = generado[i_gen]

    with io.open(GENERADO, 'w', encoding='utf-8', newline='') as fh:
        fh.write('\n'.join(plantilla))

    contador = next(l for l in plantilla if l.startswith('  <div id="stats">'))
    print('Diseño aplicado al grafo. ' + contador.strip())


if __name__ == '__main__':
    main()
