const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCodeLib = require('qrcode');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

// ============================================================
// ENV LOADING — Reads from process.env (Railway) or local files
// ============================================================
function loadEnvFile(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            content.split('\n').forEach(line => {
                const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?/);
                if (match) {
                    const key = match[1];
                    let val = (match[2] || '').trim();
                    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                        val = val.slice(1, -1);
                    }
                    if (!process.env[key]) process.env[key] = val;
                }
            });
        } catch (e) {
            console.error(`Error loading env file ${filePath}:`, e.message);
        }
    }
}

// Load local env files for development. In Railway, process.env is already populated.
loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(__dirname, '../knowledgebot-saas/.env.local'));

const APP_URL = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3003';
const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Path to system Chromium (set by Dockerfile for Railway/Linux, overrideable)
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH || undefined;
// Persistent volume path for session data (Railway volume mounted at /data)
const VOLUME_PATH = process.env.VOLUME_PATH || '/data';
const SESSION_DATA_PATH = path.join(VOLUME_PATH, 'wwebjs_sessions');

/**
 * Compuerta de propiedad de lineas (30-Jul-2026).
 *
 * Este puente no puede descargar la media entrante (0 archivos de 328
 * mensajes medidos), asi que las lineas se van migrando al puente Baileys
 * del 3005 de una en una. Mientras conviven los dos, cada linea tiene que
 * ser atendida por UNO SOLO: si los dos la atienden, el cliente recibe la
 * respuesta dos veces y el agente se ejecuta dos veces.
 *
 * BRIDGE_LINES es la lista de lineas que este puente atiende. Vacia o sin
 * definir = todas, que es el comportamiento de siempre.
 *
 * La comprobacion vive dentro de startSession(), que es el unico punto por
 * el que se crea una sesion (autoload, el endpoint /start y la reconexion
 * pasan todos por ahi). Asi ninguna ruta HTTP puede colarse.
 */
