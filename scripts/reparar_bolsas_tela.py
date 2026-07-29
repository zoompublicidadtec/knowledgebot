"""Reparacion de las bolsas de tela (organza / satin / yute).

1. Archiva los 14 productos fabricados ZM-GEN-407..420 (active=false, no se
   borran) y purga sus vectores del indice.
2. Corrige las 5 bolsas legitimas cuyas tarifas quedaron como 'unitario':
   pasan a 'lote_total' con los rangos exactos de lote (50-50 y 100-100), igual
   que sus hermanas que si venian de la hoja del Excel. ZM-GEN-171 ademas
   corrige sus importes a los de la tabla del dueno (95.000 / 180.000).

Uso:  python reparar_bolsas.py           (simulacion)
      python reparar_bolsas.py --apply   (aplica)

Se ejecuta DENTRO del VPS.
"""
import json
import os
import sys
import time

import httpx
from dotenv import dotenv_values

APPLY = "--apply" in sys.argv
ENV = dotenv_values("/root/knowledgebot/.env.production")
SUPA = ENV["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = ENV.get("SUPABASE_SERVICE_ROLE_KEY") or ENV["SUPABASE_SERVICE_ROLE"]
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}
INDEX = "/root/knowledgebot/Motor de Conocimiento/data/embeddings/product_embeddings.json"
BACKUPS = "/root/knowledgebot/backups"
STAMP = time.strftime("%Y%m%d_%H%M%S")

FABRICADOS = [f"ZM-GEN-{n}" for n in range(407, 421)]

# ref -> (hoja de origen, {min_qty: precio correcto o None si se conserva})
REPARAR = {
    "ZM-GEN-166": ("Bolsa Organza (reparado 2026-07-29)", {50: None, 100: None}),
    "ZM-GEN-167": ("Bolsa Organza (reparado 2026-07-29)", {50: None, 100: None}),
    "ZM-GEN-171": ("Bolsa Organza (reparado 2026-07-29)", {50: 95000, 100: 180000}),
    "ZM-GEN-361": ("Bolsa Satin (verificado por el dueno 2026-07-29)", {50: None, 100: None}),
    "ZM-GEN-366": ("Bolsa Satin (verificado por el dueno 2026-07-29)", {50: None, 100: None}),
}
VARIANTE = {50: "Lote de 50 unidades", 100: "Lote de 100 unidades"}


def get(path, **params):
    r = httpx.get(f"{SUPA}/rest/v1/{path}", params=params, headers=H, timeout=60)
    r.raise_for_status()
    return r.json()


def patch(path, params, body):
    r = httpx.patch(f"{SUPA}/rest/v1/{path}", params=params, headers=H, json=body, timeout=60)
    if r.status_code >= 400:
        print("   ERROR", r.status_code, r.text[:200])
        return False
    return True


refs = FABRICADOS + list(REPARAR)
prods = get("products", select="*", reference=f"in.({','.join(chr(34)+r+chr(34) for r in refs)})")
by_ref = {p["reference"]: p for p in prods}
tiers = {}
for p in prods:
    tiers[p["reference"]] = get("price_tiers", select="*", product_id=f"eq.{p['id']}",
                                order="min_qty.asc")

print(f"productos encontrados: {len(prods)} de {len(refs)}")

# ── Respaldo ────────────────────────────────────────────────────────────────
os.makedirs(BACKUPS, exist_ok=True)
bak = f"{BACKUPS}/bolsas_{STAMP}.json"
if APPLY:
    with open(bak, "w", encoding="utf-8") as f:
        json.dump({"products": prods, "price_tiers": tiers}, f, ensure_ascii=False, indent=2)
    print(f"respaldo -> {bak}")

# ── 1. Archivar los fabricados ──────────────────────────────────────────────
print("\n=== ARCHIVAR (active=false) ===")
for ref in FABRICADOS:
    p = by_ref.get(ref)
    if not p:
        print(f"  {ref}: no existe, se omite")
        continue
    print(f"  {ref} | {p['name']} | activo {p['active']} -> False")
    if APPLY:
        patch("products", {"id": f"eq.{p['id']}"}, {"active": False})

# ── 2. Corregir las legitimas ───────────────────────────────────────────────
print("\n=== CORREGIR TARIFAS (unitario -> lote_total) ===")
for ref, (hoja, precios) in REPARAR.items():
    p = by_ref.get(ref)
    if not p:
        print(f"  {ref}: no existe")
        continue
    print(f"\n  {ref} | {p['name']}")
    for t in tiers[ref]:
        lote = 50 if t["min_qty"] == 50 else (100 if t["min_qty"] == 100 else None)
        if lote is None:
            print(f"    tarifa {t['min_qty']}-{t['max_qty']}: no encaja en lote 50/100, SE DEJA IGUAL")
            continue
        nuevo = {
            "price_basis": "lote_total",
            "min_qty": lote,
            "max_qty": lote,
            "variant": VARIANTE[lote],
            "source_sheet": hoja,
        }
        if precios[lote] is not None:
            nuevo["price"] = precios[lote]
        antes = (f"{t['min_qty']}-{t['max_qty']} = {int(t['price']):,} ({t['price_basis']})")
        desp = (f"{lote}-{lote} = {int(nuevo.get('price', t['price'])):,} (lote_total)")
        print(f"    {antes}  ->  {desp}")
        if APPLY:
            patch("price_tiers", {"id": f"eq.{t['id']}"}, nuevo)

# ── 3. Purgar del indice vectorial los archivados ───────────────────────────
print("\n=== PURGA DEL INDICE VECTORIAL ===")
with open(INDEX, "r", encoding="utf-8") as f:
    idx = json.load(f)
sobran = [dp for dp in idx if dp["id"] in FABRICADOS]
print(f"  datapoints totales: {len(idx)} | a purgar: {len(sobran)} ({[d['id'] for d in sobran]})")
if APPLY and sobran:
    nuevos = [dp for dp in idx if dp["id"] not in FABRICADOS]
    tmp = INDEX + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(nuevos, f, ensure_ascii=False, indent=2)
    os.replace(tmp, INDEX)
    print(f"  indice guardado con {len(nuevos)} datapoints")

# ── 4. Invalidar caches ─────────────────────────────────────────────────────
if APPLY:
    try:
        print("\nreindex:", httpx.post("http://127.0.0.1:8001/reindex", timeout=60).json().get("stats"))
    except Exception as e:
        print("reindex fallo:", e)

print("\n=== MODO:", "APLICADO" if APPLY else "SIMULACION (sin --apply no se toca nada)", "===")
