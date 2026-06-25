<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Reglas Estrictas del Proyecto

1. **Conexión de WhatsApp**: El usuario ha decidido **NO** utilizar conexiones oficiales de WhatsApp (Meta Cloud API). La conexión actual mediante el puente local (`wa-server-knowledge` con `whatsapp-web.js`) funciona perfectamente para sus necesidades. **Bajo ninguna circunstancia se debe sugerir, recomendar o intentar cambiar la conexión a la API oficial de Meta**. Asume siempre que el puente de WhatsApp Web.js es la arquitectura definitiva y correcta para este proyecto.