const BRIDGE_LINES = (process.env.BRIDGE_LINES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function ownsLine(sessionName) {
    if (BRIDGE_LINES.length === 0) return true;
    return BRIDGE_LINES.includes(sessionName);
}

/**
 * MODO SOLO-ENVIO (31-Jul-2026).
 *
 * Arquitectura final: cada linea usa LOS DOS puentes a la vez.
 *   - Baileys (3005) RECIBE: es el unico que sabe descargar audios y fotos.
 *   - Este puente (3004) ENVIA: es el unico que entrega de verdad.
 *
 * Por que hace falta este reparto: con Baileys, WhatsApp acepta el mensaje y
 * lo rechaza despues en el acuse con `error: 463` (candado de privacidad
 * NackCallerReachoutTimelocked) porque la rama 6.x no sabe adjuntar el nodo
 * `<tctoken>`. La 7.x si lo adjunta, pero NO CONECTA desde este servidor:
 * probado rc13 y rc14, con y sin version de protocolo remota, en Node 20 y 22,
 * y aislada de nuestro codigo. Siempre `statusCode 428`.
 * Este puente entrega bien porque usa el WhatsApp Web autentico dentro de
 * Chrome, que emite esos tokens de forma nativa.
 *
 * Con FORWARD_INBOUND=false este puente deja de reenviar lo que recibe. Sin
 * eso, los dos puentes reenviarian el mismo mensaje y el cliente recibiria
 * cada respuesta dos veces. Tambien apaga de raiz el eco del puente.
 */
/**
 * `FORWARD_INBOUND_LINES` dice de que lineas SI se reenvia lo recibido.
 *   - Variable sin definir  -> se reenvian todas (comportamiento de siempre).
 *   - Variable definida     -> solo las listadas; el resto queda en solo-envio.
 *   - Definida y vacia      -> ninguna: este puente solo envia.
 *
 * Hace falta por linea, y no un interruptor global, porque la migracion se
 * hace por fases: mientras `linea_2` ya recibe por Baileys, `linea_1` todavia
 * tiene que recibir por aqui. Si este puente reenviara una linea que ya recibe
 * el otro, el agente correria dos veces y el cliente veria cada respuesta
 * duplicada.
 */
const FORWARD_INBOUND_DEFINIDA = process.env.FORWARD_INBOUND_LINES !== undefined;
const FORWARD_INBOUND_LINES = (process.env.FORWARD_INBOUND_LINES || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

function reenviaEntrantes(sessionName) {
    if (!FORWARD_INBOUND_DEFINIDA) return true;
    return FORWARD_INBOUND_LINES.includes(sessionName);
}

console.log(`[CONFIG] BRIDGE_LINES: ${BRIDGE_LINES.length ? BRIDGE_LINES.join(',') : '(todas)'}`);
console.log(`[CONFIG] Reenvia entrantes de: ${
    !FORWARD_INBOUND_DEFINIDA ? '(todas)' : (FORWARD_INBOUND_LINES.join(',') || 'NINGUNA — solo envio')
}`);

// Ensure session data directory exists
try {
    if (!fs.existsSync(SESSION_DATA_PATH)) {
        fs.mkdirSync(SESSION_DATA_PATH, { recursive: true });
        console.log(`[VOLUME] Directorio de sesiones creado: ${SESSION_DATA_PATH}`);
    } else {
        console.log(`[VOLUME] Directorio de sesiones existe: ${SESSION_DATA_PATH}`);
    }
    // List existing session files
    const sessionFiles = fs.readdirSync(SESSION_DATA_PATH);
    console.log(`[VOLUME] Sesiones guardadas en disco: ${sessionFiles.length > 0 ? sessionFiles.join(', ') : 'ninguna'}`);
} catch (e) {
    console.error(`[VOLUME] Error accediendo al volumen: ${e.message}`);
    console.log(`[VOLUME] Usando directorio local como fallback`);
}

console.log(`[CONFIG] APP_URL: ${APP_URL}`);
console.log(`[CONFIG] Supabase URL: ${SUPABASE_URL ? 'OK' : 'MISSING'}`);
console.log(`[CONFIG] Chromium: ${CHROMIUM_PATH || 'Default (local)'}`);
console.log(`[CONFIG] Volume: ${VOLUME_PATH}`);

// ============================================================
// GLOBAL CRASH PROTECTION — Prevent unhandled promise rejections
// from killing the entire Node.js process. This is critical because
// Puppeteer/whatsapp-web.js frequently throw async errors during
// normal operation (page navigation, presence updates, etc.).
// ============================================================
process.on('unhandledRejection', (reason, promise) => {
    console.error('[GLOBAL] Unhandled Promise Rejection (caught safely):', reason?.message || reason);
    // Do NOT crash — just log it
});

process.on('uncaughtException', (err) => {
    console.error('[GLOBAL] Uncaught Exception (caught safely):', err.message);
    // Do NOT crash — just log it
});
console.log(`[CONFIG] Bridge API Key: ${BRIDGE_API_KEY ? 'SET' : 'NOT SET (auth disabled)'}`);

// ============================================================
// SUPABASE CLIENT
// ============================================================
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false
        },
        realtime: {
            transport: ws
        }
    });
    console.log('[SUPABASE] Inicializado correctamente con ws transport.');
} else {
    console.error('[SUPABASE] FALTAN CREDENCIALES. El servidor no puede funcionar sin Supabase.');
    process.exit(1);
}

// ============================================================
// SESSION PERSISTENCE — Uses LocalAuth to save session data
// directly to the Railway persistent volume at /data.
// This is simpler and more reliable than RemoteAuth + Supabase,
// as the volume survives container restarts and redeployments.
// ============================================================

// ============================================================
// HELPERS
// ============================================================

// Send authenticated callback to the Next.js SaaS app
async function callbackToApp(path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (BRIDGE_API_KEY) headers['x-bridge-key'] = BRIDGE_API_KEY;
    try {
        await fetch(`${APP_URL}${path}`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });
    } catch (e) {
        console.error(`[CALLBACK] Error calling ${path}:`, e.message);
    }
}

// Validate incoming X-API-Key (returns true if auth is disabled in dev)
function validateApiKey(req, res) {
    if (!BRIDGE_API_KEY) return true; // No key configured = open (local dev)
    const incoming = req.headers['x-api-key'] || '';
    if (incoming !== BRIDGE_API_KEY) {
        return res.status(403).json({ error: 'Invalid API key' });
    }
    return true;
}

// ============================================================
// CACHE CLEANUP — Chromium accumulates large Cache/Code Cache/GPUCache
// folders under each session's user-data-dir. These are useless for
// WhatsApp Web persistence (only the auth tokens matter) and will fill
// the Railway volume. We purge them on startup, keeping only auth files.
// ============================================================

