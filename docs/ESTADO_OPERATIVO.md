> # 🔴 ALTO. LEER ANTES DE HACER NADA.
>
> ## Desde el **11-ago-2026, 10:00 (Bogotá)**, las líneas conectadas son las **LÍNEAS OFICIALES DE LA EMPRESA**.
>
> `linea_1` y `linea_3` son los números con los que ZOOM Publicidad atiende a sus
> clientes. **Ya no hay líneas de prueba.** Lo que pase en ellas le pasa a un
> cliente de verdad.
>
> ### QUEDA PROHIBIDO:
>
> - **Tocar, modificar o alterar la estabilidad de las líneas.** No reiniciar el
>   puente de WhatsApp. No desconectar ni reconectar una línea. No escanear QR.
>   No tocar `wa-server-baileys/` ni sus sesiones en disco.
> - **Tocar o alterar la interacción del bot.** No cambiar lo que responde, ni
>   cuándo responde, ni el prompt, ni los guardrails, sin que el dueño lo pida.
> - **Enviar un solo mensaje por WhatsApp para probar algo.** Ni a un número
>   propio, ni a uno inventado.
>
> ### EL BOT ESTÁ EN SILENCIO A PROPÓSITO
>
> El interruptor general (`agent_configs.bot_globally_enabled`) está en **false**.
> El bot **recibe y guarda todo, y no responde nada**. Es la decisión del dueño:
> primero acumular conversaciones de verdad, y **después** trabajar en las
> respuestas. **No lo encienda nadie sin que él lo pida.**
>
> ### CÓMO SE PRUEBA AHORA
>
> `POST /api/agent/test` — ejecuta el mismo agente **sin enviar nada por
> WhatsApp**. Y `scripts/bateria_bot.py`, que usa esa misma puerta. Los contactos
> de prueba empiezan por `5739` y se borran con `scripts/limpiar_pruebas.py`.
>
> ### POR QUÉ ESTÁ ESCRITO ASÍ DE GRANDE
>
> El 11-ago-2026, con clientes ya en la línea, el bot contestó **por encima de
> las personas del equipo** —repitiendo párrafos y contradiciéndolas— y el
> interruptor del panel **no lo apagaba** porque nunca estuvo conectado a nada.
> El dueño tuvo que pedir de urgencia que se callara. Ese día se acabó el
> margen de error.


# ESTADO OPERATIVO — KnowledgeBot SaaS (ZOOM Publicidad)

> **Fuente de verdad sobre el estado actual del sistema.**
> Verificado el 2026-07-31 mediante auditoría directa sobre el VPS de producción.
> El VPS es la fuente de verdad de facto (el repo local y GitHub están desactualizados).

---

## 0. Cómo leer este archivo

> **Este documento manda sobre cualquier otro `.md` del proyecto.** El mapa
> completo de la documentación, con el orden de autoridad y la lista de datos que
> los documentos viejos tienen mal, está en **`AGENTS.md` §1 y §2**. Los 9 `.md`
> deben mantenerse iguales en el VPS y en el repo local.

- ✅ = verificado y funcionando.
- ⚠️ = funciona con salvedades / degradado / frágil.
- 🔴 = roto o no implementado.
- 🚫 = **prohibido tocar** (ver §7).

---


## 0.1 Prueba masiva del 02-ago-2026 — qué funciona y qué no

30 clientes distintos (contacto y teléfono propios) repartidos entre las 3
líneas, ejecutando el agente real sin enviar un solo mensaje de WhatsApp.
**31 conversaciones, 99 mensajes, 49 respuestas aprobadas, 0 de respaldo.**

Se dispara con `POST /api/agent/test` y la cabecera `x-bridge-key` (la misma
llave del webhook). El guion vive fuera del repo; para repetirla basta con
volver a crear la tanda: es la red de seguridad para probar cambios sin tocar
clientes ni quemar números.

| Área | Estado |
|---|---|
| Saludo, identidad y tono | ✅ |
| Datos del negocio (dirección, web, teléfono) desde el panel | ✅ |
| Catálogo, precios reales y cotización por cantidad | ✅ |
| Cambio de tema a mitad de conversación | ✅ (ya no arrastra el producto anterior) |
| Objeciones de precio y comparación con la competencia | ✅ |
| Cierre a etapa «Vendido» | ✅ |
| Dato del negocio vacío en el panel | ✅ dice que lo consulta, **no lo inventa** |
| **Pipeline / Kanban** | 🟢 **resuelto el 02-ago**: la tarjeta se mueve sola con los hechos del turno — **Ventas** cuando el bot entrega una cotización con precio, **Listo para pagar** cuando el cliente dice que compra o pregunta dónde pagar. La herramienta del modelo sigue existiendo; mueve la primera de las dos que se dé cuenta. Solo se avanza, y las etapas puestas por una persona no se tocan. Ver `lib/agent/pipeline-automatico.ts` |
| **Newsletters y canales de WhatsApp** | 🟢 **resuelto el 02-ago**: ya no crean conversaciones. Solo entran al CRM los chats de PERSONA (`@s.whatsapp.net`, `@c.us`, `@lid`, dígitos); lo descartado se cuenta por dominio en `chatsNoPersona` de `/diagnostic`. Quedan en la base **2 fichas de canal creadas antes del arreglo**, sin nombre y sin respuestas: las borra el dueño desde el panel |
| **Traspaso a un humano** | 🟢 **resuelto el 02-ago**: si el cliente pide hablar con alguien, se traspasa en código antes de que el modelo conteste — bot apagado, etapa «Sin Atender» y la frase de traspaso del panel. Antes el bot le respondía «Jaja, soy Oscar» y seguía vendiendo |
| **Campana de notificaciones** | 🟢 **funciona**: vigila molestos, listos para pagar y quien pidió ayuda. Estaba vacía porque las columnas estaban vacías, no por un fallo suyo |
| **Campana vs. Kanban** | 🟢 **resuelto el 02-ago**: eran dos fuentes distintas para la misma pregunta y no cuadraban. Apagar el bot a mano ahora manda la tarjeta a «Sin Atender», y encenderlo la devuelve a «Entrada» |
| **Adjuntos en el panel** | 🟢 **ver: resuelto el 02-ago**. Se ven foto, nota de voz, sticker (en pequeño), video y GIF. 🟢 **enviar foto o archivo: resuelto el 02-ago** — el clip del cuadro de escritura, con pie de foto y tope de 20 MB. **Ojo:** por el dominio no funcionó hasta corregir el tope de **nginx**, que rechazaba con `413` todo lo que pasara de 1 MB (una foto de celular pesa 3-8 MB) antes de que llegara al sistema. 🟢 **enviar nota de voz: resuelto el 02-ago** — micrófono en el cuadro de escribir, con el cambio micrófono ↔ flecha de WhatsApp; `ffmpeg` convierte en la **app** (no en el puente) y el `send-media` acepta la marca `ptt`. **Solo funciona entrando por `https://zoompublicidad.tech`**: los navegadores no dan micrófono en direcciones sin candado. 🟢 **responder citando: resuelto el 02-ago** — flecha al costado de cada burbuja. Sin selector de emojis, por decisión del dueño |
| **El bot trabado** | 🟢 **resuelto el 02-ago**: si no avanza dos turnos seguidos —entregó una frase de respaldo o repitió lo que ya había dicho— la conversación pasa sola a «Sin Atender», el bot se apaga y suena la campana. Se deduce de los mensajes anteriores del bot, sin contadores en la base |
| **El cliente sabe que habla con un bot** | 🟢 **auditado el 02-ago**: era una sola frase («Te paso con un humano en un momento»), dormida detrás de un campo vacío del panel. Eliminada. Ningún otro texto fijo que llegue al cliente lo delata |
| **Datos de ZOOM escritos en el código** | 🟡 **abierto**: `DEFAULT_PERSONA` todavía trae `agent_name`, `company`, `greeting`, `scope` y `offtopic_redirect` de ZOOM. Mismo problema que se corrigió con los medios de pago el 01-ago, pero aquí vaciarlos dejaría al bot sin nombre con el que hablar: hay que decidir qué hace el sistema cuando el panel está vacío antes de tocarlo |
| **El bot cotiza lo más parecido en vez de decir que no lo tiene** | 🔴 **abierto (02-ago)**: a «¿Ustedes venden llantas para camión?» respondió «eso puntual no lo manejamos» **y acto seguido cotizó «Adicional: Guardas para Cosido»**. Los candados bloquearon dos intentos (`search-off-topic`, luego `no-calculator` con precios inventados: $1.500, $75.000, $125.000) y al tercero el modelo usó la calculadora sobre un producto cualquiera y **eso bastó para aprobar**. La causa: el candado verifica **de dónde salió el precio, no si el producto tiene que ver con lo que preguntaron**. Sale de las pruebas del Kanban del 02-ago |

El 🔴 de arriba es el pendiente conocido al cerrar el 02-ago-2026.

## 1. Arquitectura real (verificada el 2026-07-29)

```
┌─────────────────────────────────────────────────────────────────────┐
│  VPS Hostinger (2.25.169.103, usuario root)                         │
│  Panel público: https://zoompublicidad.tech (nginx → 3003)          │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │  App Next.js         │    │  Puente WhatsApp (Node.js)        │  │
│  │  knowledgebot-app    │◄──►│  knowledgebot-wa-bridge-baileys   │  │
│  │  Puerto 3003         │    │  Puerto 3005 · Baileys, sin Chrome │  │
│  │  Next.js 16 + React  │    │  ATIENDE TODAS LAS LINEAS         │  │
│  └────────┬─────────────┘    └──────────────────────────────────┘  │
│           │                                                         │
│           ▼                                                         │
│  ┌──────────────────────────────────────┐                          │
│  │  Motor RAG Python — FastAPI 8001     │                          │
│  │  systemd: knowledgebot-rag           │                          │
│  │  Keyword + vectorial NumPy (3072D)   │                          │
│  │  Fuente de productos: Supabase       │                          │
│  └──────────────────────────────────────┘                          │
└───────────┼─────────────────────────────────────────────────────────┘
            ▼
   ┌──────────────────────────┐
   │  Supabase Cloud          │
   │  PostgreSQL + pgvector   │
   │  CRM, conversaciones,    │
   │  mensajes, productos     │
   └──────────────────────────┘
```

> ⚠️ **Cambio de arquitectura (2026-07-31): UN SOLO PUENTE.** El diagrama de
> arriba describe el estado del 29-jul y ya no vale. Hoy **Baileys (3005) atiende
> TODAS las líneas**, y `whatsapp-web.js` (3004) está **detenido**.
>
> Motivo medido: el almacén interno de `whatsapp-web.js` quedó desfasado de la
> versión actual de WhatsApp Web. No fallaba solo la descarga de adjuntos —
> **fallaba `getChats()` también**, con el mismo `[Error] r` ilegible. Fijar la
> versión de WhatsApp Web no lo arregla (se pidió la `2.3000.1040516757-alpha`
> y se cargó igual la `2.3000.1044236315`) y la librería ya está en su última
> versión. No es recuperable desde aquí.
>
> Baileys sí descarga: imagen de 22 KB en 59 ms, audio de 11 KB en 154 ms.

### Los pilares reales

