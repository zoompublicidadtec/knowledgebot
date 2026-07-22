# 🧠 Memoria Técnica Oficial — KnowledgeBot SaaS
# Última verificación: 17 de julio de 2026 (datos confirmados en el VPS en producción)

KnowledgeBot SaaS es un bot de ventas por WhatsApp ("Oscar Herrera") con RAG,
CRM y panel SaaS. Este documento es la ÚNICA fuente de verdad técnica.
Si un comentario viejo del código o una versión anterior contradice esto,
ESTE DOCUMENTO TIENE PRIORIDAD. Verifica siempre con grep/sed/cat antes de
afirmar el estado de algo.

============================================================
## 1. REGLAS INQUEBRANTABLES
============================================================
1. WhatsApp = SOLO whatsapp-web.js (puente local). PROHIBIDO sugerir,
   recomendar o migrar a Meta Cloud API. La conexión local ES definitiva.
2. Entorno de trabajo = PowerShell + Antigravity en Windows. NO VS Code.
3. No ejecutar nada sin aprobación EXPLÍCITA del usuario. El usuario NO es
   programador: proponer con razones simples, no decidir por él.
4. No asumir. Verificar siempre con comandos antes de afirmar.
5. Trabajar directo en el VPS. El local es solo referencia. Toda
   modificación real va al VPS (que tiene cambios que el local no tiene).
6. No declarar éxito sin validar end-to-end por WhatsApp con el bot real.

============================================================
## 2. ARQUITECTURA REAL (3 servicios + Supabase, VPS 2.25.169.103)
============================================================
- knowledgebot-app (Next.js + TypeScript) — Puerto 3003 · Docker
    · Agente IA "Oscar Herrera", panel SaaS, CRM.
    · Conecta a Supabase y al RAG Python.
- knowledgebot-wa-bridge (whatsapp-web.js) — Puerto 3004 · Docker
    · Multi-línea (hasta 8 números). Sesiones persistentes en volumen.
- Motor de Conocimiento (Python + FastAPI, RAG) — Puerto 8001
    · FUERA de Docker, corre con .venv en segundo plano.
    · Búsqueda semántica del catálogo de productos.

Base de datos: Supabase (PostgreSQL + pgvector + Realtime).
Integraciones: Google Calendar (OAuth2), OpenRouter (LLMs).
docker-compose usa network_mode: "host" y env_file: .env.production.

============================================================
## 3. ⚠️ LOS DOS MOTORES DE EMBEDDINGS (CLAVE — NO MEZCLAR)
============================================================
El sistema tiene DOS sistemas de vectores TOTALMENTE DISTINTOS e
INCOMPATIBLES entre sí. Esta es la causa #1 de confusión de agentes
anteriores. Leer con atención:

MOTOR A — Base de Conocimiento (Supabase pgvector)
  · Modelo: text-embedding-3-small (OpenAI)
  · Dimensiones: 1.536
  · Dónde: tablas knowledge_documents / knowledge_chunks de Supabase
  · Para qué: documentos, PDFs, manuales, FAQ (la "base de conocimiento")
  · Configurado en: .env.production (EMBEDDINGS_MODEL)

MOTOR B — Catálogo de Productos (Python RAG, puerto 8001)
  · Modelo: gemini-embedding-2 (Google)
  · Dimensiones: 3.072
  · Dónde: data/embeddings/product_embeddings.json (2.312 vectores hoy)
  · Para qué: búsqueda semántica del catálogo de productos
  · Configurado en: Motor de Conocimiento/config.py (EMBEDDING_DIMENSIONS=3072)

REGLA CRÍTICA: los vectores del Motor A (OpenAI 1536) y del Motor B
(Google 3072) NO se pueden comparar entre sí. Cada motor funciona por su
cuenta y no sabe del otro.

NOTA: el Motor B hoy NO procesa imágenes (el pipeline envía solo texto a
OpenRouter, no el payload multimodal). Esto NO rompe el bot porque el
catálogo funciona principalmente por búsqueda por palabras (ver sec. 4).

============================================================
## 4. CÓMO BUSCA EL BOT + DEFENSA ANTI-ALUCINACIÓN (lo más importante)
============================================================
El bot NO depende del embedding para encontrar productos. Flujo real:

1. Cliente escribe por WhatsApp.
2. El agente llama a la tool searchCatalog (lib/agent/tools/search-catalog.ts).
3. searchCatalog llama al RAG Python: POST http://127.0.0.1:8001/query
4. El RAG ejecuta query() en rag_query_engine.py:
   a) KEYWORD SEARCH (búsqueda por palabras) ← MOTOR PRINCIPAL
      · Cubre los 7.234 productos (no solo los que tienen embedding).
      · Traduce jerga colombiana (pocillo→mug, cachucha→gorra).
      · Corrección ortográfica fuzzy (lapisero→lapicero).
      · Boosting de productos "preferentes" (propios ZOOM con foto+precio).
   b) VECTOR SEARCH (embedding) ← REFUERZO, NO motor principal
      · Solo sobre los 2.312 productos con embedding.
      · Se fusiona CON PENALIZACIÓN ×0.4 (peso menor que keyword).
      · Por eso un embedding incompleto NO rompe el bot.