// Recursively delete a directory if it exists.
function deleteDirSafe(dirPath) {
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            return true;
        }
    } catch (e) {
        console.warn(`[CLEANUP] No se pudo borrar ${dirPath}: ${e.message}`);
    }
    return false;
}

// Purge Chromium cache folders for ALL sessions on the volume.
// Keeps auth tokens (Local State, Default/Login Data, etc.) intact.
function purgeChromiumCaches() {
    const CACHE_DIRS = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker'];
    let purgedCount = 0;

    try {
        if (!fs.existsSync(SESSION_DATA_PATH)) {
            console.log('[CLEANUP] Directorio de sesiones no existe aún, nada que limpiar.');
            return;
        }

        // Iterate over chromium_<session> directories
        const entries = fs.readdirSync(SESSION_DATA_PATH);
        for (const entry of entries) {
            if (!entry.startsWith('chromium_')) continue;
            const sessionDir = path.join(SESSION_DATA_PATH, entry);

            // Top-level cache dirs
            for (const cacheDir of CACHE_DIRS) {
                if (deleteDirSafe(path.join(sessionDir, cacheDir))) {
                    purgedCount++;
                }
            }

            // Also clean cache dirs nested under 'Default' (Chromium's default profile)
            const defaultProfile = path.join(sessionDir, 'Default');
            if (fs.existsSync(defaultProfile)) {
                for (const cacheDir of CACHE_DIRS) {
                    if (deleteDirSafe(path.join(defaultProfile, cacheDir))) {
                        purgedCount++;
                    }
                }
            }
        }

        console.log(`[CLEANUP] ${purgedCount} carpeta(s) de caché eliminadas de ${SESSION_DATA_PATH}.`);
    } catch (e) {
        console.warn(`[CLEANUP] Error durante la limpieza: ${e.message}`);
    }
}

// List session directories on the volume for diagnostics.
function listSessionDirs() {
    try {
        if (!fs.existsSync(SESSION_DATA_PATH)) return;
        const entries = fs.readdirSync(SESSION_DATA_PATH);
        const sessionDirs = entries.filter(e => e.startsWith('session-'));
        console.log(`[VOLUME] Sesiones LocalAuth en disco: ${sessionDirs.length > 0 ? sessionDirs.join(', ') : 'ninguna'}`);
    } catch (e) {
        console.warn(`[VOLUME] Error listando sesiones: ${e.message}`);
    }
}

// ============================================================
// SESSIONS MAP: line_key -> { client, status, intervalId }
// ============================================================
const app = express();
app.use(express.json());

// Allow Next.js frontend to call the bridge directly (CORS for local dev)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const sessions = new Map();
// ── NUEVO (seguimiento): conserva info de la ÚLTIMA caída de cada línea,
// incluso después de que sessions.delete() borra la entrada de memoria.
// Es solo para diagnóstico/lectura — no afecta la lógica de conexión.
const lastDisconnectInfo = new Map();
const reconnectAttempts = new Map();
const reconnectTimers = new Map();
const MAX_RECONNECT_ATTEMPTS = 5;

function clearReconnectState(sessionName) {
    const timer = reconnectTimers.get(sessionName);
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(sessionName);
    reconnectAttempts.delete(sessionName);
}

