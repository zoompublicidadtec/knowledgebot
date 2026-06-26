# 🧠 Memoria Técnica Completa - KnowledgeBot SaaS
KnowledgeBot SaaS es una plataforma de automatización de ventas, atención al cliente y gestión de pipelines comerciales integrada directamente con WhatsApp y Google Calendar. El sistema combina inteligencia artificial conversacional avanzada (RAG con embeddings y ejecución de herramientas) con un CRM y una interfaz de usuario SaaS para control humano. 

---

## 📂 1. Arquitectura General y Stack Tecnológico
El proyecto está construido como una aplicación **Next.js (App Router)** moderna (TypeScript + TailwindCSS).
- **Frontend**: React.js, TailwindCSS (Dark Glassmorphism), Componentes Drag-and-Drop.
- **Backend**: Next.js API Routes / Route Handlers, Vercel AI SDK.
- **Base de Datos**: Supabase (PostgreSQL, pgvector, RPC Functions, Realtime).
- **Puentes de Conexión**: OpenWA (servidor local de WhatsApp) y Meta Cloud API (Producción).
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
El cerebro de la aplicación utiliza **DeepSeek-v4-flash** debido a su alta velocidad de inferencia y su gran capacidad matemática para cotizaciones.

### Capacidades del LLM y Optimizaciones:
*   **Control de Contexto (Loop Prevention)**: El agente lee únicamente los últimos 10 mensajes y deduplica respuestas idénticas del asistente para evitar alucinaciones por ventana de contexto sobrecargada.
*   **Anti-Alucinación Estricta**: El bot tiene prohibido inventar precios o políticas. Siempre debe ejecutar la herramienta `queryKnowledgeBase` para dudas del negocio, o `searchCatalog` para productos. Si no encuentra el dato, lo escala a un humano.
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
*   **Vectores**: `knowledge_documents` y `knowledge_chunks` (usando `pgvector` para alojar embeddings de 1536 dimensiones que habilitan el motor RAG).

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
*   **Resiliencia ante Cuotas y Rate Limits (Gemini 429)**: Ante bloqueos de cuota o rate limits de la API Key de Gemini, el RAG degrada con gracia y formatea estáticamente los productos recuperados del catálogo local en un mensaje legible y exacto en español, garantizando que el bot de WhatsApp siga respondiendo.
*   **Integración Resiliente en Next.js**: Se reescribió la tool `searchCatalog` en Next.js para consultar el servicio RAG FastAPI. En caso de caída de la API de Python, se captura la excepción mediante un bloque `catch` y el sistema ejecuta automáticamente la búsqueda clásica en la base de datos SQL de Supabase.
*   **Persistencia Garantizada de Sesión (Fix de Desconexión)**: Se corrigió el volumen montado del contenedor `whatsapp-bridge` en `docker-compose.yml` para apuntar a la ruta host `../wa-server-knowledge/wwebjs_sessions` hacia `/data/wwebjs_sessions`. Esto asegura que los archivos y tokens de autenticación de las líneas de WhatsApp se almacenen físicamente en el disco del Hostinger VPS y sobrevivan a cualquier rebuild (`docker compose up --build`) o actualización del repositorio sin desconectarse.
*   **Integración con Context7 (`ctx7`)**: Se configuró el CLI y la skill `find-docs` para buscar documentación actualizada de librerías en tiempo real.
*   **Dockerización y Red en Host Mode**: Se configuró el docker-compose en `network_mode: "host"` para simplificar la interconexión mediante `localhost` sin exponer puertos sensibles.
*   **TypeScript y Builds Seguros**: Se resolvieron los errores de compilación estricta y se aisló la carpeta `scripts/` para evitar bloqueos en el build final.

---

## 🚀 7. Arquitectura Multi-Línea de WhatsApp

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
