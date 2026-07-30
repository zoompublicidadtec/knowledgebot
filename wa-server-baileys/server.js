/**
 * ============================================================
 * wa-server-baileys/server.js
 * Puente WhatsApp con Baileys — multi-línea, paridad de contrato
 * ============================================================
 *
 * POR QUÉ EXISTE
 * --------------
 * El puente `whatsapp-web.js` del puerto 3004 no puede descargar media
 * entrante. Medido el 2026-07-30 sobre los últimos 328 mensajes entrantes
 * de producción: 0 con archivo descargado, 9 con `mediaError: true`.
 * El fallo es total y no tiene arreglo desde la app (es un bug de la
 * librería). Baileys sí descarga: 91 KB en 238 ms en la prueba del 22-jul.
 *
 * Consecuencia del fallo actual: el bot no procesa notas de voz ni fotos,
 * y el dueño no las puede ver ni oír en el panel porque los bytes nunca
 * existen.
 *
 * QUÉ CAMBIA RESPECTO AL MVP DE JULIO
 * -----------------------------------
 * El MVP era de una sola línea y solo leía imágenes. Le faltaban cinco
 * cosas que habrían roto la línea en WhatsApp real sin avisar en el
 * sandbox:
 *
 *   1. MULTI-LÍNEA. Un mapa de sesiones por `line_key` en vez de una
 *      línea fija. La meta del proyecto son 8 líneas: con esto, sumar
 *      una línea es añadirla a BRIDGE_LINES y escanear un QR.
 *   2. send-media. No existía, así que el bot habría dejado de enviar
 *      fotos de producto en la línea migrada.
 *   3. Normalización del destinatario. La app guarda `@c.us` (formato de
 *      whatsapp-web.js) y Baileys exige `@s.whatsapp.net`. Sin traducir,
 *      todo envío falla. `@lid` se respeta tal cual.
 *   4. `mediaError` / `mediaType` en el payload. El adaptador de la app
 *      descarta el mensaje si no hay texto ni archivo ni error, así que
 *      un audio fallido se perdía EN SILENCIO, sin que el bot dijera nada.
 *   5. Validación de `X-API-Key` y avisos al panel (QR y estado), como
 *      hace el 3004. Sin los avisos, el Centro de Control mostraría la
 *      línea caída estando sana.
 *
 * EL ECO DEL PUENTE SE APAGA SOLO
 * -------------------------------
 * El 3004 reenvía su propio mensaje saliente sin `id`, así que la app le
 * inventa uno aleatorio y guarda la respuesta dos veces (86 casos
 * medidos). Aquí `send-text` y `send-media` devuelven el id REAL de
 * WhatsApp (`key.id`), que es el mismo que llega en el reenvío, así que
 * la idempotencia por `wa_message_id` que ya tiene la app lo descarta
 * sin código nuevo.
 *
 * CONTRATO (idéntico al puente 3004, para ser reemplazable)
 * ---------------------------------------------------------
 *   GET  /health
 *   GET  /metrics
 *   GET  /diagnostic                 -> { ok, sessions: { <line>: {...} } }
 *   GET  /qr[?line=]                 -> QR en HTML para escanear
 *   GET  /api/sessions/:s/qr
 *   POST /api/sessions/:s/start
 *   POST /api/sessions/:s/logout
 *   GET  /api/sessions/:s/chats/:chatId/history?limit=
 *   POST /api/sessions/:s/messages/send-text   { chatId, message|text }
 *   POST /api/sessions/:s/messages/send-media  { chatId, mediaUrl, caption }
 *
 * Webhook hacia la app (contrato inmutable):
 *   { event:'message.received', line_key, data:{ message:{
 *       id, from, to, fromMe, body, type, mediaType,
 *       media:{data,mimetype,filename}|null, mediaError, customerName }}}
 * ============================================================
 */

const express = require('express');
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
    isJidGroup,
    isJidBroadcast,
    Browsers,
} = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const P = require('pino');

// ============================================================
// CONFIGURACIÓN
// ============================================================

const PORT = parseInt(process.env.PORT || '3005', 10);
const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003';
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || '';
const VOLUME_PATH = process.env.VOLUME_PATH || '/data';

/**
 * Compuerta de propiedad de líneas. Este puente SOLO atiende las líneas
 * listadas aquí. Es lo que impide la doble entrega mientras el 3004 sigue
 * atendiendo las demás: ninguna ruta HTTP puede arrancar una línea ajena.
 */