function startSession(sessionName) {
    // Compuerta: esta linea la atiende otro puente. No se arranca aqui.
    if (!ownsLine(sessionName)) {
        console.log(`[${sessionName}] IGNORADA: no pertenece a este puente (BRIDGE_LINES=${BRIDGE_LINES.join(',')}).`);
        return null;
    }

    if (sessions.has(sessionName)) {
        const existing = sessions.get(sessionName);
        // Starting the same LocalAuth profile twice races Chromium and can
        // invalidate a QR flow. An initialization error removes its entry,
        // allowing a later explicit retry to create a fresh client.
        console.log(`[${sessionName}] Sesión ya ${existing.status}; se conserva el cliente actual.`);
        return existing;
    }

    console.log(`[${sessionName}] Inicializando cliente WhatsApp Web...`);

    // LocalAuth saves session data directly to the Railway volume.
    // Sessions at: /data/wwebjs_sessions/session-{clientId}/
    // The volume persists across container restarts and redeployments.
    const clientOptions = {
        authStrategy: new LocalAuth({
            clientId: sessionName,
            dataPath: SESSION_DATA_PATH,
        }),
        webVersionCache: {
            type: 'none' // Prevent cache corruption when running multiple lines concurrently
        },
        puppeteer: {
            headless: true,
            protocolTimeout: 180000, // 3 minutos para prevenir CDP timeouts (Runtime.callFunctionOn)
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-extensions',
                '--disable-software-rasterizer',
                // ── Anti-cache: prevent Chromium from filling the volume with media/cache ──
                '--disable-cache',
                '--disk-cache-size=1',
                '--media-cache-size=1',
                '--disable-application-cache',
                '--disable-offline-load-stale-cache'
            ],
        },
    };

    // Use system Chromium if available (Railway/Docker deployment)
    if (CHROMIUM_PATH) {
        clientOptions.puppeteer.executablePath = CHROMIUM_PATH;
    }

    const client = new Client(clientOptions);

    const sessionObj = {
        client, status: 'initializing', intervalId: null, lastQr: null,
        // ── NUEVO (seguimiento): solo lectura, no afecta la lógica de conexión.
        connectedAt: null,      // ISO timestamp al pasar a 'connected'
        phoneNumber: null,      // cachear el teléfono para mostrarlo en el panel
        lastError: null,        // último mensaje de error (ej. "detached Frame...")
        lastErrorAt: null,      // cuándo ocurrió ese error
        keepAliveErrors: 0,     // contador de errores consecutivos del keep-alive
    };
    sessions.set(sessionName, sessionObj);

    // ─── QR ───────────────────────────────────────────────
    client.on('qr', (qr) => {
        console.log(`\n[${sessionName}] QR generado. Escanéalo en el panel:`);
        qrcode.generate(qr, { small: true });

        QRCodeLib.toDataURL(qr, async (err, url) => {
                if (err) return;
                // Always store QR in memory so the panel can pull it even if push fails
                sessionObj.lastQr = url;
                await callbackToApp('/api/whatsapp-lines/qr', { line_key: sessionName, qr_base64: url });
                console.log(`[${sessionName}] QR callback sent.`);
        });
    });

    // ─── READY ────────────────────────────────────────────
    client.on('ready', async () => {
        const phone = client.info?.wid?.user || '';
        console.log(`\n==================================================`);
        console.log(` [${sessionName}] CONECTADO — Teléfono: ${phone}`);
        console.log(`==================================================\n`);

        sessionObj.status = 'connected';
        clearReconnectState(sessionName);
        // ── NUEVO (seguimiento): registrar momento de conexión y teléfono.
        sessionObj.connectedAt = new Date().toISOString();
        sessionObj.phoneNumber = phone;
        sessionObj.keepAliveErrors = 0; // reset al reconectar

        await callbackToApp('/api/whatsapp-lines/status', { line_key: sessionName, status: 'connected', phone_number: phone });

        // Force an immediate session backup to Supabase so the connection survives
        // a bridge restart. RemoteAuth normally backs up every 5 min, but that is too
        // slow — if Railway restarts within those 5 min, the session is lost forever.
        try {
            if (typeof client.saveAuthState === 'function') {
                await client.saveAuthState();
                console.log(`[${sessionName}] Sesión respaldada en Supabase inmediatamente.`);
            }
        } catch (e) {
            console.warn(`[${sessionName}] No se pudo respaldar la sesión al instante:`, e.message);
        }

        // Keep-alive presence — MUST catch the async Promise to prevent crashes
        const keepOnline = async () => {
            try {
                if (sessions.get(sessionName)?.status === 'connected') {
                    await client.sendPresenceAvailable();
                }
            } catch (e) {
                console.warn(`[${sessionName}] Keep-alive error (no-crash):`, e.message);
                // ── NUEVO (seguimiento): registrar el error para diagnóstico.
                // NO detiene, NO recicla — solo anota. El bucle sigue igual que antes.
                try {
                    const s = sessions.get(sessionName);
                    if (s) {
                        s.lastError = e.message;
                        s.lastErrorAt = new Date().toISOString();
                        s.keepAliveErrors = (s.keepAliveErrors || 0) + 1;
                    }
                } catch {}
            }
        };
        keepOnline();
        sessionObj.intervalId = setInterval(keepOnline, 25000);
    });

    // ─── DISCONNECTED ─────────────────────────────────────
    client.on('disconnected', async (reason) => {
        // Ignore stale events emitted by a client already replaced by a newer one.
        if (sessions.get(sessionName) !== sessionObj) return;

        console.error(`[${sessionName}] Desconectado. Razón: ${reason}`);
        try { lastDisconnectInfo.set(sessionName, { reason: String(reason), at: new Date().toISOString() }); } catch {}
        if (sessionObj.intervalId) clearInterval(sessionObj.intervalId);
        sessions.delete(sessionName);
        try { await client.destroy(); } catch {}

        const reasonText = String(reason || 'unknown');
        const sessionDir = path.join(SESSION_DATA_PATH, `session-${sessionName}`);
        const hasLocalSession = fs.existsSync(sessionDir);
        const isExplicitLogout = /logout|unpaired|auth(?:entication)?[_ -]?failure/i.test(reasonText);

        if (hasLocalSession && !isExplicitLogout) {
            const attempt = (reconnectAttempts.get(sessionName) || 0) + 1;
            reconnectAttempts.set(sessionName, attempt);

            if (attempt <= MAX_RECONNECT_ATTEMPTS) {
                const delayMs = Math.min(3000 * attempt, 15000);
                console.warn(`[${sessionName}] Reconexión automática ${attempt}/${MAX_RECONNECT_ATTEMPTS} en ${delayMs}ms.`);
                const timer = setTimeout(() => {
                    reconnectTimers.delete(sessionName);
                    if (!sessions.has(sessionName)) startSession(sessionName);
                }, delayMs);
                reconnectTimers.set(sessionName, timer);
                return;
            }

            console.error(`[${sessionName}] Se agotaron los reintentos de reconexión.`);
        }

        clearReconnectState(sessionName);
        await callbackToApp('/api/whatsapp-lines/status', { line_key: sessionName, status: 'disconnected' });
    });

    // ─── INBOUND & OUTBOUND MESSAGES (message_create catches both) ───
    client.on('message_create', async msg => {
        if (msg.isStatus) return;

        // Esta linea la recibe el puente Baileys (el unico que descarga audios
        // y fotos). Si este tambien la reenviara, el agente correria dos veces
        // y el cliente recibiria cada respuesta duplicada.
        if (!reenviaEntrantes(sessionName)) return;

        // Route correctly if sent from phone: contact is msg.to, else msg.from
        const targetChat = msg.fromMe ? msg.to : msg.from;
        if (targetChat.endsWith('@g.us') || targetChat.endsWith('@broadcast')) return;

        console.log(`[${sessionName}] Mensaje (${msg.fromMe ? 'Saliente' : 'Entrante'}) para/de: ${targetChat}`);

        if (!msg.fromMe) {
            try {
                const chat = await msg.getChat();
                await chat.sendStateTyping();
            } catch {}
        }

        try {
            let mediaData = null;
            if (msg.hasMedia && (msg.type === 'audio' || msg.type === 'ptt' || msg.type === 'image')) {
                // Reintento con backoff: el primer intento puede fallar por un
                // frame efímeramente detached que se recupera. Probamos hasta 2 veces.
                let lastMediaErr = null;
                for (let intento = 1; intento <= 2; intento++) {
                    try {
                        const media = await msg.downloadMedia();
                        if (media?.data) {
                            mediaData = { data: media.data, mimetype: media.mimetype, filename: media.filename };
                            console.log(`[${sessionName}] Media descargada OK (type=${msg.type}, mimetype=${media.mimetype}, ${Math.round(media.data.length * 3/4 / 1024)}KB, intento=${intento})`);
                            lastMediaErr = null;
                            break;
                        } else {
                            console.warn(`[${sessionName}] Media sin data tras downloadMedia (type=${msg.type}, intento=${intento})`);
                        }
                    } catch (mediaErr) {
                        lastMediaErr = mediaErr;
                        // Captura RICA del error para diagnóstico (no solo .message que a veces da 'r').
                        const errType = mediaErr && mediaErr.constructor ? mediaErr.constructor.name : typeof mediaErr;
                        const errMsg = mediaErr && mediaErr.message ? mediaErr.message : String(mediaErr);
                        const errStack = mediaErr && mediaErr.stack ? String(mediaErr.stack).split('\n').slice(0, 3).join(' | ') : '';
                        console.error(`[${sessionName}] ERROR descargando media (type=${msg.type}, intento=${intento}/${2}): [${errType}] ${errMsg}${errStack ? ' || ' + errStack : ''}`);
                        if (intento < 2) {
                            await new Promise(r => setTimeout(r, 2000)); // backoff 2s antes de reintentar
                        }
                    }
                }
            } else if (msg.hasMedia) {
                // Tiene media pero no es audio/ptt/image: registramos el tipo para diagnóstico.
                console.log(`[${sessionName}] Mensaje con media de tipo no procesado: type=${msg.type}, hasMedia=${msg.hasMedia}`);
            }

            let customerName = '';
            try {
                const contact = await msg.getContact();
                customerName = contact.pushname || contact.name || '';
            } catch {}

            const webhookHeaders = { 'Content-Type': 'application/json' };
            if (BRIDGE_API_KEY) webhookHeaders['x-bridge-key'] = BRIDGE_API_KEY;

            const res = await fetch(`${APP_URL}/api/webhooks/whatsapp`, {
                method: 'POST',
                headers: webhookHeaders,
                body: JSON.stringify({
                    event: 'message.received',
                    line_key: sessionName,
                    data: {
                        message: {
                            id: msg.id._serialized,
                            from: msg.from,
                            to: msg.to,
                            fromMe: msg.fromMe,
                            body: msg.body,
                            type: msg.type,
                            media: mediaData,
                            mediaError: msg.hasMedia && !mediaData,
                            mediaType: msg.type,
                            customerName,
                        },
                    },
                }),
            });
            if (!res.ok) {
                console.error(`[${sessionName}] Error en webhook de recepción (status ${res.status}): ${await res.text()}`);
            }
        } catch (e) {
            console.error(`[${sessionName}] Error procesando mensaje (posible fallo de conexión a ${APP_URL}):`, e.message);
        }
    });

    client.initialize().catch(err => {
        console.error(`[${sessionName}] Error inicializando:`, err.message);
        sessions.delete(sessionName);
    });

    return sessionObj;
}

