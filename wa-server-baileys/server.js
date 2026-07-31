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
/**
 * Paquete `baileys` 7.x, no `@whiskeysockets/baileys` 6.x.
 *
 * POR QUE SE SUBIO DE VERSION (2026-07-31)
 * ----------------------------------------
 * Con 6.7.24 el puente RECIBIA bien pero NINGUN mensaje enviado llegaba al
 * cliente. `sendMessage()` se resolvia sin error y devolvia un id valido, y
 * WhatsApp lo rechazaba despues, en el acuse:
 *   attrs: { from: '...', class: 'message', error: '463' }
 *
 * El 463 es `NackCallerReachoutTimelocked`, el candado de privacidad de
 * WhatsApp. Se dispara porque el `<message>` sale SIN su nodo hijo `<tctoken>`
 * (Trusted Contact Token). Comprobado en el codigo de las dos versiones:
 *   6.7.24 -> `tctoken` aparece 0 veces en Socket/messages-send, y no existe
 *             el fichero Utils/tc-token-utils. La rama 6.x nunca lo tendra.
 *   7.0.0-rc13 -> 11 ocurrencias de `tctoken` en messages-send, existe
 *             tc-token-utils.js y se consulta `privacyTokenOn1to1`.
 *
 * Explica lo que no encajaba: fallaban por igual el @lid y el telefono (la
 * direccion no era la variable), y el puente viejo con Puppeteer si entrega
 * porque el WhatsApp Web autentico emite esos tokens de forma nativa.
 *
 * Se elige rc13 y no rc14 a proposito: rc13 lleva meses en uso y es la version
 * con la que otros confirmaron que el 463 desaparece; rc14 se publico sin
 * notas de version.
 *
 * `require()` sigue funcionando pese a que el paquete es ESM: Node 20 lo
 * admite. Se comprobo antes de migrar, asi que NO hizo falta reescribir el
 * puente entero a modulos ESM.
 */
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

