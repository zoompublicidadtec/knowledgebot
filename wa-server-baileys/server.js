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
 *   POST /api/sessions/:s/messages/send-text   { chatId, message|text,
 *                                                 quoted?: {id, fromMe, texto} }
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
    // Las dos que usa el manejador propio de `stream:error` (ver startSession):
    // son las MISMAS que usa Baileys por dentro, no una copia nuestra.
    getAllBinaryNodeChildren,
    getErrorCodeFromStreamError,
    // Para reconocer la copia ilegible de un mensaje propio y acusarle
    // recibo (ver `acusarCopiaPropiaIlegible`).
    proto,
    isJidUser,
} = require('@whiskeysockets/baileys');
// Baileys reporta el motivo del corte como un Boom, y `connection.update` lee
// `lastDisconnect.error.output.statusCode`. Con un Error pelado se perderia.
const { Boom } = require('@hapi/boom');
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
    // Cuantas veces se ignoro un acuse repetido de WhatsApp en vez de tirar la
    // conexion. Si este numero sube y las lineas siguen conectadas, el arreglo
    // esta trabajando. Se ve en GET /metrics.
    acuses_ignorados: 0,
    // Copias ilegibles de mensajes propios a las que se les acuso recibo
    // para que WhatsApp dejara de reenviarlas. Si este numero sube y los
    // cortes cada ~50 min desaparecen, el arreglo esta trabajando.
    copias_propias_acusadas: 0,
    copias_propias_sin_acusar: 0,
    // Cuantas copias ilegibles se VIERON, se hayan podido acusar o no. Separar
    // «vistas» de «acusadas» es lo que permite distinguir «no llegan a mi
    // funcion» de «llegan y el acuse falla». Sin esa separacion, el 12-ago el
    // contador marcaba 0 y no habia forma de saber cual de las dos pasaba.
    copias_propias_vistas: 0,
    webhooks_sent: 0,
    webhooks_suppressed_shadow: 0,
    webhooks_failed: 0,
    text_sent: 0,
    media_sent: 0,
    send_errors: 0,
    /** Mensajes que WhatsApp acepto y luego rechazo en el acuse. */
    acks_rechazados: 0,
    /**
     * Chats que NO son personas (canales, grupos, difusiones, estados): no se
     * reenvian y no abren ficha en el CRM. Se publica el desglose por dominio
     * para que un tipo de chat nuevo de WhatsApp se vea el mismo dia en
     * /diagnostic, en vez de colarse en el panel disfrazado de cliente.
     */
    chats_no_persona: 0,
    chats_no_persona_por_dominio: {},
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
function registroQueVigilaAcks(base, alFallar, line) {
    const niveles = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    return new Proxy(base, {
        get(target, prop) {
            if (prop === 'child') {
                return (...a) => registroQueVigilaAcks(target.child(...a), alFallar, line);
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
                        detectarRestriccion(line, obj);
                    } catch { /* vigilar no puede romper el registro */ }
                    return v.apply(target, args);
                };
            }
            return typeof v === 'function' ? v.bind(target) : v;
        },
    });
}

/**
 * ¿Ese remitente es otra de NUESTRAS líneas?
 *
 * Se compara contra los números que el propio puente tiene conectados. Si un
 * `@lid` no trae teléfono, se busca en el mapa aprendido de cada línea.
 * Devuelve el nombre de la línea propia, o null.
 */
function esLineaPropia(remitenteJid, lineaQueRecibe) {
    if (!remitenteJid) return null;
    const soloDigitos = (j) => String(j || '').split('@')[0].replace(/\D/g, '');
    const numero = soloDigitos(remitenteJid);
    if (!numero) return null;

    for (const [otraLinea, otroSt] of sessions) {
        if (otraLinea === lineaQueRecibe) continue;
        if (otroSt?.phoneNumber && soloDigitos(otroSt.phoneNumber) === numero) return otraLinea;
    }

    // El remitente puede venir como @lid: se mira el telefono aprendido.
    if (remitenteJid.endsWith('@lid')) {
        const aprendido = loadLidMap(lineaQueRecibe)[remitenteJid];
        if (aprendido) return esLineaPropia(aprendido, lineaQueRecibe);
    }
    return null;
}

/** Saca el texto de un nodo de WhatsApp, venga como Buffer o serializado. */
function textoDeNodo(nodo) {
    const partes = [];
    const visitar = (n) => {
        if (!n) return;
        if (Array.isArray(n)) return n.forEach(visitar);
        if (Buffer.isBuffer(n)) return void partes.push(n.toString('utf8'));
        if (n.type === 'Buffer' && Array.isArray(n.data)) {
            return void partes.push(Buffer.from(n.data).toString('utf8'));
        }
        if (typeof n === 'object') return visitar(n.content);
    };
    visitar(nodo);
    return partes.join(' ');
}

/**
 * WHATSAPP AVISA CUANDO RESTRINGE UNA CUENTA. HAY QUE ESCUCHARLO.
 *
 * El 01-ago-2026 la línea 2 dejó de entregar y nadie sabía por qué: todo daba
 * «conectada», el código era el mismo que el de la línea 1, y cada envío moría
 * con un 463 sin explicación. Se perdieron horas buscando el fallo en el
 * sistema.
 *
 * El dato estaba llegando desde el principio. WhatsApp había mandado una
 * notificación a esa cuenta:
 *
 *   {"xwa2_notify_account_reachout_timelock":{
 *      "enforcement_type":"RESTRICT_ALL_COMPANIONS",
 *      "is_active":true,
 *      "time_enforcement_ends":"1786218427"}}
 *
 * Es decir: WhatsApp restringió **todos los dispositivos vinculados** de esa
 * cuenta —WhatsApp Web incluido; el teléfono en sí NO— hasta una fecha exacta.
 * Baileys no sabe interpretarla y la descartaba con un «Invalid mex newsletter
 * notification», así que la única señal clara del problema se tiraba a la
 * basura y el dueño quedaba adivinando.
 *
 * Aquí se lee, se guarda y se muestra en el panel con su fecha de fin. No se
 * puede esquivar una restricción de WhatsApp —ni se debe intentar—, pero sí se
 * puede dejar de buscar un fallo que no existe.
 */
