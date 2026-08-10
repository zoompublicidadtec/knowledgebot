<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# KnowledgeBot — punto de entrada obligatorio

> Verificado contra el VPS de producción el **2026-08-02**.
> `CLAUDE.md` solo contiene `@AGENTS.md`: este archivo es la puerta de entrada.

## 0. Knowledge Graph del código (LEER PRIMERO)

El proyecto tiene un **grafo de conocimiento del código real** generado con
Graphify. Antes de asumir cómo funciona el sistema o de buscar archivos a
ciegas, **consultá el grafo**: cada conexión es literal del código (marcada
`EXTRACTED`) o derivada (`INFERRED`), con su archivo y línea.

El grafo vive en el VPS (fuente de verdad), en `/root/knowledgebot/graphify-out/`.
Está generado contra el commit **`2f48802`**. **Si el código cambió desde
entonces, el grafo está desactualizado y miente** → regeneralo antes de confiar.

### Cómo consultarlo (por SSH al VPS)

```bash
# El binario NO está en el PATH por defecto. Exportar SIEMPRE antes:
export PATH=$HOME/.local/bin:$PATH
cd /root/knowledgebot

# 1) ¿El grafo sigue vigente? Lo que lo invalida es que cambie el CODIGO, no
#    que avance el HEAD: un commit de documentacion no lo desactualiza.
git diff --stat 2f48802..HEAD -- '*.ts' '*.tsx' '*.js' '*.py'
#    Sin salida = el grafo esta al dia. Con salida = regenerar (paso 4).

# 2) Entender un símbolo / concepto / archivo:
graphify explain "processInboundMessage"
graphify explain "applyOutputGuardrail"
graphify explain "api_service"

# 3) Trazar la ruta entre dos partes del sistema:
graphify path "processInboundMessage" "getProductPrice"
graphify path "runAgentForMessage" "searchCatalog"

# 4) Regenerar el grafo tras cambios de código (~30s, sin costo, sin LLM):
graphify update .
python3 scripts/aplicar_tema_grafo.py   # SIEMPRE despues de regenerar
#    graphify reescribe graph.html con su plantilla de fabrica y BORRA el
#    diseño que hizo el dueño. El diseño vive en graphify-out/graph.plantilla.html
#    (versionado a proposito) y ese guion le vuelve a meter los datos nuevos.
#    Si regeneras y no lo corres, le borras el trabajo sin avisarle.

# 5) Salud del grafo (nodos/aristas rotas o duplicadas):
graphify diagnose multigraph
```

### Qué contiene el grafo

- `graph.json` — grafo consultable. Al 11-ago-2026: **1.490 nodos y 2.667 aristas**, `graphify diagnose multigraph` sin duplicados ni variantes
  contradictorias.
- `GRAPH_REPORT.md` (24 KB) — resumen humano: comunidades, god-nodes, conexiones.
- `graph.html` (1 MB) — visualización interactiva (abrir en navegador).

**Regla:** para entender arquitectura, dependencias o "qué rompe si cambio X",
consultá el grafo antes de leer código suelto. Para datos vivos (estado real de
servicios, catálogo, logs), el VPS sigue siendo la fuente de verdad (ver §4).

### Lo que el grafo NO tiene, y dónde está

**El grafo tiene la estructura del código, no el porqué.** Medido el
03-ago-2026: de sus 102 nodos de razonamiento, **93 salen de Python y solo 4 de
TypeScript**, y este sistema es TypeScript en un 95 %. `lib/agent/index.ts`
—1.400 líneas, con los comentarios más importantes del proyecto— aporta al grafo
**solo nombres**: sabe que `photosByConversation` existe, no sabe para qué sirve.

El motivo es que el extractor convierte los *docstrings* de Python en nodos de
razonamiento, pero no hace lo mismo con los comentarios de bloque de TypeScript.
La capa semántica (la que sí lo haría, con LLM) **nunca se ha corrido aquí**: el
grafo es 100 % extracción de estructura.

**Dónde está entonces el porqué:** en `docs/ESTADO_OPERATIVO.md` §12, «Índice de
mecanismos». Cada título de ese archivo **sí** se vuelve un nodo del grafo (47
nodos salen de ahí), así que `graphify explain "el repartidor de fotos"` o
`graphify explain "la cotización armada"` los encuentran.