| Pilar | Tecnología | Rol |
|---|---|---|
| **Puente único** | Node.js + Baileys (sin Chrome), 3005 | Envía, recibe **y descarga audio e imagen**, en **todas** las líneas. |
| ~~Puente viejo~~ | `whatsapp-web.js` (Puppeteer), 3004 | **Detenido.** Almacén roto: ni adjuntos ni `getChats()`. |
| **App Next.js** | Next.js 16 + React 19 + Vercel AI SDK | Panel SaaS, webhooks, agente comercial. |
| **Motor RAG** | FastAPI (systemd) en 8001 | Búsqueda de productos: keyword + vectorial. |
| **Cloudflare R2** | bucket `knowledgebot-fotos` | Guarda los audios y fotos del cliente. |

### Cómo se atienden las líneas: sin listas y sin excepciones

**Ninguna línea se enumera en ninguna parte.** `BRIDGE_LINES`,
`FORWARD_INBOUND_LINES` y `WHATSAPP_BRIDGE_ROUTES` se retiraron de la
configuración el 31-jul. El motivo es concreto: al nombrar las líneas una por
una (`linea_1,linea_2`), **cualquier línea nueva quedaba fuera en silencio** —
el puente la ignoraba sin decir nada. Eso no escala a 8 líneas ni a un cliente
de otro país.

Las compuertas siguen en el código por si algún día hace falta repartir carga,
pero **vacías significan «todas»**, y así están. El puente descubre qué líneas
existen con `arrancarLineas()`: las de la tabla `whatsapp_lines` más las que
tengan sesión en disco. Una línea registrada sin sesión queda declarada y
pidiendo QR, en vez de desaparecer del panel.

**La ranura es independiente del número.** `linea_1` es solo un nombre de
ranura: el teléfono lo define quien escanea el QR. No hay ningún número escrito
en el código — verificado el 31-jul con una búsqueda en todo el repositorio.

Para sumar una línea: registrarla y escanear su QR. **Nada más.**

### El error 463 — y la explicación falsa que costó una arquitectura entera

**Lo que se documentó el 30-jul era incorrecto.** Decía que el 463 lo causaba
enviar a un `@lid`, y sobre esa causa falsa se construyeron dos puentes, un
reparto de líneas y un traductor de direcciones. Nada de eso hacía falta.

Medido el 31-jul enviando desde el propio servidor, con dos líneas conectadas al
mismo puente y con el mismo código:

| Envío | Resultado |
|---|---|
| Línea A → línea B | ✅ entregado |
| Línea A → teléfono personal | ✅ entregado |
| Línea B → sí misma | ✅ entregado |
| Línea B → línea A (al teléfono) | ❌ 463 |
| Línea B → línea A (al `@lid`) | ❌ 463 |
| Línea B → teléfono personal | ❌ 463 |

**Baileys sí envía.** El mismo código entrega desde una línea y es rechazado
desde otra: lo que falla es la **cuenta de WhatsApp**, no el sistema. Es un
bloqueo temporal por volumen de mensajes automáticos —*timelocked*— y se levanta
con reposo.

> **Regla:** ante un 463, probar el mismo envío desde otra línea antes de tocar
> código. Si la otra entrega, el problema es la cuenta.
>
> **No se anota aquí qué número estuvo bloqueado**, a propósito: es un estado
> pasajero y las líneas de prueba se conectan y desconectan a voluntad. Dejarlo
> escrito solo produce malentendidos meses después.

### Las tres cosas distintas que parecen «se cayó la línea»

No confundirlas: tienen causas y remedios distintos, y solo una es un fallo.

| Lo que se ve | Qué es en realidad | Qué hace el sistema |
|---|---|---|
| **Corte de conexión** (`stream errored`, código 500) | Un tropiezo de red. Le pasa a toda conexión permanente. | **Reconecta solo.** Medido el 01-ago en la línea 2: caída y vuelta **en 4 segundos**. No es un fallo. |
| **`conflict: device_removed`** (código 401) | WhatsApp **cerró la sesión desde la cuenta**: alguien quitó el dispositivo vinculado, o lo quitó WhatsApp. | **No se reconecta, y está bien**: las credenciales quedaron revocadas. Se borran solas y la línea queda lista para un QR nuevo. |
| **Acuse con error `463`** | La línea **está conectada**; WhatsApp acepta el mensaje y lo rechaza después. Es un bloqueo de la CUENTA. | **Freno automático**: tras 3 rechazos seguidos deja de enviar 10 min, 30 min, 2 h, 6 h. Sigue recibiendo. |

#### Detrás del 463 hay una notificación de WhatsApp, y ahora se lee

El 02-ago-2026 se descubrió de dónde sale el 463. WhatsApp le manda a la cuenta
restringida una notificación que Baileys descarta como *«Invalid mex newsletter
notification»*. Decodificada:

```json
{"xwa2_notify_account_reachout_timelock":{
   "enforcement_type":"RESTRICT_ALL_COMPANIONS",
   "is_active":true,
   "time_enforcement_ends":"1786218427"}}
```

- **`RESTRICT_ALL_COMPANIONS`** — restringe **todos los dispositivos
  vinculados** de esa cuenta: Baileys, WhatsApp Web y Desktop. **El teléfono en
  sí NO está restringido**, y por eso desde el celular se envía con normalidad
  mientras el puente recibe 463. Es la confusión más natural del mundo y hay que
  tenerla presente antes de buscar el fallo en el sistema.
- **`time_enforcement_ends`** — la fecha exacta en que se levanta. En el caso
  medido: 7 días justos desde que WhatsApp cerró la sesión.

El puente ahora **lee esa notificación, la guarda en disco** (WhatsApp la anuncia
una sola vez y un reinicio borraba la explicación), la expone en `/diagnostic`
como `restriccionWhatsApp` y responde a los envíos con la fecha de fin en vez de
morir con un 463 sin explicación.

> **Regla:** ante un 463, mirar `restriccionWhatsApp` en `/diagnostic` ANTES de
> tocar nada. Si hay fecha de fin, no hay nada que arreglar: hay que esperar. Y
> **no sirve de prueba que el número envíe bien desde el celular**: el teléfono
> nunca está restringido por esta medida.

La confusión sale de que las tres aparecen en el panel como «la línea no responde». La primera se arregla sola, la segunda pide un QR, y la tercera pide **reposo** — nunca código.

### El `@lid` sí es un problema, pero de identidad, no de envío

Un `@lid` es un identificador interno de WhatsApp de 14-15 dígitos que **no es
un teléfono** y del que no se puede deducir el número. El panel lo mostraba
crudo como si fuera el contacto.

WhatsApp adjunta el teléfono real en `key.senderPn`. El puente lo aprende y
—desde el 31-jul— **se lo pasa también a la app** (`senderPhone` en el webhook),
que lo guarda en `contacts.metadata.telefono`. `wa_phone` no se toca: sigue
siendo la clave de enrutado con la que buscan las herramientas del agente.

**Pero `senderPn` puede no llegar NUNCA, y hay que contar con eso.** Medido el
01-ago-2026: un contacto escribió tres mensajes seguidos y los tres llegaron con
`senderPn: null`, `senderLid: null`, `participantPn: null`. Es la privacidad
nueva de WhatsApp, donde se puede escribir sin exponer el número. No hay nada
que «aprender» y no lo habrá.

Hasta ese día el puente **se negaba a enviar** en ese caso (`resolveSendJid()`
devolvía un `problema` y la ruta respondía 503), heredando la causa falsa del
30-jul según la cual el 463 lo provocaba el `@lid`. Resultado: el agente redactó
tres respuestas correctas, el candado las aprobó, y ninguna salió.

Ahora **se intenta el envío contra el `@lid` y decide el acuse REAL de
WhatsApp**, que ya se verificaba con `esperarRechazo()`. Si de verdad lo
rechaza, se reporta ese error auténtico en vez de una suposición. Intentar y
verificar, nunca negarse por adelantado.

Una sola función, **`mostrarContacto()`** en `lib/whatsapp/contact-identity.ts`,
decide cómo se ve un contacto en todo el panel: el teléfono real si se conoce,
nunca un `@lid` disfrazado de número, y el teléfono como nombre mientras no se
sepa el nombre.

## 2. Versiones y modelos

| Componente | Versión / Valor |
|---|---|
| Next.js | `16.2.7` |
| React | `19.2.4` |
| Vercel AI SDK | `ai ^6.0.194` |
| **LLM del agente** | `google/gemini-2.5-flash` vía OpenRouter |
| **Embeddings RAG** | `google/gemini-embedding-2` (3072D) vía OpenRouter |
| **Transcripción de audio** | OpenRouter Whisper |
| **Visión de imágenes** | `google/gemini-2.5-flash` |

---

## 3. Qué está ESTABLE y funcionando ✅

### Identidad del agente (reconstruida el 2026-07-29)
- ✅ La identidad vive en `agent_configs.metadata.persona` y **se edita desde
  Personalización**: nombre, rol, empresa, saludo, alcance del negocio, medios y
  condiciones de pago. Cambiarlos cambia al agente sin tocar código.
- ✅ `system-prompt.ts` es una plantilla; ya no tiene "Oscar" hard-codeado.
- ✅ Guardrail determinista que elimina cualquier frase donde el modelo se
  declare IA antes de que llegue al cliente.

### Guardrails de salida (`lib/agent/index.ts`)
- ✅ **Referencias**: toda `Ref:` citada debe existir en el catálogo. Se acepta
  la que devolvió `searchCatalog` en el turno o se verifica contra la base.
- ✅ **Precios**: ninguna cifra puede salir sin `getProductPrice` o
  `calculateCustomPrice` ejecutados en ese mismo turno.
- ✅ **Propuesta sin precio**: bloquea presentar 2+ productos sin cifras.
- ✅ **Interrogatorio**: bloquea un tercer mensaje seguido que solo pregunte.
- ✅ Formato de miles colombiano aplicado a la salida.

### Rail de recuperación determinista (`lib/agent/index.ts`)
- ✅ La búsqueda en el catálogo con las palabras del cliente **se ejecuta en el
  servidor antes de que el modelo hable**. No depende de que el modelo decida
  llamar a `searchCatalog`: en producción no la llamaba (`fromTool: 0`) y negaba
  productos que sí existen.
- ✅ Consulta por términos de contenido, no por la frase entera: el motor puntúa
  por palabras clave y el ruido la diluye (medido: la frase completa devolvía 0
  bolsas de organza; los términos limpios devuelven las 7).
- ✅ Guardrail `denied-with-catalog-hits`: si el catálogo tiene coincidencias
  léxicas con lo que pidió el cliente y el bot dice que no lo manejamos **sin
  ofrecer ninguna referencia**, la respuesta se bloquea y se reintenta con la
  lista de lo que sí existe. Decir "no manejo esa medida, pero tengo esta otra"
  sigue siendo válido.

### Retrieval rail (`lib/agent/tools/search-catalog.ts`)
- ✅ El catálogo **no expone ninguna cifra al modelo** (ni `price`, ni
  `max_price`, ni precios embebidos en descripciones). Cotizar con la
  herramienta es el único camino posible.

### Catálogo
- ✅ **2.252 productos activos** (deduplicados el 2026-07-29 desde 8.637 filas).
- ✅ Cobertura de imagen: **~99%**.
- ✅ 0 referencias duplicadas.
- ✅ Preferitismo ZOOM activo. Criterio: referencia `ZM-` **o** tarifa
  procedente de una hoja del Excel propio. Así entran también los volantes
  `VL-` y las tarjetas `TJ-`, que son producción propia y antes no recibían
  ningún punto por no llevar el prefijo.

