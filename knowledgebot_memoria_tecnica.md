# 🧠 Memoria Técnica — KnowledgeBot SaaS

> ## ⚠️ Documento histórico. NO es fuente de verdad.
>
> Escrito en junio/julio de 2026. **No refleja el sistema actual.** Se conserva
> por el relato, con las afirmaciones falsas corregidas en línea y marcadas como
> `CORRECCIÓN (2026-07-29)`.
>
> - Estado real del sistema → **`docs/ESTADO_OPERATIVO.md`**
> - Reglas y mapa de documentos → **`AGENTS.md`**
>
> Lo que este documento decía mal: el modelo **no es DeepSeek** sino
> `google/gemini-2.5-flash`; **no existe ni existirá Meta Cloud API**; el
> catálogo de productos **no usa pgvector** sino vectores 3072D multimodales en
> archivo; y el bot **no escala a un humano anunciándolo**, porque tiene
> prohibido delatarse como IA.

KnowledgeBot SaaS es una plataforma de automatización de ventas, atención al cliente y gestión de pipelines comerciales integrada directamente con WhatsApp y Google Calendar. El sistema combina inteligencia artificial conversacional avanzada (RAG con embeddings y ejecución de herramientas) con un CRM y una interfaz de usuario SaaS para control humano. 

---

## 📂 1. Arquitectura General y Stack Tecnológico
El proyecto está construido como una aplicación **Next.js (App Router)** moderna (TypeScript + TailwindCSS).
- **Frontend**: React.js, TailwindCSS (Dark Glassmorphism), Componentes Drag-and-Drop.
- **Backend**: Next.js API Routes / Route Handlers, Vercel AI SDK.
- **Base de Datos**: Supabase (PostgreSQL, pgvector, RPC Functions, Realtime).
- **Puentes de Conexión**: puente local propio de WhatsApp.
  > `CORRECCIÓN (2026-07-29)`: aquí decía "y Meta Cloud API (Producción)". **Es
  > falso y está prohibido**: nunca ha habido Meta Cloud API y no se va a usar.
  > Hoy corre `whatsapp-web.js` en el puerto 3004 atendiendo las dos líneas.
- **Integraciones**: Google Calendar API (OAuth2) y OpenRouter (LLMs).

---

## 💼 2. Gestión de Clientes, CRM y Embudo de Ventas (Pipeline)
El sistema incluye un CRM completo que clasifica y gestiona el ciclo de vida del cliente.

### Sistema de Etiquetado y Pipeline (Kanban Board)
El embudo de ventas se visualiza como un tablero Kanban interactivo que lee el estado (`metadata.stage`) de cada contacto. Las columnas representan las etapas del ciclo comercial:
1. **Entrada (Inbox)**: Nuevos leads interactuando autónomamente con el bot.
2. **Sin Atender (Unhandled)**: Clientes que requieren asistencia o en los que el bot detectó una anomalía y se pausó.
3. **Ventas (Sales)**: Clientes en proceso de negociación.
4. **Vendido (Sold)**: Ventas cerradas con éxito.
5. **Molesto (Angry)**: Casos de insatisfacción. El bot se desactiva inmediatamente.
6. **Ignorar (Ignore)**: Spam o contactos descartados.

### Consola de Chat y "Human-in-the-Loop"
*   **Monitoreo en Tiempo Real**: Los agentes pueden observar la conversación de la IA con el cliente a través de una conexión WebSocket (`Supabase Realtime`).
*   **Control de Intervención (Toggle Bot)**: Cada conversación tiene un interruptor `bot_active`. Los agentes humanos pueden apagar el bot en cualquier momento para tomar control manual.
*   **Handoff Automático**: Si el LLM detecta que no puede resolver la duda, ejecuta la herramienta `requestHumanHandoff`, la cual desactiva el bot automáticamente y despliega un banner de advertencia visual en la interfaz del asesor humano.

---

## 🛒 3. Motor de Catálogo y Cotización Dinámica
La arquitectura de productos de KnowledgeBot está diseñada para soportar lógicas de precios industriales complejas, alejándose del modelo tradicional de "precio fijo".

