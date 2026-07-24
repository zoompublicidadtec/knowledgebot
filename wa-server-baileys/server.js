/**
 * ============================================================
 * wa-server-baileys/server.js
 * MVP Sprint 1 — Puente WhatsApp con Baileys (sin Puppeteer)
 * ============================================================
 *
 * Versión corregida con las 4 observaciones de la auditoría Traycer:
 *   1. FORWARDING_ENABLED=false por defecto -> descarga en sombra sin
 *      enviar webhooks. Elimina la entrega duplicada en coexistencia
 *      con el puente :3004. Se activa solo en la conmutación.
 *   2. Endpoint /api/sessions/:session/chats/:chatId/history -> paridad
 *      de contrato con el puente actual. Alimenta el store persistente.
 *   3. LINE_KEY configurable (línea de prueba en sombra).
 *   4. Store de mensajes persistente en volumen -> mitiga el "store frío"
 *      detectado por Traycer en la conmutación.
 *
 * ALCANCE DEL MVP (lo que SÍ hace):
 *   - Una sola sesión Baileys dedicada a prueba (1 línea).
 *   - Recibe mensajes vía messages.upsert.
 *   - Si el mensaje trae imagen -> downloadMediaMessage() -> base64.
 *   - Normaliza al CONTRATO INMUTABLE y POST al webhook (:3003)
 *      SOLO si FORWARDING_ENABLED=true.
 *   - Acumula historial en el store persistente (siempre, sin importar el flag).
 *   - Métricas en /metrics. Health en /health. QR en /qr.
 *
 * ALCANCE DEL MVP (lo que NO hace, a propósito):
 *   - Multi-línea (una sola sesión).
 *   - Audios/documentos/stickers (solo imagen en este Sprint).
 *   - Envío (send-text/send-media).
 *   - R2, panel.
 *
 * CONTRATO INMUTABLE del webhook:
 *   {
 *     event: 'message.received',
 *     line_key: <LINE_KEY>,
 *     data: { message: {
 *       id, from, to, fromMe, body, type,
 *       media: { data, mimetype, filename } | null,
 *       customerName
 *     }}
 *   }
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
const { Boom } = require('@hapi/boom');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const P = require('pino');

// ============================================================
// CONFIGURACIÓN
// ============================================================

const PORT = process.env.PORT || 3005;
const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003';
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || '';

// --- CORRECCIÓN TRAYCER #1: forwarding silenciado por defecto ---
// El MVP arranca en MODO SOMBRA: descarga imágenes y acumula historial,
// pero NO envía webhooks a la app. Evita duplicación mientras :3004
// sigue en producción. Se activa con FORWARDING_ENABLED=true al switch.
const FORWARDING_ENABLED = (process.env.FORWARDING_ENABLED || 'false').toLowerCase() === 'true';

// Línea única del MVP (línea de prueba). Default 'linea_1'.
const LINE_KEY = process.env.LINE_KEY || 'linea_1';
const AUTH_DIR = process.env.AUTH_DIR || `/data/baileys_sessions/session-${LINE_KEY}`;

// --- CORRECCIÓN TRAYCER #4: store persistente para mitigar store frío ---
// El store guarda los mensajes recibidos en disco. Así, cuando se haga la
// conmutación y la app llame a /history, el store ya tiene historial
// acumulado desde el arranque en sombra.
const STORE_DIR = process.env.STORE_DIR || `/data/baileys_store/${LINE_KEY}`;
fs.mkdirSync(STORE_DIR, { recursive: true });

const logger = P({ level: process.env.LOG_LEVEL || 'info' });

// ============================================================
// MÉTRICAS
// ============================================================

const metrics = {
    messages_received: 0,
    images_detected: 0,
    images_downloaded: 0,
    download_errors: 0,
    webhooks_sent: 0,
    webhooks_suppressed_shadow: 0,
    webhooks_failed: 0,
    started_at: new Date().toISOString(),
    forwarding_enabled: FORWARDING_ENABLED,
    last_download_ms: 0,
    last_post_ms: 0,
};

// ============================================================
// STORE PERSISTENTE DE MENSAJES (corrección #4)
// ============================================================

/**
 * Guarda cada mensaje recibido en disco para alimentar /history.
 * Formato: un archivo JSON por chat, append-only simple.
 * Ruta: STORE_DIR/<chatJid>.json
 */
function storeAppend(messageRecord) {
    try {
        const safeName = (messageRecord.chatJid || 'unknown').replace(/[^a-zA-Z0-9@_.-]/g, '_');
        const filePath = path.join(STORE_DIR, `${safeName}.json`);
        let arr = [];
        if (fs.existsSync(filePath)) {
            arr = JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
        }
        arr.push(messageRecord);
        // Tope defensivo: últimos 200 mensajes por chat.
        if (arr.length > 200) arr = arr.slice(-200);
        fs.writeFileSync(filePath, JSON.stringify(arr, null, 2));
    } catch (e) {
        logger.warn({ err: e.message }, 'No se pudo persistir mensaje en store');
    }
}