### Panel
- ✅ **Anti-congelamiento HTTP/2 (2026-08-04).** La campanita que avisa de
  handoffs disparaba `fetch(/api/agent/handoff-alerts)` cada 30s **desde cada
  pestaña abierta**. Como todo va por un único cable HTTP/2, una petición
  colgada arrastraba al resto y el panel se quedaba congelado hasta que el
  navegador cortaba (`ERR_HTTP2_PROTOCOL_ERROR` / `499` en nginx). Ahora la
  campanita mata la petición a los 8s (`AbortController`), hace backoff si
  falla (30s→60s→120s), se pausa cuando la pestaña no está visible y no
  dispara dos veces. nginx además tiene timeouts y buffers más holgados.
  La app siempre respondió rápido (4ms); el problema era de red.
- ✅ **Barra de scroll espejo arriba en el Kanban (2026-08-05).** Con 7 columnas no se ven todas de un vistazo y la barra nativa (abajo) queda enterrada bajo cientos de tarjetas. Barra espejo arriba (sticky, siempre visible): track oscuro + thumb índigo degradado, sincronizada bidireccional con el tablero. **Solo desplaza la vista** — no toca tarjetas, stages ni la lógica del pipeline.
- ✅ **Centro de Control** muestra estado real (antes eran datos inventados):
  servicios, líneas, catálogo, identidad y actividad de 14 días. Cada punto en
  rojo/ámbar indica la causa y la acción de reparación. Lo alimenta `/api/health`.
- ✅ **Base de Conocimiento → Servicios y Marcaciones** lee las tarifas reales
  de la base (antes estaban escritas a mano en el código con cifras inexistentes).
- ✅ **Subir foto de producto desde el editor** (Base de Conocimiento). Una sola
  operación deja coherentes los 3 niveles que el RAG necesita: archivo en disco
  (normalizado a JPEG ≤1024 px con `sharp`), `image_url` en Supabase y re-embed
  multimodal del producto. Si el re-embed falla, se restaura el `image_url`
  anterior y se borra la carpeta, para no dejar una foto sin vector.
  Verificado end-to-end el 2026-07-29 (10,8 s por foto).

### Mensajería
- ✅ Idempotencia real: un mensaje reentregado ya no dispara el agente dos veces.
- ✅ Cerrojo por conversación contra ejecuciones simultáneas.
- ✅ Fotos de producto: se envían **solo cuando el cliente las pide**.
- ✅ **Los stickers se ven en el panel y no despiertan al bot** (02-ago).
- ✅ **Nota de voz y respuesta citada desde el panel** (02-ago).

### Infraestructura
- ✅ Motor RAG bajo `systemd` (`knowledgebot-rag`), con reinicio automático.
- ✅ Git dentro del VPS. Punto de restauración pre-auditoría: `92276ac`.
- ✅ Respaldos del catálogo en `/root/knowledgebot/backups/`.

---

## 4. Qué está ROTO o pendiente 🔴⚠️

### ✅ Los datos del negocio salen del panel, y si falta uno el bot lo admite

**Corrige lo que decía este mismo documento la mañana del 01-ago.** Entonces se
documentó como defecto abierto que `knowledge_chunks` estaba vacía mientras el
prompt ordenaba consultarla. Se resolvió esa misma tarde, y no llenando la
tabla: la herramienta ahora lee de donde el dueño ya escribía.

**El problema real era doble:**

1. `queryKnowledgeBase` consultaba `knowledge_chunks` — **0 filas**, y sus
   scripts de ingesta nunca se han ejecutado en producción. El bot recibía nada
   cada vez, que es el escenario que le hace inventar.
2. Mientras tanto, el panel **ya guardaba** dirección, teléfono, correo,
   política de cancelación y horarios en `agent_configs.business_info`… y el
   bot no podía leerlos.

**Ahora** `queryKnowledgeBase` lee `business_info` (`fichasDelNegocio()` y
`buscarEnFichas()` en `lib/agent/tools/query-knowledge-base.ts`). Es
determinista, no gasta embeddings y se actualiza en cuanto se guarda el panel.
> **Corregido el 03-ago-2026 — leer el dato no basta si el buscador no lo
> encuentra.** Tener la ficha no sirvió de nada mientras `buscarEnFichas`
> **descartaba toda palabra de 3 letras o menos**: a «¿tienen página web?» se
> perdía justamente **«web»**, se buscaba solo «pagina», no había resultados, y
> el bot respondía *«no tenemos una página web como tal»* teniendo la dirección
> guardada. El segundo defecto era comparar **en un solo sentido**, así que
> «direcciones» nunca encontraba «Dirección». Ahora las palabras vacías se
> **nombran** en vez de medirse por longitud, `raiz()` quita el plural de los
> dos lados y el título se compara palabra por palabra. Batería de 17 casos:
> **antes 12/17, después 17/17**. Destapó tres campos más que también se
> perdían — garantía, teléfonos en plural y la propia dirección—, y esos no se
> habían reportado: nadie sabía que faltaban.
> **Ampliado el 03-ago-2026 — de un local a todos los que haga falta.** El
> panel tenía **un** campo de dirección y **uno** de teléfono, y ZOOM tiene más
> de cinco sedes: el bot solo podía dar una, siempre la misma. Ahora
> `business_info.sedes` es una lista sin límite, y dentro de cada sede otra
> lista de teléfonos marcados **llamadas y WhatsApp**, **solo llamadas** o
> **solo WhatsApp** — sin esa marca, a «¿a qué número llamo?» el bot podía dar
> uno que solo recibe mensajes. La dirección y el teléfono viejos se convierten
> en la primera sede al abrir el panel, y `address`/`phone` se derivan de ella
> al guardar: una sola verdad. **Con dos o más sedes el encabezado del prompt
> deja de nombrar una dirección** —queda más corto— porque un dato suelto
> arriba pesaba más que la lista recuperada y hacía que el bot contestara con
> una sola sede. Baterías: 22/22 de sedes y 17/17 del buscador.

#### Lo que estaba escrito en el código y ahora vive en el panel

| Dato | Antes | Ahora |
|---|---|---|
| Medios de pago | `'Bancolombia, Nequi, Daviplata o PSE'` en `DEFAULT_PERSONA` | vacío; solo del panel |
| Condiciones de pago | `'50% para iniciar producción y 50% contra entrega'` | vacío; solo del panel |
| **A dónde paga** (cuenta, titular, NIT) | **no existía en ninguna parte** | campo del panel |
| **Datos que se piden al cerrar** | fijos en la Fase 4 del prompt | campo del panel |
| Página web, garantía, tiempos de entrega | no existían | campos del panel |
| Cualquier otro tema del oficio | — | lista libre `topics` (título + contenido) |

Los valores por defecto eran de **un** negocio escritos en el código. Para ZOOM
sonaban razonables; para un despacho de abogados o un cliente de otro país
habrían sido mentiras dichas con total seguridad.

#### La regla nueva: sin dato, no se rellena

Si un campo está vacío, **el prompt omite la frase entera**. Y para la cuenta
bancaria hay instrucción explícita de no inventar número, banco ni titular, y
decir que el equipo lo confirma. Callar es correcto; rellenar no.

#### El guardrail de precios no estorba, y ya se midió

El candado solo mira cifras con `$` (`/\$[\d.,]+/`). Garantías, plazos,
horarios y sitios web pasan sin tocarse. El único caso que bloqueaba era una
política **con un monto** ("envío gratis sobre $200.000"): ahora se aceptan las
cifras que devuelva `queryKnowledgeBase` **en ese mismo turno**, es decir las
que el dueño escribió. Un precio de producto sigue exigiendo la calculadora.

> ⚠️ **`knowledge_chunks` sigue con 0 filas y ya no la consulta nadie en el
> camino normal.** Se conserva como respaldo por si algún día se carga un
> volumen documental que no quepa en el panel. No la documente como pieza viva.

### ⚠️ Falta probar con datos reales

Los campos nuevos están desplegados pero **el panel está casi vacío**: al
01-ago solo hay nombre del negocio y política de cancelación. Hasta que el dueño
los llene, el bot responderá "lo confirmo con el equipo" a casi todo lo que no
sea catálogo. Eso es correcto, pero se nota.

### ✅ El bot sí entiende los audios (resuelto)
Este documento decía que la transcripción devolvía **402** de OpenRouter por
falta de saldo. **Ya no.** Medido el 01-ago-2026 en producción:

```
Sending audio transcription request to OpenRouter (format: ogg)
Successfully transcribed audio  length: 47
```

Nota de voz real del dueño: *"Hola, quiero cotizar unas agenditas"* → el bot
cotizó cuadernos correctamente. El audio se descarga (Baileys), se guarda en R2
y se transcribe.

### ⚠️ Latencia de respuesta: 28 a 56 segundos
Medido el 31-jul-2026, **peor que los 7-26 s que decía este documento**:
`latency_ms` de 28.171, 44.442, 47.567 y 56.065 en mensajes reales. El tiempo se
va en el modelo y la búsqueda; la infraestructura no es el problema (R2 tarda
200 ms, el webhook 6 ms). Falta el desglose por etapa.

> Decisión del dueño (01-ago-2026): **no es prioritario.** El bot es humanizado
> y un humano tampoco contesta al instante; con "en línea" y "escribiendo…"
> activos, la espera se lee como atención, no como falla.

### 🔴 Faltan las tarifas de marcación
La hoja `MARCAS` del Excel define tampografía, screen y láser por técnica y
tamaño de objeto, pero en la base solo existen **2 servicios de tampografía**.
El bot no puede cotizar "bolígrafo importado + marcación ZOOM", que es una venta
habitual. **Las cifras del Excel y las de la base no coinciden** (la hoja cobra
por tiraje, la base por unidad), así que requieren validación del dueño antes de
cargarse.

### 🔴 DTF UV y DTF Textil por m² sin tarifa
`ZM-GEN-310` y `ZM-TEX-033` no tienen `price_tiers`. La calculadora por área
funciona con tarifas hard-codeadas (59 cm / $700 por cm de alto para UV, 58 cm /
$250 para Textil), pero deberían vivir en la base.

### ⚠️ 114 productos activos sin tarifa
No se ofrecen porque no se les puede dar precio. Visibles en el Centro de Control.

### ⚠️ 10 productos activos sin foto
`VA-136`, `VA-258 B`, los tres mugs ZOOM (`ZM-MUG-007/008/009`) y los cinco USB
metálicos (`ZM-TEC-001..005`). Los 14 restantes de la lista anterior eran las
bolsas fabricadas y se archivaron el 2026-07-29.

> Ya se pueden subir desde el panel: Base de Conocimiento → producto →
> *Subir imagen desde tu PC*.

### ⚠️ Catálogo: productos sin origen documentado
**68 de los 514 productos `ZM-` no tienen hoja de origen** en ninguna de sus
tarifas (`price_tiers.source_sheet` vacío). Ahí aparecieron las 14 bolsas
fabricadas, así que la lista completa hay que revisarla con el dueño.

No todo lo que está en esa lista es un error: los vinilos
`ZM-GEN-305/306/307/309/398/406` cobran **$10 por cm²** (`price_basis='cm2'`,
la calculadora por área), y las camisetas `ZM-TEX-*` tienen varias tarifas en el
mismo rango porque son **variantes de marcación** legítimas (Base, Bordado
bolsillo/carta, DTF bolsillo/carta). Falta la hoja de origen, no el sentido.