**Regla para quien trabaje aquí:** cuando descubras cómo funciona algo por
dentro, no lo dejes solo en un comentario del código — **añade su título en §12
de ESTADO_OPERATIVO**, o el siguiente que llegue va a tener que releer 1.400
líneas para saber lo mismo.

## 1. Mapa de la documentación, y quién gana cuando se contradicen

Hay 6 archivos `.md` en el proyecto (eran 9; tres se borraron por muertos). Este es el
orden de autoridad: si dos documentos dicen cosas distintas, manda el de arriba.

| # | Documento | Qué es | Fiabilidad |
|---|---|---|---|
| 1 | `docs/ESTADO_OPERATIVO.md` | Estado real: qué funciona, qué está roto, qué está prohibido tocar | **Fuente de verdad** |
| 2 | `docs/REGISTRO_DE_CAMBIOS.md` | Bitácora de cada cambio con la prueba que se hizo | **Historia verificada** |
| 3 | `AGENTS.md` (este archivo) | Reglas de trabajo y mapa de documentos | Reglas vigentes |
| 4 | `CLAUDE.md` | Solo importa `@AGENTS.md`. **No escribir contenido aquí** | — |
| 5 | `README.md` | Instalación y stack, en inglés | ⚠️ Parcialmente obsoleto |
| 6 | `data/README_BASE_DE_DATOS.md` y `catalogo_catalogospromocionales/README.md` | Describen el catálogo **de origen** de los importados (junio 2026) | Solo origen de datos |

> **El 02-ago-2026 se borraron tres documentos muertos**, por orden del dueño:
> `knowledgebot_memoria_tecnica.md` (31 KB de relato con datos falsos ya
> desmentidos: decía que el modelo era DeepSeek y que se usaba Meta Cloud API),
> `docs/planes/` (planes cerrados) y la copia duplicada
> `catalogo_catalogospromocionales/BASE_DE_DATOS/README_BASE_DE_DATOS.md`.
> Quedan **6 documentos**. No crear nuevos: mantener estos.

## 2. Los siete datos que la documentación vieja tiene mal

Si un documento afirma lo contrario de esto, el documento está equivocado:

1. **El modelo del bot es `google/gemini-2.5-flash`** vía OpenRouter. **No es
   DeepSeek** (la memoria técnica dice "DeepSeek-v4-flash": es falso).
2. **Hay DOS sistemas de vectores distintos**, y confundirlos es el error más
   frecuente. Las dos cifras son correctas, cada una en su sitio:
   - **Catálogo de productos** → **3072D multimodal** (texto + foto), en archivo
     dentro de `Motor de Conocimiento/data/embeddings/`, con búsqueda NumPy.
     **No usa pgvector.**
   - **Glosario y base de conocimiento** → **1536D** en Supabase
     `knowledge_chunks` (Gemini truncado a 1536 por el esquema `vector(1536)`).
     ⚠️ **Esa tabla está VACÍA (0 filas) y YA NO LA CONSULTA NADIE.** Desde el
     01-ago-2026, `queryKnowledgeBase` lee los datos del negocio del **panel**
     (`agent_configs.business_info`), que es donde el dueño los escribe y donde
     se actualizan solos. Se conserva el esquema por si algún día hace falta un
     volumen documental que no quepa en el panel. Las dimensiones describen el
     **esquema**, no que haya datos. Ver `docs/ESTADO_OPERATIVO.md` §4.
3. **Hay UN SOLO puente y atiende TODAS las líneas por igual**
   (desde el 2026-07-31). Cualquier documento que hable de dos puentes, de
   repartir líneas entre ellos, o de `BRIDGE_LINES` / `WHATSAPP_BRIDGE_ROUTES`
   como algo vigente, está desactualizado.
   - **Baileys, puerto 3005** (`wa-server-baileys/`) es el único puente.
     Envía, recibe y **descarga audio e imagen**: imagen de 22 KB en 59 ms,
     audio de 11 KB en 154 ms, medido en producción.
   - **`whatsapp-web.js`, puerto 3004** (`wa-server/`) está **detenido**. Su
     almacén interno quedó desfasado de la versión actual de WhatsApp Web:
     fallan `downloadMedia()` **y `getChats()`** con un `[Error] r` ilegible.
     Fijar la versión de WhatsApp Web **no lo arregla** (se pidió la
     `2.3000.1040516757-alpha` y se cargó igual la `2.3000.1044236315`), y la
     librería ya está en su última versión publicada. No es recuperable.
   - **Ninguna línea se enumera en ninguna parte.** `BRIDGE_LINES` y
     `FORWARD_INBOUND_LINES` se quitaron de `docker-compose.yml`: al nombrar
     las líneas una por una, cualquier línea nueva quedaba fuera **en
     silencio**. Vacías = todas. El puente descubre las líneas de la tabla
     `whatsapp_lines` más las sesiones en disco (`arrancarLineas()`).
   - Para sumar una línea: registrarla y escanear su QR. Nada más. La ranura
     (`linea_1`, `linea_2`, …) es independiente del número: cualquier teléfono,
     de cualquier país, puede ir en cualquier ranura.