5. El RAG devuelve IDs → el bot enriquece con precio/foto desde Supabase
   (annotateMatchesWithPricing) → ofrece al cliente.

DEFENSAS ANTI-ALUCINACIÓN (CRÍTICAS — no romper):
  · filterValidForSale(): descarta productos SIN precio o SIN foto.
  · Algoritmo "Nunca Mesa Vacía": si quedan <3 opciones válidas, busca en
    categorías hermanas y luego en categorías populares de respaldo. El
    bot SIEMPRE entrega al menos 3 opciones reales cotizables y con foto.
  · Output Guardrail (lib/agent/index.ts): intercepta la respuesta antes
    de enviarla por WhatsApp y BLOQUEA cualquier precio que el LLM invente
    (no devuelto por getProductPrice/searchCatalog).
  · Regla 12 del system prompt: prohibido escribir precios sin tool.
  · Salvaguarda anti-precio-corrupto: invalida precios > $1.000.000.000 COP.
  · Prohibido ofrecer productos desde conocimiento previo: SIEMPRE debe
    invocar searchCatalog.

FALLBACK: si el RAG Python cae, searchCatalog busca directo en Supabase
(SQL). El bot sigue funcionando.

============================================================
## 5. EL AGENTE IA (Oscar Herrera)
============================================================
· Modelo: Gemini 2.5-flash vía OpenRouter (NO DeepSeek). Elegido porque
  es MULTIMODAL: ve imágenes y escucha audios del cliente.
· Identidad estricta: asume 100% la identidad de "Oscar Herrera", cerrador
  de ventas. JAMÁS revela que es IA. Saludo oficial de primer contacto:
  "hola, hablas con oscar herrera. cuentame como te podemos ayudar?".
· Anti-alucinación estricta: no inventa precios ni políticas. Si no
  encuentra el dato, escala a humano (requestHumanHandoff).
· Extracción silenciosa: ejecuta saveContactInfo durante la charla para
  poblar el CRM (nombres, emails, requerimientos).
· Control de contexto: lee solo los últimos 10 mensajes y deduplica para
  evitar alucinaciones por ventana sobrecargada.
· Audio: transcribe mensajes de voz con Whisper. Si hay 429, rota modelos
  en cascada (whisper-large-v3-turbo → large-v3 → whisper-1).

EMBUDO DE VENTAS (reglas comerciales del system prompt):
  · Ofrece exactamente 3 opciones que varíen en precio y material
    (Premium, Estándar, Económica). La Premium DEBE ser el producto más
    caro de la familia (is_most_expensive=true).
  · Prohibido decir "barato" o "ahorro" (clientes corporativos).
  · Prohibido listas con más de 2 preguntas de indagación.
  · Protocolo de Indagación: como casi todos los productos tienen
    variantes, primero hace UNA pregunta corta para afinar variante y
    cantidad (salvo que el cliente ya especifique ambos).
  · Objeción "caro": NUEVA búsqueda con searchCatalog para opciones más
    económicas + downselling escalonado defendiendo el valor.
  · Objeción "no me gusta": NUEVA búsqueda omitiendo lo ya presentado.
  · Venta cruzada post-confirmación: ofrece 2 complementos exactos; si
    dice SÍ se suman sin preguntas; si NO, se cierra con el pedido.
  · Silencio en adicionales técnicos (despunte, troquel): solo se
    cotizan si el cliente los pide.

============================================================
## 6. CATÁLOGO, PRECIOS Y COTIZACIÓN (datos reales 17-Jul-2026)
============================================================
· Total: 7.234 productos · Con foto: 6.757 (93%) · Con precio: 6.772 (94%)
· Con embedding (Motor B): 2.312 (32%).

DOS TIPOS DE ID DE PRODUCTO (por diseño, no es error):
  · UUID (b4844d3c-...): productos fabricados por ZOOM (propios).
  · Código Cataprom (VA-666, CAP-22): productos importados del catálogo
    externo. Ambos coexisten. NO unificar, NO inventar campos nuevos.
  · Clasificación PROPIO/IMPORTADO se calcula en classify_origen().

PREFERENTES (boost comercial): productos UUID CON foto Y precio.
Reciben +0.40 de score para aparecer primero. NO es requisito para vender.

TIPOLOGÍAS DE COTIZACIÓN SOPORTADAS:
  1. Escalas de volumen (tiered pricing): función RPC get_product_price_tiers.
  2. Productos compuestos (cuadernos): base + accesorios (insertos, guardas,
     filtro UV, cosido). Algoritmo codicioso de insertos (bloques 8,4,3,2,1).
  3. Cálculo matemático dinámico: fracciona pedidos atípicos.
  4. Cotización por área (textiles, bordados, DTF): costo base + mult por cm².
  5. Tarjetas y Volantes: se venden por MILLARES. Si cantidad >=100, se
     divide entre 1000. Mínimo 1 millar (volantes 1/4 carta: mínimo 2).