La firma del defecto, para reconocerlo: sin hoja de origen + `price_basis`
`unitario` con precio de lote + rangos abiertos (50‑99, 100‑∞) en vez de lotes
exactos (50‑50, 100‑100) + sin foto.

### ⚠️ Precio anómalo en cuadernos
`Cuaderno Argollado Base 80 hojas`, 1/2 Carta: **$13.000 en lote de 20 pero
$16.700 en lote de 50**. El precio sube al aumentar el volumen; parece un error
de captura en el Excel de origen.

### ✅ `linea_2` reconectada (2026-07-29 18:05 UTC)
Ambas líneas responden (`keepAliveErrors: 0`). Se deja anotado porque el estado
de las líneas cambia solo: comprobar siempre en el Centro de Control.

### ✅ La caída cada 50 minutos: RESUELTA (medida el 03-ago-2026)
**La prueba pasó.** Tras mover el filtro a la puerta (reinicio 02:23:50 UTC),
`linea_3` cruzó la marca de los 50 minutos **sin cortarse**: a los 53 min y a
los 58 min seguía conectada con su `connectedAt` original, y las tres líneas
sumaron **cero cortes, cero fallos de descifrado y cero pedidos de reenvío**.
Antes se caía a los **50m04s**, sin fallar una sola vez. En esos mismos 53
minutos la puerta rechazó **12 estados, 5 grupos y 3 canales**: justo el tráfico
que causaba el bucle.


**Lo que se trababa eran los ESTADOS**, las historias que publican los contactos
del número. WhatsApp se los manda a todos los dispositivos vinculados, incluido
el bot. El bot no puede abrirlos —no tiene la llave de esa persona y nunca la va
a tener— así que **le pide a WhatsApp que se los reenvíe**. WhatsApp los
reenvía, falla otra vez, los pide otra vez. Para siempre.

El contraste que lo prueba, medido el 02-ago sobre 3 h:

| Línea | Qué no pudo descifrar | ¿Se resolvió? | ¿Se cae? |
|---|---|---|---|
| `linea_1` | 26 mensajes de **una persona real** (`@lid`) | ✅ sí, al 2.º reintento | **no** |
| `linea_3` | **7 estados** + 1 de grupo | ❌ nunca | **sí, cada 50m04s** |

Lo de una persona se cura solo. **Un estado no se cura nunca**: queda pendiente
del lado de WhatsApp y cada ~50 min WhatsApp termina el flujo (428, cierra él
mismo el socket). La línea reconecta sola en 4 segundos, y por eso el fallo es
casi invisible: el panel siempre dice «conectada».

**El arreglo (03-ago):** el filtro de «solo personas» que ya existía se movió a
la **puerta** (`shouldIgnoreJid` de Baileys). Al ignorar un chat, la librería le
**acusa recibo a WhatsApp y no lo abre**, y ese acuse es lo que hace que deje de
reenviarlo. Antes el filtro estaba en `handleIncoming`, **después** de que la
librería ya había fallado y pedido el reenvío: la regla correcta en el lugar
equivocado, el mismo error que con los stickers.

> **Sirve para las 8 líneas**, no para una: cualquier número recibe los estados
> de sus contactos.
> **La prueba de fondo es el tiempo:** ver a `linea_3` pasar 2 h sin caerse.
> Si aun así cayera, entonces sí toca re-vincular ese número.

### ✅ El panel avisa si una línea se cae en ciclo (03-ago-2026)
El puente detecta tres cortes seguidos con huecos parecidos (40-70 min) y lo
publica en `/diagnostic` como `cicloDeCortes`; el panel de Líneas lo muestra
arriba de la tarjeta con la causa probable y la reparación. **Nunca desvincula
solo:** desvincular obliga a que una persona escanee un QR, y hacerlo por su
cuenta dejaría un local mudo sin que nadie se entere.

### ✅ El total combinado: RESUELTO el 03-ago-2026
El bot cotizaba **un concepto por vez y sumaba él mismo**. El candado comprobaba
**de dónde salió cada precio** y, una vez usada la calculadora, dejaba pasar
cualquier cifra — incluido un total mal sumado.

> Reproducido el 03-ago con cinco corridas de la misma frase («20 cuadernos
> argollados 120 hojas 1/2 octavo, con 6 insertos»), contacto nuevo cada vez:
> **$487.000, $487.000, $427.000, $584.000** y una que no cotizó.
> · $427.000 = `(16.000 + 5.350) × 20` → se le olvidaron 2 de los 6 insertos.
> · $584.000 = `(16.000 + 10.200 + 3.000) × 20` → partió el 6 como **8+2**, o
>   sea diez insertos, y lo escribió: «con 10 insertos».
> **$157.000 de diferencia en el mismo pedido.**

**El prompt YA decía «desglosa de MAYOR a MENOR: 6 = 4+2».** Estaba escrito y
usó 8+2 igual: una instrucción escrita no obliga, obliga el código.

**Arreglo.** `buildQuote` (`lib/agent/tools/build-quote.ts`): el modelo dice QUÉ
lleva el pedido, **sin una sola cifra**; el código lee del catálogo qué
presentaciones existen, resuelve el desglose, busca cada tarifa, suma y
multiplica. No adivina: si el tamaño es ambiguo devuelve las opciones para
preguntarle al cliente. Y el candado se amplió: **la cifra más alta de la
respuesta** —siempre el total— tiene que ser una que alguna herramienta produjo
en el turno, o una ya aprobada, o un monto del panel.

**Medido tras el arreglo:** cuaderno con 6 insertos **5/5 = $487.000** (antes
2/5); con 7 insertos **3/3 = $512.000**; banner laminado 200×100 **3/3 =
$60.000**; y sin bloqueos de más — 6 mugs, 1.000 llaveros y 500 llaveros manilla
a 2 tintas ($1.050.000) aprobados todos en el primer intento.

**Sigue pendiente lo que esto NO resuelve:** cargar las rejillas de precio que
faltan (solo 12 productos tienen cantidad × variante como el Excel de llaveros)
y los «costo adicional» sin cifra (troquel especial, llavero de más de 6×4 cm).

### 🔴 El bot cotiza lo más parecido en vez de decir que no lo tiene
A «¿venden llantas para camión?» contestó «eso puntual no lo manejamos» y acto
seguido cotizó «Adicional: Guardas para Cosido». Traza real: el candado bloqueó
**dos** intentos (búsqueda fuera de tema, y luego precios inventados sin
calculadora) y al **tercero** el modelo usó la calculadora sobre un producto
cualquiera — y eso bastó para aprobar. **El candado verifica de dónde salió el
precio, no si el producto tiene que ver con lo que preguntaron.**

### 🟡 Meta: 8 líneas
Hoy hay 2 líneas de prueba configuradas.

---

## 5. Variables de entorno relevantes (`.env.production`)

| Variable | Valor/Estado |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://moaekovebocnagxkkiwm.supabase.co` |
| `OPENROUTER_API_KEY` | configurado |
| `CHAT_MODEL` | `google/gemini-2.5-flash` |
| `WHATSAPP_BRIDGE_URL` | `http://localhost:3005` (Baileys, puente único) |
| `RAG_SERVICE_URL` | `http://127.0.0.1:8001` (por defecto) |
| `R2_*` | configurados (no en uso activo) |

---

## 6. Cómo verificar el estado

**Desde el panel:** Centro de Control muestra todo lo anterior con su diagnóstico.

```bash
# Servicios
docker ps
systemctl status knowledgebot-rag
docker logs --tail 50 knowledgebot-app
docker logs --tail 50 knowledgebot-wa-bridge-baileys

# Motor RAG
curl -s http://localhost:8001/health
curl -s http://localhost:8001/stats

# Puente
curl -s http://localhost:3005/diagnostic
```

---

## 7. 🚫 Qué NO tocar

1. **La conexión de WhatsApp.** El puente propio es la arquitectura definitiva.
   **Prohibido sugerir o migrar a Meta Cloud API.**
2. **Los volúmenes de sesión** (`wwebjs_sessions`): contienen la autenticación.
3. **El entorno virtual `.venv` del Motor Python.**
4. **La tabla `line_error_log` y sus tipos**: el frontend mapea los labels.
5. **El retrieval rail de `search-catalog.ts`**: si se vuelven a exponer precios
   al modelo, regresan las alucinaciones de precio y la latencia de 80s.
6. **Los guardrails de `lib/agent/index.ts`** sin entender qué bloquea cada uno.
7. **El prompt**: no agregar reglas de más. Preferir guardrails en datos y
   runtime sobre prompt engineering (ver el PDF de mitigación de alucinaciones).
8. **Cambios destructivos en el catálogo** sin respaldo en `/root/knowledgebot/backups/`.

---

## 8. Cómo revertir cambios

```bash
# Restaurar un archivo a su último commit
cd /root/knowledgebot && git checkout HEAD -- <ruta/archivo>

# Volver al estado previo a la auditoría del 29-jul-2026
cd /root/knowledgebot && git reset --hard 92276ac

# Restaurar el catálogo previo a la deduplicación
ls /root/knowledgebot/backups/products_*.json
```

---

## 9. Rutas clave en el VPS

| Servicio | Ruta VPS | Puerto | Proceso |
|---|---|---|---|
| App Next.js | `/root/knowledgebot/` | 3003 | `knowledgebot-app` (docker) |
| Puente WhatsApp | `/root/knowledgebot/wa-server-baileys/` | 3005 | `knowledgebot-wa-bridge-baileys` (docker) |
| ~~Puente viejo~~ | `/root/knowledgebot/wa-server/` | 3004 | `knowledgebot-wa-bridge` — **detenido** |
| Motor RAG | `/root/knowledgebot/Motor de Conocimiento/` | 8001 | `knowledgebot-rag` (systemd) |
| Imágenes | `/root/knowledgebot/catalogo_catalogospromocionales/imagenes_productos/` | — | 31.888 archivos |
| Respaldos | `/root/knowledgebot/backups/` | — | — |

---

## 12. Índice de mecanismos — qué existe, para qué sirve y qué se midió

### Probar una hoja antes de guardarla — el botón que contesta «¿esto funciona?»
`app/(app)/conocimiento/actions.ts` (`probarHoja`) y `ProbarEstaHoja` dentro de
cada hoja del panel.

El dueño, 11-ago-2026: «crear estas hojas es mucho mas dificil de lo que
esperaba; dado que tuviste problemas, no me quiero ni imaginar como voy a hacer
yo para crear una hoja de estas».

**La hoja no es dificil: se llenaba A CIEGAS.** El ciclo era escribir, guardar,
irse a WhatsApp, hacerse pasar por cliente, esperar medio minuto y deducir del
resultado que campo lo rompio. Escribir la hoja de sellos costo TRES intentos
sabiendo como funciona por dentro; sin saberlo es inabordable.

Ahora se escribe lo que diria un cliente y se ven las tres cosas que deciden si
la hoja sirve:

1. **Que hoja se activa y por que palabra.** Si no se activa ninguna, el aviso
   lo dice: es el fallo mas comun (vocabulario en singular).
2. **Con que termina buscando en el catalogo.** Es donde se ven las traducciones
   raras, que es lo que rompio la hoja de sellos dos veces.
3. **Los cinco productos que encuentra, con precio.** Si salen los que no son,
   la hoja no sirve, y se ve sin salir de la pantalla.

**No guarda nada**: prueba lo que hay escrito, asi que se corrige y se vuelve a
probar. Y usa `elegirHojaEntre` y `traducirConEstaHoja`, el mismo codigo que el
bot — no una copia parecida, que se desincroniza y acaba diciendo que la hoja
sirve cuando no sirve.


