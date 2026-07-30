"""
Fusiona las fichas de contacto duplicadas: una persona, una ficha.

POR QUE
-------
`webhook-processor` guardaba el contacto por `wa_phone` tal como lo entregaba
el puente, sin canonizar, y cada puente nombra al mismo cliente distinto. La
misma persona acababa con varias fichas y el bot perdia su historial.
Medido el 2026-07-30: `victor ramirez` con 3 fichas, `VRS Digital` con 2.

CUIDADO CON EL CASCADE
----------------------
`conversations.contact_id` y `appointments.contact_id` son ON DELETE CASCADE, y
`messages.conversation_id` tambien. Borrar un contacto duplicado se llevaria sus
conversaciones y TODOS sus mensajes. Por eso primero se repunta y solo despues
se borra la ficha, ya vacia.

CRITERIO
--------
Dos identificadores son la misma persona si comparten los digitos. Los `@lid`
son identificadores internos de 14-15 digitos, no telefonos, asi que solo se
unen con otro registro de los mismos digitos; nunca se adivina el telefono que
hay detras.

Ficha que sobrevive: la mas antigua, que es la que tiene el historial.

Uso:  python fusionar_contactos.py [probar|aplicar]
"""
import os
import sys
import json
import re
import collections
from datetime import datetime, timezone

from dotenv import load_dotenv
import httpx

MODO = sys.argv[1] if len(sys.argv) > 1 else "probar"
APLICAR = MODO == "aplicar"

load_dotenv("/root/knowledgebot/.env.production")
URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
H = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}
BACKUP_DIR = "/root/knowledgebot/backups"


def get(path, params=None):
    r = httpx.get(f"{URL}/rest/v1/{path}", headers=H, params=params or {}, timeout=90)
    r.raise_for_status()
    return r.json()


def page(path, params):
    rows, off, size = [], 0, 1000
    while True:
        p = dict(params)
        p["limit"] = size
        p["offset"] = off
        b = get(path, p)
        rows += b
        if len(b) < size:
            break
        off += size
    return rows


def patch(path, params, body):
    r = httpx.patch(
        f"{URL}/rest/v1/{path}",
        headers={**H, "Prefer": "return=representation"},
        params=params,
        json=body,
        timeout=90,
    )
    r.raise_for_status()
    return r.json()


def delete(path, params):
    r = httpx.delete(
        f"{URL}/rest/v1/{path}",
        headers={**H, "Prefer": "return=representation"},
        params=params,
        timeout=90,
    )
    r.raise_for_status()
    return r.json()


def wa_digits(wa_id):
    raw = str(wa_id or "").strip()
    if not raw:
        return ""
    user = raw.split("@")[0].split(":")[0]
    return re.sub(r"\D", "", user)


def ts(row, field="created_at"):
    v = row.get(field)
    if not v:
        return datetime.max.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00"))
    except Exception:
        return datetime.max.replace(tzinfo=timezone.utc)


print("=" * 70)
print(f" FUSION DE CONTACTOS  ---  MODO: {MODO.upper()}")
if not APLICAR:
    print(" (nada se escribe; usar 'aplicar' para ejecutar)")
print("=" * 70)

contacts = page("contacts", {"select": "id,organization_id,wa_phone,full_name,created_at,metadata"})
convs = page("conversations", {"select": "id,organization_id,contact_id,line_key,bot_active,last_message_at,created_at"})
appts = page("appointments", {"select": "id,contact_id"})
msg_counts = collections.Counter()
for m in page("messages", {"select": "conversation_id"}):
    msg_counts[m.get("conversation_id")] += 1

print(f"\ncontactos={len(contacts)}  conversaciones={len(convs)}  citas={len(appts)}  mensajes={sum(msg_counts.values())}")

# ---------------------------------------------------------------- respaldo
if APLICAR:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    path = f"{BACKUP_DIR}/contactos_fusion_{stamp}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generado": stamp,
                "motivo": "fusion de fichas duplicadas previa a la migracion de linea_2 a Baileys",
                "contacts": contacts,
                "conversations": convs,
                "appointments": appts,
                "conteo_mensajes_por_conversacion": dict(msg_counts),
            },
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"respaldo -> {path}")

convs_by_contact = collections.defaultdict(list)
for c in convs:
    convs_by_contact[c["contact_id"]].append(c)


def mask(d):
    return f"{d[:5]}...{d[-3:]}" if len(d) > 8 else d


# ============================================================
# PASO 1 - fusionar fichas de contacto con los mismos digitos
# ============================================================
print("\n" + "=" * 70)
print(" PASO 1: fichas de contacto con los mismos digitos")
print("=" * 70)

grupos = collections.defaultdict(list)
for c in contacts:
    d = wa_digits(c.get("wa_phone"))
    if d:
        grupos[(c.get("organization_id"), d)].append(c)

fusionadas = 0
contact_remap = {}