### Tipologías de Cotización Soportadas:
1. **Precios por Escalas de Volumen (Tiered Pricing)**: 
   Productos masivos (como llaveros, botones o memorias USB) reducen su precio unitario según el volumen de compra. La base de datos almacena rangos (ej. 1-49, 50-99, 100-499) y la función RPC `get_product_price_tiers` calcula automáticamente el valor unitario exacto aplicable al lote solicitado.
2. **Cotización de Productos Compuestos**:
   Artículos modulares (como cuadernos personalizados). El bot solicita la configuración base (tamaño, hojas) y luego añade el valor de accesorios o acabados (insertos, guardas, cosido, filtro UV) consultando dinámicamente cada componente en el catálogo.
3. **Cálculo Matemático Dinámico**: 
   El agente descompone matemáticamente pedidos atípicos. Si un cliente solicita una cantidad de "adicionales" que no coincide con los paquetes predefinidos, el LLM fracciona la solicitud (ej. combinar un paquete de 4 unidades y uno de 1) usando razonamiento lógico para lograr el total.
4. **Cotización por Área Computada (Area Pricing)**:
   Para productos como textiles, bordados o DTF, el sistema calcula el precio aplicando fórmulas algebraicas (costo base + multiplicador por cm²) según el alto y ancho suministrado por el cliente.

### Catálogo Semántico y Variaciones:
Los productos con variaciones de materiales y formas (ej. memorias USB en forma de llave, tarjeta o pulsera) son procesados mediante búsqueda semántica o coincidencias de texto. El bot actúa como experto, explicando los acabados técnicos sin necesitar glosarios externos, ya que su *System Prompt* contiene diccionarios contextuales de la industria de las artes gráficas.

---

## 🤖 4. Agente de IA y RAG (Retrieval-Augmented Generation)
El cerebro de la aplicación utiliza **`google/gemini-2.5-flash`** vía OpenRouter.

> `CORRECCIÓN (2026-07-29)`: aquí decía **DeepSeek-v4-flash**. Nunca fue así en
> producción. El modelo del chat se configura con `CHAT_MODEL` en
> `.env.production`. La visión de imágenes usa el mismo Gemini y la
> transcripción de audio usa Whisper por OpenRouter.

### Capacidades del LLM y Optimizaciones:
*   **Control de Contexto (Loop Prevention)**: El agente lee únicamente los últimos 10 mensajes y deduplica respuestas idénticas del asistente para evitar alucinaciones por ventana de contexto sobrecargada.
*   **Anti-Alucinación Estricta**: El bot tiene prohibido inventar precios o políticas. Siempre debe ejecutar la herramienta `queryKnowledgeBase` para dudas del negocio, o `searchCatalog` para productos.

> `CORRECCIÓN (2026-07-29)`: aquí decía "si no encuentra el dato, lo escala a un
> humano". **Está prohibido decirlo así**: anunciar que escala con un humano
> delata al bot. Y la anti-alucinación ya no depende de esta descripción: hoy son
> compuertas en código — la búsqueda del catálogo se ejecuta en el servidor con
> las palabras del cliente, ninguna cifra sale sin pasar por la calculadora, y
> toda referencia citada se verifica contra la base antes de enviar.
*   **Extracción de Datos Invisibles**: Ejecuta silenciosamente `saveContactInfo` durante la charla para poblar el CRM con nombres, emails y requerimientos comerciales a medida que el usuario los menciona.
*   **Regla de Identidad Estricta y Persona (Oscar Herrera)**: El bot asume al 100% la identidad de "Oscar Herrera", el cerrador de ventas estrella. Tiene una orden inquebrantable de jamás revelar que es una inteligencia artificial o asistente virtual. Su primer contacto debe ser siempre el saludo oficial: *"hola, hablas con oscar herrera. cuentame como te podemos ayudar?"*.