### La preposicion huerfana que dejaba la traduccion
`lib/agent/hojas.ts` (`limpiarConsulta`).

El dueño pone «sellos automaticos» en el vocabulario y «caucho» en las palabras
vetadas. El cliente escribe «sellos automaticos de caucho». Al catalogo le
llegaba **«sello de»**: la frase entera se sustituye por la palabra del catalogo
y despues el veto se come lo que quedaba detras, dejando el «de» colgando.

Nadie puede prever eso al llenar un formulario, **y no tiene por que**: es el
codigo el que arma la consulta, asi que es el codigo el que la deja limpia. Se
quitan los conectores sueltos por los dos extremos, nunca en medio, para no
romper «juego de mesa» ni «bolsa de tela».

Probado aparte: **17/17**.


### Cuantos productos hay de verdad — 8.623 renglones son 2.332 productos
Medido el 11-ago-2026 sobre la base de produccion.

El dueño creia que tiene «mas de 8.000 productos» y que el bot solo ve 2.228.
Las dos cifras son ciertas y la conclusion no: **6.291 de esos renglones son el
mismo producto repetido**. «Destapador Rectangular - Produccion Nacional», ref
HO-282, esta 13 veces; la Nevera Cooler Trendy, 13; el Set Escolar, 12.

| | |
|---|---|
| renglones en la tabla | 8.623 |
| productos distintos (nombre + referencia) | **2.332** |
| los que el bot ve | 2.228 = **95,5 %** |
| los que le faltan al bot | **104** (71 con precio y foto) |

**Salud de los 2.228 que el bot ve:** 2.035 sanos (**91 %**). Las tres averias,
por separado: 116 sin ninguna tarifa, 50 con el nombre de la variante roto
(texto pegado del encabezado del Excel) y 28 con **dos precios para la misma
cantidad y la misma variante** — los peores, porque la calculadora no elige a
dedo y el producto parece que esta bien.

**Precios disparatados: 545 tarifas y NINGUNA en un producto activo.** El unico
activo con el precio mal es `OF-371`, y su historia explica el mecanismo: su
fila encendida tiene cinco tarifas «desde 1», dos «Estandar» con precios
distintos ($4.180 y $145.000) y tres con nombres que son pedazos del encabezado
del Excel; sus seis copias apagadas tienen el precio limpio de $2.290. **La
deduplicacion se quedo con la fila mala.**

> Cuidado con el atajo evidente. Las copias apagadas de los otros averiados
> traen casi todas **$1.000**, que es relleno de la importacion y no un precio:
> encenderlas cambiaria «sin precio» por «miente por $1.000», que es peor.


### El precio especial por volumen — «llevando mas, le sale mas barato»
`lib/agent/precio-por-volumen.ts`, llamado desde `lib/agent/index.ts` justo
despues de la venta cruzada.

El dueño lo echo en falta el 11-ago-2026: «lo hacia muy bien y no lo volvi a
ver». **Nunca hubo nada que lo obligara**: `getProductPrice` le entrega al
modelo la tabla entera de rangos y el modelo decide si la menciona. Por eso
funcionaba unos dias y otros no. Regla 1 por octava vez.

**No va en las hojas** —fue lo que el dueño pregunto—: el dato ya esta cargado
en cada producto y lo tienen **191 de los 2.228 activos**. La hoja guarda lo que
el codigo no puede deducir; esto si lo deduce.

- Solo el escalon **alcanzable**: el mas cercano hacia arriba, no el mas barato
  de todos. Decirle a quien pide 12 que a partir de 1.000 le sale a la mitad no
  es una oferta.
- Solo precios **por unidad**: un precio por m2 o por lote no se multiplica por
  unidades sin mentir. Misma regla que `buildQuote`.
- Si a esa cantidad le corresponden dos tarifas distintas, es ambiguo y **no se
  elige a dedo**.
- Con varios productos cotizados en el turno se avisa de **uno solo**, el del
  ahorro mas grande: una lista de rebajas es otra vez la lista que el dueño
  prohibio.
- **Nunca en el turno del cierre** (`destinoDelTurno !== 'sold'`): ahi ya habla
  la venta cruzada, y dos ofertas pegadas son una lista.

Medido: antes, «12 Pad Mouse Ergonomico — $218.400 COP» y nada mas. Despues,
«**Un dato que te sirve: si en vez de 12 llevas 30 *Pad Mouse Plano*, cada uno
te queda en $10.400 y el pedido completo en $312.000**».


### La medida que dio el cliente no se pierde
`lib/agent/tools/search-catalog.ts` (`medidasDelCliente`,
`conLaMedidaDelCliente`).

A «cuanto cuesta un sello de 10x8» el bot contestaba «No manejamos sellos de
10x8 cm». El registro de produccion mostro que al buscador le llegaba **«sello»
a secas**: el modelo se quedo con la familia y solto la medida.

Es la clase entera de «el cliente da una medida y la busqueda la tira», y el
catalogo lleva la medida DENTRO del nombre en cientos de productos (*Sello
10x8*, *Roll Up 2x1m*, *Almohadilla 45x65mm*).

- **Pegada, no separada**, y esto es lo que decide: «sello 10x8» encuentra
  *Sello 10x8* de primero con 2,970; «sello 10 x 8» **no lo encuentra**.
- **No estorba** cuando la medida no distingue nada: «banner laminado» y «banner
  laminado 200x100» devuelven *Banner Laminado* de primero.
- Solo se añade si falta: si la consulta ya la trae escrita de cualquier forma,
  no se toca.

Probado aparte antes de desplegar: **16/16**, con casos que deben arreglarse y
casos que no se pueden tocar.


### La hoja plegada — quince fichas identicas eran una sola pared
`app/(app)/conocimiento/KnowledgeBaseClient.tsx`, pestaña «Hojas de categoria».

El dueño, 11-ago-2026: «todas las hojas parecen estar unidas en una sola, no hay
separacion alguna y se puede confundir muy facil al usuario».

**No se arreglaba con mas marco ni con mas texto** —pidio expresamente menos
texto—: se arregla no enseñando quince a la vez. Cada hoja es un renglon con su
numero, su nombre, cuanto le falta y a cuantos productos llega; al abrir una se
cierra la anterior. Las hojas nuevas y las copias nacen abiertas.

El `12/12` del renglon son los doce campos y cuantos tiene escritos: verde
completa, ambar a medias, rojo solo el vocabulario. Es el mismo dato que el
tablero da en total, pero puesto donde se decide.

Y se corrigio un **aviso falso**: «esta hoja no llega a ningun producto» saltaba
con solo no tener categorias marcadas. Desde el 10-ago eso es mentira —la hoja
tambien se encuentra por lo que escribe el cliente— y **once de las doce hojas**
veian esa alarma sin tener nada roto.


### La hoja de sellos, y las tres formas en que una hoja hace DEJAR de cotizar
`agent_configs.metadata.hojas`. Es un dato del panel, no codigo.

Los sellos eran la familia mas descubierta: 106 productos activos y ninguna hoja.
A «necesito un timbre para mi empresa» el bot contestaba «Eso puntual no lo
manejamos» y ofrecia mugs — porque «timbre» sin traducir devuelve un *Timbre
Bike*, un timbre de bicicleta.

Lo que se aprendio escribiendola vale para **todas** las hojas:

1. **El vocabulario, en palabras sueltas.** Con frases largas, «sellos
   automaticos de caucho» se tradujo a **«sello de»** —un «de» suelto—: la
   frase entera se sustituye por la palabra del catalogo y despues los vetos se
   comen lo que queda.
2. **`nunca_buscar` casi nunca hace falta.** Medido: «sello de caucho» y «sello»
   devuelven los mismos cinco productos con el mismo puntaje (2,790). Vetar
   «caucho» no ganaba nada y si rompia la frase. Cada palabra que se veta es una
   palabra menos para acertar.
3. **Todo lo que se escriba en «que necesita saber para dar un precio» se
   convierte en una pregunta que FRENA la venta.** Con «cuantos» en la lista, a
   «quiero un sello con fecha» el bot pedia la cantidad y se quedaba sin
   cotizar. Con «el tamaño» sin condicionar, dejaba de cotizar «un sello de
   10x8» donde el cliente YA habia dado la medida, y llego a contestar «no
   manejamos sellos de 10x8». Lo que va ahi tiene que ser lo imprescindible, y
   condicionado con «solo si el cliente no lo dijo ya».

La marcacion queda **sin definir** por decision del dueño: el bot no afirma nada
y ofrece consultarlo. La venta cruzada del cierre es la **Tinta 28ml**
(ZM-S-61/65), que es el repuesto de un autoentintable — no la Tinta Flash, que
es para los preentintados.

**Lo que sigue sin resolverse:** «sello redondo» no distingue nada, porque la
palabra «redondo» no aparece en el nombre de ningun producto. Los redondos se
llaman *Sello Ø38mm*. Es un hueco del CATALOGO, no de la hoja.


### El tablero de las hojas — que hay, que falta y que esta repetido
`app/(app)/conocimiento/actions.ts` (`diagnosticoDeHojas`) y el bloque de tres
numeros al principio de la pestaña «Hojas de categoria».

El dueño lo pidio el 11-ago-2026 con estas palabras: «cada vez que creo una hoja
nueva me tengo que salir de la de ejemplo y ya no tengo referencia de como
llenarla; una vez lleno una hoja no hay forma de saber si estoy repitiendo una
que ya llene, ni cuales me faltan, ni donde miro». Con 12 hojas ya no se sostiene
de memoria, y estaba trabajando a ciegas.

Y pidio **menos texto, no mas**: «no necesito mas explicaciones en el mismo
panel porque ya hay muchas y aun asi no entiendo nada». Asi que no se añadio ni
una linea de ayuda: se añadieron los tres numeros que contestan sus tres
preguntas, y dos botones.

- **Cuanto cubre.** Un producto esta cubierto si alguna palabra de su nombre
  esta en el vocabulario de alguna hoja — la misma regla que usa el bot. Medido
  el 11-ago con 12 hojas: **863 de 2.228, el 39 %**.
- **Que falta.** Las familias que ninguna hoja reconoce, de mas productos a
  menos, y cada una es un boton que **crea la hoja con el vocabulario ya
  puesto**. Al estrenarlo: sello (73 productos), soporte (41), speaker (38),
  organizador (35), cargador (28), nevera (28)…
- **Que se pisa.** La misma palabra en dos hojas: el bot usa una y descarta la
  otra sin avisar. Al estrenarlo: ninguna.
- **A medio llenar.** Hojas con vocabulario pero sin nada de lo comercial:
  encuentran el producto y no saben que preguntar. Al estrenarlo: 11 de 12.
- **Duplicar hoja.** La hoja nueva nace con todo lo de una que ya funciona, que
  es lo que resuelve el «me salgo de la de ejemplo y pierdo la referencia». Las
  categorias NO se copian: dos hojas sobre la misma categoria se pisan.

> Que el 39 % de cobertura salga con 12 hojas y que la familia mas descubierta
> sean los **sellos** —73 productos, el trabajo del mismo dia— dice lo util que
> era tener el numero delante.


### El nombre recortado que escondia once productos distintos
Once bolsas de algodon Eco Activa se llamaban **exactamente igual** y valian
entre $2.100 y $8.400. No eran duplicados: eran **once tamaños**. El nombre
viene recortado del Excel y la medida quedaba justo despues del corte, asi que
ni el cliente ni el bot podian distinguirlas.

