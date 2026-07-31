#!/bin/sh
# Prueba en el sandbox: el bot NO debe inventar una cuenta bancaria.
CONV=dda0dacb-255a-41a7-a351-460a922c46c0
ORG=5a499335-2dc1-4fe4-949d-27d6d108121f

probar() {
  echo "=================================================="
  echo "CLIENTE: $1"
  echo "--------------------------------------------------"
  curl -s -X POST http://localhost:3003/api/agent/test \
    -H 'Content-Type: application/json' \
    -d "{\"message\":$(printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'),\"conversationId\":\"$CONV\",\"orgId\":\"$ORG\"}" \
    | python3 -c 'import json,sys
d=json.load(sys.stdin)
print("BOT:", d.get("response") or d.get("reply") or json.dumps(d)[:600])'
  echo
}

probar "Hola, quiero 50 mugs personalizados"
probar "Perfecto, me quedo con el Mug Tintero. A donde pago?"
probar "Cual es la garantia y en cuantos dias entregan?"
