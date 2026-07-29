"""Reparación completa de precios contra el catálogo de origen.

El importador concatenó los dígitos del campo `precio` (texto libre) sin
distinguir precios de cantidades:

    "Negro $8.500Natural, Azul Royal $ 10.900"  -> 850010900
    "Unidad $3.4901.000 unidadesColores"        -> 34901000   (precio $3.490)
    "Oferta $1.000Venta mínima ... 100 unidades"-> 1000100    (precio $1.000)

La clave es tomar, después de cada "$", SOLO el prefijo que forma un número
válido con separadores de miles (1-3 dígitos y grupos de 3), y descartar lo
que venga pegado detrás.

Revisa TODAS las referencias importadas, no solo las de cifras extremas.

Uso: python reparar_precios_v2.py [--apply]
"""
import os, re, csv, sys, json
from collections import defaultdict
from datetime import datetime
import httpx
from dotenv import load_dotenv

load_dotenv("/root/knowledgebot/.env.production")
U = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
K = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
H = {"apikey": K, "Authorization": f"Bearer {K}", "Content-Type": "application/json"}
APPLY = "--apply" in sys.argv
CSV_PATH = "/root/knowledgebot/data/catalogo_productos.csv"
c = httpx.Client(timeout=120)

# Un precio bien formado: 1-3 dígitos y luego grupos de 3 separados por punto.
PRECIO = re.compile(r"\$\s*(\d{1,3}(?:\.\d{3})*|\d{3,7})")
RANGO = re.compile(
    r"Precio\s+de\s+([\d.]+)\s*a\s*([\d.]+)\s*unidades?\s*:?\s*\$\s*(\d{1,3}(?:\.\d{3})*|\d{3,7})", re.I)
RANGO_DESDE = re.compile(
    r"Precio\s+(?:de|desde)\s+([\d.]+)\s*unidades?\s+en\s+adelante\s*:?\s*\$\s*(\d{1,3}(?:\.\d{3})*|\d{3,7})", re.I)
ETIQUETA = re.compile(
    r"([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ ,/()-]{2,38}?)\s*:?\s*\$\s*(\d{1,3}(?:\.\d{3})*|\d{3,7})")

RUIDO = re.compile(r"cantidad|m[ií]nim|inyecci|unidad|venta|m[uú]ltipl|caja|estuche|incluid|"
                   r"precio|desde|colores de l[ií]nea|oferta|ver |consulte|nota", re.I)


def num(s):
    s = str(s).replace(".", "").strip()
    return int(s) if s.isdigit() else None


def parse_precio(texto):
    if not texto or not texto.strip():
        return []
    t = texto.strip()
    if "VARIABLE" in t.upper() or "COMUNICADO" in t.upper():
        return []

    out = []
    # "PRECIO BOMBA 200-999 $3.050" / "1.000-2.999 $2.880" / "3.000 o más $2.730"
    for m in re.finditer(r"([\d.]{3,7})\s*[-–]\s*([\d.]{3,7})\s*\$\s*(\d{1,3}(?:\.\d{3})*|\d{3,7})", t):
        lo, hi, pr = num(m.group(1)), num(m.group(2)), num(m.group(3))
        if lo and pr:
            out.append(("Estándar", lo, hi, pr))
    for m in re.finditer(r"([\d.]{3,7})\s*o\s*m[aá]s\s*\$\s*(\d{1,3}(?:\.\d{3})*|\d{3,7})", t, re.I):
        lo, pr = num(m.group(1)), num(m.group(2))
        if lo and pr:
            out.append(("Estándar", lo, None, pr))
    if out:
        return out

    for m in RANGO.finditer(t):
        lo, hi, pr = num(m.group(1)), num(m.group(2)), num(m.group(3))
        if lo and pr:
            out.append(("Estándar", lo, hi, pr))
    for m in RANGO_DESDE.finditer(t):
        lo, pr = num(m.group(1)), num(m.group(2))
        if lo and pr:
            out.append(("Estándar", lo, None, pr))
    if out:
        return out

    vs = []
    for m in ETIQUETA.finditer(t):
        etiqueta = m.group(1).strip(" ,/-:")
        precio = num(m.group(2))
        if not precio:
            continue
        if RUIDO.search(etiqueta) or len(etiqueta) < 3:
            etiqueta = "Estándar"
        vs.append((etiqueta[:40], 1, None, precio))

    # Todo precio con "$" cuenta. Sin esto se perdía el precio base cuando iba
    # al principio sin etiqueta ("$7.990Adicional Sublimación $3.959").
    sueltos = [x for x in (num(y) for y in PRECIO.findall(t)) if x]
    ya = {v[3] for v in vs}
    for s in sueltos:
        if s not in ya:
            ya.add(s)
            vs.append(("Estándar", 1, None, s))

    if not vs:
        return []

    seen, uniq = set(), []
    for v in sorted(vs, key=lambda x: x[3]):
        if v[3] in seen:
            continue
        seen.add(v[3])
        uniq.append(v)
    return uniq


