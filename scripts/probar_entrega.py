"""
Prueba de ENTREGA REAL sin molestar al dueno.

Manda un mensaje de linea_2 a linea_1 (las dos son suyas) por el puente que
ahora deberia entregar, y comprueba que llega de verdad:
  - que el puente no devuelva error
  - que NO aparezca el acuse rechazado 463
  - que el mensaje entre por el webhook y quede en la base

Antes apaga el bot en los hilos entre las dos lineas, o se responderian
mutuamente en un bucle infinito.
"""
import os
import re
import time
import json
from dotenv import load_dotenv
import httpx

load_dotenv("/root/knowledgebot/.env.production")
URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
BRIDGE_KEY = os.environ.get("BRIDGE_API_KEY", "")
H = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}

TEL_L1 = "573011022628"
TEL_L2 = "573107975278"


def sb(path, params):
    r = httpx.get(f"{URL}/rest/v1/{path}", headers=H, params=params, timeout=60)
    r.raise_for_status()
    return r.json()


def sb_patch(path, params, body):
    r = httpx.patch(f"{URL}/rest/v1/{path}", headers={**H, "Prefer": "return=representation"},
                    params=params, json=body, timeout=60)
    r.raise_for_status()
    return r.json()


print("=" * 78)
print(" 1) APAGAR EL BOT EN LOS HILOS ENTRE LAS DOS LINEAS (evita el bucle)")
print("=" * 78)
contactos = sb("contacts", {"select": "id,wa_phone,full_name"})
internos = [c for c in contactos if re.sub(r"\D", "", (c.get("wa_phone") or "")).endswith((TEL_L1[-10:], TEL_L2[-10:]))]
ids = [c["id"] for c in internos]
for c in internos:
    print(f"  contacto interno: {c.get('wa_phone')}  {c.get('full_name')!r}")

apagadas = 0
if ids:
    convs = sb("conversations", {"select": "id,contact_id,line_key,bot_active",
                                 "contact_id": "in.(" + ",".join(ids) + ")"})
    for cv in convs:
        if cv.get("bot_active"):
            sb_patch("conversations", {"id": f"eq.{cv['id']}"}, {"bot_active": False})
            apagadas += 1
        print(f"  hilo {cv['id'][:8]} linea={cv.get('line_key')} -> bot apagado")
print(f"  hilos apagados ahora: {apagadas}")

print()
print("=" * 78)
print(" 2) ESTADO DE LOS PUENTES")
print("=" * 78)
d4 = httpx.get("http://localhost:3004/diagnostic", timeout=15).json()
try:
    d5 = httpx.get("http://localhost:3005/diagnostic", timeout=15).json()
except Exception:
    d5 = {"sessions": {}}
    print("  3005  (parado)")
for k, v in (d4.get("sessions") or {}).items():
    print(f"  3004  {k:9s} {v.get('status'):14s} tel={v.get('phoneNumber')}")
for k, v in (d5.get("sessions") or {}).items():
    print(f"  3005  {k:9s} {v.get('status'):14s} tel={v.get('phoneNumber')}")

l2 = (d4.get("sessions") or {}).get("linea_2") or {}
if l2.get("status") != "connected":
    print(f"\n  linea_2 NO esta conectada en el 3004 (status={l2.get('status')}). No se puede probar el envio.")
    raise SystemExit(1)

print()
print("=" * 78)
print(" 3) ENVIAR de linea_2 a linea_1 POR EL PUENTE QUE DEBE ENTREGAR (3004)")
print("=" * 78)
marca = f"PRUEBA-ENTREGA-{int(time.time())}"
t0 = time.time()
r = httpx.post(
    f"http://localhost:3004/api/sessions/linea_2/messages/send-text",
    headers={"Content-Type": "application/json", "X-API-Key": BRIDGE_KEY},
    json={"chatId": TEL_L1, "text": f"{marca} — verificacion automatica del puente, ignorar."},
    timeout=90,
)
print(f"  HTTP {r.status_code} en {time.time()-t0:.1f}s")
print(f"  respuesta: {r.text[:200]}")
enviado_id = None
try:
    enviado_id = (r.json().get("data") or {}).get("id")
except Exception:
    pass
print(f"  id devuelto: {enviado_id}")

print()
print("  esperando 12s a que WhatsApp entregue y el webhook lo registre...")
time.sleep(12)

print()
print("=" * 78)
print(" 4) LLEGO DE VERDAD? (debe aparecer como ENTRANTE en linea_1)")
print("=" * 78)
msgs = sb("messages", {"select": "line_key,direction,content,wa_message_id,created_at",
                       "order": "created_at.desc", "limit": 15})
encontrado = None
for m in msgs:
    if marca in (m.get("content") or ""):
        encontrado = m
        print(f"  ENCONTRADO -> linea={m.get('line_key')} direccion={m['direction']} "
              f"id={m.get('wa_message_id')}")
        break

if not encontrado:
    print("  no aparece todavia. Ultimos mensajes:")
    for m in msgs[:6]:
        print(f"    {m['created_at'][11:19]} {str(m.get('line_key')):8s} {m['direction']:8s} "
              f"{(m.get('content') or '')[:52]!r}")

print()
print("=" * 78)
print(" VEREDICTO")
print("=" * 78)
print(f"  puente acepto el envio : {'SI' if r.status_code == 200 else 'NO (HTTP ' + str(r.status_code) + ')'}")
print(f"  llego a la otra linea  : {'SI' if encontrado else 'NO'}")
print()
print("  (revisar aparte el log del 3004 por si hubo acuse 463)")
with open("/root/_marca_prueba.txt", "w") as f:
    f.write(marca)
