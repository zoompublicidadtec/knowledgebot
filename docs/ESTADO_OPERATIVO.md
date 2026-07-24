# ESTADO OPERATIVO — KnowledgeBot SaaS (ZOOM Publicidad)

> **Fuente de verdad sobre el estado actual del sistema.**
> Verificado el 2026-07-23 tras la migración de `linea_1` a Baileys.
> El VPS es la fuente de verdad de facto (el repo local y GitHub están desactualizados).

---

## 0. Cómo leer este archivo

- ✅ = verificado y funcionando.
- ⚠️ = funciona con salvedades / degradado / frágil.
- 🔴 = roto o no implementado.
- 🚫 = **prohibido tocar** (ver §7).

---

## 1. Arquitectura real (lo que el código hace hoy)

```
┌─────────────────────────────────────────────────────────────────────┐
│  VPS Hostinger (2.25.169.103, usuario root)                         │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │  App Next.js         │    │  Puente WhatsApp (Node.js)        │  │
│  │  knowledgebot-app    │◄──►│  knowledgebot-wa-bridge (3004)    │  │
│  │  Puerto 3003         │    │  whatsapp-web.js 1.34.7 + Chrome  │  │
│  │  Next.js 16 + React  │    │  ATENDE linea_2 (producción)      │  │
│  └────────┬─────────────┘    └──────────────────────────────────┘  │
│           │                               ┌──────────────────────┐ │
│           │  (busca catálogo)             │ Puente Baileys       │ │
│           ▼                               │ knowledgebot-        │ │
│  ┌──────────────────────┐                 │ baileys-bridge (3005)│ │
│  │  Motor RAG Python    │                 │ @whiskeysockets/     │ │
│  │  FastAPI Puerto 8001 │                 │ baileys (sin Chrome) │ │
│  │  Búsqueda LOCAL NumPy│                 │ ATENDE linea_1       │ │
│  └──────────────────────┘                 └──────────────────────┘ │
│           │                                                         │
└───────────┼─────────────────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────────────┐   ┌──────────────────────────┐
   │  Supabase Cloud          │   │  Cloudflare R2           │
   │  PostgreSQL + pgvector   │   │  Bucket: knowledgebot-   │
   │  CRM, conversaciones,    │   │  fotos (imágenes/audios) │
   │  mensajes, productos     │   │  URLs firmadas de 1h     │
   └──────────────────────────┘   └──────────────────────────┘
```

### Los 4 pilares

| Pilar | Tecnología | Rol |
|---|---|---|
| **Puente WhatsApp (viejo)** | Node.js + `whatsapp-web.js` 1.34.7 (Puppeteer) | Atiende `linea_2`. No puede descargar media (bug `r \|\| r`). |
| **Puente WhatsApp (nuevo)** | Node.js + `@whiskeysockets/baileys` | Atiende `linea_1`. **Descarga imágenes y audios correctamente.** |
| **App Next.js** | Next.js 16 (App Router) + React 19 + Vercel AI SDK | Panel SaaS, webhooks, agente conversacional ("Oscar"). |
| **Motor Python** | FastAPI en puerto 8001 | Descubrimiento de productos por búsqueda semántica local NumPy. |

---

## 2. Versiones y modelo de IA

| Componente | Versión / Valor |
|---|---|
| Next.js | `16.2.7` |
| React | `19.2.4` |
| Vercel AI SDK | `ai ^6.0.194` |
| `whatsapp-web.js` (puente viejo) | `^1.34.7` |
| `@whiskeysockets/baileys` (puente nuevo) | `^6.7.9` |
| **LLM del agente** | `google/gemini-2.5-flash` vía OpenRouter |
| **Embeddings RAG** | `gemini-embedding-2` (3072D) |
| **Transcripción audios** | OpenRouter Whisper (whisper-large-v3-turbo) |
| **Visión de imágenes** | `google/gemini-2.5-flash` (describeImage, Buffer.from) |

---

## 3. Qué está ESTABLE y funcionando ✅

### Multimodalidad en `linea_1` (Baileys) ✅ NUEVO
- ✅ Imágenes: Baileys descarga → sube a R2 → Gemini describe → Oscar cotiza → responde.
- ✅ Audios/notas de voz: Baileys descarga → Whisper transcribe → Oscar responde.
- ✅ `linea_1` entra y sale por el puente Baileys (3005).

### Mensajes de texto
- ✅ Webhook `/api/webhooks/whatsapp` recibe mensajes con `line_key` (multi-línea).
- ✅ `linea_2` responde texto normalmente por el puente viejo (3004).

### Agente conversacional ("Oscar")
- ✅ System prompt con reglas + reglas especiales (cuadernos, DTF, formatos WhatsApp).
- ✅ Tools disponibles (catálogo, precios, citas, handoff, etc.).
- ✅ Anti-alucinación de precios (Regla 12 + CANDADO v4).

### Catálogo y precios
- ✅ Búsqueda semántica + fallback a Supabase RPC.
- ✅ 7,233 productos en `all_products.json`.

### Almacenamiento Cloudflare R2 ✅ NUEVO
- ✅ Imágenes/audios se suben a R2 (`r2-storage.ts`).
- ✅ Firma de URLs en lectura (`/api/media/signed-url`), nunca persistida.
- ✅ Purga de base64 del `raw` persistido en Supabase.