function detectarRestriccion(line, obj) {
    const nodo = obj && typeof obj === 'object' ? obj.node : null;
    if (!nodo || nodo.tag !== 'notification' || !line) return;

    const texto = textoDeNodo(nodo);
    if (!texto.includes('reachout_timelock')) return;

    const bruto = texto.slice(texto.indexOf('{'));
    let datos = null;
    try {
        datos = JSON.parse(bruto)?.data?.xwa2_notify_account_reachout_timelock || null;
    } catch { /* si cambia el formato, al menos queda el texto crudo */ }

    const st = sessions.get(line);
    if (!st) return;

    const terminaMs = Number(datos?.time_enforcement_ends || 0) * 1000;
    st.restriccion = {
        // La restricción es de la CUENTA, no de la ranura. Sin este campo, el
        // castigo de un número se le aplicaba al siguiente que ocupara la misma
        // ranura. Ver `restriccionVigente`.
        telefono: st.phoneNumber || null,
        activa: datos ? datos.is_active !== false : true,
        tipo: datos?.enforcement_type || 'desconocido',
        terminaISO: terminaMs ? new Date(terminaMs).toISOString() : null,
        vistaISO: new Date().toISOString(),
        crudo: datos ? undefined : bruto.slice(0, 300),
    };

    guardarRestriccion(line, st.restriccion);

    logger.error(
        { line, ...st.restriccion },
        'WHATSAPP RESTRINGIÓ ESTA CUENTA: no es un fallo del sistema. Los dispositivos vinculados no pueden enviar hasta la fecha indicada. El teléfono en sí no está restringido.'
    );
}

/**
 * La restricción se guarda en disco porque WhatsApp la anuncia UNA vez.
 * Sin esto, un reinicio del contenedor borraba la única explicación que
 * teníamos y el panel volvía a decir «conectada» sin más, que es justo lo que
 * hizo perder horas el 01-ago.
 */
function restriccionPath(line) {
    return path.join(authDir(line), 'restriccion-whatsapp.json');
}

function guardarRestriccion(line, r) {
    try {
        fs.mkdirSync(authDir(line), { recursive: true });
        fs.writeFileSync(restriccionPath(line), JSON.stringify(r, null, 2));
    } catch (e) {
        logger.warn({ line, err: e.message }, 'No se pudo guardar la restricción de WhatsApp');
    }
}