function storeRead(chatJid, limit = 15) {
    try {
        const safeName = (chatJid || 'unknown').replace(/[^a-zA-Z0-9@_.-]/g, '_');
        const filePath = path.join(STORE_DIR, `${safeName}.json`);
        if (!fs.existsSync(filePath)) return [];
        const arr = JSON.parse(fs.readFileSync(filePath, 'utf8') || '[]');
        // últimos N, orden cronológico ascendente
        return arr.slice(-limit);
    } catch (e) {
        logger.warn({ err: e.message }, 'No se pudo leer store');
        return [];
    }
}

// ============================================================
// ADAPTADOR ÚNICO — contrato inmutable
// ============================================================

/**
 * Normaliza un mensaje de Baileys al payload EXACTO que el webhook
 * en :3003 espera. ÚNICA función que sabe de Baileys.
 */
function normalizeIncomingMessage(baileysMsg, lineKey, mediaData, msgType) {
    const msg = baileysMsg;
    const media = mediaData;
    let bodyText = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || '';

    // Extract quoted/replied message if present (contextInfo)
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (contextInfo?.quotedMessage) {
        const qm = contextInfo.quotedMessage;
        const quotedContent = qm.conversation
            || qm.extendedTextMessage?.text
            || qm.imageMessage?.caption
            || '';
        if (quotedContent) {
            bodyText = `${bodyText}\n[En respuesta a: "${quotedContent}"]`;
        }
    }

    return {
        event: 'message.received',
        line_key: lineKey,
        data: {
            message: {
                id: msg.key.id,
                from: msg.key.remoteJid,
                to: msg.key.remoteJid,
                fromMe: msg.key.fromMe === true,
                body: bodyText,
                type: msgType || (media ? 'image' : 'chat'),
                media: media ? {
                    data: media.data,
                    mimetype: media.mimetype,
                    filename: media.filename || '',
                } : null,
                customerName: '',
            },
        },
    };
}

// ============================================================
// ENVÍO AL WEBHOOK (respeta FORWARDING_ENABLED)
// ============================================================

async function sendToWebhook(payload) {
    // --- CORRECCIÓN TRAYCER #1: silencio en sombra ---
    if (!FORWARDING_ENABLED) {
        metrics.webhooks_suppressed_shadow++;
        logger.debug({ line: LINE_KEY }, 'Webhook suprimido (modo sombra)');
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
            logger.error({ status: res.status, errText }, 'Webhook rechazó el payload');
            return false;
        }
        metrics.webhooks_sent++;
        logger.info({ latency_ms: metrics.last_post_ms }, 'Webhook enviado OK');
        return true;
    } catch (err) {
        metrics.webhooks_failed++;
        metrics.last_post_ms = Date.now() - t0;
        logger.error({ err: err.message }, 'No se pudo alcanzar el webhook de la app');
        return false;
    }
}

// ============================================================
// SOCKET BAILEYS
// ============================================================

let sock = null;
let lastQR = null;
let connectionState = { status: 'initializing', connectedAt: null, phoneNumber: null, keepAliveErrors: 0, lastError: null };