# ── Origen ─────────────────────────────────────────────────────────────────
origen = {}
with open(CSV_PATH, encoding="utf-8-sig") as f:
    for r in csv.DictReader(f):
        ref = (r.get("referencia") or "").strip()
        if ref and ref not in origen:
            origen[ref] = r.get("precio") or ""
print(f"catálogo de origen: {len(origen)} referencias")

# ── Estado actual (solo productos activos) ─────────────────────────────────
prods, off = [], 0
while True:
    b = c.get(f"{U}/rest/v1/products",
              params={"select": "id,reference,name", "active": "eq.true",
                      "limit": 1000, "offset": off, "order": "id.asc"}, headers=H).json()
    prods += b
    if len(b) < 1000:
        break
    off += 1000

tiers, off = [], 0
while True:
    b = c.get(f"{U}/rest/v1/price_tiers",
              params={"select": "id,product_id,price,min_qty,max_qty,variant,price_basis",
                      "limit": 1000, "offset": off, "order": "id.asc"}, headers=H).json()
    tiers += b
    if len(b) < 1000:
        break
    off += 1000

tby = defaultdict(list)
for t in tiers:
    tby[t["product_id"]].append(t)

reparar = []
for p in prods:
    ref = (p.get("reference") or "").strip()
    texto = origen.get(ref)
    if texto is None:
        continue  # producto propio de ZOOM: su precio no viene de este CSV
    esperado = parse_precio(texto)
    if not esperado:
        continue
    actuales = [t for t in tby.get(p["id"], []) if t["price_basis"] == "unitario"]
    if not actuales:
        continue
    precios_bd = sorted({int(float(t["price"])) for t in actuales})
    precios_ok = sorted({v[3] for v in esperado})
    if precios_bd != precios_ok:
        reparar.append((p, texto, actuales, esperado, precios_bd, precios_ok))

print(f"productos activos con precio distinto al origen: {len(reparar)}\n")
print("=== MUESTRA ===")
for p, texto, act, esp, bd, ok in reparar[:12]:
    print(f"\n{p['reference']}: {p['name'][:46]}")
    print(f"   origen: {texto[:90]!r}")
    print(f"   BD:  {bd}")
    print(f"   ->   {[(v[0], v[3]) for v in esp]}")

if not APPLY:
    print("\n[ENSAYO EN SECO] Ejecuta con --apply para escribir.")
    sys.exit(0)

stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
bak = f"/root/knowledgebot/backups/tarifas_prev_{stamp}.json"
with open(bak, "w", encoding="utf-8") as f:
    json.dump([{"ref": p["reference"], "tiers": act} for p, _, act, _, _, _ in reparar],
              f, ensure_ascii=False)
print(f"\nrespaldo: {bak}")

ok_count = 0
for p, texto, act, esp, bd, okp in reparar:
    ids = ",".join(t["id"] for t in act)
    d = c.delete(f"{U}/rest/v1/price_tiers", params={"id": f"in.({ids})"},
                 headers={**H, "Prefer": "return=minimal"})
    if d.status_code >= 300:
        print("  ERROR borrando", p["reference"], d.text[:120])
        continue
    payload = [{"product_id": p["id"], "variant": v, "min_qty": lo, "max_qty": hi,
                "price": pr, "price_basis": "unitario", "currency": "COP",
                "source_sheet": "Reparado desde catalogo_productos.csv"}
               for v, lo, hi, pr in esp]
    ins = c.post(f"{U}/rest/v1/price_tiers", headers={**H, "Prefer": "return=minimal"}, json=payload)
    if ins.status_code >= 300:
        print("  ERROR insertando", p["reference"], ins.text[:120])
        continue
    ok_count += 1
    if ok_count % 50 == 0:
        print(f"  reparados {ok_count}/{len(reparar)}")

print(f"\nOK — {ok_count} productos reparados. Revertir con {bak}")
