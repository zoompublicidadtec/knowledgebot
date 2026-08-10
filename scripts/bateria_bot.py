#!/usr/bin/env python3
"""
BATERIA DE PRUEBA DEL BOT — mide, no arregla.

Corre cada caso con un contacto NUEVO (reusar acumula historial y la respuesta
cambia sin que se haya roto nada). Imprime una tabla y un puntaje X/N.

Uso:  python3 bateria.py <etiqueta>
      la etiqueta va en el telefono de prueba para no mezclar tandas.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ETIQUETA = (sys.argv[1] if len(sys.argv) > 1 else "x")[:6]
ORG = "5a499335-2dc1-4fe4-949d-27d6d108121f"
BASE = "http://localhost:3003/api/agent/test"
LLAVE = os.environ.get("BRIDGE_API_KEY", "")
LINEA = "linea_1"


def hablar(telefono, mensaje):
    body = json.dumps(
        {
            "message": mensaje,
            "orgId": ORG,
            "contactPhone": telefono,
            "contactName": "Prueba",
            "lineKey": LINEA,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        BASE,
        data=body,
        headers={"Content-Type": "application/json", "x-bridge-key": LLAVE},
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.loads(r.read().decode("utf-8")).get("reply") or ""


def tiene(txt, *palabras):
    t = (txt or "").lower()
    return all(p.lower() in t for p in palabras)


def alguna(txt, *palabras):
    t = (txt or "").lower()
    return any(p.lower() in t for p in palabras)


# ---------------------------------------------------------------- los casos
# (clave, [mensajes], funcion que dice si paso, que se esperaba)
CASOS = [
    (
        "banner",
        ["cuanto vale un banner laminado de 200 x 100 cm"],
        lambda r: "60.000" in r[-1] or "60000" in r[-1],
        "el total debe ser $60.000",
    ),
    (
        "cuadernos",
        ["necesito 20 cuadernos argollados de 120 hojas 1/2 octavo con 6 insertos"],
        lambda r: "487.000" in r[-1] or "487000" in r[-1],
        "el total debe ser $487.000",
    ),
    (
        "esfero",
        ["necesito 50 esferos con el logo de mi empresa"],
        lambda r: alguna(r[-1], "boligrafo", "bolígrafo") and not alguna(r[-1], "alcancia", "alcancía"),
        "debe ofrecer boligrafos, nunca una alcancia",
    ),
    (
        "mug_magico",
        ["quiero 30 mugs que cambien de color con el agua caliente"],
        lambda r: alguna(r[-1], "magico", "mágico"),
        "debe ofrecer el Mug Magico",
    ),
    (
        "cachucha",
        ["cuanto valen 20 cachuchas bordadas"],
        lambda r: alguna(r[-1], "gorra"),
        "cachucha es gorra",
    ),
    (
        "ref_exacta",
        ["necesito el precio de 10 unidades de la referencia MU-303-1"],
        lambda r: alguna(r[-1], "wilem")
        and not alguna(r[-1], "no encuentro", "no la tengo", "no existe", "no manejamos"),
        "MU-303-1 existe y esta activa: tiene que encontrarla",
    ),
    (
        "ref_inexistente",
        ["cuanto vale la referencia XQ-9999-Z"],
        lambda r: not alguna(r[-1], "xq-9999-z (ref", "(ref: xq-9999-z"),
        "no debe inventar una referencia que no existe",
    ),
    (
        "dos_cosas",
        ["me interesa el botilito, pero tambien mandame fotos de gorras de dril"],
        lambda r: alguna(r[-1], "botilito") and alguna(r[-1], "gorra"),
        "debe atender las DOS cosas en la misma respuesta",
    ),
    (
        "foto",
        ["mandame la foto del mug tintero"],
        lambda r: not alguna(
            r[-1], "no puedo", "no te la puedo", "no tengo la capacidad", "no soy capaz", "no me es posible"
        ),
        "nunca decir que no puede mandar la foto",
    ),
    (
        "libretas",
        ["tienen libretas? necesito 50"],
        lambda r: alguna(r[-1], "libreta") and "$" in r[-1],
        "debe ofrecer libretas CON precio",
    ),
    (
        "plural",
        ["precios de 30 cuadernos argollados de 80 hojas media carta"],
        lambda r: alguna(r[-1], "cuaderno") and "$" in r[-1],
        "el plural debe encontrar lo mismo y cotizar",
    ),
    (
        "marcacion",
        ["los mugs ya vienen con mi logo impreso?"],
        lambda r: len(r[-1]) > 40
        and not alguna(r[-1], "hubo un error", "error al cotizar")
        and not alguna(r[-1], "numero de tintas", "número de tintas", "segun la tecnica", "según la técnica"),
        "no debe inventar la politica de marcacion ni pedir tintas",
    ),
    (
        "cambio_tema",
        ["cuanto valen 20 mugs", "mejor dime que valen unos esferos"],
        lambda r: alguna(r[-1], "boligrafo", "bolígrafo", "esfero") and not alguna(r[-1], "mug"),
        "al cambiar de tema no debe seguir con mugs",
    ),
    (
        # Dos familias DISTINTAS a proposito: si una cifra se repite entre mugs
        # y gorras, es que la arrastro, no que coincidan.
        "precios_reciclados",
        ["cuanto valen 20 mugs", "y cuanto valen 15 gorras de dril bordadas"],
        None,  # se evalua aparte: compara cifras entre los dos turnos
        "no debe repetir las cifras del turno anterior con otros productos",
    ),
    (
        "cierre",
        [
            "cuanto valen 20 mugs magicos",
            "me quedo con ese, como pago?",
        ],
        lambda r: alguna(r[-1], "pago", "transferencia", "consignar", "datos", "nombre")
        and not alguna(r[-1], "no puedo"),
        "en el cierre pide datos y explica el pago",
    ),
]


import re

CIFRA = re.compile(r"\$\s?[\d.,]{4,}")


def cifras(t):
    return set(x.replace(" ", "") for x in CIFRA.findall(t or ""))


def correr(caso):
    clave, mensajes, evalua, esperado = caso
    tel = "5739%s%s@c.us" % (ETIQUETA, clave[:6])
    tel = tel.replace("_", "")
    respuestas = []
    t0 = time.time()
    try:
        for m in mensajes:
            respuestas.append(hablar(tel, m))
    except Exception as e:
        return {
            "clave": clave, "ok": False, "segundos": time.time() - t0,
            "esperado": esperado, "respuesta": "ERROR: %s" % e, "respuestas": respuestas,
        }
    seg = time.time() - t0

    if clave == "precios_reciclados":
        repetidas = cifras(respuestas[0]) & cifras(respuestas[-1])
        ok = len(repetidas) == 0
        nota = "repetidas: %s" % (", ".join(sorted(repetidas)) or "ninguna")
    else:
        ok = bool(evalua(respuestas))
        nota = ""

    # NINGUNA respuesta puede salir cortada, gane o pierda el resto.
    final = (respuestas[-1] or "").strip()
    if final and (final[-1] in "$*-,;:" or final.endswith(" de") or final.endswith(" por")):
        ok = False
        nota = (nota + " | CORTADA al final: ...%s" % final[-32:]).strip(" |")

    return {
        "clave": clave, "ok": ok, "segundos": seg, "esperado": esperado,
        "respuesta": respuestas[-1], "respuestas": respuestas, "nota": nota,
    }


def main():
    if not LLAVE:
        raise SystemExit("falta BRIDGE_API_KEY en el entorno")
    print("BATERIA '%s' — %d casos\n" % (ETIQUETA, len(CASOS)))
    with ThreadPoolExecutor(max_workers=3) as pool:
        res = list(pool.map(correr, CASOS))

    buenos = sum(1 for r in res if r["ok"])
    for r in res:
        print("=" * 78)
        print("%s  %-18s  (%.0f s)" % ("PASA " if r["ok"] else "FALLA", r["clave"], r["segundos"]))
        print("   esperado: %s" % r["esperado"])
        if r.get("nota"):
            print("   %s" % r["nota"])
        cuerpo = (r["respuesta"] or "").replace("\n", "\n      ")
        print("   dijo: %s" % cuerpo[:900])
    print("=" * 78)
    print("\nRESULTADO: %d de %d" % (buenos, len(CASOS)))

    with open("/tmp/bateria_%s.json" % ETIQUETA, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    print("detalle en /tmp/bateria_%s.json" % ETIQUETA)


main()