### Enrutado por línea ✅ NUEVO
- ✅ `getBridgeUrl(lineKey?)` lee `WHATSAPP_BRIDGE_ROUTES` (JSON).
- ✅ `linea_1` → `http://localhost:3005` (Baileys).
- ✅ `linea_2` → fallback a `WHATSAPP_BRIDGE_URL` (3004).

### Monitoreo de líneas
- ✅ Panel `/lineas` con detección de zombies (`isZombie` con `keepAliveErrors >= 10`).
- ✅ Panel `/integraciones` sincronizado.

### Control de versiones
- ✅ Git inicializado **dentro del VPS**. Commit P0 de seguridad: `36d2213`.
- ✅ `.gitignore` blindado (sesiones, `.env`, `.bak`, `node_modules`).

---

## 4. Qué está ROTO o degradado 🔴⚠️

### 🔴 PROBLEMA A — Multimodalidad en `linea_2` (puente viejo)
- **Síntoma:** `whatsapp-web.js` no puede descargar imágenes/audios. Error `r || r: r at #evaluate`.
- **Causa raíz confirmada con logs:** la librería es incompatible con la versión actual de WhatsApp Web. No tiene fix desde código.
- **Solución:** migrar `linea_2` a Baileys (mismo mecanismo que `linea_1`). **Pendiente.**

### ⚠️ PROBLEMA C — Mensajes duplicados
- **Síntoma:** el bot a veces responde dos veces.
- **Causa sospechada:** loop interno del agente o emisión doble del framework.
- **Estado:** documentado, no resuelto. El usuario lo conoce.

### 🟡 PENDIENTE — Migración del resto de líneas
- `linea_1` está en Baileys ✅. Faltan `linea_2` y las 6 líneas restantes (meta: 8 líneas en el CRM).
- Las líneas de prueba actuales NO son las definitivas de producción.

---

## 5. Variables de entorno relevantes

### `.env.production` (VPS)
| Variable | Valor/Estado |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://moaekovebocnagxkkiwm.supabase.co` |
| `OPENROUTER_API_KEY` | `sk-or-v1-...` |
| `CHAT_MODEL` | `google/gemini-2.5-flash` |
| `WHATSAPP_BRIDGE_URL` | `http://localhost:3004` (puente viejo, fallback global) |
| `WHATSAPP_BRIDGE_ROUTES` | `{"linea_1":"http://localhost:3005"}` ✅ NUEVO |
| `R2_BUCKET` | `knowledgebot-fotos` |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | configurados |

---

## 6. Cómo verificar el estado (sin tocar nada)

```bash
# Salud de los 3 servicios
docker logs --tail 50 knowledgebot-app
docker logs --tail 50 knowledgebot-wa-bridge      # puente viejo (linea_2)
docker logs --tail 50 knowledgebot-baileys-bridge  # puente nuevo (linea_1)

# Estado de líneas (Baileys)
curl -s http://localhost:3005/diagnostic
curl -s http://localhost:3005/metrics

# Estado de líneas (puente viejo)
curl -s http://localhost:3004/diagnostic

# Motor RAG
curl -s http://localhost:8001/health
```

---

## 7. 🚫 Qué NO tocar (prohibido o de muy alto riesgo)

1. **La conexión de WhatsApp.** El puente `whatsapp-web.js`/Baileys es la arquitectura definitiva. **Prohibido sugerir, recomendar o migrar a Meta Cloud API** (regla de `AGENTS.md`).
2. **El volumen `wwebjs_sessions` y `baileys_sessions`.** Contienen los tokens de autenticación.
3. **El entorno virtual `.venv` del Motor Python.**
4. **La tabla `line_error_log` y sus tipos.** El frontend mapea los labels.
5. **Los UUIDs hardcoded en `get-product-price.ts`.**
6. **`maxSteps: 30` del agente** sin verificar que los flujos de cuadernos no se corten.
7. **El prompt de Oscar (`system-prompt.ts`).** No agregar reglas de más (induce alucinaciones).
8. **Cambios destructivos en `all_products.json`** sin backup.
9. **RAG, embeddings, cotizaciones, CRM, autenticación.** Intocables salvo necesidad explícita.

---

## 8. Cómo revertir cambios (red de seguridad)

Git está inicializado en el VPS (`/root/knowledgebot/`).

```bash
# Restaurar un archivo a su último commit
cd /root/knowledgebot && git checkout HEAD -- <ruta/archivo>

# Restaurar TODO al snapshot P0 (estado pre-Baileys)
cd /root/knowledgebot && git reset --hard 36d2213
```

Los `.bak*` **no están en `.gitignore`** y no se commitean.

---

## 9. Rutas clave en el VPS

| Servicio | Ruta VPS | Puerto | Contenedor Docker |
|---|---|---|---|
| App Next.js | `/root/knowledgebot/` | 3003 | `knowledgebot-app` |
| Puente WhatsApp (viejo) | `/root/knowledgebot/wa-server/` | 3004 | `knowledgebot-wa-bridge` |
| Puente WhatsApp (Baileys) | `/root/knowledgebot/wa-server-baileys/` | 3005 | `knowledgebot-baileys-bridge` |
| Motor RAG Python | `/root/knowledgebot/Motor de Conocimiento/` | 8001 | (sin Docker, `.venv` + uvicorn) |

---

## 10. Historial de este documento

| Fecha | Cambio |
|---|---|
| 2026-07-18 | Creación inicial. |
| 2026-07-23 | Actualización tras migración de `linea_1` a Baileys. Multimodalidad (imágenes+audios) funcional end-to-end en `linea_1`. Enrutado por línea + R2 + firma en lectura activos. |