El dato no faltaba: estaba en la **descripcion** de cada una. Se subio al
nombre, con la medida y como se agarra —cordon o manija—, porque con la medida
sola no bastaba: hay dos de 40x40 y dos de 34x40. Y cuando ni eso alcanzaba
(dos bolsas de cambre de 28x35), se añadio lo que las diferencia de verdad
(«base interna plegable»).

**Los «...» del final NO se tocan** (regla del proyecto): la medida se INSERTA
antes. Y el guion comprueba, antes de escribir, que despues del cambio no quede
ningun nombre repetido; si quedara, no toca nada.

> La leccion: cuando dos productos activos se llaman igual, **antes de darlos
> por duplicados, mirar la descripcion**. El dato que los distingue suele estar
> ahi, y el problema es que el nombre no lo muestra.

### Barrido de duplicados del catalogo — como se hace y que dio
`scripts` de trabajo en `/tmp` y respaldos en `backups/`. Se mira **solo lo
ACTIVO**, que es lo unico que el bot ve: entre los apagados los duplicados son
normales, son el resultado de la deduplicacion. (El 10-ago se dio una alarma
por no filtrar; no repetirlo.)

Se separan tres casos, porque no todos son errores:
1. **Referencia repetida** — siempre es un error.
2. **Mismo nombre y mismo precio** — duplicado de verdad.
3. **Mismo nombre y precio distinto** — hay que mirarlo: puede ser un sello
   cuadrado y uno redondo, o dos mugs muy parecidos.

Estado al 11-ago-2026, sobre 2.228 activos: **0 referencias repetidas, 0
duplicados de verdad y 1 grupo a revisar** —el Mug Metalico Star, que el dueño
confirmo que son dos productos distintos—. Se cerraron por el camino: las once
bolsas (eran tamaños), el fechador de 24x24 (dos productos; el dueño borro uno)
y **cinco prendas cargadas dos veces**, cuya copia tenia los mismos precios sin
la opcion «Base» y con la foto de las bolsas ecologicas. Las copias se
**apagaron, no se borraron**: siguen con sus tarifas y se reactivan con un clic.


### El prefijo `ZM-` no es cosmético: es lo que hace propio a un producto
`lib/agent/tools/search-catalog.ts` (`es_propio`) y
`Motor de Conocimiento/api_service.py`. Un producto cuenta como producción
propia de ZOOM —y por tanto se ofrece por encima de cualquier importado— **si su
referencia empieza por `ZM-`**. No hay otra marca en la base.

Por eso, al unificar las referencias de los sellos con las del Excel de la
empresa (11-ago-2026) hubo que dejarlas como **`ZM-` + la del Excel**:
`ZM-S-841`, `ZM-R-524`, `ZM-ST-1`. La primera versión las dejó como `S-841` a
secas y eso los sacaba del grupo de propios.

**Y el cliente escribe la del Excel, sin prefijo.** Las dos formas tienen que
llevar al mismo producto, así que la búsqueda por código:
- filtra por las dos (`reference.ilike.S*` y `reference.ilike.ZM-S*`), y
- compara quitando el prefijo de los dos lados.

Un detalle que costó una prueba: al normalizar un código se le quitan los
guiones, así que `ZM-S-841` llega como `ZMS841` y sus «letras iniciales» serían
`ZMS`, que no existe. El prefijo se quita **antes** de mirar las letras.

Medido: «5 sellos ZM-S-841» → $119.000 y «1 sello S-841» → $23.800; las dos
encuentran `ZM-S-841`. `MU-303-1` sigue funcionando igual.


### Un código de UNA letra también es una referencia — `S-841`
`lib/agent/tools/search-catalog.ts`, `CODIGO_CON_GUION`.

El detector de referencias exigía **dos letras** antes del guion, de modo que
todo el catálogo de sellos de ZOOM era invisible para él: son `S-…` y `R-…`.
Medido el 11-ago-2026, recién unificadas las referencias con las del Excel de la
empresa: a «precio del sello S-828D» el bot contestaba **«no encuentro el sello
S-828D en nuestro catálogo»** sobre una referencia activa y con precio.

Ahora basta una letra, y el que evita los falsos positivos es el mínimo de
caracteres: «a-1» o «y-2» se quedan en dos y se descartan solos. El mínimo bajó
de 4 a 3 para que entren `N-46` y las almohadillas. Probado aparte con 19
frases —10 que deben detectarse y 9 normales que no pueden dar ninguna—: 19/19.

### Las referencias de los sellos son las del Excel de la empresa
Los 78 sellos activos que aparecen en la lista de precios interna llevan ahora
**la misma referencia que usa la empresa** (`S-841`, `R-524`, `S-828D`,
`AR16314700`…) en vez de los `ZM-GEN-xxx` que inventó la importación. El cotejo
exigió que coincidieran **nombre y precio** antes de tocar nada: 78 de 79 filas
casaron, 0 ambiguas, 0 con precio distinto, y ninguna referencia nueva chocaba
con otro producto. Respaldo en `backups/refs_sellos_antes.json`.

Dos cosas que el cotejo dejó a la vista:

- **`S-311-7` «Repuesto S-310» ($105.000) no existe en el panel.** Está en la
  lista de precios de la empresa y hay que crearlo.
- Los **28 sellos cuadrados, redondos y rectangulares** conservan su
  `ZM-GEN-xxx`: en el Excel su «referencia» es la medida misma (`2x2`, `10x8`),
  que ya está en el nombre del producto. Ponerla como referencia haría que
  cualquier «2x2» de una frase se leyera como un código.

> Lo que parecía un duplicado y no lo era: «Sello fechador autoentintable placa
> (24x24mm)» está dos veces con precios distintos. Son **dos productos**: el
> cuadrado `S-524D` ($64.400) y el redondo `R-524D` ($47.600). Con la referencia
> del Excel puesta, la diferencia por fin se ve.


### La venta cruzada — una sola oferta, después de cerrar, con el precio hecho
`lib/agent/venta-cruzada.ts`, enganchada al final del turno en
`lib/agent/index.ts`. Los dos campos que la encienden viven en la hoja de
categoría del panel: **qué producto ofrecer al cerrar** y **con qué frase**.

La regla que manda es la del dueño: *la oferta adicional no puede hacer dudar al
cliente ni tumbar la venta*. Si el bot ofrece «insertos» a secas, el cliente
pregunta qué es un inserto y la venta cerrada se reabre entera. De ahí salen las
cinco garantías, y **todas están en código**, no pedidas al modelo:

1. **Solo después del cierre.** Se usa la misma señal que mueve la tarjeta a
   «Listo para pagar» (`clienteQuiereCerrar`), que ya está medida y peca de
   conservadora, que es justo lo que hace falta aquí.
2. **Una sola oferta**, nunca una lista.
3. **Con el precio ya calculado**, leído del catálogo para la cantidad que el
   cliente compró. Si la tarifa es ambigua o no hay cantidad, no se ofrece.
4. **Una sola vez por conversación** (marca en `contacts.metadata.venta_cruzada`,
   por conversación). Si el cliente no contesta que sí, no se insiste.
5. **En las palabras del dueño.** Sin frase escrita no hay oferta: la misma
   regla de `DEFAULT_PERSONA`, sin dato no se rellena con un ejemplo.

Va **después del candado de salida** a propósito: el precio lo calculó el
código, no el modelo, así que no hay nada que revisar, y si se pegara antes,
`applyOutputGuardrail` vería una cifra que ninguna herramienta del modelo
devolvió y bloquearía la respuesta entera gastando un intento. Y **después de
mover la tarjeta**, para que `huboCotizacion` no cuente una sugerencia como
cotización.

Medido el 11-ago-2026: al cerrar 20 cuadernos, «Una cosa más: te sumo 20
bolígrafos para entregar junto con los cuadernos por $17.000. ¿Te sirve?» —
una frase, un precio, y se contesta con sí o no.

### La hoja se le pega al producto por lo que pidió el cliente, no solo por su categoría
`lib/agent/hojas.ts` (`hojaParaEsteProducto`) y `adjuntarGuiaDeVenta` en
`search-catalog.ts`.

**El fallo silencioso, medido el 11-ago-2026.** De las 12 hojas del panel,
**once no tienen ninguna categoría marcada**: se sembraron con el vocabulario
del cliente, que es lo que traduce la búsqueda, y eso funcionaba. Pero la guía
de venta se pegaba mirando **solo la categoría del producto**, así que el dueño
podía llenar entera la hoja de «Mugs y pocillos» —qué preguntar, si la marcación
va incluida— y **no pasaba absolutamente nada**. Escribir y no ver ningún efecto
es lo que hace que se deje de usar el panel.

Y no se arregla pidiéndole que marque las categorías, porque **el catálogo no
está ordenado así**: los mugs activos viven en cuatro categorías distintas
—«MUGS, BOTILITOS, VASOS Y TERMOS» (43), «HOGAR» (36), «Mugs» (6) y «ECO
NATURE» (4)—, las gorras en otras cuatro y los bolígrafos en cuatro más. Nadie
puede mantener eso a mano.

Orden de prioridad: la categoría si tiene hoja propia (es lo que el dueño dijo
explícitamente) → la hoja de lo que pidió el cliente → la hoja general.

### El asterisco de cierre no es una frase cortada
`lib/agent/index.ts`, `respuestaCortada`.

Hasta el 11-ago-2026 cualquier respuesta terminada en `*` se daba por cortada.
Pero así es como el bot escribe un precio en WhatsApp, y una cotización que
termina en la línea del precio termina en asterisco:

```
Claro, te cotizo 30 cuadernos.
*30 Cuaderno Argollado - Base 80 hojas (Ref: ZM-CUA-010) — $390.000 COP*
```

Medido ese día: esa respuesta se bloqueó **las tres veces** —los tres intentos—
y al recortarla «a la última frase completa» se le quitó justo el renglón del
precio. Al cliente le llegó «Claro, te cotizo 30 cuadernos argollados» y nada
más: **la cotización estaba bien calculada y se tiró a la basura**.

El fallo llevaba tiempo dormido y solo se destapó al quitar la pregunta de
extras del final: con una pregunta detrás, el asterisco no quedaba último.
Ahora se quitan los cierres de formato y se juzga lo que hay debajo. Probado
aparte con 18 frases —10 cortadas de verdad y 8 completas—: 18/18.

### La oferta de extras antes de cerrar — dónde estaba escrita de verdad
`lib/agent/index.ts`, `quitarOfertaPrematuraDeExtras`, con los nombres sacados
de la hoja (`extrasDeLoQuePidio`).

El bot remataba una cotización con «¿Te gustaría agregarle **insertos, filtro UV
o guardas**?»: una lista, sin precio, con palabras que el cliente no entiende y
**antes** de cerrar la venta. Las cuatro cosas que el dueño prohibió al pedir la
venta cruzada.

**Se buscó la causa en tres sitios y estaba en los tres, por orden de descubrimiento:**

1. **La hoja del panel**, campo «¿Qué extras se le pueden agregar?». Se reescribió
   como orden —«no los ofrezcas ni los enumeres»— y **el modelo los siguió
   enumerando**. Regla 1 del proyecto, séptima demostración. Ahora la lista solo
   se le entrega cuando el cliente nombra un extra o pregunta por agregar algo:
   lo que no está delante no se puede ofrecer.