// ============================================================
// API ROUTES
// ============================================================

// Health check
app.get('/health', (req, res) => {
    const status = {};
    for (const [key, val] of sessions.entries()) {
        status[key] = { status: val.status, hasQr: !!val.lastQr };
    }
    res.json({ ok: true, sessions: status });
});

// ── NUEVO (seguimiento): diagnóstico detallado por línea. SOLO LECTURA.
// Devuelve, por cada línea: estado, desde cuándo conectada, último error,
// contador de errores del keep-alive, y si la sesión persistente existe en disco.
// No realiza ninguna acción sobre las sesiones — solo observa y reporta.
app.get('/diagnostic', (req, res) => {
    const out = {};
    // 1) Sesiones cargadas en memoria
    for (const [key, val] of sessions.entries()) {
        out[key] = {
            loaded: true,
            status: val.status,
            connectedAt: val.connectedAt,
            phoneNumber: val.phoneNumber,
            lastError: val.lastError,
            lastErrorAt: val.lastErrorAt,
            keepAliveErrors: val.keepAliveErrors || 0,
            hasQr: !!val.lastQr,
            sessionOnDisk: fs.existsSync(path.join(SESSION_DATA_PATH, 'session-' + key)),
        };
    }
    // 2) Líneas que cayeron (no están en memoria pero tenemos su última info)
    for (const [key, info] of lastDisconnectInfo.entries()) {
        if (!out[key]) {
            out[key] = {
                loaded: false,
                status: 'disconnected',
                lastDisconnectReason: info.reason,
                lastErrorAt: info.at,
                sessionOnDisk: fs.existsSync(path.join(SESSION_DATA_PATH, 'session-' + key)),
            };
        }
    }
    res.json({ ok: true, sessions: out, bridgeTime: new Date().toISOString() });
});