async function startBaileys() {
    fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { version } = await fetchLatestBaileysVersion();
    logger.info({ version }, 'Baileys version');

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Desktop'),
        version,
        // No bloquear la recepción de mensajes esperando el historial completo.
        // El timeout de executeInitQueries rompe la sesión en cuentas con mucho historial.
        syncHistory: false,
        markOnlineOnConnect: false,
        msgRetryCount: 3,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            lastQR = qr;
            logger.info('QR disponible. Escanear desde GET /qr.');
            console.log('\n\n=== QR PARA ' + LINE_KEY + ' ===\n' + qr + '\n=== FIN QR ===\n\n');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            connectionState.status = 'disconnected';
            connectionState.lastError = lastDisconnect?.error?.message || 'closed';
            logger.warn({ statusCode, shouldReconnect }, 'Conexión cerrada');
            if (shouldReconnect) {
                startBaileys();
            } else {
                connectionState.status = 'logged_out';
                logger.error('Sesión cerrada por logout. Borrar AUTH_DIR y re-escanear QR.');
            }
        } else if (connection === 'open') {
            connectionState.status = 'connected';
            connectionState.connectedAt = new Date().toISOString();
            connectionState.keepAliveErrors = 0;
            connectionState.lastError = null;
            // Extraer número de teléfono del propio JID del bot
            try {
                const me = sock.user;
                if (me?.id) {
                    const phone = me.id.split(':')[0];
                    connectionState.phoneNumber = phone;
                }
            } catch {}
            logger.info({ line: LINE_KEY, forwarding: FORWARDING_ENABLED }, 'Baileys CONECTADO');
        }
    });

    // ========================================================
    // RECEPCIÓN DE MENSAJES
    // ========================================================
    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            try {
                const jid = msg.key.remoteJid;
                if (isJidGroup(jid) || isJidBroadcast(jid)) continue;

                metrics.messages_received++;
                const fromMe = msg.key.fromMe === true;
                const imageMsg = msg.message?.imageMessage;
                const audioMsg = msg.message?.audioMessage || msg.message?.pttMessage;

                logger.info(
                    { from: jid, fromMe, hasImage: !!imageMsg, hasAudio: !!audioMsg, forwarding: FORWARDING_ENABLED },
                    `Mensaje (${fromMe ? 'Saliente' : 'Entrante'})`
                );

                let mediaData = null;
                let msgType = 'chat';

                // Procesar media entrante: imagen, audio (nota de voz) o ptt.
                if (!fromMe && (imageMsg || audioMsg)) {
                    const t0 = Date.now();
                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger });
                        metrics.last_download_ms = Date.now() - t0;

                        if (!buffer || buffer.length === 0) {
                            metrics.download_errors++;
                            logger.error('downloadMediaMessage devolvió buffer vacío');
                        } else {
                            const base64 = buffer.toString('base64');
                            if (imageMsg) {
                                msgType = 'image';
                                metrics.images_detected++;
                                metrics.images_downloaded++;
                                mediaData = {
                                    data: base64,
                                    mimetype: imageMsg.mimetype || 'image/jpeg',
                                    filename: `img_${msg.key.id}.jpg`,
                                };
                            } else {
                                // audio / ptt (nota de voz)
                                msgType = 'ptt';
                                mediaData = {
                                    data: base64,
                                    mimetype: audioMsg.mimetype || 'audio/ogg; codecs=opus',
                                    filename: `audio_${msg.key.id}.ogg`,
                                };
                            }
                            const sizeKB = Math.round(buffer.length / 1024);
                            logger.info(
                                { sizeKB, mimetype: mediaData.mimetype, ms: metrics.last_download_ms, type: msgType },
                                `Media descargada OK por Baileys: ${sizeKB} KB (${msgType})`
                            );
                        }
                    } catch (dlErr) {
                        metrics.download_errors++;
                        metrics.last_download_ms = Date.now() - t0;
                        logger.error(
                            { err: dlErr.message, stack: dlErr.stack?.split('\n').slice(0, 3).join(' | ') },
                            'ERROR descargando media con Baileys'
                        );
                    }
                }

                // --- CORRECCIÓN TRAYCER #4: persistir en store SIEMPRE ---
                const storeRecord = {
                    id: msg.key.id,
                    chatJid: jid,
                    fromMe,
                    body: msg.message?.conversation
                        || msg.message?.extendedTextMessage?.text
                        || msg.message?.imageMessage?.caption
                        || '',
                    type: msgType,
                    timestamp: msg.messageTimestamp
                        ? new Date(parseInt(msg.messageTimestamp) * 1000).toISOString()
                        : new Date().toISOString(),
                    hadMedia: !!mediaData,
                };
                storeAppend(storeRecord);

                // Enviar webhook (respeta modo sombra): entrantes, o cualquier media.
                if (!fromMe || mediaData) {
                    const payload = normalizeIncomingMessage(msg, LINE_KEY, mediaData, msgType);
                    await sendToWebhook(payload);
                }
            } catch (loopErr) {
                logger.error({ err: loopErr.message }, 'Error procesando mensaje en loop');
            }
        }
    });
}

// ============================================================
// HTTP: health, metrics, qr
// ============================================================

const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        line: LINE_KEY,
        socket: sock ? 'initialized' : 'not-yet',
        forwarding_enabled: FORWARDING_ENABLED,
        lastQR: lastQR ? true : false,
        uptime_s: Math.round(process.uptime()),
    });
});

app.get('/metrics', (req, res) => {
    res.json({ ...metrics, uptime_s: Math.round(process.uptime()) });
});

// ============================================================
// CONTRATO DE PARIDAD — /diagnostic (panel de líneas)
// ============================================================

/**
 * GET /diagnostic
 *
 * El panel /lineas consulta este endpoint para mostrar el estado
 * real (zombie/conectado/caído) de cada línea. Devuelve la misma
 * estructura que el puente whatsapp-web.js:
 *   { ok, sessions: { <LINE_KEY>: { loaded, status, connectedAt, phoneNumber, keepAliveErrors, hasQr, sessionOnDisk } } }
 */
