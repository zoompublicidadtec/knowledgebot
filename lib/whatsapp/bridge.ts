import { logger } from '@/lib/logger';

/**
 * Punto único de verdad sobre DÓNDE vive el puente de WhatsApp de cada línea
 * y cuál es el secreto compartido que autentica las llamadas en los dos
 * sentidos:
 *   - app    -> puente  (cabecera X-API-Key en /api/sessions/*)
 *   - puente -> app     (cabecera x-bridge-key en webhook/qr/status)
 *
 * POR QUÉ HAY MÁS DE UN PUENTE
 * ----------------------------
 * El puente `whatsapp-web.js` del 3004 no puede descargar la media entrante
 * (medido el 2026-07-30: 0 archivos descargados en 328 mensajes entrantes, 9
 * con `mediaError`). El puente Baileys del 3005 sí puede. La migración se hace
 * línea por línea, así que durante la transición conviven los dos y cada línea
 * tiene que ir al suyo.
 *
 * Variables de entorno:
 *   WHATSAPP_BRIDGE_URL     puente por defecto, para toda línea sin ruta propia.
 *   WHATSAPP_BRIDGE_ROUTES  rutas por línea, separadas por coma:
 *                             linea_2=http://localhost:3005,linea_3=http://...
 *   BRIDGE_API_KEY          secreto compartido, idéntico en app y puentes.
 *
 * Sin `WHATSAPP_BRIDGE_ROUTES` el comportamiento es exactamente el de antes:
 * todas las líneas al puente por defecto.
 */

const LOCAL_FALLBACK = 'http://localhost:3004';

/** Quita la barra final para que quien llame pueda concatenar rutas sin dudar. */
function normalizeBase(raw: string): string {
  const t = raw.trim();
  return t.endsWith('/') ? t.slice(0, -1) : t;
}

/** Puente por defecto: atiende toda línea que no tenga ruta explícita. */
function getDefaultBridgeUrl(): string {
  const raw = (process.env.WHATSAPP_BRIDGE_URL || '').trim();
  if (!raw) {
    logger.warn('WHATSAPP_BRIDGE_URL no está definida; se usa localhost como último recurso.', {});
    return LOCAL_FALLBACK;
  }
  return normalizeBase(raw);
}

/**
 * Mapa `line_key -> url` leído de WHATSAPP_BRIDGE_ROUTES.
 * Las entradas mal formadas se ignoran con aviso en el log, para que un error
 * de tipeo en la variable no deje una línea muda sin explicación.
 */
export function getBridgeRoutes(): Record<string, string> {
  const raw = (process.env.WHATSAPP_BRIDGE_ROUTES || '').trim();
  if (!raw) return {};

  const routes: Record<string, string> = {};
  for (const entry of raw.split(',')) {
    const part = entry.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) {
      logger.warn('Entrada inválida en WHATSAPP_BRIDGE_ROUTES (se esperaba linea=url)', { entry: part });
      continue;
    }
    const line = part.slice(0, eq).trim();
    const url = part.slice(eq + 1).trim();
    if (!line || !url) {
      logger.warn('Entrada incompleta en WHATSAPP_BRIDGE_ROUTES', { entry: part });
      continue;
    }
    routes[line] = normalizeBase(url);
  }
  return routes;
}

/**
 * URL del puente que atiende esa línea. Sin línea, o si la línea no tiene ruta
 * propia, devuelve el puente por defecto.
 */
export function getBridgeUrl(lineKey?: string | null): string {
  if (lineKey) {
    const routed = getBridgeRoutes()[lineKey];
    if (routed) return routed;
  }
  return getDefaultBridgeUrl();
}

/** Secreto compartido con los puentes (puede venir vacío en dev local). */
export function getBridgeApiKey(): string {
  return (process.env.BRIDGE_API_KEY || '').trim();
}

/** Cabeceras estándar app -> puente, con la clave cuando está configurada. */
export function bridgeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const apiKey = getBridgeApiKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}

export interface BridgeProbe {
  url: string;
  /** Líneas enrutadas explícitamente a este puente. Vacío = puente por defecto. */
  lines: string[];
  isDefault: boolean;
  reachable: boolean;
  bridgeTime: string | null;
  error?: string;
}