### Función de Agendamiento Autónomo
Al identificar intención de agendamiento, el bot interactúa de forma directa con Google Calendar:
1. Revisa huecos libres en horarios comerciales reales (`getAvailableSlots`).
2. Confirma la fecha con el cliente.
3. Reserva formalmente el evento en la agenda de la empresa (`bookAppointment`), sin cruce de horarios.
4. Soporta cancelaciones y reprogramaciones autónomas (`cancelAppointment`, `rescheduleAppointment`).

---

## ⚙️ 5. Base de Datos (Supabase / PostgreSQL)
El núcleo de almacenamiento relacional cuenta con tablas optimizadas para IA:
*   **Módulos de Negocio**: `organizations`, `profiles`, `contacts`, `conversations`, `messages`, `appointments`.
*   **Configuraciones**: `agent_configs`, `whatsapp_configs`, `google_calendar_configs`.
*   **Vectores**: `knowledge_documents` y `knowledge_chunks` (usando `pgvector` para alojar embeddings de 1536 dimensiones).

> `CORRECCIÓN (2026-07-29)`: esas 1536 dimensiones son **solo del glosario y la
> base de conocimiento**, no del catálogo. El catálogo de productos es un sistema
> aparte: **3072D multimodales** (texto + foto) en
> `Motor de Conocimiento/data/embeddings/`, con búsqueda NumPy y **sin pgvector**.
> Confundir los dos sistemas es el error más repetido en esta documentación.

### Gestión de Ingesta Masiva
Para lidiar con las miles de referencias de productos y sus escalas de precios, el proyecto incluye herramientas de Node.js (`cuadernos/validate_and_load.js` y `scripts/ingest.ts`). Estos scripts:
1. Validen la consistencia matemática de los archivos CSV antes de insertarlos.
2. Limpian entidades huérfanas respetando llaves foráneas.
3. Realizan inserciones en lotes de alta eficiencia para poblar la tabla de productos, niveles de precios y reglas de áreas.

---

*KnowledgeBot SaaS no es un simple autorespondedor; es un sistema híbrido que automatiza flujos comerciales complejos, realiza matemáticas de ventas en tiempo real, mantiene sincronizado el CRM de la organización, y permite una transición silenciosa y fluida hacia asesores humanos cuando se requiere empatía o decisión gerencial.*

---

## 🚀 6. Mejoras y Optimizaciones (Última Actualización)

*   **Integración de RAG Multimodal ("Motor de Conocimiento")**: Se integró el sub-sistema en Python (FastAPI en el puerto `8001`) como el motor de búsqueda semántica principal. Realiza búsquedas vectoriales sobre 3072 dimensiones combinadas con un fallback inteligente de concordancia de texto si los vectores fallan.
*   **Regla Arquitectónica de Dimensiones de Embeddings (3072D vs 1536D)**: El sistema implementa una separación estructural obligatoria en el manejo de vectores para garantizar máximo rendimiento sin violar los límites físicos de las bases de datos relacionales:
    1. **Catálogos Masivos Locales / Python RAG (3072D)**: Todo catálogo pesado con imágenes (como `catalogo_catalogospromocionales` o futuras bases de datos masivas procesadas en el servidor Python independiente en puerto 8001) opera invariablemente a **3072 dimensiones** (`gemini-embedding-2`). Al almacenarse en archivos JSON/memoria local o índices especializados, no tienen restricciones de tamaño y aprovechan la precisión máxima de Gemini.
    2. **Bases Documentales SaaS / Supabase (1536D)**: Toda tabla almacenada en PostgreSQL/Supabase que requiera índices vectoriales rápidos HNSW (`knowledge_chunks`, `products` relacionales como cuadernos) debe configurarse con columnas `vector(1536)` y llamar a Gemini utilizando el parámetro `outputDimensionality: 1536` (implementado en `lib/embeddings.ts`). Esto se debe al límite arquitectónico inquebrantable de `pgvector` en PostgreSQL, donde los índices HNSW no soportan más de 2000 dimensiones.
    3. **Regla para Futuras Bases de Datos**: Si se añade una nueva base de datos o catálogo al sistema: ¿Se alojará y buscará dentro de PostgreSQL/Supabase? → **Usar 1536D**. ¿Se procesará como motor independiente o archivo local en el VPS? → **Usar 3072D**. Ambos utilizan la misma `GEMINI_API_KEY`.
