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
| 2026-07-29 | **Subida de fotos desde el panel: reparada.** El endpoint y el botón ya existían (`c762a1f`, `006b311`, `eec4fcf`) pero **ningún upload podía funcionar**: el volumen de imágenes estaba montado `:ro`, así que `mkdir` fallaba y el endpoint devolvía 500 siempre. | `docker-compose.yml` | Prueba end-to-end sobre `VA-258 B`: HTTP 200 en 10,8 s, archivo en disco (8.470 B), `image_url` en Supabase, imagen servida por el panel y `image_count=1` en el índice vectorial. Estado revertido al terminar. | ✅ OK |
| 2026-07-29 | **El rollback del upload ya no borra la foto anterior.** Si el re-embed fallaba, el endpoint ponía `image_url = null` en vez de restaurar el valor previo: un fallo pasajero del motor borraba la foto de un producto que sí la tenía. Ahora se lee el `image_url` previo, se restaura al deshacer y se elimina la carpeta huérfana del disco. | `app/api/products/upload-image/route.ts` | Prueba del camino de fallo con referencia inexistente sobre `ZM-PAD-001`: HTTP 502, `image_url` intacto, 0 carpetas huérfanas. | ✅ OK |
| 2026-07-29 | **El re-embed ya no congela el motor de búsqueda ni pierde vectores.** `/reembed` tarda ~12 s y se ejecutaba en el event loop, dejando al bot sin `/query` mientras el panel subía una foto; además el read-modify-write del índice (138 MB) no estaba serializado y dos subidas simultáneas se pisaban. Ahora corre en `asyncio.to_thread` y la escritura del índice va bajo lock. | `Motor de Conocimiento/api_service.py`, `Motor de Conocimiento/embedding_pipeline.py` | Regresión de búsqueda tras el cambio: 3/3 consultas con resultados en 2,0–5,5 s y los `ZM-` encabezando. | ✅ OK |
| 2026-07-29 | **Deuda de bitácora saldada**: los commits `c762a1f` (botón Subir imagen), `006b311` (`/reembed` de un producto) y `eec4fcf` (endpoint `upload-image` + `sharp`) estaban en el VPS sin registrar aquí. | — | Lectura de `git log` del VPS. | ✅ Documentado |
| 2026-07-29 | **Auditoría completa del sistema en producción.** Punto de restauración `92276ac`. | — | Lectura directa del VPS, la base y 833 mensajes reales. | ✅ Diagnóstico con evidencia. |
| 2026-07-29 | **Deduplicación del catálogo:** 1.280 referencias estaban repetidas hasta 9 veces. Se archivaron 6.301 filas conservando la de mejor calidad y migrando 395 tarifas. | Supabase `products`, `price_tiers` | Respaldo en `backups/products_20260729_*.json`. Conteo 8.637 → 2.252 activos. | ✅ 0 referencias duplicadas. |
| 2026-07-29 | **Enlace de imágenes:** 92 productos tenían su foto en disco sin vincular; se corrigieron además URLs rotas. | Supabase `products.image_url` | Verificación de existencia de cada archivo. | ✅ Cobertura 98,8%. |
| 2026-07-29 | **Identidad configurable desde el panel.** Causa raíz de que el bot se declarara IA: `agent_configs.system_prompt` decía "Eres un asistente virtual… escalas con un humano" y se anteponía al prompt que ordenaba lo contrario. | `lib/agent/system-prompt.ts`, `lib/personalization/actions.ts`, `app/(app)/personalizacion/client-form.tsx`, Supabase `agent_configs.metadata` | Prueba: "¿eres un robot?" → responde en personaje. | ✅ OK |
| 2026-07-29 | **Guardrails de salida**: referencias verificadas contra el catálogo, precios obligados a pasar por calculadora, bloqueo de propuestas sin precio y de interrogatorios sin oferta, saneamiento de identidad y formato de miles. | `lib/agent/index.ts` | Pruebas conversacionales end-to-end. | ✅ OK |
| 2026-07-29 | **Retrieval rail**: `searchCatalog` deja de exponer cifras al modelo (`price`, `max_price` y precios embebidos en descripciones). | `lib/agent/tools/search-catalog.ts` | Latencia por mensaje de 84s a 13s; desaparecen los reintentos por precios de memoria. | ✅ OK |
| 2026-07-29 | **Idempotencia de mensajes**: `ignoreDuplicates` no informaba del conflicto y el agente se ejecutaba dos veces (31% de respuestas duplicadas). Se añade verificación de inserción y cerrojo por conversación. | `lib/whatsapp/webhook-processor.ts` | Revisión de 521 mensajes salientes históricos. | ✅ OK |
| 2026-07-29 | **Envío de fotos bajo demanda**: se guardan las imágenes de las propuestas y se envían solo si el cliente las pide. | `lib/whatsapp/webhook-processor.ts` | Prueba: "¿tienes foto del segundo?" → confirma el envío sin negarse. | ✅ OK |
| 2026-07-29 | **Preferitismo ZOOM reparado.** `is_preferente` devolvía 0 de 2.252: leía `products.price` (vacío en Supabase) y no reconocía las referencias `ZM-`. | `Motor de Conocimiento/supabase_loader.py`, `rag_query_engine.py` | 517 preferentes; los ZM- encabezan camisetas, llaveros, cuadernos y DTF. | ✅ OK |
| 2026-07-29 | **DTF cotizable**: `calculateCustomPrice` buscaba por UUID pero recibía referencias, y el candado no la aceptaba como calculadora válida. | `lib/agent/tools/calculate-custom-price.ts`, `lib/agent/index.ts` | Cotización por medidas operativa. | ✅ OK |
| 2026-07-29 | **Motor RAG bajo systemd** (`knowledgebot-rag`) con reinicio automático y `reload=False`; se elimina la llamada extra al LLM por búsqueda que gastaba tokens y contradecía al catálogo. | `/etc/systemd/system/knowledgebot-rag.service`, `api_service.py`, `rag_query_engine.py` | `systemctl is-active` + consultas de prueba. | ✅ OK |
| 2026-07-29 | **Centro de Control con datos reales.** Antes era `FILTER_DATA` inventado. Ahora reporta servicios, líneas, catálogo, identidad y actividad, con causa y acción de reparación. | `app/api/health/route.ts` (nuevo), `app/(app)/control-room/page.tsx` | Respuesta verificada contra la base. | ✅ OK |
| 2026-07-29 | **Pestaña Servicios y Marcaciones con tarifas reales.** Antes mostraba precios escritos a mano en el código que no existían ni en la base ni en el Excel. | `app/(app)/conocimiento/actions.ts`, `KnowledgeBaseClient.tsx` | 85 servicios agrupados; señala los que no tienen tarifa. | ✅ OK |
| 2026-07-29 | **Reindexado de embeddings** (3072D multimodales) sobre el catálogo deduplicado, purgando huérfanos. | `Motor de Conocimiento/data/embeddings/` | Incremental con checkpoint. | ✅ OK |
| 2026-07-29 | **Documentación corregida**: `ESTADO_OPERATIVO.md` describía un puente Baileys en el puerto 3005 que no existe en producción. | `docs/ESTADO_OPERATIVO.md` | Verificación de contenedores y puertos activos. | ✅ OK |
| 2026-07-24 | **PUNTO DE RESTAURACIÓN RESTORE_POINT_20260724_PRE_ZM_PREFERENTE**: Restauración de puntaje preferente para referencias `ZM-` de ZOOM y activación de extracción de fotos/citas. | `Motor de Conocimiento/rag_query_engine.py`, `docs/REGISTRO_DE_CAMBIOS.md` | Commit git `376092a` / `7e0c100`. | ✅ OK |
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
| 2026-07-24 | **Blindaje total en `saveGlosarioItem` (try/catch para evitar alertas) + adición de `posillo`/`posillos` en `JARGON_SYNONYMS` de Python RAG.** | `app/(app)/conocimiento/actions.ts`, `Motor de Conocimiento/rag_query_engine.py` | Pruebas de guardado de jerga + búsquedas de posillo en RAG. | ✅ OK |
| 2026-07-24 | **Soporte híbrido Gemini 2 + OpenRouter en `lib/embeddings.ts` (detección por prefijo de clave `AIza...` / `sk-or-v1...`).** | `lib/embeddings.ts` | Guardado de jerga comercial sin depender exclusivamente de GEMINI_API_KEY. | ✅ OK |

---

## Notas

- Los `linea_*` actuales (573011022628, 573107975278) son **líneas de prueba**. El sistema en producción final tendrá **8 líneas** conectadas al CRM.
- Si un cambio requiere deploy, anotar fecha/hora del deploy y resultado de la verificación post-deploy.