app.get('/diagnostic', (req, res) => {
    const sessionOnDisk = fs.existsSync(path.join(AUTH_DIR, 'creds.json'));
    res.json({
        ok: true,
        sessions: {
            [LINE_KEY]: {
                loaded: !!sock,
                status: connectionState.status,
                connectedAt: connectionState.connectedAt,
                phoneNumber: connectionState.phoneNumber,
                keepAliveErrors: connectionState.keepAliveErrors,
                lastError: connectionState.lastError,
                lastErrorAt: connectionState.lastError ? new Date().toISOString() : null,
                hasQr: !!lastQR,
                sessionOnDisk,
            },
        },
        bridgeTime: new Date().toISOString(),
    });
});

/**
 * POST /api/sessions/:session/logout
 *
 * Permite desconectar la línea desde el panel. Borra la sesión de disco
 * para que la próxima vez pida QR nuevo.
 */
app.post('/api/sessions/:session/logout', async (req, res) => {
    try {
        if (sock) {
            try { await sock.logout(); } catch {}
        }
        // Borrar credenciales de disco
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        connectionState = { status: 'logged_out', connectedAt: null, phoneNumber: null, keepAliveErrors: 0, lastError: 'logout manual' };
        lastQR = null;
        logger.warn({ session: req.params.session }, 'Logout manual ejecutado desde el panel');
        res.json({ success: true });
        // Reintentar conexión (pedirá QR nuevo)
        setTimeout(() => startBaileys(), 3000);
    } catch (err) {
        logger.error({ err: err.message }, 'Error en logout');
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/qr', async (req, res) => {
    if (!lastQR) return res.status(404).json({ error: 'QR no disponible todavía' });
    const png = await QRCode.toDataURL(lastQR);
    const html = `<!doctype html><body style="background:#111;color:#eee;font-family:sans-serif;text-align:center">
        <h2>QR — ${LINE_KEY}</h2>
        <img src="${png}" />
        <p>Escanear desde WhatsApp del teléfono de la línea.</p>
    </body></html>`;
    res.type('html').send(html);
});

// ============================================================
// CORRECCIÓN TRAYCER #2: paridad de contrato /history
// ============================================================

/**
 * GET /api/sessions/:session/chats/:chatId/history?limit=15
 *
 * La app (webhook-processor.ts) llama a este endpoint cuando una
 * conversación nueva no tiene mensajes en Supabase, para sincronizar
 * contexto. Sin esto, las conversaciones nuevas pierden historial.
 *
 * La app usa sessionId='default' (porque openwa_session_id es null en BD).
 * Responde con el contrato que la app espera:
 *   { success: true, messages: [{ id, fromMe, body, type, timestamp }] }
 *
 * Limitación documentada (Traycer): el store solo tiene mensajes recibidos
 * desde que esta sesión Baileys arrancó. La fase sombra con
 * FORWARDING_ENABLED=false acumula historial gratis para mitigarlo.
 */
app.get('/api/sessions/:session/chats/:chatId/history', (req, res) => {
    const { chatId } = req.params;
    const limit = parseInt(req.query.limit || '15', 10);
    const messages = storeRead(chatId, limit).map((m) => ({
        id: m.id,
        fromMe: m.fromMe,
        body: m.body,
        type: m.type,
        // La app espera timestamp milisegundos para new Date(m.timestamp).
        timestamp: new Date(m.timestamp).getTime(),
    }));
    res.json({ success: true, messages });
});

// Compatibilidad: que un health check del panel no rompa si llama al /start.
app.post('/api/sessions/:session/start', (req, res) => {
    res.json({ success: true, session: req.params.session, note: 'Baileys se autostart en arranque' });
});

app.get('/api/sessions/:session/qr', async (req, res) => {
    if (!lastQR) return res.status(404).json({ error: 'QR no disponible' });
    res.json({ success: true, qr: lastQR });
});

// Envío de mensajes de texto (para que Oscar pueda responder).
app.post('/api/sessions/:session/messages/send-text', async (req, res) => {
    try {
        const { chatId, message, text } = req.body;
        const content = message || text;
        if (!sock) return res.status(503).json({ error: 'Socket no inicializado' });
        if (!chatId || !content) return res.status(400).json({ error: 'chatId y message/text requeridos' });
        const sent = await sock.sendMessage(chatId, { text: content });
        res.json({ success: true, data: { id: sent?.key?.id || `baileys_${Date.now()}` } });
    } catch (err) {
        logger.error({ err: err.message }, 'Error enviando texto');
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    logger.info(
        { port: PORT, line: LINE_KEY, appUrl: APP_URL, forwarding: FORWARDING_ENABLED },
        'Puente Baileys MVP escuchando'
    );
    startBaileys().catch((err) => {
        logger.error({ err: err.message }, 'No se pudo iniciar Baileys');
        process.exit(1);
    });
});
