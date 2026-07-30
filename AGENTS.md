<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# KnowledgeBot — punto de entrada obligatorio

> Verificado contra el VPS de producción el **2026-07-29**.
> `CLAUDE.md` solo contiene `@AGENTS.md`: este archivo es la puerta de entrada.

## 0. Knowledge Graph del código (LEER PRIMERO)

El proyecto tiene un **grafo de conocimiento del código real** generado con
Graphify. Antes de asumir cómo funciona el sistema o de buscar archivos a
ciegas, **consultá el grafo**: cada conexión es literal del código (marcada
`EXTRACTED`) o derivada (`INFERRED`), con su archivo y línea.

El grafo vive en el VPS (fuente de verdad), en `/root/knowledgebot/graphify-out/`.
Está generado contra el commit **`f76eef3`**. **Si el código cambió desde
entonces, el grafo está desactualizado y miente** → regeneralo antes de confiar.

### Cómo consultarlo (por SSH al VPS)

```bash
# El binario NO está en el PATH por defecto. Exportar SIEMPRE antes:
export PATH=$HOME/.local/bin:$PATH
cd /root/knowledgebot

# 1) ¿El grafo sigue vigente? Comparar commit actual con el del grafo:
git rev-parse HEAD                       # si difiere de f76eef3, regenerar (paso 4)

# 2) Entender un símbolo / concepto / archivo:
graphify explain "processInboundMessage"
graphify explain "applyOutputGuardrail"
graphify explain "api_service"

# 3) Trazar la ruta entre dos partes del sistema:
graphify path "processInboundMessage" "getProductPrice"
graphify path "runAgentForMessage" "searchCatalog"

# 4) Regenerar el grafo tras cambios de código (~30s, sin costo, sin LLM):
graphify update .

# 5) Salud del grafo (nodos/aristas rotas o duplicadas):
graphify diagnose multigraph
```

### Qué contiene el grafo

- `graph.json` (1.2 MB) — 1.203 nodos + 2.050 aristas, consultable.
- `GRAPH_REPORT.md` (24 KB) — resumen humano: comunidades, god-nodes, conexiones.
- `graph.html` (1 MB) — visualización interactiva (abrir en navegador).

**Regla:** para entender arquitectura, dependencias o "qué rompe si cambio X",
consultá el grafo antes de leer código suelto. Para datos vivos (estado real de
servicios, catálogo, logs), el VPS sigue siendo la fuente de verdad (ver §4).

## 1. Mapa de la documentación, y quién gana cuando se contradicen

Hay 9 archivos `.md` en el proyecto y **se contradecían entre sí**. Este es el
orden de autoridad: si dos documentos dicen cosas distintas, manda el de arriba.

| # | Documento | Qué es | Fiabilidad |
|---|---|---|---|
| 1 | `docs/ESTADO_OPERATIVO.md` | Estado real: qué funciona, qué está roto, qué está prohibido tocar | **Fuente de verdad** |
| 2 | `docs/REGISTRO_DE_CAMBIOS.md` | Bitácora de cada cambio con la prueba que se hizo | **Historia verificada** |
| 3 | `AGENTS.md` (este archivo) | Reglas de trabajo y mapa de documentos | Reglas vigentes |
| 4 | `CLAUDE.md` | Solo importa `@AGENTS.md`. **No escribir contenido aquí** | — |
| 5 | `knowledgebot_memoria_tecnica.md` | Relato técnico de junio/julio 2026 | ⚠️ **Histórico, con datos falsos ya señalados dentro** |
| 6 | `README.md` | Instalación y stack, en inglés | ⚠️ Parcialmente obsoleto |
| 7 | `docs/planes/*.md` | Planes de trabajo cerrados o superados | Archivo |
| 8 | `data/README_BASE_DE_DATOS.md` | Describe el catálogo **de origen** de importados (junio 2026) | Solo origen de datos |
| 9 | `catalogo_catalogospromocionales/README.md` y `BASE_DE_DATOS/README_BASE_DE_DATOS.md` | Ídem; el segundo es copia del primero | Solo origen de datos |

## 2. Los cinco datos que la documentación vieja tiene mal

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
3. **Hay DOS puentes de WhatsApp a la vez, y cada línea va al suyo**
   (desde el 2026-07-30). Esto cambió: cualquier documento que diga que solo
   existe el 3004, o que Baileys no está desplegado, está desactualizado.
   - **`linea_1` → `whatsapp-web.js`, puerto 3004** (`wa-server/`). **No puede
     descargar media**: 0 archivos de 328 mensajes entrantes medidos.
   - **`linea_2` → Baileys, puerto 3005** (`wa-server-baileys/`). Sí descarga:
     imagen de 22 KB en 59 ms, audio de 11 KB en 154 ms, medido en producción.
   - Quién atiende cada línea lo deciden **dos compuertas en código**:
     `BRIDGE_LINES` en cada puente (ninguno arranca una línea ajena) y
     `WHATSAPP_BRIDGE_ROUTES` en `.env.production`, que le dice a la app a qué
     puente hablarle por línea (`getBridgeUrl(lineKey)`).
   - Para migrar otra línea: añadirla a `BRIDGE_LINES` del puente Baileys,
     quitarla del viejo, añadir su ruta y escanear un QR. No hay código nuevo.
4. **Nunca Meta Cloud API.** La memoria técnica menciona "Meta Cloud API
   (Producción)": está prohibido y no existe en el sistema.
5. **El despliegue es Docker sobre un VPS Hostinger** (2.25.169.103). El README
   habla de Railway: quedó de una etapa anterior.

## 3. Reglas estrictas del proyecto

1. **Conexión de WhatsApp**: el puente local propio es la arquitectura
   definitiva. **Prohibido sugerir, recomendar o intentar Meta Cloud API.**
   Migrar el puente a Baileys sí está autorizado (29-jul-2026) para desbloquear
   el audio y las imágenes entrantes, que hoy no se descargan.
2. **Entorno del dueño**: Windows con PowerShell, sin VS Code. Los comandos que
   se le entreguen deben ser directos para PowerShell.
3. **El VPS es la fuente de verdad.** Ni el repo local ni GitHub están al día.
   Todo el desarrollo se hace por SSH sobre `/root/knowledgebot`.
4. **Líneas**: `linea_1` (573011022628) y `linea_2` (573107975278) son **de
   prueba** y el dueño autoriza conectarlas y desconectarlas libremente. La meta
   son **8 líneas** centralizadas en el CRM: diseñar todo pensando en eso.
5. **No crear archivos `.md` nuevos.** Mantener sincronizados solo los 9 que ya
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
curl -s http://localhost:3004/diagnostic      # puente de WhatsApp
docker ps ; systemctl status knowledgebot-rag
docker logs --tail 80 knowledgebot-app | grep -iE 'guardrail|candado|rail'
```

El **Centro de Control** del panel (`/control-room`, alimentado por
`/api/health`) muestra lo mismo con causa y acción de reparación por cada punto.

Para probar el agente sin molestar a clientes: `POST /api/agent/test`, que
ejecuta el mismo `runAgentForMessage` que el webhook de WhatsApp.