*   **Resiliencia ante Cuotas y Rate Limits (Gemini 429)**: Ante bloqueos de cuota o rate limits de la API Key de Gemini, el RAG degrada con gracia y formatea estáticamente los productos recuperados del catálogo local en un mensaje legible y exacto en español, garantizando que el bot de WhatsApp siga respondiendo.
*   **Integración Resiliente en Next.js**: Se reescribió la tool `searchCatalog` en Next.js para consultar el servicio RAG FastAPI. En caso de caída de la API de Python, se captura la excepción mediante un bloque `catch` y el sistema ejecuta automáticamente la búsqueda clásica en la base de datos SQL de Supabase.
*   **Persistencia Garantizada de Sesión (Fix de Desconexión)**: Se corrigió el volumen montado del contenedor `whatsapp-bridge` en `docker-compose.yml` para apuntar a la ruta host `../wa-server-knowledge/wwebjs_sessions` hacia `/data/wwebjs_sessions`. Esto asegura que los archivos y tokens de autenticación de las líneas de WhatsApp se almacenen físicamente en el disco del Hostinger VPS y sobrevivan a cualquier rebuild (`docker compose up --build`) o actualización del repositorio sin desconectarse.
*   **Integración con Context7 (`ctx7`)**: Se configuró el CLI y la skill `find-docs` para buscar documentación actualizada de librerías en tiempo real.
*   **Dockerización y Red en Host Mode**: Se configuró el docker-compose en `network_mode: "host"` para simplificar la interconexión mediante `localhost` sin exponer puertos sensibles.
*   **TypeScript y Builds Seguros**: Se resolvieron los errores de compilación estricta y se aisló la carpeta `scripts/` para evitar bloqueos en el build final.
*   **Regla Estricta del Entorno de Desarrollo**: El usuario **NO** utiliza VS Code. Trabaja de manera exclusiva con la consola de **PowerShell** en Windows y el cliente de **Antigravity**. Toda instrucción para el desarrollador debe asumir PowerShell de forma nativa sin referencias a menús o atajos de VS Code.
*   **Traducción de Jerga Colombiana (Anti-Fallback)**: Se añadió un diccionario conversacional en el prompt del sistema que instruye al bot a traducir modismos ("pocillo pal tinto", "botilito", "cachucha") a términos formales del catálogo ("mug", "termo", "gorra") ANTES de realizar cualquier búsqueda, solucionando consultas fallidas por diferencias de vocabulario.
*   **Estrategia Estricta de Embudo de Ventas**: Se configuró al agente con una regla comercial avanzada obligatoria:
    1. Debe ofrecer **exactamente 3 opciones** que varíen en precio (Premium, Estándar, Económica).
    2. Prohibido usar palabras que denoten "barato" o "ahorro" para mantener sobriedad con clientes corporativos.
    3. Tiene prohibido hacer listas con más de 2 preguntas de indagación; debe conversar naturalmente.
    4. En caso de objeción de precio, debe aplicar *downselling* escalonado y defender el valor de los productos antes de ofrecer la opción más barata del catálogo.