const BRIDGE_LINES = (process.env.BRIDGE_LINES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Modo sombra. Con `false` el puente se conecta, descarga la media y
 * acumula historial, pero NO envía webhooks a la app. Permite probar la
 * descarga con la línea todavía atendida por el 3004, sin duplicar nada.
 */
const FORWARDING_ENABLED = (process.env.FORWARDING_ENABLED || 'false').toLowerCase() === 'true';

/** Tope de descarga. Por encima de esto no se baja el archivo. */
const MAX_MEDIA_MB = parseInt(process.env.MAX_MEDIA_MB || '20', 10);
const MAX_MEDIA_BYTES = MAX_MEDIA_MB * 1024 * 1024;

const SESSIONS_ROOT = process.env.AUTH_ROOT || path.join(VOLUME_PATH, 'baileys_sessions');
const STORE_ROOT = process.env.STORE_ROOT || path.join(VOLUME_PATH, 'baileys_store');

const logger = P({ level: process.env.LOG_LEVEL || 'info' });

if (BRIDGE_LINES.length === 0) {
    logger.error('BRIDGE_LINES está vacío: este puente no atendería ninguna línea. Abortando.');
    process.exit(1);
}

// ============================================================
// MÉTRICAS
// ============================================================

const metrics = {
    started_at: new Date().toISOString(),
    forwarding_enabled: FORWARDING_ENABLED,
    lines: BRIDGE_LINES.slice(),
    messages_received: 0,
    media_detected: 0,
    media_downloaded: 0,
    media_too_large: 0,
    download_errors: 0,
    webhooks_sent: 0,
    webhooks_suppressed_shadow: 0,
    webhooks_failed: 0,
    text_sent: 0,
    media_sent: 0,
    send_errors: 0,
    last_download_ms: 0,
    last_post_ms: 0,
};

// ============================================================
// HELPERS
// ============================================================

/**
 * Traduce cualquier forma de destinatario al JID que Baileys entiende.
 *
 * La app guarda los teléfonos tal como los entregó el puente que los vio
 * primero, así que en la base conviven `@c.us` (whatsapp-web.js), `@lid`
 * y dígitos sueltos. Medido el 2026-07-30: 6 contactos `@lid`, 5 sin
 * sufijo y 2 `@c.us`. Sin esta traducción, enviar falla.
 *
 * `@lid` y `@g.us` se dejan intactos: no son teléfonos y Baileys los
 * direcciona por sí mismo.
 */
function normalizeJid(chatId) {
    let s = String(chatId || '').trim().replace(/^\+/, '').replace(/\s+/g, '');
    if (!s) return '';
    if (s.includes('@')) {
        const idx = s.lastIndexOf('@');
        const user = s.slice(0, idx);
        const domain = s.slice(idx + 1).toLowerCase();
        if (domain === 'c.us' || domain === 's.whatsapp.net') {
            return `${user.split(':')[0]}@s.whatsapp.net`;
        }
        return `${user}@${domain}`;
    }
    return `${s}@s.whatsapp.net`;
}

/**
 * Aviso autenticado a la app (QR y estado de línea), igual que el 3004.
 *
 * En modo sombra NO se avisa nada, y esto no es cosmético: la ruta
 * `/api/whatsapp-lines/qr` pone la línea en `status='awaiting_qr'`, y el
 * `autoload()` del puente 3004 solo reconecta las líneas que están en
 * `connected`. Un puente en sombra avisando del QR dejaría la línea sin
 * reconectar en el siguiente reinicio del puente que de verdad la atiende.
 */
async function callbackToApp(routePath, body) {
    if (!FORWARDING_ENABLED) {
        logger.info({ routePath, line: body?.line_key }, 'Aviso al panel suprimido (modo sombra)');
        return;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (BRIDGE_API_KEY) headers['x-bridge-key'] = BRIDGE_API_KEY;
    try {
        await fetch(`${APP_URL}${routePath}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
    } catch (e) {
        logger.error({ err: e.message, routePath }, 'Error avisando a la app');
    }
}

/** Valida X-API-Key. Sin clave configurada queda abierto (dev local). */
function validateApiKey(req, res) {
    if (!BRIDGE_API_KEY) return true;
    const incoming = req.headers['x-api-key'] || '';
    if (incoming !== BRIDGE_API_KEY) {
        res.status(401).json({ error: 'API key inválida' });
        return false;
    }
    return true;
}

/**
 * Resuelve el nombre de sesión que manda la app a una línea de este puente.
 *
 * La app usa el `line_key` en el adaptador, pero en la sincronización de
 * historial todavía puede mandar 'default'. Con una sola línea propia se
 * resuelve sin ambigüedad; con varias, 'default' no se puede adivinar.
 */
function resolveLine(sessionName) {
    if (BRIDGE_LINES.includes(sessionName)) return sessionName;
    if (BRIDGE_LINES.length === 1) return BRIDGE_LINES[0];
    return null;
}

// ============================================================
// STORE PERSISTENTE DE MENSAJES
// ============================================================

/**
 * La app pide `/history` cuando una conversación no tiene mensajes en
 * Supabase. Baileys no trae historial del teléfono (`syncHistory:false`,
 * necesario porque la sincronización completa rompía la sesión), así que
 * se acumula en disco desde el arranque. La fase sombra sirve justamente
 * para llenar esto antes de conmutar.
 */
function storePath(line, chatJid) {
    const safe = String(chatJid || 'unknown').replace(/[^a-zA-Z0-9@_.-]/g, '_');
    return path.join(STORE_ROOT, line, `${safe}.json`);
}

function storeAppend(line, record) {
    try {
        const file = storePath(line, record.chatJid);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        let arr = [];
        if (fs.existsSync(file)) {
            arr = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
        }
        arr.push(record);
        if (arr.length > 200) arr = arr.slice(-200);
        fs.writeFileSync(file, JSON.stringify(arr, null, 2));
    } catch (e) {
        logger.warn({ err: e.message }, 'No se pudo persistir el mensaje en el store');
    }
}

function storeRead(line, chatJid, limit = 15) {
    try {
        // El chatId puede llegar en cualquier formato; se prueban las dos
        // variantes para no perder el historial por el sufijo.
        const candidates = [chatJid, normalizeJid(chatJid)];
        for (const c of candidates) {
            const file = storePath(line, c);
            if (fs.existsSync(file)) {
                const arr = JSON.parse(fs.readFileSync(file, 'utf8') || '[]');
                return arr.slice(-limit);
            }
        }
        return [];
    } catch (e) {
        logger.warn({ err: e.message }, 'No se pudo leer el store');
        return [];
    }
}

// ============================================================
// ADAPTADOR — contrato inmutable del webhook
// ============================================================

/** Texto plano del mensaje, sin la cita. */
function extractBody(msg) {
    const m = msg.message || {};
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.audioMessage?.caption ||
        ''
    );
}

/**
 * Mensaje citado, cuando el cliente usa "responder" sobre un mensaje anterior.
 *
 * Se devuelve como objeto aparte porque hacen falta las DOS cosas:
 *   - El panel pinta una caja de cita leyendo `data.message.quoted.body`.
 *     Ese campo no lo mandaba NINGUNO de los dos puentes, asi que la caja
 *     llevaba tiempo sin datos y la funcion parecia rota.
 *   - El agente necesita el referente dentro del texto, o no entiende a que
 *     se refiere el cliente cuando dice "de ese, cuanto por 200".
 *
 * `contextInfo` puede venir colgando de cualquier tipo de mensaje, no solo del
 * texto: tambien de una foto, un audio o un video con "responder".
 */
function extractQuoted(msg) {
    const m = msg.message || {};
    const ctx =
        m.extendedTextMessage?.contextInfo ||
        m.imageMessage?.contextInfo ||
        m.videoMessage?.contextInfo ||
        m.audioMessage?.contextInfo ||
        m.documentMessage?.contextInfo ||
        m.stickerMessage?.contextInfo;

    const q = ctx?.quotedMessage;
    if (!q) return null;

    const cuerpo =
        q.conversation ||
        q.extendedTextMessage?.text ||
        q.imageMessage?.caption ||
        q.videoMessage?.caption ||
        q.documentMessage?.caption ||
        (q.imageMessage ? '[imagen]' : '') ||
        (q.audioMessage ? '[nota de voz]' : '') ||
        (q.videoMessage ? '[video]' : '') ||
        (q.documentMessage ? '[documento]' : '') ||
        '';

    if (!cuerpo) return null;

    return {
        id: ctx.stanzaId || null,
        body: cuerpo,
        // `participant` es quien escribio el mensaje citado.
        fromMe: ctx.participant ? ctx.participant === (msg.key.remoteJid || '') : null,
    };
}

/** Texto que ve el AGENTE: incluye la cita, porque necesita el referente. */
function bodyParaElAgente(msg) {
    const body = extractBody(msg);
    const q = extractQuoted(msg);
    if (!q) return body;
    return body ? `${body}\n[En respuesta a: "${q.body}"]` : `[En respuesta a: "${q.body}"]`;
}

function normalizeIncomingMessage(msg, lineKey, mediaData, msgType, mediaError) {
    return {
        event: 'message.received',
        line_key: lineKey,
        data: {
            message: {
                id: msg.key.id,
                from: msg.key.remoteJid,
                to: msg.key.remoteJid,
                fromMe: msg.key.fromMe === true,
                body: bodyParaElAgente(msg),
                // El panel pinta la caja de cita con esto.
                quoted: extractQuoted(msg),
                type: msgType,
                mediaType: msgType,
                media: mediaData
                    ? {
                        data: mediaData.data,
                        mimetype: mediaData.mimetype,
                        filename: mediaData.filename || '',
                    }
                    : null,
                mediaError: !!mediaError,
                customerName: msg.pushName || '',
            },
        },
    };
}

async function sendToWebhook(payload) {
    if (!FORWARDING_ENABLED) {
        metrics.webhooks_suppressed_shadow++;
        logger.info(
            { line: payload.line_key, hasMedia: !!payload.data.message.media },
            'Webhook suprimido (modo sombra)'
        );
        return 'suppressed';
    }

    const headers = { 'Content-Type': 'application/json' };
    if (BRIDGE_API_KEY) headers['x-bridge-key'] = BRIDGE_API_KEY;

    const t0 = Date.now();
    try {
        const res = await fetch(`${APP_URL}/api/webhooks/whatsapp`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        metrics.last_post_ms = Date.now() - t0;

        if (!res.ok) {
            metrics.webhooks_failed++;
            const errText = await res.text().catch(() => '');
            logger.error({ status: res.status, errText }, 'La app rechazó el payload');
            return false;
        }
        metrics.webhooks_sent++;
        logger.info({ latency_ms: metrics.last_post_ms }, 'Webhook entregado');
        return true;
    } catch (err) {
        metrics.webhooks_failed++;
        metrics.last_post_ms = Date.now() - t0;
        logger.error({ err: err.message }, 'No se pudo alcanzar el webhook de la app');
        return false;
    }
}

// ============================================================
// SESIONES
// ============================================================

/** line_key -> { sock, status, connectedAt, phoneNumber, keepAliveErrors, lastError, lastErrorAt, lastQR, reconnectDelay } */
const sessions = new Map();

function blankState() {
    return {
        sock: null,
        status: 'initializing',
        connectedAt: null,
        phoneNumber: null,
        keepAliveErrors: 0,
        lastError: null,
        lastErrorAt: null,
        lastQR: null,
        // El panel pinta el QR con <img src={qr_code}>, asi que necesita la
        // imagen en data URL, no el texto del QR. El puente 3004 guarda lo
        // mismo en `lastQr`; sin esta paridad el panel muestra una imagen rota.
        lastQRDataUrl: null,
        reconnectDelay: 2000,
        starting: false,
        /**
         * Generacion del socket vivo. Cada socket nuevo incrementa este numero
         * y sus manejadores comparan contra el suyo: asi los eventos de un
         * socket viejo se ignoran en vez de disparar otra reconexion.
         *
         * SIN ESTO (medido el 2026-07-30 en produccion): 64 sockets abiertos y
         * 114 errores `conflict: replaced` en pocos minutos. WhatsApp da UNA
         * ranura por dispositivo vinculado, asi que dos sockets con las mismas
         * credenciales se expulsan entre si; cada expulsion disparaba otra
         * reconexion y la linea nunca llegaba a atender nada
         * (`webhooks_sent: 0` con 8 mensajes recibidos).
         */
        epoch: 0,
        reconnectTimer: null,
    };
}

function authDir(line) {
    return path.join(SESSIONS_ROOT, `session-${line}`);
}

/**
 * Cierra el socket anterior y le quita los manejadores ANTES de crear otro.
 * `end()` cierra el websocket sin cerrar la sesion en WhatsApp: las
 * credenciales del disco siguen sirviendo y no hace falta otro QR.
 */
function teardownSocket(st, line) {
    const old = st.sock;
    st.sock = null;
    if (!old) return;
    try { old.ev.removeAllListeners(); } catch { /* ya estaba desmontado */ }
    try { old.end(undefined); } catch { /* ya estaba cerrado */ }
    logger.info({ line }, 'Socket anterior cerrado antes de reconectar');
}

/** Un solo reintento en vuelo por linea. */
function scheduleReconnect(st, line, delay, motivo) {
    if (st.reconnectTimer) {
        logger.info({ line, motivo }, 'Ya hay un reintento programado, no se duplica');
        return;
    }
    st.reconnectTimer = setTimeout(() => {
        st.reconnectTimer = null;
        startSession(line, motivo).catch(e =>
            logger.error({ err: e.message, line }, 'Fallo el reintento de conexion')
        );
    }, delay);
    logger.warn({ line, delay_ms: delay, motivo }, 'Reconexion programada');
}

/**
 * Decide qué hacer con la media entrante.
 *
 * Solo se descargan imagen y audio/nota de voz, que son los dos que la app
 * sabe interpretar (visión con Gemini y transcripción con Whisper). Vídeo y
 * documento se bajan si son pequeños; si no, se marcan como error para que
 * el bot pida amablemente el detalle por texto en vez de callarse.
 */
function classifyMedia(msg) {
    const m = msg.message || {};
    if (m.imageMessage) return { kind: 'image', node: m.imageMessage, ext: 'jpg', fallbackMime: 'image/jpeg' };
    if (m.audioMessage) {
        const isPtt = m.audioMessage.ptt === true;
        return { kind: isPtt ? 'ptt' : 'audio', node: m.audioMessage, ext: 'ogg', fallbackMime: 'audio/ogg; codecs=opus' };
    }
    if (m.pttMessage) return { kind: 'ptt', node: m.pttMessage, ext: 'ogg', fallbackMime: 'audio/ogg; codecs=opus' };
    if (m.videoMessage) return { kind: 'video', node: m.videoMessage, ext: 'mp4', fallbackMime: 'video/mp4' };
    if (m.documentMessage) return { kind: 'document', node: m.documentMessage, ext: 'bin', fallbackMime: 'application/octet-stream' };
    if (m.documentWithCaptionMessage?.message?.documentMessage) {
        return {
            kind: 'document',
            node: m.documentWithCaptionMessage.message.documentMessage,
            ext: 'bin',
            fallbackMime: 'application/octet-stream',
        };
    }
    if (m.stickerMessage) return { kind: 'sticker', node: m.stickerMessage, ext: 'webp', fallbackMime: 'image/webp' };
    return null;
}

async function startSession(line, motivo = 'inicial') {
    // Compuerta: este puente no arranca líneas que no le pertenecen.
    if (!BRIDGE_LINES.includes(line)) {
        logger.warn({ line, owned: BRIDGE_LINES }, 'Se ignora el arranque: la línea no pertenece a este puente');
        return;
    }

    let st = sessions.get(line);
    if (!st) {
        st = blankState();
        sessions.set(line, st);
    }

    // Si habia un reintento programado, este arranque lo sustituye.
    if (st.reconnectTimer) {
        clearTimeout(st.reconnectTimer);
        st.reconnectTimer = null;
    }

    if (st.starting) {
        logger.info({ line, motivo }, 'Arranque ya en curso, se ignora');
        return;
    }
    st.starting = true;

    // Nunca dos sockets vivos con las mismas credenciales: se expulsan entre
    // si (`conflict: replaced`) y la linea queda inservible.
    teardownSocket(st, line);

    const epoch = st.epoch + 1;
    st.epoch = epoch;
    /** Los eventos de un socket ya sustituido se descartan. */
    const esViejo = () => st.epoch !== epoch;

    const dir = authDir(line);
    fs.mkdirSync(dir, { recursive: true });

    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState(dir);

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            logger: logger.child({ line }),
            browser: Browsers.macOS('Desktop'),
            version,
            // La sincronización de historial completo rompía la sesión por
            // timeout en cuentas con mucho historial (probado el 23-jul).
            syncHistory: false,
            markOnlineOnConnect: false,
        });

        st.sock = sock;
        logger.info({ line, epoch, motivo }, 'Socket creado');
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            if (esViejo()) return;
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                st.lastQR = qr;
                logger.info({ line }, `QR disponible para ${line}: GET /qr?line=${line}`);
                try {
                    st.lastQRDataUrl = await QRCode.toDataURL(qr);
                    await callbackToApp('/api/whatsapp-lines/qr', {
                        line_key: line,
                        qr_base64: st.lastQRDataUrl,
                    });
                } catch (e) {
                    logger.warn({ err: e.message }, 'No se pudo generar o avisar el QR');
                }
            }

            if (connection === 'open') {
                st.status = 'connected';
                st.connectedAt = new Date().toISOString();
                st.keepAliveErrors = 0;
                st.lastError = null;
                st.lastErrorAt = null;
                st.lastQR = null;
                st.lastQRDataUrl = null;
                st.reconnectDelay = 2000;
                try {
                    const me = sock.user;
                    if (me?.id) st.phoneNumber = String(me.id).split(':')[0].split('@')[0];
                } catch { /* sin número: no es fatal */ }
                logger.info(
                    { line, phone: st.phoneNumber, forwarding: FORWARDING_ENABLED },
                    'Baileys CONECTADO'
                );
                await callbackToApp('/api/whatsapp-lines/status', {
                    line_key: line,
                    status: 'connected',
                    phone_number: st.phoneNumber,
                });
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                st.starting = false;
                st.lastError = lastDisconnect?.error?.message || 'conexión cerrada';
                st.lastErrorAt = new Date().toISOString();
                // El socket ya esta muerto: se desmonta para que no siga
                // emitiendo eventos que provoquen mas reconexiones.
                teardownSocket(st, line);

                // 401 — la sesion se cerro desde el telefono. Reconectar no
                // sirve: hace falta borrar las credenciales y escanear un QR.
                if (statusCode === DisconnectReason.loggedOut) {
                    st.status = 'logged_out';
                    st.keepAliveErrors++;
                    logger.error({ line }, 'Sesión cerrada desde el teléfono. Hay que borrar la sesión y escanear un QR nuevo.');
                    await callbackToApp('/api/whatsapp-lines/status', { line_key: line, status: 'disconnected' });
                    return;
                }

                // 515 — Baileys pide reiniciar el socket. Es lo NORMAL justo
                // despues de escanear el QR, no un fallo: se reconecta rapido y
                // no cuenta como error, o el panel mostraria la linea enferma
                // en su primer minuto de vida.
                if (statusCode === DisconnectReason.restartRequired) {
                    st.status = 'initializing';
                    logger.info({ line }, 'WhatsApp pide reiniciar el socket (normal tras vincular)');
                    scheduleReconnect(st, line, 1000, 'restart-required');
                    return;
                }

                // 440 — otra conexion tomo la ranura de este dispositivo.
                // Reconectar en seguida es pelearse por la ranura, y es
                // exactamente lo que produjo 114 conflictos seguidos. Se espera
                // de verdad y se deja dicho en claro para el panel.
                if (statusCode === DisconnectReason.connectionReplaced) {
                    st.status = 'disconnected';
                    st.keepAliveErrors++;
                    st.lastError =
                        'Otra conexión tomó esta línea. Suele ser otro puente o otra instancia usando las mismas credenciales.';
                    logger.error({ line }, 'Conexión reemplazada por otra sesión');
                    await callbackToApp('/api/whatsapp-lines/status', { line_key: line, status: 'disconnected' });
                    scheduleReconnect(st, line, 30000, 'connection-replaced');
                    return;
                }

                st.status = 'disconnected';
                st.keepAliveErrors++;
                const delay = Math.min(st.reconnectDelay, 60000);
                st.reconnectDelay = Math.min(delay * 2, 60000);
                logger.warn({ line, statusCode }, 'Conexión cerrada');
                await callbackToApp('/api/whatsapp-lines/status', { line_key: line, status: 'disconnected' });
                scheduleReconnect(st, line, delay, `close-${statusCode || 'sin-codigo'}`);
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (esViejo()) return;
            if (type !== 'notify') return;
            for (const msg of messages) {
                try {
                    await handleIncoming(line, msg, sock);
                } catch (e) {
                    logger.error({ err: e.message, line }, 'Error procesando un mensaje');
                }
            }
        });

        st.starting = false;
    } catch (err) {
        st.starting = false;
        st.status = 'disconnected';
        st.lastError = err.message;
        st.lastErrorAt = new Date().toISOString();
        teardownSocket(st, line);
        const delay = Math.min(st.reconnectDelay, 60000);
        st.reconnectDelay = Math.min(delay * 2, 60000);
        logger.error({ err: err.message, line }, 'No se pudo iniciar la sesión');
        scheduleReconnect(st, line, delay, 'error-de-arranque');
    }
}

async function handleIncoming(line, msg, sock) {
    const jid = msg.key.remoteJid;
    if (!jid) return;
    if (isJidGroup(jid) || isJidBroadcast(jid) || jid === 'status@broadcast') return;
    if (!msg.message) return;

    metrics.messages_received++;
    const fromMe = msg.key.fromMe === true;
    const cls = classifyMedia(msg);

    // Los stickers no aportan a una cotización y ensucian el hilo.
    if (cls && cls.kind === 'sticker') return;

    let mediaData = null;
    let mediaError = false;
    let msgType = cls ? cls.kind : 'chat';

    if (cls) {
        metrics.media_detected++;
        const declared = Number(cls.node?.fileLength || 0);
        const soloPequenos = cls.kind === 'video' || cls.kind === 'document';

        if (declared > MAX_MEDIA_BYTES || (soloPequenos && declared > 8 * 1024 * 1024)) {
            metrics.media_too_large++;
            mediaError = true;
            logger.warn({ line, kind: cls.kind, bytes: declared }, 'Archivo demasiado grande, no se descarga');
        } else {
            const t0 = Date.now();
            try {
                // `reuploadRequest` deja que Baileys le pida al teléfono del
                // cliente que vuelva a subir el archivo si el primer intento
                // falla porque ya expiró en los servidores de WhatsApp.
                const buffer = await downloadMediaMessage(
                    msg,
                    'buffer',
                    {},
                    { logger, reuploadRequest: sock?.updateMediaMessage }
                );
                metrics.last_download_ms = Date.now() - t0;

                if (!buffer || buffer.length === 0) {
                    metrics.download_errors++;
                    mediaError = true;
                    logger.error({ line, kind: cls.kind }, 'La descarga devolvió un archivo vacío');
                } else if (buffer.length > MAX_MEDIA_BYTES) {
                    metrics.media_too_large++;
                    mediaError = true;
                    logger.warn({ line, bytes: buffer.length }, 'Archivo descargado por encima del tope');
                } else {
                    metrics.media_downloaded++;
                    mediaData = {
                        data: buffer.toString('base64'),
                        mimetype: cls.node?.mimetype || cls.fallbackMime,
                        filename: `${cls.kind}_${msg.key.id}.${cls.ext}`,
                    };
                    logger.info(
                        { line, kind: cls.kind, kb: Math.round(buffer.length / 1024), ms: metrics.last_download_ms },
                        `Media descargada por Baileys: ${Math.round(buffer.length / 1024)} KB`
                    );
                }
            } catch (dlErr) {
                metrics.download_errors++;
                metrics.last_download_ms = Date.now() - t0;
                mediaError = true;
                logger.error(
                    { line, kind: cls.kind, err: dlErr.message },
                    'ERROR descargando media con Baileys'
                );
            }
        }
    }

    storeAppend(line, {
        id: msg.key.id,
        chatJid: jid,
        fromMe,
        body: bodyParaElAgente(msg),
        type: msgType,
        timestamp: msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
            : new Date().toISOString(),
        hadMedia: !!mediaData,
    });

    const body = bodyParaElAgente(msg);
    // Sin texto, sin archivo y sin error no hay nada que contarle a la app.
    if (!body && !mediaData && !mediaError) return;

    const payload = normalizeIncomingMessage(msg, line, mediaData, msgType, mediaError);
    await sendToWebhook(payload);
}

/** Indicador de "escribiendo", como hace el puente 3004. */
async function typing(sock, jid, ms = 1200) {
    try {
        await sock.presenceSubscribe(jid);
        await sock.sendPresenceUpdate('composing', jid);
        await new Promise((r) => setTimeout(r, ms));
        await sock.sendPresenceUpdate('paused', jid);
    } catch { /* el indicador es cosmético: si falla, se envía igual */ }
}

// ============================================================
// HTTP
// ============================================================

const app = express();
// Las fotos y audios viajan en base64 dentro del JSON.
app.use(express.json({ limit: '60mb' }));

/**
 * Estado de las líneas propias con la MISMA forma que devuelve el puente
 * 3004, para que el panel de líneas y el Centro de Control no tengan que
 * saber qué puente atiende cada línea.
 */
function describeSessions() {
    const out = {};
    for (const line of BRIDGE_LINES) {
        const st = sessions.get(line) || blankState();
        out[line] = {
            loaded: !!st.sock,
            status: st.status,
            connectedAt: st.connectedAt,
            phoneNumber: st.phoneNumber,
            keepAliveErrors: st.keepAliveErrors,
            lastError: st.lastError,
            lastErrorAt: st.lastErrorAt,
            hasQr: !!st.lastQR,
            sessionOnDisk: fs.existsSync(path.join(authDir(line), 'creds.json')),
            bridge: 'baileys',
        };
    }
    return out;
}

/**
 * `/health` incluye `sessions` con la misma forma que `/diagnostic` porque
 * `app/api/whatsapp-lines/sync` lee el estado de las líneas desde aquí, no
 * desde /diagnostic. Sin esa clave, el sync marcaría las líneas de este
 * puente como perdidas y las pondría en 'disconnected' en la base.
 */
app.get('/health', (req, res) => {
    res.json({
        ok: true,
        bridge: 'baileys',
        sessions: describeSessions(),
        forwarding_enabled: FORWARDING_ENABLED,
        uptime_s: Math.round(process.uptime()),
    });
});

app.get('/metrics', (req, res) => {
    res.json({ ...metrics, uptime_s: Math.round(process.uptime()) });
});

/**
 * Mismo contrato que el 3004, para que el panel de líneas y el Centro de
 * Control no necesiten saber qué puente atiende cada línea.
 */
app.get('/diagnostic', (req, res) => {
    res.json({
        ok: true,
        bridge: 'baileys',
        sessions: describeSessions(),
        bridgeTime: new Date().toISOString(),
    });
});

app.get('/qr', async (req, res) => {
    const line = resolveLine(String(req.query.line || '')) || BRIDGE_LINES[0];
    const st = sessions.get(line);
    if (!st?.lastQR) {
        return res
            .status(404)
            .type('html')
            .send(
                `<!doctype html><body style="background:#111;color:#eee;font-family:sans-serif;text-align:center;padding:40px">
                 <h2>${line}</h2><p>No hay QR pendiente. Estado: <b>${st?.status || 'desconocida'}</b>.</p>
                 <p>Si ya está conectada no hace falta escanear nada.</p></body>`
            );
    }
    const png = await QRCode.toDataURL(st.lastQR);
    res.type('html').send(
        `<!doctype html><body style="background:#111;color:#eee;font-family:sans-serif;text-align:center;padding:24px">
         <h2>QR — ${line}</h2><img src="${png}" style="width:320px;height:320px" />
         <p>WhatsApp del teléfono &rarr; Dispositivos vinculados &rarr; Vincular dispositivo.</p>
         <p style="opacity:.6">La página no se recarga sola: si el QR expira, refresca.</p></body>`
    );
});

/**
 * Contrato idéntico al del 3004: `{ status, qr }` donde `qr` es la imagen en
 * data URL, porque el panel la pinta directamente con <img src=…>.
 */
app.get('/api/sessions/:session/qr', (req, res) => {
    if (validateApiKey(req, res) !== true) return;
    const line = resolveLine(req.params.session);
    if (!line) return res.status(404).json({ error: `Línea "${req.params.session}" no pertenece a este puente` });

    const st = sessions.get(line);
    if (!st) return res.status(404).json({ error: 'Sesión no iniciada' });
    if (st.status === 'connected') return res.json({ status: 'connected', qr: null });
    if (!st.lastQRDataUrl) {
        return res.json({ status: st.status, qr: null, message: 'El QR aún no está listo. Espera unos segundos.' });
    }
    res.json({ status: st.status, qr: st.lastQRDataUrl });
});

app.post('/api/sessions/:session/start', (req, res) => {
    if (validateApiKey(req, res) !== true) return;
    const line = resolveLine(req.params.session);
    if (!line) return res.status(404).json({ error: `Línea "${req.params.session}" no pertenece a este puente` });
    const st = sessions.get(line);
    if (st?.status === 'connected') {
        return res.json({ success: true, session: line, note: 'ya conectada' });
    }
    startSession(line);
    res.json({ success: true, session: line, note: 'arranque solicitado' });
});

app.post('/api/sessions/:session/logout', async (req, res) => {
    if (validateApiKey(req, res) !== true) return;
    const line = resolveLine(req.params.session);
    if (!line) return res.status(404).json({ error: `Línea "${req.params.session}" no pertenece a este puente` });

    try {
        const st = sessions.get(line) || blankState();
        if (st.reconnectTimer) {
            clearTimeout(st.reconnectTimer);
            st.reconnectTimer = null;
        }
        if (st.sock) {
            try { await st.sock.logout(); } catch { /* puede estar ya caída */ }
        }
        // Se sube la generación en vez de reiniciar el estado: con `epoch` de
        // vuelta a 0, el socket que se acaba de cerrar volveria a parecer el
        // vivo y sus eventos dispararian reconexiones fantasma.
        teardownSocket(st, line);
        st.epoch += 1;
        st.status = 'logged_out';
        st.connectedAt = null;
        st.phoneNumber = null;
        st.lastQR = null;
        st.lastQRDataUrl = null;
        st.lastError = 'logout manual';
        st.lastErrorAt = new Date().toISOString();
        st.reconnectDelay = 2000;
        st.starting = false;
        sessions.set(line, st);

        fs.rmSync(authDir(line), { recursive: true, force: true });
        logger.warn({ line }, 'Logout manual desde el panel');
        await callbackToApp('/api/whatsapp-lines/status', { line_key: line, status: 'disconnected' });
        res.json({ success: true });
        scheduleReconnect(st, line, 3000, 'tras-logout-manual');
    } catch (err) {
        logger.error({ err: err.message, line }, 'Error en logout');
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/sessions/:session/chats/:chatId/history', (req, res) => {
    if (validateApiKey(req, res) !== true) return;
    const line = resolveLine(req.params.session);
    if (!line) return res.status(404).json({ error: `Línea "${req.params.session}" no pertenece a este puente` });

    const limit = parseInt(req.query.limit || '15', 10);
    const messages = storeRead(line, req.params.chatId, limit).map((m) => ({
        id: m.id,
        fromMe: m.fromMe,
        body: m.body,
        type: m.type,
        // La app hace new Date(m.timestamp): espera milisegundos.
        timestamp: new Date(m.timestamp).getTime(),
    }));
    res.json({ success: true, messages });
});

app.post('/api/sessions/:session/messages/send-text', async (req, res) => {
    if (validateApiKey(req, res) !== true) return;
    const line = resolveLine(req.params.session);
    if (!line) return res.status(404).json({ error: `Línea "${req.params.session}" no pertenece a este puente` });

    const st = sessions.get(line);
    if (!st?.sock || st.status !== 'connected') {
        return res.status(400).json({ error: `Línea "${line}" no está conectada (${st?.status || 'sin sesión'})` });
    }

    const { chatId, message, text } = req.body || {};
    const content = message || text;
    if (!chatId || !content) return res.status(400).json({ error: 'chatId y message/text son obligatorios' });

    const jid = normalizeJid(chatId);
    try {
        await typing(st.sock, jid);
        const sent = await st.sock.sendMessage(jid, { text: content });
        metrics.text_sent++;
        // El id REAL de WhatsApp: es lo que apaga el eco del puente.
        res.json({ data: { id: sent?.key?.id || `baileys_${Date.now()}` } });
    } catch (err) {
        metrics.send_errors++;
        logger.error({ err: err.message, line, jid }, 'Error enviando texto');
        res.status(500).json({ error: err.message });
    }
});

/**
 * Envío de media. No existía en el MVP, y sin él el bot deja de mandar
 * las fotos de producto que el cliente pide.
 *
 * Recibe una URL (normalmente relativa, servida por la propia app en
 * /api/products/images/...) y la resuelve contra APP_URL, igual que el 3004.
 */
app.post('/api/sessions/:session/messages/send-media', async (req, res) => {
    if (validateApiKey(req, res) !== true) return;
    const line = resolveLine(req.params.session);
    if (!line) return res.status(404).json({ error: `Línea "${req.params.session}" no pertenece a este puente` });

    const st = sessions.get(line);
    if (!st?.sock || st.status !== 'connected') {
        return res.status(400).json({ error: `Línea "${line}" no está conectada (${st?.status || 'sin sesión'})` });
    }

    const { chatId, mediaUrl, caption } = req.body || {};
    if (!chatId || !mediaUrl) return res.status(400).json({ error: 'chatId y mediaUrl son obligatorios' });

    const jid = normalizeJid(chatId);
    const fullUrl = String(mediaUrl).startsWith('/') ? `${APP_URL}${mediaUrl}` : String(mediaUrl);

    try {
        const r = await fetch(fullUrl, {
            headers: { 'User-Agent': 'knowledgebot-baileys/1.0' },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} al descargar ${fullUrl}`);

        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length === 0) throw new Error(`El archivo de ${fullUrl} vino vacío`);
        if (buf.length > MAX_MEDIA_BYTES) throw new Error(`El archivo pesa ${Math.round(buf.length / 1024 / 1024)} MB, por encima del tope de ${MAX_MEDIA_MB} MB`);

        const mime = (r.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();

        let content;
        if (mime.startsWith('image/')) {
            content = { image: buf, mimetype: mime, caption: caption || undefined };
        } else if (mime.startsWith('audio/')) {
            content = { audio: buf, mimetype: mime };
        } else if (mime.startsWith('video/')) {
            content = { video: buf, mimetype: mime, caption: caption || undefined };
        } else {
            const name = decodeURIComponent(fullUrl.split('/').pop() || 'archivo');
            content = { document: buf, mimetype: mime, fileName: name, caption: caption || undefined };
        }

        await typing(st.sock, jid, 1500);
        const sent = await st.sock.sendMessage(jid, content);
        metrics.media_sent++;
        logger.info({ line, jid, mime, kb: Math.round(buf.length / 1024) }, 'Media enviada');
        res.json({ data: { id: sent?.key?.id || `baileys_media_${Date.now()}` } });
    } catch (err) {
        metrics.send_errors++;
        logger.error({ err: err.message, line, jid, fullUrl }, 'Error enviando media');
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ARRANQUE
// ============================================================

app.listen(PORT, () => {
    logger.info(
        { port: PORT, lines: BRIDGE_LINES, appUrl: APP_URL, forwarding: FORWARDING_ENABLED },
        'Puente Baileys escuchando'
    );
    fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
    fs.mkdirSync(STORE_ROOT, { recursive: true });
    for (const line of BRIDGE_LINES) {
        sessions.set(line, blankState());
        startSession(line).catch((e) => logger.error({ err: e.message, line }, 'Fallo al arrancar la línea'));
    }
});