// Start a session
app.post('/api/sessions/:session/start', (req, res) => {
    const auth = validateApiKey(req, res);
    if (auth !== true) return;
    const sessionName = req.params.session;
    try {
        startSession(sessionName);
        res.json({ success: true, message: `Iniciando "${sessionName}"` });
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// Get current QR for a session (pull model fallback if push callback failed)
app.get('/api/sessions/:session/qr', (req, res) => {
    const auth = validateApiKey(req, res);
    if (auth !== true) return;
    const sessionName = req.params.session;
    const sessionObj = sessions.get(sessionName);
    if (!sessionObj) {
        return res.status(404).json({ error: 'Session not found or not started.' });
    }
    if (sessionObj.status === 'connected') {
        return res.json({ status: 'connected', qr: null });
    }
    if (!sessionObj.lastQr) {
        return res.json({ status: sessionObj.status, qr: null, message: 'QR not yet generated. Wait a few seconds.' });
    }
    res.json({ status: sessionObj.status, qr: sessionObj.lastQr });
});

// Send message
app.post('/api/sessions/:session/messages/send-text', async (req, res) => {
    const auth = validateApiKey(req, res);
    if (auth !== true) return;
    const sessionName = req.params.session;
    let { chatId, text } = req.body;

    if (chatId) {
        chatId = String(chatId).replace('+', '').replace(/\s/g, '');
        if (!chatId.includes('@')) chatId = chatId + '@c.us';
    }

    const sessionObj = sessions.get(sessionName);
    if (!sessionObj || sessionObj.status !== 'connected') {
        return res.status(400).json({ error: `Sesión "${sessionName}" no está activa.` });
    }

    try {
        const client = sessionObj.client;
        try {
            const chat = await client.getChatById(chatId);
            await chat.sendStateTyping();
            await new Promise(r => setTimeout(r, 1500));
            await chat.clearState();
        } catch {}
        // Se devuelve el identificador REAL de WhatsApp, no uno inventado.
        // Con 'sent_' + Date.now() la app guardaba un id que jamas volvia a
        // ver, asi que cuando el propio puente reenviaba este mismo mensaje por
        // message_create no podia reconocerlo como repetido y la respuesta
        // quedaba DOS VECES en el panel (86 casos medidos el 30-Jul-2026).
        const sentMsg = await client.sendMessage(chatId, String(text));
        res.json({ data: { id: sentMsg?.id?._serialized || ('sent_' + Date.now()) } });
    } catch (e) {
        console.error(`[${sessionName}] Error al enviar:`, e.message);
        res.status(500).json({ error: e.toString() });
        if (e.message?.includes('detached Frame')) {
            try { sessionObj.client.destroy(); } catch {}
            if (sessionObj.intervalId) clearInterval(sessionObj.intervalId);
            sessions.delete(sessionName);
        }
    }
});

// Send media (image/pdf/etc) from URL
app.post('/api/sessions/:session/messages/send-media', async (req, res) => {
    const auth = validateApiKey(req, res);
    if (auth !== true) return;
    const sessionName = req.params.session;
    let { chatId, mediaUrl, caption } = req.body;

    if (chatId) {
        chatId = String(chatId).replace('+', '').replace(/\s/g, '');
        if (!chatId.includes('@')) chatId = chatId + '@c.us';
    }

    const sessionObj = sessions.get(sessionName);
    if (!sessionObj || sessionObj.status !== 'connected') {
        return res.status(400).json({ error: 'Sesión "' + sessionName + '" no está activa.' });
    }

    try {
        const client = sessionObj.client;
        try {
            const chat = await client.getChatById(chatId);
            await chat.sendStateTyping();
            await new Promise(r => setTimeout(r, 1500));
            await chat.clearState();
        } catch {}

        let fullMediaUrl = mediaUrl;
        if (mediaUrl.startsWith('/')) {
            fullMediaUrl = APP_URL + mediaUrl;
        }

        console.log('[' + sessionName + '] Enviando media desde URL: ' + fullMediaUrl);
        let media;
        try {
            media = await MessageMedia.fromUrl(fullMediaUrl, { unsafeMime: true });
        } catch (urlErr) {
            console.warn('[' + sessionName + '] MessageMedia.fromUrl fallo (' + urlErr.message + '), intentando fallback con fetch...');
            const fetchRes = await fetch(fullMediaUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
            if (!fetchRes.ok) throw new Error(`HTTP ${fetchRes.status} al descargar media de ${fullMediaUrl}`);
            const arrayBuf = await fetchRes.arrayBuffer();
            const mimeType = fetchRes.headers.get('content-type') || 'image/jpeg';
            const base64Data = Buffer.from(arrayBuf).toString('base64');
            media = new MessageMedia(mimeType, base64Data, 'imagen.jpg');
        }
        const sentMsg = await client.sendMessage(chatId, media, { caption: caption || '' });
        res.json({ data: { id: sentMsg?.id?._serialized || ('sent_media_' + Date.now()) } });
    } catch (e) {
        console.error('[' + sessionName + '] Error al enviar media:', e.message);
        res.status(500).json({ error: e.toString() });
        if (e.message?.includes('detached Frame')) {
            try { sessionObj.client.destroy(); } catch {}
            if (sessionObj.intervalId) clearInterval(sessionObj.intervalId);
            sessions.delete(sessionName);
        }
    }
});

// Logout a session
app.post('/api/sessions/:session/logout', async (req, res) => {
    const auth = validateApiKey(req, res);
    if (auth !== true) return;
    const sessionName = req.params.session;
    const sessionObj = sessions.get(sessionName);
    if (!sessionObj) return res.json({ success: true, message: 'Sesión no estaba activa.' });

    try {
        if (sessionObj.intervalId) clearInterval(sessionObj.intervalId);
        try { await sessionObj.client.logout(); } catch {}
        try { await sessionObj.client.destroy(); } catch {}
        sessions.delete(sessionName);
        // Delete local session data from the volume
        const sessionDir = path.join(SESSION_DATA_PATH, `session-${sessionName}`);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`[${sessionName}] Sesión eliminada del volumen: ${sessionDir}`);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// Chat history
app.get('/api/sessions/:session/chats/:chatId/history', async (req, res) => {
    const auth = validateApiKey(req, res);
    if (auth !== true) return;
    const sessionName = req.params.session;
    let { chatId } = req.params;
    const limit = parseInt(req.query.limit) || 15;
    if (!chatId.includes('@')) chatId = chatId.replace('+', '') + '@c.us';

    const sessionObj = sessions.get(sessionName);
    if (!sessionObj) return res.status(400).json({ error: `Sesión "${sessionName}" no activa.` });

    try {
        const chat = await sessionObj.client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit });
        res.json({ success: true, messages: messages.map(m => ({
            id: m.id._serialized, from: m.from, to: m.to, body: m.body,
            timestamp: m.timestamp * 1000, fromMe: m.fromMe, type: m.type
        }))});
    } catch (e) {
        res.status(500).json({ error: e.toString() });
    }
});

// ============================================================
// AUTOLOAD — Reconnect previously connected lines on startup
// ============================================================
async function autoload() {
    if (!supabase) return;
    try {
        console.log('[AUTOLOAD] Consultando líneas activas en Supabase...');
        const { data: lines, error } = await supabase
            .from('whatsapp_lines')
            .select('line_key, status');

        if (error) throw error;

        const connectedLines = (lines || []).filter(l => l.status === 'connected');
        console.log(`[AUTOLOAD] ${connectedLines.length} línea(s) para reconectar.`);

        for (const line of connectedLines) {
            // Check if a local session exists on the volume (LocalAuth)
            const sessionDir = path.join(SESSION_DATA_PATH, `session-${line.line_key}`);
            const hasLocalSession = fs.existsSync(sessionDir);

            if (hasLocalSession) {
                console.log(`[AUTOLOAD] Sesión encontrada en volumen: ${sessionDir} — Reconectando: ${line.line_key}`);
                startSession(line.line_key);
            } else {
                console.log(`[AUTOLOAD] Sin sesión en volumen para: ${line.line_key} — necesita QR.`);
                // Update status to disconnected so the panel shows the QR button
                await supabase.from('whatsapp_lines').update({ status: 'disconnected' }).eq('line_key', line.line_key);
            }
        }
    } catch (err) {
        console.error('[AUTOLOAD] Error:', err.message);
    }
}

// ============================================================
// START SERVER
// ============================================================
const PORT = parseInt(process.env.PORT || '3004');
app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(` Servidor WhatsApp Multi-Sesión — Puerto ${PORT}`);
    console.log(` APP_URL: ${APP_URL}`);
    console.log(`==================================================\n`);
    // Purge Chromium caches BEFORE starting sessions to free volume space.
    // Only auth tokens are preserved; Cache/Code Cache/GPUCache are wiped.
    purgeChromiumCaches();
    // List session directories for diagnostics
    listSessionDirs();
    autoload();
});