*   **Regla de Búsqueda de Catálogo Obligatoria (Anti-Alucinación Total)**: Se prohibió estrictamente al bot presentar o inventar opciones (alucinar) a partir de su conocimiento previo. El bot DEBE invocar la herramienta `searchCatalog` de inmediato apenas el usuario pregunta por un producto, garantizando que siempre ofrece elementos que físicamente existan en la base de datos y estén listos para ser cotizados sin fallar.
*   **Corrección en Cotización de Cuadernos y Adicionales (Algoritmo Codicioso de Insertos)**: Se solucionó el problema de cotización donde el bot no lograba localizar los componentes adicionales (insertos, filtro UV, guardas) en el catálogo debido a que incluía el tamaño del cuaderno (ej. "1/2 carta") en la búsqueda. Además, se le obligó a usar un algoritmo codicioso (de mayor a menor) utilizando los bloques disponibles (8, 4, 3, 2, 1) para descomponer cantidades no estándar de insertos (ej. 5 se descompone en 4 + 1), prohibiéndole explícitamente multiplicar el precio unitario de 1 inserto por la cantidad requerida.
*   **Mapeo Global de Tamaños**: Se implementó una directiva global para deducir tamaños a partir de expresiones del usuario. Adjetivos como "pequeño", "mediano" o "grande" se asocian de forma automática con las menores, intermedias o mayores dimensiones físicas de cualquier tipo de producto en el catálogo (mugs, tulas, gorras o cuadernos), previniendo preguntas redundantes e insistentes.
*   **Persistencia Garantizada de Sesión (Fix de Desconexión)**: Se corrigió el volumen montado del contenedor `whatsapp-bridge` en `docker-compose.yml` para apuntar a la ruta host `../wa-server-knowledge/wwebjs_sessions` hacia `/data/wwebjs_sessions`.
*   **Regla Estricta del Entorno de Desarrollo**: El usuario **NO** utiliza VS Code. Trabaja de manera exclusiva con la consola de **PowerShell** en Windows y el cliente de **Antigravity**.
*   **Traducción de Jerga Colombiana (Anti-Fallback)**: Se añadió un diccionario conversacional en el prompt del sistema que instruye al bot a traducir modismos a términos formales del catálogo ANTES de realizar cualquier búsqueda.
*   **Estrategia Estricta de Embudo de Ventas**: Regla comercial avanzada (3 opciones, sin palabras como "barato", prohibido listas > 2 preguntas, downselling escalonado).
*   **Regla de Búsqueda de Catálogo Obligatoria (Anti-Alucinación Total)**: Prohibición estricta de presentar o inventar opciones. El bot DEBE invocar la herramienta `searchCatalog` de inmediato.
*   **Ampliación del Espacio de Búsqueda RAG (top_k: 5 → 15)**: Se aumentó el parámetro `top_k` del microservicio RAG Python de 5 a 15 resultados.
*   **Sistema de Anotación de Precios en Búsqueda (`annotateMatchesWithPricing`)**: Se reemplazó la función `fetchReferencesWithValidPrice` por `annotateMatchesWithPricing`, una función unificada que consulta `price_tiers` en Supabase.
*   **Regla Comercial del Producto Más Caro Obligatorio**: Se estableció que la Opción Premium de las 3 propuestas iniciales DEBE ser obligatoriamente el producto con `is_most_expensive = true`.
*   **Regla 12: Prohibición Absoluta de Alucinar Precios (`getProductPrice`)**: Se añadió la Regla 12 al System Prompt prohibiendo terminantemente escribir cualquier cifra de precio sin haber ejecutado la herramienta `getProductPrice`.
*   **Salvaguarda Anti-Precio-Corrupto**: Filtro en `getProductPriceTool` que invalida cualquier precio superior a $1.000.000.000 COP.
*   **Diversidad Obligatoria de Materiales**: Se actualizó la Regla 7 para exigir que las 3 opciones iniciales varíen en materiales (metal, cerámica, plástico).
*   **Corrección del Entorno Virtual de Python**: Se documentó que el microservicio RAG DEBE ejecutarse con el Python del entorno virtual (`.venv\Scripts\python.exe`).

---

## 🚀 7. Administración, Despliegue y Comandos del Servidor (VPS)

El entorno de producción se gestiona directamente en el VPS de Hostinger (`2.25.169.103`) bajo el usuario `root`.

### Rutas Clave de Despliegue:
*   **SaaS App (Next.js)**: `/root/knowledgebot/` (Puerto `3003` - Docker: `knowledgebot-app`)
*   **WhatsApp Bridge (Node.js)**: `/root/knowledgebot/wa-server/` (Puerto `3004` - Docker: `knowledgebot-wa-bridge`)
*   **RAG Engine (Python)**: `/root/knowledgebot/Motor de Conocimiento/` (Puerto `8001` - Ejecutado en segundo plano con entorno virtual `.venv`)