============================================================
## 7. CRM Y PIPELINE
============================================================
Tablero Kanban que lee metadata.stage de cada contacto:
  1. Entrada (Inbox) · 2. Sin Atender (Unhandled) · 3. Ventas (Sales)
  4. Vendido (Sold) · 5. Molesto (Angry) · 6. Ignorar (Ignore).
· Bot se desactiva solo en Molesto.
· Monitoreo en tiempo real (Supabase Realtime).
· Toggle bot_active por conversación (human-in-the-loop).
· Handoff automático (requestHumanHandoff): desactiva bot + banner al asesor.

============================================================
## 8. AGENDAMIENTO (Google Calendar)
============================================================
Herramientas: getAvailableSlots → bookAppointment (sin cruces) →
cancelAppointment → rescheduleAppointment. Solo en horarios comerciales.

============================================================
## 9. MULTI-LÍNEA DE WHATSAPP
============================================================
Hasta 8 números, mismo agente "Oscar", mismo catálogo y conocimiento.
Sesiones en volumen wwebjs_sessions (persisten tras rebuilds).
Tabla whatsapp_lines + columna line_key en conversations/messages (RLS).
QR se renderiza en el panel (Integraciones → WhatsApp) en base64.

PROCEDIMIENTO DE RECONEXIÓN (sin reiniciar el VPS):
  1. Esperar QR automático que aparece en el panel.
  2. Forzar login: POST :3004/api/sessions/<line_key>/start (header
     x-bridge-key) → GET /api/sessions/<line_key>/qr.
  3. Logout completo (sesión corrupta): POST .../logout → luego paso 2.
DISTINCIÓN CLAVE: si el bot RECIBE pero NO responde, el problema NO es
WhatsApp sino la entrega al webhook (/api/webhooks/whatsapp).
LECCIÓN (3-Jul-2026): un return 404 de Nginx en el bloque :80 simuló
"desconexión". Fix: location /api/webhooks/ con proxy_pass directo,
separado del redirect HTTPS (los 301 convierten POST en GET y rompen el webhook).

============================================================
## 10. BASE DE DATOS (Supabase)
============================================================
· Negocio: organizations, profiles, contacts, conversations, messages,
  appointments.
· Config: agent_configs, whatsapp_configs, google_calendar_configs.
· Vectores (Motor A): knowledge_documents, knowledge_chunks (pgvector 1536D).
· Ingesta: scripts/ingest.ts y cuadernos/validate_and_load.js (validan
  CSV, limpian huérfanos, insertan en lotes).

============================================================
## 11. RUTAS Y COMANDOS DEL VPS
============================================================
· App Next.js:     /root/knowledgebot/                       (puerto 3003)
· RAG Python:      /root/knowledgebot/Motor de Conocimiento/ (puerto 8001)
· WhatsApp Bridge: /root/knowledgebot/wa-server/             (puerto 3004)
· Catálogo JSON:   Motor de Conocimiento/data/products/all_products.json
· Embeddings cat:  Motor de Conocimiento/data/embeddings/product_embeddings.json
· VPS: 2.25.169.103 · usuario root.

MONITOREO:
  · docker logs -f knowledgebot-wa-bridge
  · docker logs -f knowledgebot-app
  · tail -f "Motor de Conocimiento/logs/api_run.log"
  · tail -f "Motor de Conocimiento/logs/embeddings_run.log"

REINICIOS (SOLO con aprobación del usuario):
  · RAG: pkill -f api_service.py ; luego
    cd "Motor de Conocimiento" && setsid nohup .venv/bin/python api_service.py > logs/api_run.log 2>&1 &
  · Bot:    docker compose up --build -d app
  · Bridge: docker compose up --build -d whatsapp-bridge

============================================================
## 12. LECCIONES DE SESIONES ANTERIORES (QUÉ NO HACER)
============================================================
· NO asumir que "embeddings" es un solo sistema. Siempre hay DOS motores.
· NO confundir dimensiones: Supabase=1536 (OpenAI), Catálogo=3072 (Google).
· NO sugerir migrar WhatsApp a Meta Cloud API (jamás).
· NO inventar campos nuevos (sku_interno, tipo...) sin aprobación.
· NO leer el JSON local como si fuera el del VPS.
· NO confiar en comentarios viejos del código: muchos están desactualizados.
· NO declarar éxito sin validar end-to-end por WhatsApp.
· Si un cambio falla 2 veces, revertir desde el backup (.bak.timestamp).
· El RAG DEBE correr con el python del .venv (.venv/bin/python).
· docker-compose usa env_file: .env.production (NO .env.local).