for (org, digits), rows in sorted(grupos.items(), key=lambda kv: kv[0][1]):
    if len(rows) < 2:
        continue
    rows.sort(key=ts)
    canon, dups = rows[0], rows[1:]
    nombre = canon.get("full_name") or "(sin nombre)"
    print(f"\n  {mask(digits)}  \"{nombre}\"")
    print(f"    SOBREVIVE  {canon['wa_phone']!r}  (creada {canon.get('created_at')})")
    for d in dups:
        n_convs = len(convs_by_contact.get(d["id"], []))
        n_msgs = sum(msg_counts.get(cv["id"], 0) for cv in convs_by_contact.get(d["id"], []))
        n_appt = sum(1 for a in appts if a.get("contact_id") == d["id"])
        print(f"    se fusiona {d['wa_phone']!r}  -> {n_convs} conversacion(es), {n_msgs} mensaje(s), {n_appt} cita(s)")
        contact_remap[d["id"]] = canon["id"]

        if APLICAR:
            # 1) Repuntar sus conversaciones y citas ANTES de borrar la ficha,
            #    porque el CASCADE se las llevaria con todo su historial.
            for cv in convs_by_contact.get(d["id"], []):
                patch("conversations", {"id": f"eq.{cv['id']}"}, {"contact_id": canon["id"]})
                cv["contact_id"] = canon["id"]
            for a in appts:
                if a.get("contact_id") == d["id"]:
                    patch("appointments", {"id": f"eq.{a['id']}"}, {"contact_id": canon["id"]})
                    a["contact_id"] = canon["id"]
            # 2) Guardar el identificador fusionado, para no perder el rastro.
            meta = canon.get("metadata") or {}
            if not isinstance(meta, dict):
                meta = {}
            alias = meta.get("wa_ids_fusionados") or []
            if d["wa_phone"] not in alias:
                alias.append(d["wa_phone"])
            meta["wa_ids_fusionados"] = alias
            patch("contacts", {"id": f"eq.{canon['id']}"}, {"metadata": meta})
            canon["metadata"] = meta
            # 3) Ahora la ficha esta vacia y se puede borrar sin arrastrar nada.
            delete("contacts", {"id": f"eq.{d['id']}"})
        fusionadas += 1

if fusionadas == 0:
    print("  ninguna: no hay fichas duplicadas")

# Rehacer el indice por contacto con los cambios aplicados.
convs_by_contact = collections.defaultdict(list)
for c in convs:
    if c["contact_id"] in contact_remap:
        c["contact_id"] = contact_remap[c["contact_id"]]
    convs_by_contact[c["contact_id"]].append(c)

# ============================================================
# PASO 2 - una conversacion por contacto y linea
# ============================================================
print("\n" + "=" * 70)
print(" PASO 2: conversaciones repetidas del mismo contacto en la misma linea")
print("=" * 70)

dup_convs = 0
for contact_id, rows in convs_by_contact.items():
    por_linea = collections.defaultdict(list)
    for cv in rows:
        por_linea[cv.get("line_key")].append(cv)

    for line_key, grupo in por_linea.items():
        if len(grupo) < 2:
            continue
        grupo.sort(key=ts)
        keep, extra = grupo[0], grupo[1:]
        nombre = next((c.get("full_name") for c in contacts if c["id"] == contact_id), "?")
        print(f"\n  contacto \"{nombre}\" en linea {line_key}: {len(grupo)} conversaciones")
        print(f"    SE QUEDA  {keep['id']}  ({msg_counts.get(keep['id'], 0)} mensajes, creada {keep.get('created_at')})")
        for cv in extra:
            n = msg_counts.get(cv["id"], 0)
            print(f"    se vuelca {cv['id']}  ({n} mensajes)")
            if APLICAR:
                # Mover los mensajes y solo entonces borrar la conversacion,
                # que a esas alturas ya no arrastra nada.
                patch("messages", {"conversation_id": f"eq.{cv['id']}"}, {"conversation_id": keep["id"]})
                delete("conversations", {"id": f"eq.{cv['id']}"})
            dup_convs += 1

if dup_convs == 0:
    print("  ninguna: cada contacto tiene una sola conversacion por linea")

# ============================================================
# COMPROBACION
# ============================================================
print("\n" + "=" * 70)
print(" COMPROBACION")
print("=" * 70)

c2 = page("contacts", {"select": "id,wa_phone,full_name"})
cv2 = page("conversations", {"select": "id,contact_id,line_key"})
m2 = page("messages", {"select": "id"})
print(f"contactos: {len(contacts)} -> {len(c2)}")
print(f"conversaciones: {len(convs)} -> {len(cv2)}")
print(f"mensajes: {sum(msg_counts.values())} -> {len(m2)}   (NO deben perderse)")

g2 = collections.defaultdict(list)
for c in c2:
    d = wa_digits(c.get("wa_phone"))
    if d:
        g2[d].append(c["wa_phone"])
resto = {d: v for d, v in g2.items() if len(v) > 1}
print(f"digitos con mas de una ficha: {len(resto)}")
for d, v in resto.items():
    print(f"  {mask(d)} -> {v}")

par = collections.Counter((c["contact_id"], c.get("line_key")) for c in cv2)
resto2 = {k: v for k, v in par.items() if v > 1}
print(f"pares contacto+linea con mas de una conversacion: {len(resto2)}")