### Scripts de Despliegue Automático (Ejecutar en Local):
Para evitar conflictos de Git o pérdidas de tiempo resolviendo permisos en el VPS, se utilizan scripts automatizados escritos en Python en la carpeta local de scratch:
1.  **`deploy_whatsapp_fix.py`**: Copia el código actualizado de `server.js` al VPS y reinicia el contenedor de Docker del bridge de WhatsApp.
2.  **`deploy_all_rag_changes.py`**: Sube los archivos `config.py`, `embedding_pipeline.py`, `rag_query_engine.py` y `.env` al VPS, detiene de forma limpia los procesos FastAPI y de ingesta existentes, y reinicia la API y el pipeline en segundo plano con codificación UTF-8.

### Comandos Útiles de Administración (SSH):
*   **Monitorear logs del Bridge de WhatsApp**: `docker logs -f knowledgebot-wa-bridge`
*   **Monitorear logs de la App Next.js**: `docker logs -f knowledgebot-app`
*   **Reiniciar Bridge**: `docker compose restart whatsapp-bridge` (dentro de `/root/knowledgebot/`)
*   **Ver logs de Embeddings en vivo**: `tail -f "/root/knowledgebot/Motor de Conocimiento/logs/embeddings_run.log"`
*   **Ver logs de la API RAG en vivo**: `tail -f "/root/knowledgebot/Motor de Conocimiento/logs/api_run.log"`
*   **Matar procesos de embeddings o API manualmente**: `pkill -f embedding_pipeline.py` o `pkill -f api_service.py`


---

## 🚀 8. Arquitectura Multi-Línea de WhatsApp

Para permitir que una sola organización (como ZOOM Publicidad) escale su operación de ventas de forma masiva, el SaaS implementa una arquitectura **Multi-Línea** que permite conectar y gestionar hasta 8 números de WhatsApp independientes desde un único panel centralizado. 

### Principios del Diseño Multi-Línea
1. **Identidad Unificada**: Las múltiples líneas son atendidas por el mismo agente central ("Oscar"), consumiendo exactamente el mismo catálogo de productos, directrices de precios y base de conocimientos. Esto evita la fragmentación de información y elimina la necesidad de multiplicar el entrenamiento o los datos por cada número celular.
2. **Conexión Local (No Meta API)**: Por decisión y requerimiento estricto del proyecto, la conexión de WhatsApp **NO emplea las APIs oficiales de Meta Cloud**. Todo el tráfico pasa a través del puente local (`wa-server-knowledge` con `whatsapp-web.js`), el cual soporta múltiples sesiones dinámicas. Las sesiones se almacenan de forma persistente a través del volumen Docker persistente en el host VPS (`wwebjs_sessions`), garantizando que no se pierda la autenticación tras actualizaciones del sistema o reinicios del contenedor.
3. **Generación de Códigos QR Inline**: El emparejamiento con WhatsApp se digitalizó por completo. En lugar de revisar la consola de comandos de Windows, el panel SaaS obtiene los códigos QR en *Base64* desde las APIs del puente y los renderiza visualmente en el navegador en tiempo real.