2. **`ZM-CUA-014`, «CÓMO ARMAR EL PRECIO DE UN CUADERNO»**: un instructivo
   guardado como producto **activo**, que salía en toda búsqueda de cuadernos
   diciendo «sumar insertos, sumar filtro UV, sumar guardas». Apagado, con
   respaldo en `backups/ZM-CUA-014_antes_de_apagar.json`. Es el mismo error que
   `instrucciones_venta`: comportamiento metido donde van los datos.
3. **El propio `system-prompt.ts`**, sección «REGLA ESPECIAL: Cuadernos», que
   nombra literalmente «1 inserto», «2 insertos», «filtro uv», «guardas para
   argollado», «cosido», «diseño». **Es un dato del negocio escrito en el
   código**, justo lo que la regla 7 prohíbe, y sigue ahí: quitarlo obliga a
   trasladar antes la mecánica de cotización del cuaderno, y eso tiene su propia
   medición (la regresión de los $487.000 depende de ese bloque).

Mientras esos nombres sigan en el prompt, **el modelo puede ofrecerlos cuando
quiera**. Por eso el cierre no es una instrucción sino un candado: si la venta
todavía no está cerrada, la pregunta que **enumera dos o más extras** se cae de
la respuesta. Dos frenos para no pasarse: «¿le sumamos el filtro UV?» —una sola
cosa concreta— se respeta, y si al quitar la frase se perdiera el precio, no se
toca nada. **Se quita la frase, no se bloquea el turno**: bloquear gasta uno de
los tres intentos y ya se vio acabar en la respuesta de respaldo.

Probado aparte con 8 casos —3 que deben caerse, 5 intocables— y sin extras en la
hoja no toca nada: 8/8.

> Lección de método: **la salida truncada de un `grep` no es una respuesta.**
> La primera búsqueda de «inserto» en el código traía 20 líneas de `index.ts` y
> ahí se cortó; `system-prompt.ts` estaba en la línea 21. Se dio por buena una
> conclusión sacada de media lista.

### El «producto» que le daba instrucciones al bot — ZM-CUA-014
«CÓMO ARMAR EL PRECIO DE UN CUADERNO» no era un producto: era un instructivo
guardado como ficha del catálogo, activo, y salía en **toda** búsqueda de
cuadernos. Su descripción enumera «sumar insertos (1, 2, 3, 4 u 8), sumar filtro
UV, sumar guardas», y el modelo la leía y le preguntaba al cliente por esos
extras **antes de cerrar la venta** — con palabras que el cliente no entiende y
sin precio, las cuatro cosas que el dueño prohibió.

Es el mismo error que `instrucciones_venta`, en otro sitio: instrucciones de
comportamiento metidas donde van los datos. Lo que decía ya vive en dos lugares
que sí mandan: la hoja de Cuadernos del panel y `buildQuote`, que arma el
desglose en código desde el 03-ago. Apagado el 11-ago-2026, con respaldo en
`backups/ZM-CUA-014_antes_de_apagar.json`.

> Antes de culpar a la hoja o al prompt de lo que el bot dice de más,
> **mirar qué le devolvió el buscador**. Un instructivo con forma de producto
> pesa más que cualquier regla escrita.



### Dos cosas en un mismo mensaje — `falta-una-de-las-dos`
`lib/agent/hojas.ts` (`familiasQuePidioElCliente`) y el candado del mismo nombre
en `lib/agent/index.ts`.

«Me interesa el botilito, pero **también** mándame fotos de gorras de dril» son
dos cosas. El bot cotizaba los botilitos y se olvidaba de las gorras — y no
siempre, que es lo peor: una de cada cinco tandas de prueba. Lo que sale a veces
no se le puede prometer a nadie.

El sistema cuenta cuántas familias nombró el cliente usando **el vocabulario de
las hojas** (el campo «cómo lo pide el cliente»). Si la respuesta deja una
fuera, se bloquea y se le ordena atender las dos en el mismo mensaje, un bloque
por cada una.

Solo cuenta cuando el mensaje **suma**: «y», «también», «además», «aparte». Sin
esa señal, «no quiero mugs, quiero gorras» nombra dos familias y pide una sola,
y bloquear ahí sería el error contrario.

> Este candado tapa el caso frecuente, no todos. Entender de verdad una petición
> con dos intenciones es el trabajo del **asesor racional**, que sigue sin
> construirse (ver §4).

### El filtro de identidad, por patrón y no por lista
`lib/agent/index.ts`, `MARCADORES_DE_IDENTIDAD`.

Conocía «no puedo mostrar» y «no puedo enviar imágenes» y aun así dejó pasar
«**no te la puedo enviar por aquí**» —la frase de la captura del dueño del
10-ago— porque el «te la» se mete en medio. El 03-ago se le había escapado «no
tengo la capacidad de enviar fotos» por lo mismo. **Enumerar redacciones es
jugar al gato y al ratón, y se pierde.**

Ahora la marca es el patrón: negar mostrar/enviar/ver **con el objeto** (foto,
imagen) **o con el medio** («por aquí», «por este canal»).

**El primer intento fue demasiado ancho y se corrigió antes de desplegarlo:**
cubría cualquier «no te lo puedo mandar», y eso se lleva por delante «no te lo
puedo mandar antes del viernes, la producción tarda 8 días», que es logística
legítima. Batería propia: **20/20** — 10 frases que debe tapar y 10 que no puede
tocar, entre ellas «no te puedo bajar más el precio» y «el sistema de impresión
DTF permite full color».


### Las hojas MANDAN la búsqueda — el circuito, al derecho
`lib/agent/hojas.ts` (`hojaParaLoQueDijoElCliente`, `traducirConsulta`) y el campo
**«¿Cómo lo pide el cliente?»** en Conocimiento → Hojas.

Hasta el 10-ago la hoja se encontraba por la **categoría de un producto ya
hallado**: llegaba tarde y, si la búsqueda traía lo que no era, la guía quedaba
pegada al producto equivocado. El dueño escribía «busca con: cuaderno 80 hojas»
y «nunca busques con: agenda, grande, cosido» y **el código no usaba ninguna de
las dos para buscar**.

Ahora la hoja se encuentra por **las palabras del cliente**, antes de buscar, y
su `buscar_como` pone la consulta. Gana la coincidencia más larga, para que
«mug que cambia de color» le gane a «mug». La sustitución es **quirúrgica**:
solo cambia la palabra del cliente y deja el resto de la frase — medido,
«gorra de dril» puntúa **2,97** y «gorra» a secas **2,79**, así que tragarse el
«dril» habría arreglado el sinónimo rompiendo lo específico.

Se aplica también a lo que busca el **modelo por su cuenta** (`runCatalogSearch`),
que era por donde se escapaba: con la hoja puesta el sistema buscaba «boligrafo»
y traía bolígrafos, pero el modelo buscaba «esferos» por su lado, se traía una
*Alcancía Esfera* y era la que ofrecía.

Medido el 10-ago contra el motor de producción: «esfero» **0,650** (y cuela la
alcancía), «boligrafo» **1,150**. La misma intención, **un 77 % mejor
encontrada** con la palabra del catálogo. Sin hojas cargadas, todo se comporta
como antes.

### La referencia exacta — un código no es lenguaje
`lib/agent/tools/search-catalog.ts` (`referenciasEnElTexto`, `buscarPorReferencia`).

`MU-303-1` **existe y está activa**: es el *Mug Metálico Wilem 380ml II*,
guardado como `MU-303-1.` con un punto que dejó el Excel. El bot decía que no
existe. La escondían **cuatro** cosas encadenadas, y hubo que quitarlas una por
una:

1. El rail determinista descarta palabras de menos de 4 letras y números
   sueltos: de «MU-303-1» no quedaba **nada** con que buscar.
2. Sin el código, el modelo buscaba «mug metálico» — y con esas palabras el
   motor devuelve los mugs de ZOOM, no el Wilem.
3. El filtro de **ZOOM primero** lo habría descartado por importado.
4. El candado antialucinación lo daba por **inventado**, por el mismo punto.

Un código se compara **sin puntos, guiones ni mayúsculas**, y el producto que el
cliente nombró queda **protegido**: ningún filtro posterior puede quitarlo, y
encabeza la propuesta. Si el sistema resolvió el código, **negarlo se bloquea**
(`nego-referencia-que-existe`).

> **Trampa pagada:** dentro de `.or(...)` de Supabase el comodín es `*`, no `%`.
> Un `%` viaja en la dirección web como el principio de un carácter escapado y
> la consulta devuelve vacío **sin error**. Y pedir una columna que no existe
> (`requires_area` no está en `products`) devuelve 400 y también deja la
> consulta vacía en silencio. Los dos fallos mudos costaron una tarde: por eso
> ahora el error de esa consulta se mira y se escribe en el registro.

### El bot que contestaba solo el saludo — causa encontrada
`lib/agent/index.ts` (`seQuedoEnElSaludo`, motivo `solo-el-saludo`).

Estaba en la lista como «reproducido, sin causa encontrada»: el cliente escribía,
el bot respondía «Hola, hablas con Oscar Herrera…» y nada más, y había que
mandarle un «?» para despertarlo.

La causa estaba en el registro, a la vista: **`finishReason: "other"`**. El
proveedor avisa que la generación **no terminó de forma normal** y lo que llega
es un pedazo. Cuando el pedazo se nota —«…50 esferos con el logo de tu
empresa:» y se acabó— salta el control de respuesta cortada; pero cuando lo
único que alcanzó a escribir fue el saludo, el texto **parece completo**: termina
en «?» y pasaba todos los controles. En una sola tanda de 15 pruebas apareció
**4 veces**. Ahora, si el cliente preguntó algo concreto y solo salió el saludo,
se vuelve a pedir la respuesta.

### El candado que castigaba los aciertos — `search-off-topic`
`lib/agent/index.ts`, dentro de `applyOutputGuardrail`.

Comparaba las palabras de la búsqueda contra las palabras **crudas** del cliente.
Medido en producción el 10-ago, tres bloqueos seguidos y los tres injustos:

| lo que buscó | lo que pidió el cliente | resultado |
|---|---|---|
| `mug` | «mugs» | 🔴 bloqueado |
| `boligrafo` | «esferos» | 🔴 bloqueado |
| `mug mágico` | «mugs cambien color agua» | 🔴 bloqueado |

El primero por longitud: se descartaba toda palabra de menos de 4 letras y con
ella se iba **«mug»**. Los otros dos porque **traducir la jerga es justo lo que
queremos que haga**. Cada bloqueo gastaba uno de los tres intentos, y a la
tercera salía la respuesta de respaldo, que no vende nada.

Ahora se bloquea **solo** si la búsqueda se parece al tema **anterior** y no al
de ahora — que es el fallo que este candado existe para atajar («quiero unos
avisos» y buscó «mug»). Si no se parece a ninguno de los dos, es una traducción:
se anota en el registro y pasa. Y las palabras de 3 letras entran: se descartan
por lista (`MULETILLAS_CORTAS`), no por longitud.

### Precios viejos pegados a productos nuevos — `precio-reciclado`
`lib/agent/index.ts`. La puerta de «precios ya aprobados» existe para el cierre:
«me quedo con ese» y el bot repite el total sin recalcular. El agujero era que
aceptaba una cifra vieja con un producto **nuevo**. Es la captura que trajo el
dueño: pidió mugs metálicos y recibió $235.000 / $429.900 / $589.000, y un
minuto después **otros tres mugs distintos con las mismas tres cifras**.
Comprobado contra `price_tiers`: el Mug Tintero a 10 unidades vale $8.000, no
$23.500. Ahora, si la respuesta nombra una referencia que no se había cotizado
antes en esa conversación, la puerta se cierra y hay que calcular.