4. **Nunca Meta Cloud API.** La memoria técnica menciona "Meta Cloud API
   (Producción)": está prohibido y no existe en el sistema.
5. **El despliegue es Docker sobre un VPS Hostinger** (2.25.169.103). El README
   habla de Railway: quedó de una etapa anterior.
6. **El error 463 NO es culpa del `@lid` ni de Baileys: es la CUENTA.** Esto se
   documentó mal el 30-jul y costó una arquitectura entera de dos puentes
   construida sobre una causa falsa. Lo medido el 31-jul enviando desde el
   propio servidor, con una línea que fallaba y otra que no:

   | Envío | Resultado |
   |---|---|
   | Línea A → línea B | ✅ entregado |
   | Línea A → teléfono personal | ✅ entregado |
   | Línea B → sí misma | ✅ entregado |
   | Línea B → línea A (al teléfono) | ❌ 463 |
   | Línea B → línea A (al `@lid`) | ❌ 463 |
   | Línea B → teléfono personal | ❌ 463 |

   **Baileys sí envía.** El mismo código, en la misma máquina, entrega desde una
   línea y es rechazado desde otra. Lo que falla es la **cuenta de WhatsApp**:
   un bloqueo temporal por volumen de mensajes automáticos. El propio nombre del
   error, *timelocked*, lo dice, y se levanta con reposo.

   > **Regla de diagnóstico.** Ante un 463, **probar el mismo envío desde otra
   > línea antes de tocar código**. Si la otra entrega, el problema es la cuenta.
   > No hay nada que arreglar en el sistema.
   >
   > **No anotar aquí qué número está bloqueado.** Es un estado pasajero: se
   > levanta solo, y los números de prueba se conectan y desconectan a voluntad.
   > Dejarlo escrito solo sirve para que alguien lo lea meses después y crea que
   > hay una línea rota.

   **Corregir el documento no corrige el código.** El 01-ago-2026 se descubrió
   que la causa falsa seguía viva dentro del puente: `resolveSendJid()` se
   negaba a enviar a un `@lid` sin teléfono conocido «porque WhatsApp lo rechaza
   con 463». Esa creencia se había desmentido el 31-jul aquí mismo, pero el
   código escrito el 30 nunca se revisó, y dejó sin respuesta a un cliente real.
   Al corregir una causa falsa, **buscar dónde quedó programada**, no solo
   dónde quedó escrita.

7. **Ningún dato del negocio se escribe en el código.** Medios de pago,
   condiciones, cuenta bancaria, garantía, tiempos de entrega, sitio web y los
   datos que se piden al cerrar **viven en el panel** (Personalización). Los
   valores por defecto de `DEFAULT_PERSONA` están **vacíos a propósito**: antes
   traían `'Bancolombia, Nequi, Daviplata o PSE'` y `'50% para iniciar
   producción'`, y con el campo vacío el bot los soltaba como ciertos. Para
   ZOOM sonaban razonables; para otro negocio eran mentiras dichas con total
   seguridad.

   **Regla:** si un dato falta, el prompt omite la frase entera y el bot dice
   que lo consulta con el equipo. **Nunca se rellena con un ejemplo.** Si le
   piden añadir un valor por defecto "para que no quede vacío", es exactamente
   el fallo que se corrigió.

## 3. Reglas estrictas del proyecto

1. **Conexión de WhatsApp**: el puente local propio es la arquitectura
   definitiva. **Prohibido sugerir, recomendar o intentar Meta Cloud API.**
   Migrar el puente a Baileys sí está autorizado (29-jul-2026) para desbloquear
   el audio y las imágenes entrantes, que hoy no se descargan.
2. **Entorno del dueño**: Windows con PowerShell, sin VS Code. Los comandos que
   se le entreguen deben ser directos para PowerShell.
