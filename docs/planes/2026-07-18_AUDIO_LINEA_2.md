# PLAN DE MEJORA — Audios no llegan en `linea_2` (bot no escucha)

> **Plan de trabajo vivo.** Este archivo se actualiza a medida que avanzan las etapas.
> Marcá con `[x]` lo completado, `[~]` lo en progreso, `[ ]` lo pendiente.

---

## Metadata del plan

| Campo | Valor |
|---|---|
| **ID** | `2026-07-18_AUDIO_LINEA_2` |
| **Problema referenciado** | `docs/ESTADO_OPERATIVO.md` §4 → PROBLEMA A |
| **Severidad** | 🔴 Alto |
| **Fecha de creación** | 2026-07-18 |
| **Punto de restauración** | `20260718_142353` (ver `docs/ESTADO_OPERATIVO.md` §8) |
| **Archivos que se tocarán** | `wa-server/server.js`, `lib/whatsapp/webhook-processor.ts`, `lib/whatsapp/adapter.ts` |
| **Estado global** | 🟡 En progreso |

---

## 🎯 Objetivo

Que un audio PTT enviado por un cliente a `linea_2` (o cualquier línea) **nunca más sea ignorado en silencio**. Dos metas concretas:
1. **Resiliencia:** si la descarga del audio falla, el bot responde pidiendo al cliente que escriba, en vez de desaparecer.
2. **Visibilidad:** el error aparece en el panel de Seguimiento de líneas (`/lineas`) bajo "Descarga de media", para que sepas cuándo y por qué falla.

## 🔍 Causa raíz (confirmada con logs del VPS)

```
Cliente graba audio PTT
  → wa-server detecta msg.type === 'ptt'  ✅ entra al condicional
    → msg.downloadMedia() falla 2 veces (Puppeteer: ExecutionContext.#Evaluate)
      → mediaData = null
        → webhook envía {body: "", media: null}
          → adapter.ts:138 "if (!text && !media) return null"  ← descarta silenciosamente
            → el mensaje DESAPARECE, el bot nunca lo ve
```

El bug **no es de la transcripción** (eso está más adelante en el flujo y funciona). El bug es que **el mensaje se descarta antes de llegar al agente** cuando la descarga del media falla.

## ❌ Fuera de alcance de este plan

- El duplicado de mensajes en el panel (Problema C, no prioridad).
- Actualizar `whatsapp-web.js` a otra versión.
- Cambiar la lógica de transcripción Whisper (funciona bien cuando llega el audio).

---

## 📋 Etapas

### Etapa 0 — Verificación operativa (sin código) `[ ]`
**Objetivo:** confirmar que el problema es sesión-específico de `linea_2`, no un cambio global de WhatsApp Web.

- [ ] Enviar un audio de prueba a **`linea_1`** → si transcribe bien, confirma que es solo `linea_2`.
- [ ] Revisar logs del puente: `docker logs knowledgebot-wa-bridge 2>&1 | grep -E "media|ptt|audio" | tail -20`
- [ ] Si `linea_1` también falla → **PARAR este plan**, el problema es la librería y hay otra estrategia.

### Etapa 1 — Solución operativa de `linea_2` (sin código) `[ ]`
**Objetivo:** limpiar la sesión degradada de `linea_2`.

- [ ] Hacer logout de `linea_2`:
      `POST http://localhost:3004/api/sessions/linea_2/logout` con header `x-bridge-key`.
- [ ] Escanear el nuevo QR que aparece en el panel (`/lineas`).
- [ ] Enviar audio de prueba a `linea_2` → verificar que transcribe.
- [ ] Si funciona → **el problema operacional queda resuelto**, pero igual hacemos las Etapas 2-3 para que no vuelva a ser silencioso.

### Etapa 2 — Cambio de código: propagar el error `[ ]`
**Objetivo:** que un fallo de `downloadMedia()` sea visible y el bot pueda reaccionar.

- [ ] **`wa-server/server.js`** (líneas ~396-456):
      - [ ] Declarar `let mediaDownloadError = null;` junto a `mediaData`.
      - [ ] En el `catch` de `downloadMedia()`, setear `mediaDownloadError = { type, message }`.
      - [ ] Añadir `media_download_error: mediaDownloadError` al `JSON.stringify` del webhook POST.
- [ ] **`lib/whatsapp/webhook-processor.ts`** (líneas ~171-203):
      - [ ] Al inicio del bloque de transcripción, detectar `media_download_error`.
      - [ ] Llamar `logLineError({ errorType: 'media_download', severity: 'error', ... })` → aparece en panel.
      - [ ] Setear `message.text = '[Audio no disponible - error de descarga. Pídele amablemente al cliente que te lo envíe por escrito.]'`.
- [ ] **`lib/whatsapp/adapter.ts`** (línea 138):
      - [ ] Confirmar que con `message.text` seteado, el mensaje ya no cae en `return null`. Si hace falta, ajustar la condición.

### Etapa 3 — Verificación post-código `[ ]`
**Objetivo:** confirmar que el fix funciona sin romper nada.

- [ ] Enviar audio a `linea_1` → transcribe normal (regresión: nada roto).
- [ ] Simular o reproducir un fallo de descarga → aparece error "Descarga de media" en `/lineas`.
- [ ] Confirmar que el bot responde pidiendo al cliente que escriba (no lo ignora).
- [ ] Revisar que no aparecen errores nuevos en `docker logs knowledgebot-app`.

### Etapa 4 — Deploy `[ ]`
- [ ] Subir los 3 archivos al VPS (`server.js`, `webhook-processor.ts`, `adapter.ts`).
- [ ] Reiniciar `knowledgebot-wa-bridge` y `knowledgebot-app`.
- [ ] No requiere reiniciar el RAG Python.
- [ ] Prueba de humo final en producción.

### Etapa 5 — Cierre `[ ]`
- [ ] Añadir entrada a `docs/REGISTRO_DE_CAMBIOS.md`.
- [ ] Actualizar `docs/ESTADO_OPERATIVO.md` §4 (marcar PROBLEMA A como resuelto o degradado-controlado).
- [ ] Marcar este plan como ✅ completado en el encabezado.

---

## 🔙 Cómo revertir si algo se rompe

```powershell
$ts = "20260718_142353"
Copy-Item "wa-server\server.js.bak.RESTORE_POINT.$ts" wa-server\server.js -Force
Copy-Item "lib\whatsapp\webhook-processor.ts.bak.RESTORE_POINT.$ts" lib\whatsapp\webhook-processor.ts -Force
Copy-Item "lib\whatsapp\adapter.ts.bak.RESTORE_POINT.$ts" lib\whatsapp\adapter.ts -Force
Copy-Item "lib\agent\system-prompt.ts.bak.RESTORE_POINT.$ts" lib\agent\system-prompt.ts -Force
```

---

## 📝 Notas / aprendizajes

*(vacío — llenar a medida que se avanza)*