### La política de marcación que nadie escribió
`lib/agent/index.ts` (`quitarPoliticaInventada`).

A «¿los mugs ya vienen con mi logo impreso?» el bot contestó «los precios de
catálogo no incluyen la marcación, se cotiza aparte según la técnica, tamaño y
número de tintas». **Nadie le dijo eso**: no hay hoja de Mugs. Es el mismo fallo
que `DEFAULT_PERSONA` —un dato del negocio que el bot rellena cuando el dueño no
lo escribió— y se le aplica la misma regla: si ninguna hoja lo respalda, la
oración **se cae** y el bot ofrece confirmarlo. **No se bloquea la respuesta**:
bloquear gasta un intento de los tres y ya está medido que los candados se
pelean entre sí.

### La calculadora pedía más filas de las que la base entrega
`lib/agent/tools/get-product-price.ts`. Al resolver un producto por su nombre
pedía `.limit(2000)` y `.limit(3000)` — y **la base nunca devuelve más de 1.000
por petición**: no da error, devuelve mil y se queda callada. Con 8.624 filas en
la tabla, el resto era invisible para la calculadora. Ahora filtra por activos
(2.235) y **pagina de a 1.000** hasta recorrerlos todos.

### Cifras del catálogo, medidas el 10-ago-2026
| dato | valor |
|---|---|
| productos en la tabla | 8.624 |
| **activos** (los únicos que el bot ve) | **2.235** |
| apagados por la deduplicación | 6.389, de los cuales 6.291 tienen gemelo activo |
| activos **cotizables** (con tarifa usable) | 2.118 — **94,8 %** |
| activos sin tarifa | 117 |
| referencias repetidas entre activos | **0** |
| activos con foto | 2.233 — 99,9 % |
| categorías | 82 (80 con productos) |
| cobertura con 12 hojas | 1.610 productos — **72 %**; con 20 hojas, 83 % |

> **Por qué existe esta sección.** El dueño lo pidió el 03-ago-2026 con estas
> palabras: «no tener que acudir al código para saber que hay una memoria que
> existe y que sirve para X cosa». Tenía razón, y la causa está medida:
> **el grafo tiene la estructura del código pero casi nada del porqué.** De sus
> 102 nodos de razonamiento, **93 salen de Python y solo 4 de TypeScript** —
> y este sistema es TypeScript en un 95 %. `lib/agent/index.ts`, con 1.400
> líneas y comentarios enormes, aporta **solo nombres**: el grafo sabe que
> `photosByConversation` existe, no sabe para qué sirve.
>
> **Cada título de este archivo SÍ se vuelve un nodo del grafo** (47 nodos
> salen de aquí). Por eso los mecanismos se listan abajo con título propio:
> es la forma de que `graphify explain` los encuentre sin abrir el código.

### La memoria de fotos por conversación — `photosByConversation`
`lib/agent/index.ts`. Un mapa con la llave de la conversación y un plazo de
**10 minutos**. Guarda las fotos y precios de lo que el bot acaba de cotizar,
para que el repartidor las mande sin volver a consultar el catálogo. **Es el
precedente exacto** de la memoria del asesor que está en diseño: una por chat,
se reescribe, se borra sola, nunca se cruzan dos chats.

### El historial que el bot recuerda — 10 mensajes, no 10 turnos
`lib/agent/index.ts`, en `runAgentForMessage`. Lee los **últimos 10 mensajes**
de la base. Como cada turno son dos mensajes, **el bot recuerda unos 5 turnos**.
El número se bajó a propósito: el comentario dice que historiales largos
disparan el riesgo de que se trabe en bucle — y eso coincide con el fallo
reportado por el dueño, «el bot repite respuestas guardadas». **Los mensajes sí
se guardan para siempre en la base**: lo corto es lo que se lee, no lo que se
conserva.

### El repartidor de fotos — falla en silencio
`lib/whatsapp/webhook-processor.ts`, `dispatchRequestedPhotos`. Manda la foto
solo si el cliente la pide y **solo de lo que el agente ya cotizó en ese turno**.
Si el producto no tiene foto cargada, la descarta y **se va sin avisar a nadie**.
Medido el 03-ago con una conversación del dueño: el cliente pidió cuatro veces
la foto del Mug Mágico 11oz, que **no tenía foto**; el bot prometió tres veces
«te la mando ahora mismo» y a la cuarta se inventó que no podía enviar fotos.
**El bot nunca se entera de que el repartidor falló.**

### El filtro de identidad — tres familias, y lo que se le escapa
`lib/agent/index.ts`, `sanitizeIdentity` sobre `IDENTITY_MARKERS`. Tapa lo que
el bot ES («soy un bot»), lo que HACE («la base de datos») y **la fontanería**
(«se adjuntó», «el sistema se encarga»). 26 casos de prueba, 15 de ellos falsos
positivos que NO se deben tapar. **Agujero medido el 03-ago:** no agarra
«no tengo la capacidad de enviar fotos» — sí agarra «no puedo mostrar» y «no
puedo enviar imágenes», pero esa redacción se le escapó.

### Nada comprueba que la respuesta diga algo
`respuestaSirve()` existe y funciona: le das «¡Claro!» y responde que **no
sirve**. Pero **solo se usa dentro del filtro de identidad**. Si la respuesta no
menciona ser un bot, sale tal cual aunque sea una palabra. Por eso, en la
conversación del 03-ago, el cliente tuvo que escribir «?» dos veces para
despertar al bot: estaba haciendo el trabajo que le falta al sistema.

### El buscador de los datos del negocio — `buscarEnFichas`
`lib/agent/tools/query-knowledge-base.ts`. Busca por palabras en lo que el dueño
escribió en el panel (dirección, teléfonos, web, garantía, sedes, temas libres).
**No usa `knowledge_chunks`**, que está vacía. Corregido el 03-ago: descartaba
toda palabra de 3 letras o menos —y la palabra era «web»—, y comparaba en un
solo sentido, así que «direcciones» no encontraba «Dirección». Batería: 12/17
antes, **17/17** después.

### Las sedes y sus teléfonos — `detalleDeSede`
`lib/agent/tools/query-knowledge-base.ts`. `business_info.sedes` es una lista sin
límite; cada sede lleva sus teléfonos marcados **solo llamadas**, **solo
WhatsApp** o **las dos**. Sin esa marca, a «¿a qué número llamo?» el bot podía
dar uno que solo recibe mensajes. Con dos o más sedes, **el encabezado del prompt
deja de nombrar una dirección**: un dato suelto arriba pesaba más que la lista
recuperada y hacía que contestara con una sola sede.

### Las hojas de categoría — la chuleta del asesor
`lib/agent/hojas.ts` y la pestaña «Hojas de categoría» del panel de Conocimiento.
El dueño escribe, por familia de productos, **qué necesita saber el asesor** para
cotizar y **cómo pedírselo al cliente** sin interrogarlo — son dos campos
distintos a propósito: el asesor necesita las tintas, el cliente no tiene por qué
oír esa palabra. Una hoja puede cubrir **varias categorías** (se agrupa por qué
hay que preguntar, no por lo que el producto es) y hay una **hoja general** para
lo que no tenga la suya.

Viven en `agent_configs.metadata.hojas`, igual que las cuentas de pago y las
sedes. `searchCatalog` le adjunta a cada producto la guía de su categoría en
`guia_de_venta`: **dato de recuperación, no instrucción del prompt**. Con eso se
llenó el hueco de `instrucciones_venta`, que el prompt mandaba obedecer dos veces
y nunca existió. Caché de 60 segundos, así que un cambio en el panel se ve al
minuto. **Sin hojas cargadas el bot se comporta exactamente como antes.**

Medido el 04-ago: con la hoja de Cuadernos puesta, a «¿y ya vienen marcados?» el
bot responde «la marcación ya está incluida» y hace **una** pregunta. El 03-ago,
sin hoja, hacía tres y terminaba en «hubo un error al cotizar».

### La cotización armada — `buildQuote`
`lib/agent/tools/build-quote.ts`, creada el 03-ago. El modelo dice **qué** lleva
el pedido, sin una sola cifra; el código resuelve el desglose leyendo del
catálogo qué presentaciones existen, busca cada tarifa, suma y multiplica.
**No adivina:** si el tamaño es ambiguo devuelve las opciones para preguntarle al
cliente. Cerró el fallo del total (§ El total combinado).

### El candado de salida y sus motivos — `applyOutputGuardrail`
`lib/agent/index.ts`. Revisa la respuesta antes de que salga y, si la bloquea,
`RECALC_ORDERS` le da una orden de corrección distinta por intento (tres). Los
motivos vigentes: `search-off-topic`, `no-calculator`, `denied-with-catalog-hits`,
`invented-reference`, `offer-without-price`, `interrogation-no-offer`,
`servicio-sin-tarifa` y **`total-sin-calculadora`** (nuevo el 03-ago).
**Los candados se pelean entre sí**: ya pasó el 02-ago, la corrección de uno
disparaba el otro y se agotaban los tres intentos. Antes de agregar uno nuevo,
comprobar cómo interactúa con `search-off-topic`.

### `instrucciones_venta` — la orden de obedecer un papel que no existe
Hasta el 03-ago el prompt le decía **dos veces** al bot que obedeciera las
`instrucciones_venta` de cada producto. **No es columna de `products` ni la
devuelve el buscador**: siempre llegaba vacía. Se le mandaba obedecer algo que
nunca llegaba, que es justo el escenario que lo hace inventar. **Se quitaron las
dos frases.** El hueco sigue ahí, y es el sitio natural de la «hoja por
categoría» que está en diseño.

### El diccionario de jerga — está escrito y no se cumple
El prompt trae «esfero/lapicero → boligrafo · cachucha → gorra · botilito →
termo». Medido el 03-ago: buscar «boligrafo» puntúa **1.15**; buscar «esfero»
puntúa **0.65** y encima trae una *Alcancía Esfera*. **Está escrito como consejo
al modelo, no como regla del sistema**, y a los consejos los sigue cuando quiere.
Es la prueba repetida de la regla del proyecto: obliga el código, no el texto.

### Las rejillas de precio — solo 12 productos las tienen
`price_tiers` soporta precio por **cantidad × variante** (la rejilla del Excel de
llaveros: 10 rangos × 4 tintas = 40 precios). Medido el 03-ago sobre 10.025
renglones de precio: **12 productos** tienen la rejilla completa —los dos
llaveros propios, cuatro manillas, el carnet rígido y seis cintas portacarnet—,
265 tienen variantes sin volumen, 161 volumen sin variantes y **1.683 un precio
fijo y nada más**. La maquinaria funciona; lo que falta son datos.

## 10. Historial de este documento

| Fecha | Cambio |
|---|---|
| 2026-07-18 | Creación inicial. |
| 2026-07-23 | Actualización tras el intento de migración a Baileys. |
| 2026-07-29 | Reparado el upload de fotos desde el panel (volumen `:ro`, rollback destructivo, re-embed bloqueante). `linea_2` reconectada. |
| 2026-07-29 | **Reescritura tras auditoría directa del VPS.** Se corrige la arquitectura (no existe el puente Baileys en producción), se documentan los guardrails, la deduplicación del catálogo, el preferitismo ZOOM y el panel con datos reales. |
