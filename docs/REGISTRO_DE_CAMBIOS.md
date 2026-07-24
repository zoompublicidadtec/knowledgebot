# REGISTRO DE CAMBIOS — KnowledgeBot SaaS (ZOOM Publicidad)

> Bitácora operativa de cada cambio real que se hace al sistema.
> **Una fila por cambio.** Memoria auditable del proyecto.

---

## Cómo usar este registro

Después de **cualquier** cambio, añade una fila con: Fecha, Objetivo, Archivos tocados, Prueba realizada, Resultado.

**Reglas:**
- Nunca borres filas anteriores.
- Si un cambio se revierte, añade una fila nueva diciendo "Revertido el cambio del YYYY-MM-DD".
- Crea un `.bak.RESTORE_POINT.<timestamp>` antes de cambios grandes.

---

## Bitácora

| Fecha | Objetivo | Archivos tocados | Prueba realizada | Resultado |
|---|---|---|---|---|
| 2026-07-18 | Documentación operativa inicial. | `docs/ESTADO_OPERATIVO.md`, `docs/REGISTRO_DE_CAMBIOS.md`, `AGENTS.md` | Lectura cruzada de memoria vs código. | ✅ OK |
| 2026-07-21 | Restauración del pipeline multimodal (visión de imágenes + audio). | `lib/whatsapp/webhook-processor.ts` | Backup + tsc. | ⚠️ Revertido por el usuario. |
| 2026-07-21 | Reversión completa + limpieza de scripts `.py` con credenciales. | `webhook-processor.ts`, 20 scripts `.py` eliminados | grep de credenciales. | ✅ OK |
| 2026-07-21 | Mejora del panel de líneas: `isZombie` ahora evalúa `keepAliveErrors >= 10`. | `app/api/whatsapp-lines/diagnostic/route.ts`, `app/(app)/integraciones/whatsapp/client-page.tsx` | Prueba visual. | ✅ OK |
| 2026-07-21 | `protocolTimeout: 180000` en puente viejo + `Buffer.from` en describe-image. | `wa-server/server.js`, `lib/whatsapp/describe-image.ts` | Rebuild puente. | ⚠️ No solucionó el bug de descarga. |
| 2026-07-22 | **P0: Snapshot de producción en git (VPS).** Red de seguridad. | `.gitignore` (sesiones, `.bak`, logs), 68 archivos. | Commit `36d2213`, sin push. | ✅ OK |
| 2026-07-22 | **F2: MVP de Baileys en puerto 3005 (modo sombra).** | `wa-server-baileys/package.json`, `Dockerfile`, `server.js`, `docker-compose.yml` | Baileys descargó imagen de prueba: 91 KB en 238ms. | ✅ Hipótesis probada. |
| 2026-07-22 | **S1a: Enrutado de puente por línea** (`getBridgeUrl(lineKey?)` con `WHATSAPP_BRIDGE_ROUTES`). | `lib/whatsapp/bridge.ts` | Build app, mapa vacío = idéntico. | ✅ OK (commit 2942c0a) |
| 2026-07-22 | **S1b: Reconexión R2 + AWS SDK + package-lock.json.** | `package.json`, `package-lock.json` | Prueba aislada de R2: subida + lectura. | ✅ OK (commit 75f8bf8) |
| 2026-07-22 | **S1c: R2 + purga base64 + firma en lectura + unificación strings.** | `webhook-processor.ts`, `message-bubble.tsx`, nueva ruta `/api/media/signed-url` | Build app, `linea_2` intacta. | ✅ OK (commit 27827fb) |
| 2026-07-23 | **S2-PRE + S2: Conmutación de `linea_1` a Baileys.** Endpoints `/diagnostic`, `/logout`, `/send-text` funcional. `FORWARDING_ENABLED=true`. Ruta `linea_1→3005`. Fix `message`/`text` en send-text. Fix `syncHistory:false` para evitar timeout de init. Soporte audio/ptt. | `wa-server-baileys/server.js`, `docker-compose.yml`, `.env.production` | **Prueba end-to-end: foto → R2 → Gemini → Oscar responde.** | ✅ OK |
| 2026-07-23 | **Sincronización de Catálogo RAG → Supabase:** Migración de productos faltantes con paginación (`.range()`) y preservación de UUIDs. | `scripts/import_rag_to_supabase.ts`, Supabase DB (`products`, `price_tiers`) | Conteo en Supabase pasó de 2.317 a 8.617 productos. | ✅ OK |
| 2026-07-24 | **4 Ajustes Finos de Calidad Comercial (Software Defensivo):** Enmascaramiento de UUIDs a `REF-XXXXXXXX`, sanitizador Regex en `index.ts`, priorización ZOOM con `has_pricing: true`, eliminación de evasivas y respuesta entusiasta de imágenes. | `lib/agent/tools/search-catalog.ts`, `lib/agent/tools/get-product-price.ts`, `lib/agent/index.ts` | Verificación de tipos + sanitización determinista. | ✅ OK |
| 2026-07-24 | **Poblado de referencias comerciales ZM- en Supabase (517 productos) y all_products.json (488 productos) + Migración 00007 (Trigger antierror).** Backup creado: `all_products.json.bak`. | `scripts/populate_zoom_references.ts`, `supabase/migrations/00007_auto_generate_product_reference.sql`, `lib/agent/tools/search-catalog.ts`, `all_products.json` | Ejecución de script de lote + sanitización de rag_response. | ✅ 8.639 productos en Supabase con referencias comerciales completas. |
| 2026-07-24 | **Actualización de `lib/embeddings.ts` para soporte multiclave (GEMINI_API_KEY / GOOGLE_API_KEY / OPENROUTER_API_KEY) + fallback resiliente en Glosario.** | `lib/embeddings.ts` | Guardado de jerga comercial en el panel web. | ✅ Guardado de glosario 100% funcional. |

---

## Notas

- Los `linea_*` actuales (573011022628, 573107975278) son **líneas de prueba**. El sistema en producción final tendrá **8 líneas** conectadas al CRM.
- Si un cambio requiere deploy, anotar fecha/hora del deploy y resultado de la verificación post-deploy.
