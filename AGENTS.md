<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Estado Operativo del Proyecto (lectura obligatoria)

Antes de proponer CUALQUIER cambio al sistema, debes leer:

1. **[`docs/ESTADO_OPERATIVO.md`](docs/ESTADO_OPERATIVO.md)** — la fuente de verdad sobre qué está estable, qué está roto y qué está prohibido modificar.
   - Obligatorio: revisar **§4 (qué está roto)** y **§7 (qué NO tocar)** antes de tocar nada.
2. **[`docs/REGISTRO_DE_CAMBIOS.md`](docs/REGISTRO_DE_CAMBIOS.md)** — bitácora de cada cambio real hecho al sistema. **Debes añadir una entrada nueva** después de cualquier modificación (código, BD, configuración o deploy).

> ⚠️ La memoria técnica (`knowledgebot_memoria_tecnica.md`) es **histórico-anecdótica** y contiene afirmaciones obsoletas (ej: dice que el LLM es DeepSeek cuando en realidad es `google/gemini-2.5-flash`; dice Vertex AI cuando el RAG en runtime usa búsqueda local NumPy). Si la memoria contradice a `docs/ESTADO_OPERATIVO.md`, **gana ESTADO_OPERATIVO.md**.

## Reglas Estrictas del Proyecto

1. **Conexión de WhatsApp**: El usuario ha decidido **NO** utilizar conexiones oficiales de WhatsApp (Meta Cloud API). La arquitectura definitiva es el **puente local propio** (hoy migrando de `whatsapp-web.js` a `@whiskeysockets/baileys`). **Bajo ninguna circunstancia se debe sugerir, recomendar o intentar cambiar la conexión a la API oficial de Meta**.

2. **Entorno de Trabajo**: El usuario **NO** utiliza VS Code. Trabaja exclusivamente a través de la interfaz de Antigravity y la consola de PowerShell en Windows. Las instrucciones para ejecutar comandos deben ser directas para PowerShell.

3. **El VPS es la fuente de verdad** (2026-07-22): Ni el repo local ni GitHub están actualizados. El proyecto se trabaja **directamente en el VPS de producción** (host: `2.25.169.103`, user: `root`) porque los deploys local→VPS históricamente fallaban. **Todo desarrollo y edición se hace en el VPS por SSH.**

4. **Líneas de prueba vs producción**: Las 2 líneas actuales (`linea_1`: 573011022628, `linea_2`: 573107975278) son **SOLO DE PRUEBA**. El sistema en producción final tendrá **8 líneas** conectadas a este CRM. Diseñar toda la arquitectura multi-línea teniendo esto en cuenta.

5. **No agregar documentación nueva**: El usuario prohibió cargar con "más basura" (archivos `.md` sueltos). Mantener sincronizados únicamente `docs/ESTADO_OPERATIVO.md`, `docs/REGISTRO_DE_CAMBIOS.md`, `AGENTS.md` y `knowledgebot_memoria_tecnica.md`.

6. **Git dentro del VPS**: Hay un commit P0 de seguridad (hash `36d2213`) en `/root/knowledgebot`. Antes de cada cambio, commit. Para revertir: `git checkout HEAD -- <archivo>`.

7. **Regla 0 (disciplina de diagnóstico)**: Antes de escribir código, demostrar mediante logs dónde está el problema. No asumir.

8. **Regla del prompt de Oscar**: No agregar reglas de más al `system-prompt.ts`. Cargar el prompt con instrucciones induce alucinaciones. Preferir guardrails en datos/runtime sobre prompt engineering.
