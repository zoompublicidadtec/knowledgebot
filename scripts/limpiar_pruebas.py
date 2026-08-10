#!/usr/bin/env python3
"""
Borra los contactos de PRUEBA que creo la bateria (telefonos 5739...@c.us con
nombre "Prueba"), con sus conversaciones y mensajes. Respalda todo antes.

Solo toca lo que empieza por 5739: ningun contacto de verdad usa ese prefijo.
"""
import json
import os
import urllib.request
from datetime import datetime

url = (os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")).rstrip("/")
key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
H = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}


def pedir(path, metodo="GET", extra=None):
    h = dict(H)
    if extra:
        h.update(extra)
    req = urllib.request.Request(url + path, headers=h, method=metodo)
    with urllib.request.urlopen(req, timeout=120) as r:
        cuerpo = r.read().decode("utf-8")
        return json.loads(cuerpo) if cuerpo.strip() else []


contactos = pedir("/rest/v1/contacts?select=id,wa_phone,full_name&wa_phone=like.5739*")
print("contactos de prueba encontrados: %d" % len(contactos))
if not contactos:
    raise SystemExit("nada que limpiar")

ids = [c["id"] for c in contactos]
lista = "(" + ",".join('"%s"' % i for i in ids) + ")"

convs = pedir("/rest/v1/conversations?select=id,contact_id&contact_id=in." + lista)
print("conversaciones de prueba          : %d" % len(convs))

sello = datetime.now().strftime("%Y%m%d_%H%M%S")
os.makedirs("/root/knowledgebot/backups", exist_ok=True)
ruta = "/root/knowledgebot/backups/pruebas_borradas_%s.json" % sello
with open(ruta, "w", encoding="utf-8") as f:
    json.dump({"contactos": contactos, "conversaciones": convs}, f, ensure_ascii=False, indent=1)
print("respaldo: %s" % ruta)

if convs:
    listaConv = "(" + ",".join('"%s"' % c["id"] for c in convs) + ")"
    pedir("/rest/v1/messages?conversation_id=in." + listaConv, "DELETE", {"Prefer": "return=minimal"})
    print("mensajes borrados")
    pedir("/rest/v1/conversations?id=in." + listaConv, "DELETE", {"Prefer": "return=minimal"})
    print("conversaciones borradas")

pedir("/rest/v1/contacts?id=in." + lista, "DELETE", {"Prefer": "return=minimal"})
print("contactos borrados")

quedan = pedir("/rest/v1/contacts?select=id&wa_phone=like.5739*")
print("quedan contactos de prueba: %d" % len(quedan))