3. **El VPS es la fuente de verdad.** Ni el repo local ni GitHub están al día.
   Todo el desarrollo se hace por SSH sobre `/root/knowledgebot`.
4. **Líneas**: las conectadas hoy son **de prueba** y el dueño las conecta y
   desconecta libremente. **No anotar aquí qué número está en qué ranura ni cuál
   está caída**: cambia de un día para otro y esas notas envejecen mal. El estado
   real se consulta en `/lineas` del panel o con
   `curl -s http://localhost:3005/diagnostic`.

   La ranura (`linea_1`, `linea_2`, …) es **independiente del número**: cualquier
   teléfono, de cualquier país, puede ir en cualquier ranura. El nombre visible
   se edita desde el panel («WhatsApp de Juanita», «Local 211»); la ranura no se
   toca, porque es la clave con la que se enrutan los mensajes y se agrupan las
   conversaciones.

   La meta son **8 líneas** centralizadas en el CRM: diseñar todo pensando en eso.
5. **No crear archivos `.md` nuevos.** Mantener sincronizados solo los 6 que ya
   existen, y hacerlo **en el VPS y en el repo local a la vez**. Esa divergencia
   fue la causa de la confusión: `CLAUDE.md` existía solo en el VPS y
   `docs/planes/` solo en la copia local.
6. **Git en el VPS**: commit antes y después de cada cambio. Punto de
   restauración previo a la auditoría del 29-jul-2026: **`92276ac`**. Respaldos
   de catálogo en `/root/knowledgebot/backups/`. Para revertir un archivo:
   `git checkout HEAD -- <ruta>`.
7. **Regla 0 — disciplina de diagnóstico**: antes de escribir código, demostrar
   con logs o datos dónde está el problema. No asumir.
8. **Regla del prompt**: no agregar reglas al `system-prompt.ts`. Cargar el
   prompt de instrucciones induce alucinaciones (ver *Mitigación de
   Alucinaciones en RAG.pdf* en la raíz). Lo que funciona son **guardrails
   deterministas** de entrada, recuperación y salida.
   - Medido el 2026-07-29: la plantilla del prompt bajó de **314 a 199 líneas**
     mientras el código determinista creció **+1.305 líneas**. Ese es el sentido
     correcto del cambio.
   - Distinguir tres cosas al escribir en el contexto del modelo:
     **instrucciones de comportamiento** (a evitar), **datos de recuperación**
     (correcto, es la R de RAG) y **compuertas en código** (lo único que de
     verdad obliga). Ejemplo: para que el bot ofrezca producto propio no se le
     pide en el prompt — `searchCatalog` simplemente no le entrega importados
     cuando hay tres propios cotizables.
9. **Filosofía del dueño**: no entregar la corrección de un síntoma. Buscar el
   mecanismo que produce la clase entera de fallos y dejarlo visible y
   controlable desde el panel.

## 4. Cómo verificar el estado antes de tocar nada

```bash
curl -s http://localhost:8001/health          # motor RAG
curl -s http://localhost:8001/stats           # catálogo y cobertura vectorial
curl -s http://localhost:3005/diagnostic      # puente de WhatsApp (Baileys)
docker ps ; systemctl status knowledgebot-rag
docker logs --tail 80 knowledgebot-app | grep -iE 'guardrail|candado|rail'

# El PORTERO. Se olvida siempre y no está en ningún contenedor: el panel se
# sirve por https://zoompublicidad.tech a través de nginx, y un fallo suyo NO
# aparece en los registros de la app. Si el panel responde un número pelado
# (413, 502, 504), mirar aquí ANTES que el código:
systemctl status nginx ; nginx -t
tail -30 /var/log/nginx/error.log
```

> **413 = el portero, no el sistema.** nginx aplica 1 MB por defecto si no se
> le declara tope, y rechaza **antes** de que la petición llegue a la app: el
> panel no puede ni explicarlo. Corregido el 02-ago-2026 a 25 MB. Los mensajes
> ENTRANTES no pasan por aquí: el puente le habla a la app por `localhost:3003`.

El **Centro de Control** del panel (`/control-room`, alimentado por
`/api/health`) muestra lo mismo con causa y acción de reparación por cada punto.

Para probar el agente sin molestar a clientes: `POST /api/agent/test`, que
ejecuta el mismo `runAgentForMessage` que el webhook de WhatsApp.
