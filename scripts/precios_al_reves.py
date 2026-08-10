#!/usr/bin/env python3
"""
Busca tarifas donde el precio SUBE al comprar mas cantidad, dentro de la misma
variante. Es un error de captura: al cliente se le cobra de mas por comprar mas.
Solo lee.
"""
import json
import os
import urllib.request
from collections import defaultdict

u = (os.environ["NEXT_PUBLIC_SUPABASE_URL"]).rstrip("/")
k = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {"apikey": k, "Authorization": "Bearer " + k}


def paginar(path):
    filas, desde = [], 0
    while True:
        h = dict(H)
        h["Range-Unit"] = "items"
        h["Range"] = "%d-%d" % (desde, desde + 999)
        req = urllib.request.Request(u + path, headers=h)
        with urllib.request.urlopen(req, timeout=120) as r:
            lote = json.loads(r.read().decode("utf-8"))
        filas.extend(lote)
        if len(lote) < 1000:
            return filas
        desde += 1000


prods = {p["id"]: p for p in paginar("/rest/v1/products?select=id,reference,name&active=eq.true&order=id")}
tiers = paginar("/rest/v1/price_tiers?select=product_id,min_qty,price,variant&order=id")

por = defaultdict(list)
for t in tiers:
    if t["product_id"] in prods:
        por[(t["product_id"], t.get("variant") or "")].append(t)

raros = []
for (pid, var), lista in por.items():
    lista = [x for x in lista if x.get("min_qty") is not None and x.get("price")]
    lista.sort(key=lambda x: x["min_qty"])
    for a, b in zip(lista, lista[1:]):
        if float(b["price"]) > float(a["price"]):
            raros.append((prods[pid], var, a, b))

print("TARIFAS QUE SUBEN AL COMPRAR MAS: %d" % len(raros))
print("(dentro de la misma variante; el precio unitario deberia bajar o quedarse igual)\n")
for p, var, a, b in raros[:40]:
    print("  %-14s %-46s" % (p["reference"], p["name"][:46]))
    print("       %-46s  desde %s: $%s   ->   desde %s: $%s" % (
        var[:46], a["min_qty"], a["price"], b["min_qty"], b["price"]))