// Antes se abortaba con la lista vacía. Se quitó a propósito: vacía ahora
// significa TODAS las líneas, las de hoy y las que se conecten mañana. Con la
// lista enumerada, cualquier línea nueva quedaba fuera y el puente la ignoraba
// en silencio, que es justo lo que no puede pasar con 8 líneas por delante.
if (BRIDGE_LINES.length === 0) {
    logger.info('BRIDGE_LINES vacío: este puente atiende TODAS las líneas.');
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
    /** Mensajes que WhatsApp acepto y luego rechazo en el acuse. */
    acks_rechazados: 0,
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

// ============================================================
// CORRESPONDENCIA @lid -> TELEFONO
// ============================================================

/**
 * WhatsApp puede identificar un chat por `@lid`, un identificador interno que
 * NO es un telefono. Enviar a esa direccion parece funcionar —Baileys resuelve
 * el envio sin error y devuelve un id— pero WhatsApp lo RECHAZA despues con un
 * acuse `error: 463` y el mensaje nunca se entrega.
 *
 * Medido en produccion el 2026-07-30, con el bot respondiendo en el panel pero
 * sin que llegara nada al telefono del cliente:
 *   from: 181290854776961@lid  class: message  error: 463  "received error in ack"
 *
 * Baileys 6.7.24 SI trae el telefono real en la clave del mensaje entrante
 * (`key.senderPn`, del atributo `sender_pn` del stanza). Aqui se guarda esa
 * correspondencia en disco al recibir, y se usa al enviar. Persiste en el
 * volumen para sobrevivir a un reinicio del contenedor.
 */
// ============================================================
// CONFIRMACION DE ENTREGA — acuses rechazados
// ============================================================

/**
 * WhatsApp puede ACEPTAR el envio y rechazarlo despues, en el acuse:
 *
 *   {"attrs":{"from":"573015745403@s.whatsapp.net","class":"message",
 *     "id":"3EB0F0DEC619DA17B1EAB1","error":"463"},"msg":"received error in ack"}
 *
 * `sock.sendMessage()` ya se resolvio sin error y devolvio un id valido, asi
 * que ni el puente ni la app se enteran: la app guarda la respuesta como
 * enviada y el panel muestra un mensaje que el cliente NUNCA recibio. Eso es
 * exactamente lo que el panel no debe hacer.
 *
 * Baileys no emite esos rechazos como evento; solo los escribe en su registro.
 * Asi que se envuelve el registro que se le pasa, se capturan los acuses con
 * error y se espera brevemente por el del mensaje recien enviado antes de
 * responderle a la app. Medido: el rechazo llega entre 2 y 3 segundos despues.
 */
const acksFallidos = new Map(); // id de mensaje -> { error, at }

function registrarAckFallido(line, attrs) {
    if (!attrs?.id) return;
    acksFallidos.set(String(attrs.id), { error: String(attrs.error || '?'), at: Date.now() });
    metrics.acks_rechazados++;
    logger.error(
        { line, id: attrs.id, error: attrs.error, destino: attrs.from },
        'WhatsApp RECHAZO el mensaje en el acuse: el cliente no lo recibio'
    );
    // Se limpian los viejos para que el mapa no crezca sin fin.
    const limite = Date.now() - 120000;
    for (const [k, v] of acksFallidos) if (v.at < limite) acksFallidos.delete(k);
}

/** Espera un rechazo para ese id. Devuelve el fallo, o null si no llego. */
async function esperarRechazo(id, ms = 4000) {
    if (!id) return null;
    const hasta = Date.now() + ms;
    while (Date.now() < hasta) {
        const f = acksFallidos.get(String(id));
        if (f) return f;
        await new Promise(r => setTimeout(r, 200));
    }
    return null;
}

/**
 * Envuelve el registro de Baileys para poder ver los acuses rechazados sin
 * tocar la libreria. Todo lo demas pasa tal cual.
 */
function registroQueVigilaAcks(base, alFallar) {
    const niveles = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    return new Proxy(base, {
        get(target, prop) {
            if (prop === 'child') {
                return (...a) => registroQueVigilaAcks(target.child(...a), alFallar);
            }
            const v = target[prop];
            if (typeof v === 'function' && niveles.includes(prop)) {
                return (...args) => {
                    try {
                        const obj = args[0];
                        const texto = String(args[1] || '');
                        if (
                            obj && typeof obj === 'object' && obj.attrs && obj.attrs.error &&
                            texto.toLowerCase().includes('error in ack')
                        ) {
                            alFallar(obj.attrs);
                        }
                    } catch { /* vigilar no puede romper el registro */ }
                    return v.apply(target, args);
                };
            }
            return typeof v === 'function' ? v.bind(target) : v;
        },
    });
}

const lidMaps = new Map(); // line -> { '<lid>': '<telefono@s.whatsapp.net>' }

function lidMapPath(line) {
    return path.join(STORE_ROOT, line, '_lid_map.json');
}

function loadLidMap(line) {
    if (lidMaps.has(line)) return lidMaps.get(line);
    let map = {};
    try {
        const f = lidMapPath(line);
        if (fs.existsSync(f)) map = JSON.parse(fs.readFileSync(f, 'utf8') || '{}');
    } catch (e) {
        logger.warn({ err: e.message, line }, 'No se pudo leer la correspondencia @lid');
    }
    lidMaps.set(line, map);
    return map;
}

/** Guarda el telefono real que WhatsApp adjunta a un mensaje de un chat @lid. */
function recordLidMapping(line, msg) {
    try {
        const k = msg.key || {};
        const lid = k.remoteJid && String(k.remoteJid).endsWith('@lid') ? k.remoteJid : null;
        if (!lid) return;

        const pnCrudo = k.senderPn || k.participantPn || null;
        if (!pnCrudo) return;

        const pn = normalizeJid(pnCrudo);
        if (!pn || pn.endsWith('@lid')) return;

        const map = loadLidMap(line);
        if (map[lid] === pn) return;

        map[lid] = pn;
        const f = lidMapPath(line);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(map, null, 2));
        logger.info({ line, lid, telefono: pn }, 'Aprendido el telefono real de un chat @lid');
    } catch (e) {
        logger.warn({ err: e.message, line }, 'No se pudo guardar la correspondencia @lid');
    }
}