### Cambios Clave en la Arquitectura (Next.js 15+ y PostgreSQL)
*   **Base de Datos Segura**: Se integró la tabla `whatsapp_lines` y se extendió el rastreo a `conversations` y `messages` agregando la columna `line_key`. Para proteger esta tabla, se aplicó **RLS (Row Level Security)** nativo en Supabase, utilizando sub-consultas SQL estándar (`organization_id IN (SELECT ...)`) que no dependen de funciones *helper* locales, siendo robustas para cualquier entorno de producción.
*   **APIs Modernas (Route Handlers)**: La gestión de líneas en Next.js (`/api/whatsapp-lines/...`) usa *Route Handlers* modernos con extracción asíncrona de variables (`await params`), cumpliendo con los estándares y los *breaking changes* estrictos de Vercel/Next.js (15+) para evitar cuelgues durante el proceso de *build* de despliegue.
*   **Idempotencia en Webhooks Multi-sesión**: El webhook principal intercepta los mensajes de todas las sesiones de Puppeteer y les inyecta el `line_key`. Utiliza sentencias `upsert` atadas al `wa_message_id` para garantizar que la concurrencia de 8 líneas nunca genere mensajes duplicados o errores de integridad referencial.
*   **Interfaz Operativa Central**: Se creó un panel unificado para conectar/desconectar líneas dinámicamente. Adicionalmente, el asesor cuenta con un filtro persistente (`localStorage`) en el listado de conversaciones que separa los chats por la línea de origen, optimizando el manejo de grandes volúmenes de clientes.

### 🔌 Procedimiento de Reconexión de WhatsApp (sin reiniciar el servidor)
El puente (`wa-server`, puerto `3004`) está diseñado para **sobrevivir a desconexiones** sin intervención manual: al detectar la desconexión, borra la sesión local corrupta y **regenera un QR automáticamente** que aparece en el panel (Integraciones → WhatsApp). El flujo correcto de recuperación, en orden de complejidad creciente, es:
1. **QR automático**: simplemente esperar y escanear el nuevo QR que aparece en el panel.
2. **Forzar inicio de sesión** (si el QR no aparece): `POST http://localhost:3004/api/sessions/<line_key>/start` con header `x-bridge-key`, luego `GET /api/sessions/<line_key>/qr` para obtener el QR en base64.
3. **Logout completo** (sesión corrupta, "conectado en otro lado"): `POST http://localhost:3004/api/sessions/<line_key>/logout` → destruye y limpia la sesión del volumen → luego paso 2.
**Importante**: jamás es necesario reiniciar el contenedor Docker ni el VPS; el volumen `wwebjs_sessions` persiste la autenticación incluso tras rebuilds. **Distinción clave**: si el bot recibe mensajes pero no los procesa/responde, el problema NO es la conexión de WhatsApp sino la entrega al webhook de la app web (ruta `/api/webhooks/whatsapp`). El 3 de julio de 2026 se documentó un incidente donde un cambio de HTTPS en Nginx (Certbot añadió `return 404;` en el bloque del puerto 80) hizo que el bridge recibiera 404 al entregar mensajes, simulando una "desconexión" del bot. El fix fue añadir un `location /api/webhooks/` con `proxy_pass` directo en el bloque `:80` de Nginx, separándolo del redirect HTTPS (los redirects 301 convierten POST en GET y rompen el webhook).

---

## ✅ 9. ESTADO ACTUAL: BOT 100% FUNCIONAL — LISTO PARA PRODUCCIÓN

> **Fecha de validación final**: 2 de julio de 2026
> **Estado**: ✅ APROBADO PARA DESPLIEGUE EN PRODUCCIÓN

### Resumen Ejecutivo
El bot de ventas "Oscar Herrera" ha sido exhaustivamente probado y validado en entorno local. Todos los defectos críticos identificados durante las pruebas finales han sido corregidos y verificados con scripts automatizados (`scripts/test_price_hallucination.ts`). El sistema está listo para ser desplegado en el VPS de producción (Hostinger).

### Defectos Corregidos y Validados

| # | Defecto | Estado | Solución |
|---|---------|--------|----------|
| 1 | Bot alucinaba precios (inventaba cifras sin consultar BD) | ✅ CORREGIDO | Regla 12 + `getProductPrice` obligatorio por turno |
| 2 | Precios corruptos en BD (MU-152=$1.9B, MU-239=$1.3e17) | ✅ MITIGADO | Salvaguarda anti-precio-corrupto (>$1e9 = inválido) |
| 3 | Siempre ofrecía los mismos 3 mugs de plástico | ✅ CORREGIDO | top_k ampliado a 15 + diversidad de materiales obligatoria |
| 4 | RAG devolvía solo 5 resultados ignorando top_k | ✅ CORREGIDO | Fix en `rag_query_engine.py` (usaba `RAG_RERANK_TOP_N` hardcoded) |
| 5 | No ofrecía el producto más caro de la familia | ✅ CORREGIDO | `annotateMatchesWithPricing` + flag `is_most_expensive` |
| 6 | Productos sin referencia visible en las propuestas | ✅ CORREGIDO | Formato obligatorio `(Ref: XX-NNN)` en cotizaciones |
| 7 | Microservicio RAG no se reiniciaba correctamente | ✅ CORREGIDO | Documentado uso obligatorio de `.venv/Scripts/python.exe` |

