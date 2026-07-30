"""
Prueba de punta a punta del camino de media, SIN tocar WhatsApp.

Simula el webhook que manda el puente Baileys con una nota de voz adjunta y
comprueba que:
  1. La app resuelve el contacto y la conversacion de la linea correcta.
  2. El archivo se sube a Cloudflare R2 y queda su clave en messages.raw.
  3. El base64 NO queda guardado en la base.

Usa el contacto de prueba +10000000000 con el bot DESACTIVADO en esa
conversacion, para que el agente no se ejecute y no se envie nada a nadie.
"""
import os
import json
import base64
import time
from dotenv import load_dotenv
import httpx

load_dotenv("/root/knowledgebot/.env.production")
URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BRIDGE_KEY = os.environ.get("BRIDGE_API_KEY", "")
APP = "http://localhost:3003"
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

TEL = "+10000000000"
LINEA = "linea_2"


def sb_get(path, params):
    r = httpx.get(f"{URL}/rest/v1/{path}", headers=H, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def sb_post(path, body, prefer="return=representation"):
    r = httpx.post(f"{URL}/rest/v1/{path}", headers={**H, "Prefer": prefer}, json=body, timeout=60)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, body):
    r = httpx.patch(
        f"{URL}/rest/v1/{path}",
        headers={**H, "Prefer": "return=representation"},
        params=params,
        json=body,
        timeout=60,
    )
    r.raise_for_status()
    return r.json()


print("=" * 74)
print(" PRUEBA DEL CAMINO DE MEDIA  (webhook -> R2 -> base)   sin tocar WhatsApp")
print("=" * 74)

# ---------------------------------------------------------------- organizacion
org = sb_get("whatsapp_lines", {"select": "organization_id", "line_key": f"eq.{LINEA}"})
if not org:
    raise SystemExit(f"no existe la linea {LINEA}")
ORG = org[0]["organization_id"]
print(f"organizacion: {ORG}")

# ---------------------------------------------------------------- contacto
c = sb_get("contacts", {"select": "id,wa_phone", "organization_id": f"eq.{ORG}", "wa_phone": f"eq.{TEL}"})
if c:
    contact_id = c[0]["id"]
    print(f"contacto de prueba: ya existia  {contact_id}")
else:
    contact_id = sb_post("contacts", {"organization_id": ORG, "wa_phone": TEL, "full_name": "Cliente Demo"})[0]["id"]
    print(f"contacto de prueba: creado  {contact_id}")

# --------------------------------------------- conversacion con el bot APAGADO
cv = sb_get(
    "conversations",
    {"select": "id,bot_active", "organization_id": f"eq.{ORG}", "contact_id": f"eq.{contact_id}", "line_key": f"eq.{LINEA}"},
)
if cv:
    conv_id = cv[0]["id"]
    if cv[0].get("bot_active"):
        sb_patch("conversations", {"id": f"eq.{conv_id}"}, {"bot_active": False})
    print(f"conversacion: ya existia  {conv_id}  (bot apagado)")
else:
    conv_id = sb_post(
        "conversations",
        {"organization_id": ORG, "contact_id": contact_id, "line_key": LINEA, "bot_active": False},
    )[0]["id"]
    print(f"conversacion: creada  {conv_id}  (bot apagado)")

# ---------------------------------------------------------------- el webhook
# Cabecera OGG minima. Whisper no va a entenderlo y eso da igual: lo que se
# prueba aqui es que el archivo llega a R2 y que su clave queda en la base.
audio = b"OggS" + b"\x00" * 24 + b"prueba-knowledgebot"
b64 = base64.b64encode(audio).decode()
msg_id = f"PRUEBA_MEDIA_{int(time.time())}"

payload = {
    "event": "message.received",
    "line_key": LINEA,
    "data": {
        "message": {
            "id": msg_id,
            "from": TEL,
            "to": TEL,
            "fromMe": False,
            "body": "",
            "type": "ptt",
            "mediaType": "ptt",
            "media": {"data": b64, "mimetype": "audio/ogg; codecs=opus", "filename": "prueba.ogg"},
            "mediaError": False,
            "customerName": "Cliente Demo",
        }
    },
}

print(f"\nenviando webhook simulado  id={msg_id}  audio={len(audio)} bytes")
t0 = time.time()
r = httpx.post(
    f"{APP}/api/webhooks/whatsapp",
    headers={"Content-Type": "application/json", "x-bridge-key": BRIDGE_KEY},
    json=payload,
    timeout=180,
)
print(f"respuesta del webhook: HTTP {r.status_code}  en {time.time()-t0:.1f}s")
print(f"cuerpo: {r.text[:200]}")

# ---------------------------------------------------------------- comprobacion
print("\n" + "=" * 74)
print(" QUE QUEDO EN LA BASE")
print("=" * 74)
time.sleep(2)
rows = sb_get("messages", {"select": "id,content,raw,line_key,direction,created_at", "wa_message_id": f"eq.{msg_id}"})
if not rows:
    print("NO se guardo el mensaje. RESULTADO: FALLA")
    raise SystemExit(1)

m = rows[0]
raw = m.get("raw") or {}
media = ((raw.get("data") or {}).get("message") or {}).get("media") or {}
print(f"linea      : {m.get('line_key')}")
print(f"contenido  : {(m.get('content') or '')[:70]!r}")
print(f"media.r2_key    : {media.get('r2_key')}")
print(f"media.mimetype  : {media.get('mimetype')}")
print(f"media.size_bytes: {media.get('size_bytes')}")
print(f"media.data      : {media.get('data')!r}   <- debe ser None")

ok_key = bool(media.get("r2_key"))
ok_sin_base64 = media.get("data") is None
ok_tamano = media.get("size_bytes") == len(audio)

print()
print(f"  clave de R2 guardada      : {'SI' if ok_key else 'NO'}")
print(f"  base64 fuera de la base   : {'SI' if ok_sin_base64 else 'NO'}")
print(f"  tamano correcto           : {'SI' if ok_tamano else 'NO'} ({media.get('size_bytes')} vs {len(audio)})")

with open("/root/_ultima_clave_r2.txt", "w") as f:
    f.write(media.get("r2_key") or "")

print()
print("RESULTADO:", "CAMINO COMPLETO OK" if (ok_key and ok_sin_base64 and ok_tamano) else "FALLA")