/**
 * Direccion a la que se debe ENVIAR de verdad.
 * Devuelve { jid, problema } — si es un @lid del que no se conoce el telefono,
 * `problema` explica por que no se puede entregar, en vez de fingir un envio.
 */
function resolveSendJid(line, chatId) {
    const jid = normalizeJid(chatId);
    if (!jid.endsWith('@lid')) return { jid, problema: null };

    const map = loadLidMap(line);
    const pn = map[jid];
    if (pn) return { jid: pn, problema: null };

    return {
        jid,
        problema:
            `El destinatario ${jid} es un identificador interno (@lid) y todavia no se conoce su ` +
            `telefono real. WhatsApp rechaza los envios a esa direccion con error 463. Se aprende ` +
            `en cuanto esa persona escriba una vez a esta linea.`,
    };
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
    // Lista vacía = este puente atiende todas las líneas.
    if (BRIDGE_LINES.length === 0) {
        if (sessionName && sessionName !== 'default') return sessionName;
        // 'default' solo se puede adivinar si hay exactamente una sesión viva.
        const vivas = [...sessions.keys()];
        return vivas.length === 1 ? vivas[0] : null;
    }
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

/**
 * Telefono real del remitente, en digitos, o cadena vacia.
 *
 * Tres fuentes, de la mas fiable a la menos: lo que trae este mensaje, lo que
 * se aprendio antes de ese mismo chat @lid, o el propio `remoteJid` cuando ya
 * es un telefono normal.
 */
function telefonoRealDe(msg, line) {
    const k = msg.key || {};
    const candidatos = [k.senderPn, k.participantPn];

    const jid = k.remoteJid || '';
    if (jid.endsWith('@lid')) {
        try {
            candidatos.push(loadLidMap(line)[jid]);
        } catch { /* el mapa aun no existe: no es un error */ }
    } else {
        candidatos.push(jid);
    }

    for (const c of candidatos) {
        if (!c) continue;
        const digitos = String(c).split('@')[0].split(':')[0].replace(/\D/g, '');
        if (/^\d{7,15}$/.test(digitos)) return digitos;
    }
    return '';
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
                /**
                 * TELEFONO REAL del cliente, en digitos.
                 *
                 * `from` puede ser un `@lid`: un identificador interno de
                 * WhatsApp de 14-15 digitos que NO es un telefono y del que no
                 * se puede deducir el numero. El panel lo mostraba crudo
                 * (`181290854776961@lid`) como si fuera el contacto.
                 *
                 * WhatsApp adjunta el telefono de verdad en la clave del
                 * mensaje, y el puente ya lo venia aprendiendo... pero solo
                 * para si mismo, para poder responder. Aqui se lo pasa tambien
                 * a la app, que es quien nombra al contacto en el CRM.
                 *
                 * Vacio cuando WhatsApp no lo entrega y tampoco se aprendio
                 * antes: en ese caso la app se queda con lo que ya tenia, sin
                 * inventar nada.
                 */
                senderPhone: telefonoRealDe(msg, lineKey),
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
/**
 * ¿Esta línea tiene credenciales, o está a la espera de que alguien escanee?
 *
 * Es la diferencia entre reconectar y NO reconectar. Una línea vinculada que se
 * cae debe volver sola. Una línea SIN vincular no: no hay nada a lo que volver,
 * y reintentar solo genera códigos QR que nadie está mirando.
 */
function tieneCredenciales(line) {
    try {
        return fs.existsSync(path.join(authDir(line), 'creds.json'));
    } catch {
        return false;
    }
}

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
    // Con BRIDGE_LINES vacía la compuerta queda abierta: atiende todas.
    if (BRIDGE_LINES.length > 0 && !BRIDGE_LINES.includes(line)) {
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
            version,
            // Registro vigilado: es la unica forma de enterarse de que WhatsApp
            // rechazo un mensaje en el acuse, porque Baileys no lo emite como
            // evento y `sendMessage` ya se resolvio como si todo fuera bien.
            logger: registroQueVigilaAcks(logger.child({ line }), attrs => registrarAckFallido(line, attrs)),
            browser: Browsers.macOS('Desktop'),

            // La sincronización de historial completo rompía la sesión por
            // timeout en cuentas con mucho historial (probado el 23-jul-2026).
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

                /**
                 * LÍNEA SIN VINCULAR: se detiene, no se reintenta.
                 *
                 * Cuando no hay credenciales, este cierre es casi siempre el QR
                 * que expiró ("QR refs attempts ended"). Reconectar genera otro
                 * QR, que expira, que reconecta… Medido el 01-ago-2026 con una
                 * línea desvinculada: **14 códigos QR en 30 minutos**, sockets
                 * recreados sin fin, con nadie mirando esa pantalla.
                 *
                 * No es solo gasto: es reconectarse en bucle a los servidores de
                 * WhatsApp desde la misma IP, justo la conducta que provoca los
                 * bloqueos de cuenta que ya hemos sufrido.
                 *
                 * La línea queda dormida y el socket se abre SOLO cuando alguien
                 * pide el QR desde el panel (`/api/sessions/:linea/qr` o
                 * `/start`). Una línea ya vinculada sí se reconecta sola, que es
                 * lo que corresponde.
                 */
                if (!tieneCredenciales(line)) {
                    st.status = 'logged_out';
                    st.lastQR = null;
                    st.lastQRDataUrl = null;
                    st.lastError = 'Sin vincular: el QR se genera cuando lo pidas desde el panel.';
                    st.lastErrorAt = new Date().toISOString();
                    logger.info(
                        { line, statusCode },
                        'Línea sin vincular: se deja dormida en vez de generar QR en bucle'
                    );
                    await callbackToApp('/api/whatsapp-lines/status', { line_key: line, status: 'disconnected' });
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

/**
 * Memoria corta de mensajes ya entregados a la app, por (linea, id).
 *
 * No se guarda en disco a proposito: solo tiene que cubrir la ventana en la
 * que WhatsApp reemite el mismo mensaje, que es de segundos. La app conserva
 * su propia idempotencia para lo demas.
 */
const entregados = new Map(); // `${line}:${id}` -> timestamp
const VENTANA_DUPLICADOS_MS = 10 * 60 * 1000;

function yaEntregado(line, id) {
    if (!id) return false;
    const clave = `${line}:${id}`;
    const ahora = Date.now();

    // Limpieza perezosa: evita que el mapa crezca sin fin con 8 lineas activas.
    if (entregados.size > 2000) {
        for (const [k, t] of entregados) {
            if (ahora - t > VENTANA_DUPLICADOS_MS) entregados.delete(k);
        }
    }

    const visto = entregados.get(clave);
    if (visto && ahora - visto < VENTANA_DUPLICADOS_MS) return true;
    entregados.set(clave, ahora);
    return false;
}

async function handleIncoming(line, msg, sock) {
    const jid = msg.key.remoteJid;
    if (!jid) return;
    if (isJidGroup(jid) || isJidBroadcast(jid) || jid === 'status@broadcast') return;
    if (!msg.message) return;

    metrics.messages_received++;
    const fromMe = msg.key.fromMe === true;

    // Se aprende el telefono real del chat ANTES de nada: es lo unico que
    // permite responderle a un contacto @lid sin que WhatsApp lo rechace.
    recordLidMapping(line, msg);

    // ── Un mensaje, una entrega ─────────────────────────────────────────────
    // WhatsApp reemite el MISMO mensaje mas de una vez: primero sin resolver
    // el telefono (`senderPn: null`) y de nuevo cuando ya lo conoce. Medido el
    // 31-jul-2026: la misma nota de voz llego dos veces con 750 ms de
    // diferencia, se transcribio dos veces y el cliente recibio la cotizacion
    // duplicada.
    //
    // La segunda copia sigue siendo util para APRENDER el telefono (arriba, ya
    // se hizo), pero no debe volver a entrar al agente. Se descarta aqui, en el
    // puente, que es donde nace el duplicado: si se filtrara mas adelante, cada
    // copia habria gastado ya descarga, transcripcion y modelo.
    if (yaEntregado(line, msg.key.id)) {
        logger.info(
            { line, id: msg.key.id, senderPn: msg.key.senderPn || null },
            'Reemision del mismo mensaje: se aprende el telefono y se descarta'
        );
        return;
    }

    // Trazas de la clave, para poder diagnosticar el direccionamiento sin
    // tener que pedirle al dueno que repita la prueba.
    logger.info(
        {
            line,
            remoteJid: msg.key.remoteJid,
            senderPn: msg.key.senderPn || null,
            senderLid: msg.key.senderLid || null,
            participantPn: msg.key.participantPn || null,
            fromMe,
        },
        'Mensaje recibido'
    );

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
    // Con BRIDGE_LINES vacía hay que describir las sesiones REALES, no una
    // lista fija: si no, el panel vería el puente sin líneas y las daría por
    // caídas estando sanas.
    const lineas = BRIDGE_LINES.length > 0 ? BRIDGE_LINES : [...sessions.keys()];
    for (const line of lineas) {
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
            // Cuantos contactos @lid tienen ya su telefono real aprendido. Sin
            // el, WhatsApp rechaza los envios a ese contacto con error 463.
            telefonosAprendidos: Object.keys(loadLidMap(line)).length,
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
        // Pedir el QR es la señal de que alguien SÍ está mirando: se despierta
        // la línea dormida. Sin esto quedaría en silencio para siempre.
        if (!st.sock) {
            logger.info({ line }, 'QR solicitado desde el panel: se despierta la línea');
            startSession(line, 'qr-solicitado').catch(e =>
                logger.error({ err: e.message, line }, 'Fallo al despertar la línea')
            );
        }
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
        // Nada de reconectar aquí: se acaba de desvincular a propósito. Si se
        // reconectara, empezaría a emitir QR sin que nadie los mire. El socket
        // vuelve cuando el panel pida el QR.
        st.status = 'logged_out';
        st.lastError = 'Desvinculada. Pide el QR desde el panel para volver a conectarla.';
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

    // Un @lid sin telefono conocido se rechaza AQUI. Antes se enviaba igual,
    // Baileys devolvia un id valido y la app daba la respuesta por entregada,
    // mientras WhatsApp la tiraba con error 463 y el cliente no recibia nada.
    const destino = resolveSendJid(line, chatId);
    if (destino.problema) {
        logger.error({ line, chatId, jid: destino.jid }, destino.problema);
        return res.status(503).json({ error: destino.problema });
    }
    const jid = destino.jid;

    try {
        await typing(st.sock, jid);
        const sent = await st.sock.sendMessage(jid, { text: content });
        const idReal = sent?.key?.id;

        // No basta con que sendMessage no falle: WhatsApp puede rechazarlo
        // despues, en el acuse. Se espera ese rechazo antes de decirle a la app
        // que se entrego, o el panel mostraria una respuesta fantasma.
        const rechazo = await esperarRechazo(idReal);
        if (rechazo) {
            metrics.send_errors++;
            const detalle = `WhatsApp aceptó el mensaje y lo rechazó en el acuse (error ${rechazo.error}). El cliente NO lo recibió.`;
            logger.error({ line, jid, id: idReal, error: rechazo.error }, detalle);
            return res.status(502).json({ error: detalle, ack_error: rechazo.error });
        }

        metrics.text_sent++;
        // El id REAL de WhatsApp: es lo que apaga el eco del puente.
        res.json({ data: { id: idReal || `baileys_${Date.now()}` } });
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

    const destino = resolveSendJid(line, chatId);
    if (destino.problema) {
        logger.error({ line, chatId, jid: destino.jid }, destino.problema);
        return res.status(503).json({ error: destino.problema });
    }
    const jid = destino.jid;
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
        const idReal = sent?.key?.id;

        const rechazo = await esperarRechazo(idReal);
        if (rechazo) {
            metrics.send_errors++;
            const detalle = `WhatsApp aceptó la foto y la rechazó en el acuse (error ${rechazo.error}). El cliente NO la recibió.`;
            logger.error({ line, jid, id: idReal, error: rechazo.error }, detalle);
            return res.status(502).json({ error: detalle, ack_error: rechazo.error });
        }

        metrics.media_sent++;
        logger.info({ line, jid, mime, kb: Math.round(buf.length / 1024) }, 'Media enviada');
        res.json({ data: { id: idReal || `baileys_media_${Date.now()}` } });
    } catch (err) {
        metrics.send_errors++;
        logger.error({ err: err.message, line, jid, fullUrl }, 'Error enviando media');
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ARRANQUE
// ============================================================

/**
 * Líneas registradas en el panel, según Supabase. Se consulta por HTTP para no
 * añadir dependencias al puente.
 */
async function lineasEnLaBase() {
    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) {
        logger.warn('Sin credenciales de Supabase: no se pueden descubrir las líneas registradas.');
        return [];
    }
    try {
        const r = await fetch(`${url}/rest/v1/whatsapp_lines?select=line_key`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()).map((l) => l.line_key).filter(Boolean);
    } catch (e) {
        logger.error({ err: e.message }, 'No se pudieron leer las líneas registradas');
        return [];
    }
}

/**
 * Arranque de líneas, con UNA sola regla para todas.
 *
 * El puente atiende toda línea registrada en el panel, tenga o no sesión:
 *   - con credenciales en disco -> se reconecta sola;
 *   - sin credenciales          -> queda declarada y pidiendo QR.
 *
 * Declararlas todas importa: antes, una línea sin sesión sencillamente no
 * existía para el puente, y el panel la pintaba distinta de sus hermanas
 * estando en la misma situación. Con 8 líneas eso es inmanejable.
 */
async function arrancarLineas() {
    let enDisco = [];
    try {
        enDisco = fs
            .readdirSync(SESSIONS_ROOT, { withFileTypes: true })
            .filter((d) => d.isDirectory() && d.name.startsWith('session-'))
            .map((d) => d.name.slice('session-'.length))
            .filter(Boolean)
            // Que exista la CARPETA no significa que la línea esté vinculada:
            // al desvincular queda vacía. Si se arrancaba por la carpeta, la
            // línea volvía a levantarse y a pedir QR en cada reinicio, sin que
            // nadie estuviera mirando. Lo que decide es `creds.json`.
            .filter((line) => tieneCredenciales(line));
    } catch (e) {
        logger.error({ err: e.message }, 'No se pudieron listar las sesiones en disco');
    }

    const registradas = BRIDGE_LINES.length > 0 ? BRIDGE_LINES.slice() : await lineasEnLaBase();
    const todas = [...new Set([...registradas, ...enDisco])];

    logger.info(
        { registradas, enDisco, todas },
        `Atendiendo ${todas.length} línea(s): ${enDisco.length} con sesión, ${todas.length - enDisco.length} pendiente(s) de QR`
    );

    for (const line of todas) {
        sessions.set(line, blankState());
        if (enDisco.includes(line)) {
            startSession(line).catch((e) => logger.error({ err: e.message, line }, 'Fallo al arrancar la línea'));
        } else {
            // Sin credenciales no se abre socket: se deja declarada para que el
            // panel la muestre con su causa real ("falta vincular") en vez de
            // omitirla como si no existiera.
            const st = sessions.get(line);
            st.status = 'logged_out';
            st.lastError = 'Sin sesión vinculada: hay que escanear el QR';
        }
    }
}

app.listen(PORT, () => {
    logger.info(
        { port: PORT, lines: BRIDGE_LINES, appUrl: APP_URL, forwarding: FORWARDING_ENABLED },
        'Puente Baileys escuchando'
    );
    fs.mkdirSync(SESSIONS_ROOT, { recursive: true });
    fs.mkdirSync(STORE_ROOT, { recursive: true });

    arrancarLineas().catch((e) => logger.error({ err: e.message }, 'Fallo en el arranque de líneas'));
});
