# ESTADO OPERATIVO — KnowledgeBot SaaS (ZOOM Publicidad)

> **Fuente de verdad sobre el estado actual del sistema.**
> Verificado el 2026-07-29 mediante auditoría directa sobre el VPS de producción.
> El VPS es la fuente de verdad de facto (el repo local y GitHub están desactualizados).

---

## 0. Cómo leer este archivo

- ✅ = verificado y funcionando.
- ⚠️ = funciona con salvedades / degradado / frágil.
- 🔴 = roto o no implementado.
- 🚫 = **prohibido tocar** (ver §7).

---

## 1. Arquitectura real (verificada el 2026-07-29)

```
┌─────────────────────────────────────────────────────────────────────┐
│  VPS Hostinger (2.25.169.103, usuario root)                         │
│  Panel público: https://zoompublicidad.tech (nginx → 3003)          │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐  │
│  │  App Next.js         │    │  Puente WhatsApp (Node.js)        │  │
│  │  knowledgebot-app    │◄──►│  knowledgebot-wa-bridge (3004)    │  │
│  │  Puerto 3003         │    │  whatsapp-web.js + Chrome         │  │
│  │  Next.js 16 + React  │    │  ATIENDE linea_1 y linea_2        │  │
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

> ⚠️ **Corrección importante (2026-07-29):** las versiones anteriores de este
> documento describían un puente Baileys en el puerto 3005 atendiendo `linea_1`
> con multimodalidad funcional. **Eso no existe en producción.** No hay
> contenedor Baileys corriendo; ambas líneas dependen del puente `whatsapp-web.js`
> en 3004. El código de `wa-server-baileys/` está en disco pero no desplegado.

### Los 3 pilares reales

| Pilar | Tecnología | Rol |
|---|---|---|
| **Puente WhatsApp** | Node.js + `whatsapp-web.js` (Puppeteer) | Envía y recibe. Único puente activo. |
| **App Next.js** | Next.js 16 + React 19 + Vercel AI SDK | Panel SaaS, webhooks, agente comercial. |
| **Motor RAG** | FastAPI (systemd) en 8001 | Búsqueda de productos: keyword + vectorial. |

---

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
| `WHATSAPP_BRIDGE_URL` | `http://localhost:3004` |
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
docker logs --tail 50 knowledgebot-wa-bridge

# Motor RAG
curl -s http://localhost:8001/health
curl -s http://localhost:8001/stats

# Puente
curl -s http://localhost:3004/diagnostic
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
| Puente WhatsApp | `/root/knowledgebot/wa-server/` | 3004 | `knowledgebot-wa-bridge` (docker) |
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