### Resultados de la Última Prueba Automatizada

```
Turno 1: Saludo → Bot responde naturalmente ✅
Turno 2: "627 pocillos de diferentes materiales" →
  - Opción Premium: Mug Ethio Coffee 473ml (MU-434) → $77.900 COP ✅ (ES el más caro)
  - Opción Estándar: Mug Metálico con Bamboo 500ml (MU-279) → $48.990 COP ✅
  - Opción Económica: Mug Plástico con Corcho 16Oz (MU-270) → $18.790 COP ✅
  - Totales matemáticamente exactos ✅
  - Variedad de materiales (metal, metal/bambú, plástico) ✅
Turno 3: "Dame los precios" → Repite con cifras exactas sin alucinar ✅
```

### Arquitectura de Producción Validada

```
┌─────────────────────────────────────────────────────────┐
│                    VPS Hostinger                        │
│                                                         │
│  ┌──────────────────┐   ┌──────────────────────────┐   │
│  │  Docker: Next.js  │   │  Docker: WhatsApp Bridge │   │
│  │  knowledgebot-app │   │  knowledgebot-wa-bridge  │   │
│  │  Puerto: 3003     │◄─►│  Puerto: 3004            │   │
│  │  (network: host)  │   │  (network: host)         │   │
│  └────────┬─────────┘   │  whatsapp-web.js          │   │
│           │              │  Sesiones persistentes     │   │
│           │              └──────────────────────────┘   │
│           │                                             │
│  ┌────────▼─────────┐   ┌──────────────────────────┐   │
│  │  Motor RAG Python │   │      Supabase Cloud      │   │
│  │  FastAPI (.venv)  │   │  PostgreSQL + pgvector    │   │
│  │  Puerto: 8001     │   │  6.790 productos          │   │
│  │  all_products.json│   │  price_tiers + RLS        │   │
│  └──────────────────┘   └──────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Checklist de Despliegue a Producción

- [ ] Subir código actualizado al VPS (`git pull` o scripts de deploy)
- [ ] Copiar archivos modificados del Motor de Conocimiento: `rag_query_engine.py`, `api_service.py`
- [ ] Copiar archivos modificados del agente: `search-catalog.ts`, `get-product-price.ts`, `system-prompt.ts`
- [ ] Reconstruir contenedores Docker: `docker compose up --build -d`
- [ ] Reiniciar microservicio RAG Python con `.venv/bin/python api_service.py`
- [ ] Verificar que el puerto 8001 está escuchando
- [ ] Escanear QR de las líneas de WhatsApp si es necesario
- [ ] Realizar prueba de humo enviando un mensaje real al bot

### Archivos Clave Modificados en Esta Iteración

| Archivo | Cambio Principal |
|---------|-----------------|
| `lib/agent/system-prompt.ts` | Reglas 7 (diversidad + is_most_expensive) y 12 (anti-alucinación de precios) |
| `lib/agent/tools/search-catalog.ts` | Nueva función `annotateMatchesWithPricing`, eliminó `fetchReferencesWithValidPrice` |
| `lib/agent/tools/get-product-price.ts` | Salvaguarda anti-precio-corrupto (>$1e9) |
| `Motor de Conocimiento/rag_query_engine.py` | Fix: respeta `top_k` dinámico en vez de `RAG_RERANK_TOP_N` hardcoded |
| `scripts/test_price_hallucination.ts` | Script de prueba automatizada de 3 turnos |
