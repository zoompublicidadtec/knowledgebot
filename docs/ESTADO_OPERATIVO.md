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
| **Adjuntos en el panel** | 🟢 **ver: resuelto el 02-ago**. Se ven foto, nota de voz, sticker (en pequeño), video y GIF. 🟢 **enviar foto o archivo: resuelto el 02-ago** — el clip del cuadro de escritura, con pie de foto y tope de 20 MB. 🔴 **enviar nota de voz: pendiente** — necesita `ffmpeg` en la imagen del puente y la marca `ptt` en `send-media`; sin eso llegaría como archivo de audio, no como nota de voz. Sin selector de emojis, por decisión del dueño |
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

## 10. Historial de este documento

| Fecha | Cambio |
|---|---|
| 2026-07-18 | Creación inicial. |
| 2026-07-23 | Actualización tras el intento de migración a Baileys. |
| 2026-07-29 | Reparado el upload de fotos desde el panel (volumen `:ro`, rollback destructivo, re-embed bloqueante). `linea_2` reconectada. |
| 2026-07-29 | **Reescritura tras auditoría directa del VPS.** Se corrige la arquitectura (no existe el puente Baileys en producción), se documentan los guardrails, la deduplicación del catálogo, el preferitismo ZOOM y el panel con datos reales. |