export interface MergedBridgeState {
  /** line_key -> estado tal como lo reporta el puente que la atiende. */
  sessions: Record<string, any>;
  probes: BridgeProbe[];
  /** Al menos un puente respondió. */
  anyReachable: boolean;
  /** Todos los puentes configurados respondieron. */
  allReachable: boolean;
}

/**
 * Consulta `/diagnostic` en TODOS los puentes configurados y une el resultado.
 *
 * Existe porque el panel tiene que decir la verdad habiendo varios puentes: si
 * el Centro de Control preguntara solo al puente por defecto, mostraría caída
 * una línea que está sana en el otro puente — justo el tipo de mentira que el
 * panel no debe contar.
 *
 * Para una línea con ruta propia manda SIEMPRE su puente: si ese puente no
 * responde, la línea se reporta inalcanzable aunque el puente por defecto
 * todavía tenga cargada una sesión vieja. Es lo cierto: por esa línea no están
 * pasando mensajes.
 */
export async function fetchMergedBridgeState(timeoutMs = 6000): Promise<MergedBridgeState> {
  const defaultUrl = getDefaultBridgeUrl();
  const routes = getBridgeRoutes();

  // Un mismo puente puede atender varias líneas: se agrupa por URL para no
  // preguntarle lo mismo dos veces.
  const linesByUrl = new Map<string, string[]>();
  for (const [line, url] of Object.entries(routes)) {
    if (!linesByUrl.has(url)) linesByUrl.set(url, []);
    linesByUrl.get(url)!.push(line);
  }

  const targets: { url: string; lines: string[]; isDefault: boolean }[] = [
    { url: defaultUrl, lines: linesByUrl.get(defaultUrl) || [], isDefault: true },
  ];
  for (const [url, lines] of linesByUrl) {
    if (url === defaultUrl) continue;
    targets.push({ url, lines, isDefault: false });
  }

  const headers = bridgeHeaders({});

  const results = await Promise.all(
    targets.map(async (t): Promise<{ probe: BridgeProbe; sessions: Record<string, any> }> => {
      try {
        const res = await fetch(`${t.url}/diagnostic`, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          return {
            probe: { ...t, reachable: false, bridgeTime: null, error: `HTTP ${res.status}` },
            sessions: {},
          };
        }
        const data = await res.json();
        return {
          probe: { ...t, reachable: true, bridgeTime: data.bridgeTime || null },
          sessions: (data.sessions || {}) as Record<string, any>,
        };
      } catch (e) {
        return {
          probe: { ...t, reachable: false, bridgeTime: null, error: String(e) },
          sessions: {},
        };
      }
    })
  );

  const byUrl = new Map(results.map(r => [r.probe.url, r]));

  // Base: lo que reporta el puente por defecto.
  const merged: Record<string, any> = { ...(byUrl.get(defaultUrl)?.sessions || {}) };

  // Las líneas con ruta propia las manda su puente, incluso para decir que no
  // responde. Así el panel no hereda un estado viejo del puente anterior.
  for (const [line, url] of Object.entries(routes)) {
    const r = byUrl.get(url);
    if (r?.probe.reachable) {
      merged[line] = r.sessions[line]
        ? { ...r.sessions[line], bridgeUrl: url }
        : {
            loaded: false,
            status: 'not_started',
            lastError: `El puente ${url} responde pero no tiene cargada la sesión "${line}".`,
            lastErrorAt: new Date().toISOString(),
            bridgeUrl: url,
          };
    } else {
      merged[line] = {
        loaded: false,
        status: 'bridge_unreachable',
        lastError: `El puente asignado a esta línea (${url}) no responde: ${r?.probe.error || 'sin detalle'}.`,
        lastErrorAt: new Date().toISOString(),
        bridgeUrl: url,
      };
    }
  }

  const probes = results.map(r => r.probe);
  return {
    sessions: merged,
    probes,
    anyReachable: probes.some(p => p.reachable),
    allReachable: probes.every(p => p.reachable),
  };
}
