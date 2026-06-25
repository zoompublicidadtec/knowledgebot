import { logger } from '@/lib/logger';

/**
 * Single source of truth for the WhatsApp bridge (wa-server-knowledge) location
 * and the shared secret used to authenticate calls in BOTH directions:
 *   - SaaS  -> bridge  (X-API-Key header on /api/sessions/*)
 *   - bridge -> SaaS   (x-bridge-key header on webhook/qr/status callbacks)
 *
 * In Railway the SaaS and the bridge run in SEPARATE containers, so the URL
 * MUST come from an environment variable. `localhost` only works for local
 * docker-compose (host network mode) or bare `node server.js` dev.
 *
 * Required env (production):
 *   WHATSAPP_BRIDGE_URL  e.g. https://wa-server-knowledge-production.up.railway.app
 *   BRIDGE_API_KEY       shared secret, identical in both services
 *
 * Fallbacks are for local dev only.
 */

const LOCAL_FALLBACK = 'http://localhost:3004';

/** Returns the bridge base URL (no trailing slash), reading WHATSAPP_BRIDGE_URL. */
export function getBridgeUrl(): string {
  const raw = (process.env.WHATSAPP_BRIDGE_URL || '').trim();
  if (!raw) {
    logger.warn(
      'WHATSAPP_BRIDGE_URL is not set; falling back to localhost. This will NOT work on Railway.',
      {}
    );
    return LOCAL_FALLBACK;
  }
  // Normalize: strip trailing slash so callers can safely append paths.
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** Returns the shared bridge API key (may be empty in local dev). */
export function getBridgeApiKey(): string {
  return (process.env.BRIDGE_API_KEY || '').trim();
}

/** Builds the standard headers for SaaS -> bridge requests, including the API key when set. */
export function bridgeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const apiKey = getBridgeApiKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra };
  if (apiKey) headers['X-API-Key'] = apiKey;
  return headers;
}
