#!/usr/bin/env python3
"""
DEJA LA BANDEJA DE CHATS VACIA. Nada mas.

Toca EXACTAMENTE tres tablas: `messages`, `conversations` y `contacts` — que es
donde viven los chats y la memoria que el bot guarda de cada persona.

NO TOCA el catalogo (`products`, `price_tiers`, `categories`), ni la
configuracion (`agent_configs`, con las hojas y la personalizacion), ni las
lineas (`whatsapp_lines`). El panel queda igual; lo que queda en cero es la
bandeja de chats.

POR QUE. El 11-ago-2026, al conectar las lineas oficiales de la empresa, el
dueño pidio empezar de cero: «quiero unos chats totalmente vacios, no quiero
chats de ningun tipo en el sistema, partimos de este momento justo de ahora
mismo; los demas chats y memorias de las conversaciones eliminalas porque estan
corruptos». Venian de tandas de prueba y de un periodo en el que el bot
contestaba por encima de las personas del equipo.

SIN RESPALDO, por orden expresa suya. Las conversaciones de WhatsApp en el
telefono NO se tocan: esto solo borra la copia que guarda el panel.

En seco por defecto. Borra solo con --aplicar.
"""
import json
import os
import sys
import urllib.parse
import urllib.request

URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

# Las unicas tablas que se tocan. Cualquier otra queda intacta.
SOLO_ESTAS = ("messages", "conversations", "contacts")


def todos(tabla):
    """Todos los identificadores, paginando: la base devuelve 1.000 y se calla."""
    ids, desde = [], 0
    while True:
        h = dict(H)
        h["Range"] = "%d-%d" % (desde, desde + 999)
        h["Range-Unit"] = "items"
        req = urllib.request.Request(URL + "/rest/v1/" + tabla + "?select=id", headers=h)
        with urllib.request.urlopen(req) as r:
            lote = json.loads(r.read().decode())
        ids += [x["id"] for x in lote]
        if len(lote) < 1000:
            return ids
        desde += 1000


def borrar(tabla, ids):
    """De 50 en 50: una URL con cientos de identificadores revienta."""
    hechos = 0
    for i in range(0, len(ids), 50):
        lote = ids[i:i + 50]
        lista = ",".join('"%s"' % x for x in lote)
        h = dict(H)
        h["Prefer"] = "return=minimal"
        ruta = "%s?id=in.(%s)" % (tabla, urllib.parse.quote(lista, safe='(),"'))
        req = urllib.request.Request(URL + "/rest/v1/" + ruta, headers=h, method="DELETE")
        urllib.request.urlopen(req)
        hechos += len(lote)
    return hechos


antes = {t: todos(t) for t in SOLO_ESTAS}
print("EN LA BANDEJA DE CHATS AHORA MISMO")
for t in SOLO_ESTAS:
    print("   %-16s %d" % (t, len(antes[t])))

if "--aplicar" not in sys.argv:
    print("\n--- ENSAYO. No se borro nada. Corra con --aplicar. ---")
    raise SystemExit(0)

# ORDEN OBLIGATORIO: mensajes -> conversaciones -> contactos. Al reves, las
# claves foraneas rechazan el borrado y queda a medias.
print()
for t in SOLO_ESTAS:
    print("   %-16s borrados: %d" % (t, borrar(t, antes[t])))

print("\nDESPUES")
for t in SOLO_ESTAS:
    print("   %-16s %d" % (t, len(todos(t))))
print("\nEl catalogo, las hojas y las lineas no se tocaron.")