function cargarRestriccion(line) {
    try {
        const f = restriccionPath(line);
        if (!fs.existsSync(f)) return null;
        return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch {
        return null;
    }
}

/**
 * ¿Hay una restricción de WhatsApp vigente sobre el número que hay AHORA en
 * esta ranura?
 *
 * La restricción es de la CUENTA. Se guarda dentro de la carpeta de la ranura
 * porque es donde vive la sesión, pero **solo vale para el número que la
 * recibió**. Medido el 02-ago-2026: el dueño conectó un número nuevo a la
 * ranura 2 y el puente le negó todos los envíos con el castigo del número
 * anterior — WhatsApp no había rechazado ni uno solo. Un guardián que inventa
 * el problema que dice prevenir es peor que no tenerlo.
 *
 * Si el teléfono no coincide, la restricción no aplica y el archivo se borra:
 * pertenece a una cuenta que ya no está en esta ranura.
 */
function restriccionVigente(st, line) {
    let r = st?.restriccion;
    if (!r && line) {
        r = cargarRestriccion(line);
        if (r && st) st.restriccion = r;
    }
    if (!r || !r.activa || !r.terminaISO) return null;

    const telefonoActual = st?.phoneNumber || null;
    if (telefonoActual && r.telefono && r.telefono !== telefonoActual) {
        logger.info(
            { line, restriccionDe: r.telefono, numeroActual: telefonoActual },
            'La restricción guardada es de otro número: no aplica a esta línea y se descarta'
        );
        if (st) st.restriccion = null;
        try { fs.rmSync(restriccionPath(line), { force: true }); } catch { /* da igual */ }
        return null;
    }
    // Sin teléfono anotado no se puede saber de quién era: no se aplica.
    if (!r.telefono) return null;

    return Date.parse(r.terminaISO) > Date.now() ? r : null;
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
 *
 * Si conocemos el telefono real del @lid, se usa: es la direccion mas segura.
 * Si NO lo conocemos, se INTENTA igual contra el @lid.
 *
 * Hasta el 01-ago-2026 aqui se rechazaba el envio de entrada, por la creencia
 * —anotada el 30-jul— de que el error 463 lo causaba el @lid. El 31-jul se
 * midio lo contrario: 463 es un bloqueo de la CUENTA, no de la direccion (la
 * misma linea que fallaba contra un @lid fallaba tambien contra un telefono
 * normal, y otra linea entregaba a los dos). Esa creencia falsa quedo metida
 * en el puente y dejo sin respuesta a un cliente real: WhatsApp ya no publica
 * el telefono de quien usa la privacidad nueva (`senderPn: null` en los tres
 * mensajes que mando), asi que no habia nada que "aprender" y el bot, que si
 * habia escrito tres respuestas correctas, nunca pudo entregarlas.
 *
 * No hace falta adivinar: despues de enviar se espera el acuse REAL de
 * WhatsApp (`esperarRechazo`). Si de verdad lo rechaza, se reporta ese error
 * autentico. Intentar y verificar es mejor que negarse por una suposicion.
 */
function resolveSendJid(line, chatId) {
    const jid = normalizeJid(chatId);
    if (!jid.endsWith('@lid')) return { jid, telefonoConocido: true };

    const map = loadLidMap(line);
    const pn = map[jid];
    if (pn) return { jid: pn, telefonoConocido: true };

    return { jid, telefonoConocido: false };
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
/**
 * ARMA LA CITA PARA UN ENVIO DESDE EL PANEL.
 *
 * `extractQuoted`, justo debajo, hace lo contrario: lee la cita de lo que
 * LLEGA. Esta hace falta para lo que SALE, que hasta hoy no existia — el panel
 * sabia pintar citas y no sabia crearlas.
 *
 * Baileys no cita por un id suelto: pide el mensaje entero. Se le arma el
 * minimo que usa para componer el `contextInfo`: de que chat, de quien, y cual.
 * El texto viaja solo como vista previa; el telefono del cliente resuelve el
 * original por el identificador.
 */
function construirCitado(jid, quoted) {
    if (!quoted || !quoted.id) return null;
    return {
        key: {
            remoteJid: jid,
            fromMe: quoted.fromMe === true || quoted.fromMe === 'true',
            id: String(quoted.id),
        },
        // Sin texto, WhatsApp pinta la caja de la cita vacia hasta que resuelve
        // el original. Un guion se lee mejor que un hueco.
        message: { conversation: String(quoted.texto || '').slice(0, 500) || '-' },
    };
}

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
        /**
         * Momentos de los ultimos cortes, para reconocer un CICLO.
         *
         * Una caida suelta no dice nada: la red se cae, WhatsApp reinicia. Lo
         * que delata un problema de fondo es que se repita SIEMPRE cada tanto
         * (medido el 02-ago: cada 50m04s en una linea, mientras las otras dos
         * llevaban horas intactas). Un humano solo lo ve leyendo registros;
         * esto lo pone en el panel.
         */
        cortes: [],
        cicloDeCortes: null,
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

        /**
         * FRENO POR RECHAZOS DE WHATSAPP.
         *
         * Un acuse con error 463 es WhatsApp diciendo «pará»: el mensaje no se
         * entregó y el que insiste se gana un castigo mayor. Hasta el
         * 01-ago-2026 el puente no distinguía entre «no salió por la red» y
         * «WhatsApp me está frenando», así que seguía respondiendo a cada
         * mensaje entrante. Medido ese día en la línea 2: **de 13 intentos de
         * envío, 10 rechazados** en 51 minutos. Ninguno llegó al cliente y cada
         * uno hundía más la cuenta.
         *
         * Con el freno, tras varios rechazos seguidos la línea deja de ENVIAR
         * durante un rato que crece solo. Seguir RECIBIENDO no se toca: ninguna
         * consulta se pierde, quedan todas en el panel para atenderlas cuando
         * la línea se recupere o desde otra línea.
         */
        rechazosSeguidos: 0,
        pausadaHasta: 0,
        pausaNivel: 0,
    };
}

/** Cuánto descansa una línea según cuántas veces seguidas la hayan frenado. */
const PAUSAS_MS = [10 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
/** Rechazos seguidos que hacen falta para frenar la línea. */
const RECHAZOS_PARA_PAUSAR = 3;

/** ¿Esta línea está en reposo? Devuelve los ms que le faltan, o 0. */
function reposoRestante(st) {
    if (!st?.pausadaHasta) return 0;
    return Math.max(0, st.pausadaHasta - Date.now());
}

/** WhatsApp rechazó un envío de esta línea: se cuenta y, si insiste, se frena. */
function contarRechazo(line) {
    const st = sessions.get(line);
    if (!st) return;
    st.rechazosSeguidos = (st.rechazosSeguidos || 0) + 1;
    if (st.rechazosSeguidos < RECHAZOS_PARA_PAUSAR) return;

    const nivel = Math.min(st.pausaNivel || 0, PAUSAS_MS.length - 1);
    const espera = PAUSAS_MS[nivel];
    st.pausadaHasta = Date.now() + espera;
    st.pausaNivel = Math.min((st.pausaNivel || 0) + 1, PAUSAS_MS.length - 1);
    st.rechazosSeguidos = 0;
    logger.error(
        { line, minutos: Math.round(espera / 60000), reanuda: new Date(st.pausadaHasta).toISOString() },
        'LÍNEA EN REPOSO: WhatsApp rechazó varios envíos seguidos. Se deja de enviar por esta línea para no agravar el bloqueo. Se sigue recibiendo con normalidad.'
    );
}

/** Un envío entregado limpia el contador y levanta el castigo. */
function contarEnvioBueno(line) {
    const st = sessions.get(line);
    if (!st) return;
    if (st.rechazosSeguidos || st.pausaNivel || st.pausadaHasta) {
        logger.info({ line }, 'Envío entregado: la línea vuelve a la normalidad');
    }
    st.rechazosSeguidos = 0;
    st.pausadaHasta = 0;
    st.pausaNivel = 0;
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

        // Registro vigilado: es la unica forma de enterarse de que WhatsApp
        // rechazo un mensaje en el acuse, porque Baileys no lo emite como
        // evento y `sendMessage` ya se resolvio como si todo fuera bien.
        //
        // Se guarda en una variable porque el manejador propio de
        // `stream:error` (mas abajo) escribe por el mismo registro, para que lo
        // que quede anotado sea identico a lo que anotaba la libreria.
        const registroDeLaLinea = registroQueVigilaAcks(
            logger.child({ line }),
            attrs => registrarAckFallido(line, attrs),
            line
        );

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            version,
            logger: registroDeLaLinea,
            browser: Browsers.macOS('Desktop'),

            // La sincronización de historial completo rompía la sesión por
            // timeout en cuentas con mucho historial (probado el 23-jul-2026).
            syncHistory: false,
            markOnlineOnConnect: false,

            /**
             * LA BASURA SE RECHAZA EN LA PUERTA, NO SE TIRA DESPUÉS.
             *
             * EL FALLO QUE ESTO CIERRA (medido el 02-ago-2026)
             * -----------------------------------------------
             * El bot recibía los ESTADOS que publican los contactos del número
             * (`status@broadcast`) y los mensajes de grupo. No puede abrirlos
             * —no tiene la llave de esa persona y nunca la va a tener—, así que
             * hacía lo único que sabe: **pedirle a WhatsApp que se los reenvíe**.
             * WhatsApp los reenvía, vuelve a fallar, los pide otra vez. Para
             * siempre.
             *
             * En el registro, en tres horas:
             *   linea_3 → 7 fallos desde `status@broadcast` + 1 de grupo,
             *             cada uno con su «sent retry receipt». Ninguno llegó
             *             nunca. Y es la línea que se cae cada 50m04s.
             *   linea_1 → 26 fallos, todos de UNA persona real (`@lid`). Esos
             *             SÍ se resuelven: falla, pide reenvío, y al segundo
             *             intento «Mensaje recibido». Y esa línea NO se cae.
             *
             * Esa es la diferencia: lo de una persona se cura solo; **un estado
             * no se cura nunca**, se queda pendiente del lado de WhatsApp, y
             * cada ~50 minutos WhatsApp termina el flujo.
             *
             * LO ABSURDO: el sistema YA tira esos chats. `/diagnostic` cuenta
             * 178 descartados (85 difusiones y estados, 84 grupos, 9 canales).
             * Pero el filtro estaba en `handleIncoming`, que corre DESPUÉS de
             * que la librería intentó abrirlos y pidió el reenvío. La regla
             * correcta, en el lugar equivocado — el mismo error que con los
             * stickers.
             *
             * Aquí la librería, al ignorar un chat, **le acusa recibo a
             * WhatsApp y no lo abre** (`Socket/messages-recv.js:610`, y lo
             * mismo para avisos y acuses en :578 y :500). Ese acuse es lo que
             * hace que WhatsApp lo dé por entregado y **deje de reenviarlo**.
             *
             * SE USA LA MISMA REGLA DE SIEMPRE, `esChatDePersona`: no hay una
             * segunda lista que pueda quedar desincronizada de la primera.
             *
             * ANTE LA DUDA, PASA. Sin `jid` no se ignora nada: dejar entrar de
             * más solo ensucia un poco; dejar fuera de más pierde un cliente en
             * silencio, que es el error que este proyecto ya cometió enumerando
             * las líneas una por una.
             *
             * Y el descarte SIGUE SIN SER MUDO: cada chat rechazado se cuenta
             * por dominio en `/diagnostic` y se anota una vez en el registro,
             * con qué hacer si resultara ser un cliente real.
             */
            shouldIgnoreJid: (jid) => {
                if (!jid) return false;
                if (esChatDePersona(jid)) return false;
                registrarChatNoPersona(line, jid);
                return true;
            },
        });

        st.sock = sock;
        logger.info({ line, epoch, motivo }, 'Socket creado');
        sock.ev.on('creds.update', saveCreds);

        /**
         * UN ACUSE DE RECIBO NO ES UN ERROR — PERO ESTO **NO** EVITA LA CAÍDA.
         *
         * LÉASE ENTERO ANTES DE CONFIAR EN ESTE BLOQUE. Se escribió creyendo
         * que aquí estaba la causa de que las líneas se cayeran cada ~50
         * minutos. **Se desplegó, se midió, y la caída siguió igual.** Queda
         * escrito lo que de verdad pasa, porque dejar una causa falsa dentro
         * del código es el error que este proyecto ya pagó una vez con una
         * arquitectura entera (ver AGENTS.md §2.6).
         *
         * LO QUE SÍ ES CIERTO Y ESTÁ MEDIDO:
         * Cada 50m04s exactos WhatsApp manda a esa línea, textual:
         *   {"tag":"stream:error","attrs":{},
         *    "content":[{"tag":"ack","attrs":{"class":"message","type":"media",
         *                "id":"3A0DF74A8F30B473DED8"}}]}
         * Siempre el MISMO id, un mensaje con adjunto que quedó a medias y que
         * ni siquiera está en nuestra base. Y Baileys 6.7.24 corta ante
         * CUALQUIER `stream:error` (`lib/Socket/socket.js:507`) llamando a
         * `getErrorCodeFromStreamError` (`lib/Utils/generics.js:276`), que sin
         * `code` en el nodo y sin `ack` en su tabla asume `badSession` (500):
         * «tu sesión está corrupta». **Eso es mentira y por eso se quitó.**
         *
         * LO QUE ERA FALSO: que ese corte de Baileys fuera la causa. Medido el
         * 02-ago a las 22:57:48 y a las 23:47:52, con este código ya corriendo:
         *      22:57:48  Acuse ignorado          <- este manejador NO cortó
         *      22:57:48  connection errored      <- WhatsApp cerró el socket
         *      22:57:48  Conexión cerrada (428)  <- `ws.on('close')`, socket.js:445
         *      22:57:52  Baileys CONECTADO       <- 4 segundos después
         * El `stream:error` no era Baileys siendo paranoico: **era WhatsApp
         * avisando que iba a terminar el flujo, y lo termina igual.** Baileys
         * solo llegaba primero.
         *
         * ENTONCES ¿PARA QUÉ SE DEJA?
         *   1. El motivo del corte ahora es VERDAD: 428 «el otro lado cerró»,
         *      en vez de un 500 «sesión corrupta» que manda a quien lo lea a
         *      buscar el fallo donde no está.
         *   2. Este registro es lo que permitió encontrar la causa real: nombra
         *      el id atascado en el instante exacto en que llega.
         *   3. No hace daño: linea_1 y linea_2 llevaron 2h15m sin una sola
         *      caída con este código puesto, y la que cae reconecta en 4 s.
         *
         * LA CAUSA REAL, Y DÓNDE SE ARREGLA: el mensaje atascado vive en la
         * cola de WhatsApp **para esa sesión concreta**, no en nuestro código —
         * las otras dos líneas, mismo código, cero caídas. Se arregla
         * **re-vinculando esa línea** (desvincular y escanear el QR de nuevo),
         * que le da una sesión nueva y vacía la cola. No hay nada que tocar
         * aquí.
         *
         * LA REGLA AÑADIDA: si el nodo NO trae `code` y todos sus hijos son
         * `ack`, se anota y se sigue. Cualquier otro `stream:error` se trata
         * exactamente igual que antes, con el mismo texto y el mismo Boom.
         * Las dos redes de seguridad de Baileys NO se tocan: el latido
         * (socket.js:294) y el cierre de socket (socket.js:445, que es
         * justamente el que acaba actuando aquí).
         */
        sock.ws.removeAllListeners('CB:stream:error');
        sock.ws.on('CB:stream:error', (node) => {
            const hijos = getAllBinaryNodeChildren(node);
            const soloAcuses = hijos.length > 0 && hijos.every(h => h.tag === 'ack');

            if (!node?.attrs?.code && soloAcuses) {
                metrics.acuses_ignorados++;
                logger.warn(
                    { line, acuses: hijos.map(h => h.attrs?.id) },
                    'Acuse ignorado: no es un error, la conexión sigue en pie'
                );
                return;
            }

            // Cualquier otro caso: lo mismo que hacía Baileys, palabra por
            // palabra, por el mismo registro y con el mismo Boom.
            registroDeLaLinea.error({ node }, 'stream errored out');
            const { reason, statusCode } = getErrorCodeFromStreamError(node);
            sock.end(new Boom(`Stream Errored (${reason})`, { statusCode, data: node }));
        });

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
                anotarCorte(st, line);
                // El socket ya esta muerto: se desmonta para que no siga
                // emitiendo eventos que provoquen mas reconexiones.
                teardownSocket(st, line);

                // 401 — la sesion se cerro desde el telefono. Reconectar no
                // sirve: hace falta borrar las credenciales y escanear un QR.
                if (statusCode === DisconnectReason.loggedOut) {
                    st.status = 'logged_out';
                    st.keepAliveErrors++;

                    /**
                     * BORRAR LAS CREDENCIALES AQUÍ MISMO.
                     *
                     * Este bloque decía «hay que borrar la sesión» y no la
                     * borraba: lo hacía solo el botón «Desvincular número». Y
                     * dejarlas puestas no es inofensivo, porque **un QR solo se
                     * emite cuando NO hay credenciales**. Con las credenciales
                     * revocadas en disco, cada intento de vincular volvía a
                     * «logging in…» con el usuario viejo, WhatsApp respondía
                     * `Connection Failure`, y la línea quedaba en «Generando
                     * QR…» para siempre.
                     *
                     * Medido el 01-ago-2026: a las 14:47 WhatsApp cerró la
                     * línea 2 (`conflict: device_removed`) y la línea quedó
                     * imposible de recuperar desde el panel — hacía falta que
                     * alguien entrara al servidor a borrar la carpeta. Con 8
                     * puntos de venta eso significa un local caído hasta que
                     * aparezca un técnico.
                     *
                     * Una sesión revocada por WhatsApp NO se recupera: lo único
                     * correcto es partir de cero. Se borra y la línea queda
                     * lista para dar un QR nuevo en cuanto el panel lo pida.
                     */
                    try {
                        fs.rmSync(authDir(line), { recursive: true, force: true });
                        logger.warn({ line }, 'Sesión revocada por WhatsApp: credenciales borradas, la línea queda lista para un QR nuevo');
                    } catch (e) {
                        logger.error({ line, err: e.message }, 'No se pudieron borrar las credenciales de la sesión revocada');
                    }

                    // Se limpia lo que describía a la sesión muerta: el número y
                    // el QR viejo. Si no, el panel sigue mostrando el teléfono
                    // anterior como si la línea fuera esa.
                    st.connectedAt = null;
                    st.phoneNumber = null;
                    st.lastQR = null;
                    st.lastQRDataUrl = null;
                    st.starting = false;
                    st.epoch += 1;
                    st.lastError = 'La sesión se cerró desde el teléfono. Pide el QR desde el panel para volver a conectarla.';
                    st.lastErrorAt = new Date().toISOString();

                    logger.error({ line }, 'Sesión cerrada desde el teléfono. Pide el QR desde el panel para volver a conectarla.');
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

            /**
             * EL FILTRO DE `type` IBA ANTES, Y POR ESO EL FRENO NO SERVIA.
             *
             * Primera version, desplegada el 12-ago a las 09:19: el acuse se
             * llamaba DESPUES de `if (type !== 'notify') return`. A los 82
             * minutos el contador seguia en **0 acusadas** mientras los fallos
             * de descifrado subian de 11 a 51 y caia una linea. El arreglo no
             * estaba mal escrito: **no se estaba ejecutando**.
             *
             * Baileys emite `messages.upsert` con `type = 'append'` para lo que
             * WhatsApp REENVIA (`upsertMessage(msg, node.attrs.offline ?
             * 'append' : 'notify')`, `messages-recv.js`), y una copia de un
             * mensaje que mando el equipo desde su celular es exactamente eso.
             * El filtro de 'notify' —que esta bien para no procesar historial
             * como si fuera un cliente escribiendo— dejaba fuera justo los
             * mensajes que hay que acusar.
             *
             * Ahora el acuse corre para TODOS los tipos y el filtro se aplica
             * despues, solo a lo que va al agente. Acusar una copia ilegible es
             * seguro en cualquier tipo: no la abre, no la reenvia y no la
             * guarda; solo le dice a WhatsApp que deje de mandarla.
             */
            for (const msg of messages) {
                try {
                    if (await acusarCopiaPropiaIlegible(line, msg, sock, type)) continue;
                    // El resto del camino sigue siendo solo para lo que llega
                    // en vivo: el historial no se atiende como si fuera un
                    // cliente escribiendo ahora.
                    if (type !== 'notify') continue;
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

// ============================================================
// QUIEN ES UNA PERSONA
// ============================================================

/**
 * Dominios de WhatsApp que pertenecen a una PERSONA.
 *
 * MISMA REGLA que `esChatDePersona` en lib/whatsapp/contact-identity.ts. Esta
 * copia existe porque el puente es un proceso Node aparte y no puede importar
 * del codigo de la app. Si aqui se agrega un dominio, agregarlo alla tambien.
 *
 * El filtro anterior era una LISTA NEGRA —grupos, difusiones y estados— y todo
 * lo demas pasaba. El 02-ago-2026 entro `120363315571514607@newsletter`, un
 * canal, y el CRM le abrio ficha sin nombre y conversacion en linea_3. Tapar
 * solo `@newsletter` habria sido corregir el sintoma: WhatsApp estrena tipos de
 * chat cada tanto y cada uno se colaria igual. Se invierte: pasa lo que SI es
 * una persona.
 */
const DOMINIOS_DE_PERSONA = new Set(['s.whatsapp.net', 'c.us', 'lid']);

function dominioDeJid(jid) {
    const s = String(jid || '');
    const idx = s.lastIndexOf('@');
    return idx === -1 ? '' : s.slice(idx + 1).toLowerCase();
}

function esChatDePersona(jid) {
    const s = String(jid || '').trim();
    if (!s) return false;
    const dominio = dominioDeJid(s);
    if (!dominio) return /^\+?\d{7,20}$/.test(s);
    return DOMINIOS_DE_PERSONA.has(dominio);
}

/**
 * Chats no-persona ya anotados, para no repetir la misma linea de log en cada
 * mensaje de un canal que publica seguido.
 */
const chatsNoPersonaVistos = new Set();

/**
 * El descarte NUNCA es mudo.
 *
 * Invertir a lista blanca trae el riesgo de dejar fuera EN SILENCIO a un
 * cliente real si WhatsApp estrena un dominio nuevo para personas. Ese error ya
 * se cometio en este proyecto enumerando las lineas una por una. Por eso cada
 * dominio descartado se cuenta y se publica en /diagnostic, y cada chat nuevo
 * se anota una vez en el log con que hacer si resulta ser un cliente.
 */
function registrarChatNoPersona(line, jid) {
    const dominio = dominioDeJid(jid) || '(sin dominio)';
    metrics.chats_no_persona++;
    metrics.chats_no_persona_por_dominio[dominio] =
        (metrics.chats_no_persona_por_dominio[dominio] || 0) + 1;

    // Cota de memoria: los grupos y canales son pocos, pero el puente corre
    // meses sin reiniciarse y este Set no debe crecer sin fin.
    if (chatsNoPersonaVistos.size > 500) chatsNoPersonaVistos.clear();
    if (chatsNoPersonaVistos.has(jid)) return;
    chatsNoPersonaVistos.add(jid);

    logger.warn(
        { line, jid, dominio },
        'Chat que no es una persona: no se reenvia y no abre ficha en el CRM. Si esto resulta ser un cliente real, el dominio de persona falta en DOMINIOS_DE_PERSONA (server.js y lib/whatsapp/contact-identity.ts)'
    );
}

/**
 * ¿ESTA LINEA SE CAE EN CICLO?
 *
 * Con tres cortes seguidos separados por un intervalo parecido (entre 40 y 70
 * minutos), no es mala suerte: es un reloj. Se anota para que el panel lo diga
 * con su causa probable y su reparacion, en vez de que alguien tenga que
 * sospecharlo y ponerse a leer registros.
 *
 * NO se apaga ni se desvincula nada solo: desvincular obliga a que una persona
 * escanee un QR, y hacerlo por su cuenta dejaria un local mudo sin que nadie se
 * entere. Detecta y avisa; decidir es del dueño.
 */
function anotarCorte(st, line) {
    const ahora = Date.now();
    // Solo interesan las ultimas horas: un corte de ayer no forma ciclo con
    // uno de hoy.
    st.cortes = (st.cortes || []).filter((t) => ahora - t < 4 * 3600 * 1000);
    st.cortes.push(ahora);
    if (st.cortes.length < 3) return;

    const [a, b, c] = st.cortes.slice(-3);
    const hueco1 = (b - a) / 60000;
    const hueco2 = (c - b) / 60000;
    const enCiclo =
        hueco1 >= 40 && hueco1 <= 70 &&
        hueco2 >= 40 && hueco2 <= 70;
    if (!enCiclo) return;

    st.cicloDeCortes = {
        veces: st.cortes.length,
        cadaMinutos: Math.round((hueco1 + hueco2) / 2),
        ultimoISO: new Date(ahora).toISOString(),
    };
    logger.error(
        { line, ...st.cicloDeCortes },
        'LINEA EN CICLO DE CORTES: se desconecta a intervalos regulares. Suele ser la sesion de ese numero, no el sistema: re-vincular la linea (desvincular y escanear el QR) le da una sesion nueva.'
    );
}

/** El ciclo se olvida solo si la linea aguanta mas de una vuelta entera. */
function cicloVigente(st) {
    if (!st?.cicloDeCortes) return null;
    const ultimo = new Date(st.cicloDeCortes.ultimoISO).getTime();
    const margen = (st.cicloDeCortes.cadaMinutos + 20) * 60000;
    if (Date.now() - ultimo > margen) {
        st.cicloDeCortes = null;
        st.cortes = [];
        return null;
    }
    return st.cicloDeCortes;
}

/**
 * LA COPIA ILEGIBLE DE UN MENSAJE PROPIO ES LO QUE TUMBA LA LINEA.
 *
 * EL FALLO (medido el 12-ago-2026 sobre 40 h de registro)
 * ------------------------------------------------------
 * Cuando una persona del equipo le contesta a un cliente DESDE SU CELULAR,
 * WhatsApp manda una copia de ese mensaje a todos los aparatos vinculados,
 * incluido este puente. El puente NO puede abrirla: va cifrada para la sesion
 * del telefono y la llave no es suya. Nunca lo va a poder. No es un fallo
 * pasajero, es como funciona el multi-dispositivo.
 *
 * Baileys, al no poder descifrar, hace lo unico que sabe: PEDIR EL REENVIO
 * (`messages-recv.js:655-661`, hasta `maxMsgRetryCount` = 5 veces). El mensaje
 * nunca se resuelve, se queda PENDIENTE del lado de WhatsApp, y al rato
 * WhatsApp termina el flujo entero de esa linea.
 *
 * LOS NUMEROS QUE LO PRUEBAN (40 h, linea_1 y linea_3, ambas oficiales):
 *   - 691 mensajes distintos no se pudieron descifrar; 946 intentos.
 *   - El 95 % eran `fromMe` (copias de lo que mando el propio equipo).
 *   - SE RECUPERARON: 0. Ni uno.
 *   - 16 cortes de linea. En los 16, el mensaje que llegaba en el
 *     `stream:error` del instante exacto del corte era uno de esos
 *     ilegibles, y `fromMe` en los 16. **16 de 16, el 100 %.**
 *   - De noche, sin nadie escribiendo a mano: 14 h seguidas sin un corte.
 *
 * LO QUE ESTABA ESCRITO Y ERA FALSO
 * ---------------------------------
 * El comentario de `CB:stream:error` (mas arriba) concluia que el mensaje
 * atascado era SIEMPRE EL MISMO y vivia en la cola de esa sesion, asi que
 * «se arregla re-vinculando esa linea... no hay nada que tocar aqui».
 * Medido el 12-ago: **el id es DISTINTO en cada uno de los 16 cortes**, y
 * caen LAS DOS lineas. No hay un mensaje atascado: hay una fabrica de
 * mensajes ilegibles, alimentada por el equipo contestando a mano. Seguir
 * ese consejo habria significado desvincular y re-escanear las dos lineas
 * OFICIALES —lo que el proyecto tiene prohibido— para nada, porque a la hora
 * siguiente vuelve a pasar con otro mensaje.
 *
 * EL ARREGLO, Y POR QUE ESTE
 * --------------------------
 * El mismo principio que ya funciono el 03-ago con los estados y los grupos:
 * a lo que no se puede abrir se le ACUSA RECIBO en vez de pedirlo otra vez.
 * Un mensaje acusado deja de estar pendiente y WhatsApp no vuelve a mandarlo,
 * asi que nunca llega a terminar el flujo. Se usa el MISMO `sendReceipt` con
 * el MISMO tipo `sender` que usa Baileys en su camino de exito para un
 * mensaje propio (`messages-recv.js:679-690`): no es un mensaje inventado.
 *
 * NO SE PIERDE NADA, Y ESTA MEDIDO. De esas copias hoy no llega ninguna
 * (0 de 691) y `handleIncoming` ya las descarta en su `if (!msg.message)`.
 * Acusarlas no le quita al panel nada que hoy tenga.
 *
 * SOLO SE TOCA LO PROPIO. Un mensaje de CLIENTE que no se pudo abrir se deja
 * seguir su camino normal y conserva sus reintentos: puede curarse, y
 * callarlo seria perder un cliente en silencio — el error que este proyecto
 * ya cometio enumerando las lineas una por una.
 *
 * @returns {boolean} true si era una copia propia ilegible y ya se atendio.
 */
async function acusarCopiaPropiaIlegible(line, msg, sock, tipoDeEvento) {
    // CIPHERTEXT: llego cifrado y no se pudo abrir.
    if (msg?.messageStubType !== proto.WebMessageInfo.StubType.CIPHERTEXT) return false;
    // Solo las copias de lo que enviamos nosotros.
    if (msg?.key?.fromMe !== true) return false;

    const jid = msg?.key?.remoteJid;
    const id = msg?.key?.id;
    if (!jid || !id) return false;

    // Se cuenta ANTES de intentar el acuse: asi «vistas» dice cuantas llegaron
    // hasta aqui y «acusadas» cuantas se pudieron atender. Si vistas sube y
    // acusadas no, el problema es el acuse; si no sube ninguna, es que estos
    // mensajes no llegan a esta funcion y hay que buscar mas arriba.
    metrics.copias_propias_vistas++;

    try {
        // Igual que Baileys en su camino de exito: en un chat de persona el
        // participante es el autor; en los demas, el que traiga la clave.
        const participante = isJidUser(jid)
            ? (msg.key.participant || sock?.user?.id)
            : msg.key.participant;
        await sock.sendReceipt(jid, participante, [id], 'sender');
        metrics.copias_propias_acusadas++;
        logger.info(
            { line, id, jid, tipoDeEvento },
            'Copia propia ilegible: se le acusa recibo a WhatsApp para que deje de reenviarla'
        );
    } catch (e) {
        // Que falle el acuse no puede tumbar nada: se anota y se sigue.
        metrics.copias_propias_sin_acusar++;
        logger.warn(
            { line, id, err: e?.message },
            'No se pudo acusar la copia propia ilegible'
        );
    }
    // Sin `message` no hay nada que reenviar a la app: `handleIncoming` la
    // descartaria igual en su `if (!msg.message)`.
    return true;
}

async function handleIncoming(line, msg, sock) {
    const jid = msg.key.remoteJid;
    if (!jid) return;
    // Lista blanca: grupos (@g.us), difusiones y estados (@broadcast) y canales
    // (@newsletter) quedan fuera por no estar en DOMINIOS_DE_PERSONA.
    if (!esChatDePersona(jid)) {
        registrarChatNoPersona(line, jid);
        return;
    }
    if (!msg.message) return;

    metrics.messages_received++;
    const fromMe = msg.key.fromMe === true;

    // Se aprende el telefono real del chat ANTES de nada: es lo unico que
    // permite responderle a un contacto @lid sin que WhatsApp lo rechace.
    recordLidMapping(line, msg);

    /**
     * UNA LÍNEA NUESTRA NO ES UN CLIENTE.
     *
     * Si un mensaje llega desde otra de nuestras propias líneas, el agente lo
     * atiende como si fuera un cliente y responde. Esa respuesta llega a la
     * otra línea, que también responde. **Dos bots conversando para siempre.**
     *
     * Medido el 02-ago-2026: un mensaje de prueba entre la línea 1 y la línea 2
     * disparó un ida y vuelta de 14 mensajes en 2 minutos que no paraba solo.
     * Con las 8 líneas previstas en un mismo negocio esto no es un caso raro:
     * basta que alguien escriba de un local a otro para quemar dos números
     * reales a base de mensajes automáticos.
     *
     * El puente sabe qué números son suyos —son las líneas que él mismo
     * atiende— así que aquí se corta: se registra y no se reenvía al agente.
     */
    const remitente = normalizeJid(msg.key.senderPn || msg.key.participantPn || jid);
    const propio = !fromMe && esLineaPropia(remitente, line);
    if (propio) {
        logger.warn(
            { line, remitente, deLinea: propio },
            'Mensaje recibido desde OTRA LÍNEA PROPIA: no se pasa al agente para evitar que dos bots se respondan sin fin'
        );
        return;
    }

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

    /**
     * EL STICKER SE VE, PERO NO HACE HABLAR AL BOT.
     *
     * Aquí el sticker se descartaba entero —«no aporta a una cotización y
     * ensucia el hilo»—, y esa frase mezclaba dos cosas distintas. Que no
     * aporte a una cotización es cierto. Que ensucie el hilo, no: un cliente
     * que manda un pulgar arriba ESTÁ contestando, y al dueño le sirve verlo.
     *
     * Medido el 02-ago-2026: el dueño mandó varios stickers y en el panel no
     * apareció ninguno, ni siquiera un rastro. No había cómo saber que el
     * cliente había respondido.
     *
     * Lo que de verdad había que evitar —que el bot le conteste a un dibujo—
     * se decide en la app, que es donde se decide si corre el agente
     * (`webhook-processor`), y no tirando el mensaje aquí. Descartar en el
     * puente apagaba las dos cosas a la vez.
     */

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
            // Freno por rechazos: lo que el panel necesita para avisar que la
            // línea está descansando y hasta cuándo.
            enReposo: reposoRestante(st) > 0,
            reposoMinutosRestantes: Math.ceil(reposoRestante(st) / 60000),
            reposoHasta: st.pausadaHasta ? new Date(st.pausadaHasta).toISOString() : null,
            rechazosSeguidos: st.rechazosSeguidos || 0,
            // Restriccion declarada por WhatsApp sobre la cuenta, si la hay.
            restriccionWhatsApp: restriccionVigente(st, line),
            // Cortes a intervalos regulares: el panel lo muestra con su causa
            // probable y su reparacion. Se olvida solo si la linea aguanta.
            cicloDeCortes: cicloVigente(st),
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
        /**
         * Lo que se descarto por no ser una persona, con su desglose por
         * dominio. Si aqui aparece un dominio desconocido y a la vez un cliente
         * dice que no le respondieron, ese es el sitio donde mirar.
         */
        chatsNoPersona: {
            total: metrics.chats_no_persona,
            porDominio: metrics.chats_no_persona_por_dominio,
        },
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

    const { chatId, message, text, quoted } = req.body || {};
    const content = message || text;
    if (!chatId || !content) return res.status(400).json({ error: 'chatId y message/text son obligatorios' });

    // WhatsApp declaró una restricción sobre esta cuenta: se dice con su fecha
    // en vez de dejar que el envío muera con un 463 sin explicación.
    const restr = restriccionVigente(st, line);
    if (restr) {
        const detalle =
            `WhatsApp tiene restringida la cuenta de la línea "${line}" (${restr.tipo}) hasta ` +
            `${restr.terminaISO}. Los dispositivos vinculados no pueden enviar; el teléfono en sí ` +
            `no está restringido. No es un fallo del sistema y no hay nada que reintentar.`;
        logger.warn({ line, ...restr }, detalle);
        return res.status(503).json({ error: detalle, restringida: true, termina: restr.terminaISO });
    }

    // FRENO: si WhatsApp viene rechazando esta línea, no se insiste.
    const enReposo = reposoRestante(st);
    if (enReposo > 0) {
        const minutos = Math.ceil(enReposo / 60000);
        const detalle =
            `La línea "${line}" está en reposo ${minutos} min más: WhatsApp rechazó varios envíos seguidos. ` +
            `Insistir agrava el bloqueo. Sigue recibiendo mensajes con normalidad; respondé desde otra línea si es urgente.`;
        logger.warn({ line, minutos }, detalle);
        return res.status(503).json({ error: detalle, en_reposo: true, minutos_restantes: minutos });
    }

    // Se intenta aunque no conozcamos el telefono: el acuse real de WhatsApp,
    // unas lineas mas abajo, es quien dice si se entrego o no.
    const destino = resolveSendJid(line, chatId);
    if (!destino.telefonoConocido) {
        logger.warn(
            { line, chatId, jid: destino.jid },
            'Destino @lid sin telefono conocido (privacidad de WhatsApp): se intenta el envio y se verifica el acuse'
        );
    }
    const jid = destino.jid;

    try {
        await typing(st.sock, jid);
        // Sin `quoted` en el cuerpo, `citado` es null y esto es exactamente el
        // mismo envio de siempre: `sendMessage(jid, { text })`.
        const citado = construirCitado(jid, quoted);
        const sent = citado
            ? await st.sock.sendMessage(jid, { text: content }, { quoted: citado })
            : await st.sock.sendMessage(jid, { text: content });
        const idReal = sent?.key?.id;

        // No basta con que sendMessage no falle: WhatsApp puede rechazarlo
        // despues, en el acuse. Se espera ese rechazo antes de decirle a la app
        // que se entrego, o el panel mostraria una respuesta fantasma.
        const rechazo = await esperarRechazo(idReal);
        if (rechazo) {
            metrics.send_errors++;
            const detalle = `WhatsApp aceptó el mensaje y lo rechazó en el acuse (error ${rechazo.error}). El cliente NO lo recibió.`;
            logger.error({ line, jid, id: idReal, error: rechazo.error }, detalle);
            contarRechazo(line);
            return res.status(502).json({ error: detalle, ack_error: rechazo.error });
        }

        contarEnvioBueno(line);
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

    const { chatId, mediaUrl, caption, ptt } = req.body || {};
    if (!chatId || !mediaUrl) return res.status(400).json({ error: 'chatId y mediaUrl son obligatorios' });

    // FRENO: el mismo reposo que para el texto. Ver `contarRechazo`.
    const enReposoMedia = reposoRestante(st);
    if (enReposoMedia > 0) {
        const minutos = Math.ceil(enReposoMedia / 60000);
        const detalle =
            `La línea "${line}" está en reposo ${minutos} min más: WhatsApp rechazó varios envíos seguidos. ` +
            `Insistir agrava el bloqueo. Sigue recibiendo mensajes con normalidad.`;
        logger.warn({ line, minutos }, detalle);
        return res.status(503).json({ error: detalle, en_reposo: true, minutos_restantes: minutos });
    }

    const destino = resolveSendJid(line, chatId);
    if (!destino.telefonoConocido) {
        logger.warn(
            { line, chatId, jid: destino.jid },
            'Destino @lid sin telefono conocido (privacidad de WhatsApp): se intenta el envio y se verifica el acuse'
        );
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

        /**
         * UNA NOTA DE VOZ NO ES UN AUDIO ADJUNTO.
         *
         * Para que WhatsApp la pinte como la onda que se oye de un toque, tiene
         * que llegar en ogg/opus Y marcada `ptt`. Sin la marca llega como un
         * archivo que el cliente tiene que descargar y abrir aparte.
         *
         * El envase lo arregla la app antes de subirlo (`lib/whatsapp/
         * nota-de-voz.ts`, con ffmpeg): el navegador graba en webm/opus y aqui
         * tiene que entrar ya convertido. Si no llegara convertido se corta,
         * porque mandar una nota de voz que el cliente no puede oir de un toque
         * es peor que no mandarla.
         */
        const quierenNotaDeVoz = ptt === true || ptt === 'true' || ptt === 1;

        if (quierenNotaDeVoz) {
            if (mime !== 'audio/ogg') {
                throw new Error(`Una nota de voz tiene que llegar en audio/ogg y llego en "${mime}"`);
            }
            content = { audio: buf, mimetype: 'audio/ogg; codecs=opus', ptt: true };
        } else if (mime.startsWith('image/')) {
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
            contarRechazo(line);
            return res.status(502).json({ error: detalle, ack_error: rechazo.error });
        }

        contarEnvioBueno(line);
        metrics.media_sent++;
        logger.info(
            { line, jid, mime, kb: Math.round(buf.length / 1024), notaDeVoz: quierenNotaDeVoz },
            quierenNotaDeVoz ? 'Nota de voz enviada' : 'Media enviada'
        );
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
