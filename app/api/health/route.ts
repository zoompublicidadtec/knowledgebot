import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBridgeUrl, bridgeHeaders } from '@/lib/whatsapp/bridge';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

type Level = 'ok' | 'warn' | 'error';

interface Check {
  id: string;
  label: string;
  level: Level;
  value: string;
  detail: string;
  /** Qué hacer cuando no está en verde. */
  fix?: string;
}

async function timed<T>(p: Promise<T>, ms: number): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<null>(r => setTimeout(() => r(null), ms)),
    ]);
  } catch {
    return null;
  }
}

/**
 * GET /api/health
 *
 * Diagnóstico real y unificado del sistema: servicios, líneas de WhatsApp,
 * motor RAG, catálogo y actividad. Cada punto reporta su estado, la causa y
 * la acción concreta para repararlo. Sustituye a los datos inventados que
 * mostraba el Centro de Control.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdminClient();
    const { data: profile } = await (admin as any)
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();
    if (!profile) return NextResponse.json({ error: 'No org' }, { status: 401 });

    const orgId = profile.organization_id;
    const checks: Check[] = [];

    // ── Motor RAG ──────────────────────────────────────────────────────────
    const ragUrl = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8001';
    const ragStats: any = await timed(
      fetch(`${ragUrl}/stats`, { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : null),
      6000
    );

    if (!ragStats) {
      checks.push({
        id: 'rag', label: 'Motor de búsqueda', level: 'error',
        value: 'Sin respuesta',
        detail: `El motor RAG no responde en ${ragUrl}. Sin él, el bot no encuentra productos y no puede cotizar.`,
        fix: 'Reiniciar el servicio en el VPS: systemctl restart knowledgebot-rag',
      });
    } else {
      const emb = Number(ragStats.embeddings || 0);
      const count = Number(ragStats.catalog?.count || 0);
      checks.push({
        id: 'rag', label: 'Motor de búsqueda', level: 'ok',
        value: 'En línea',
        detail: `Fuente: ${ragStats.catalog?.source || 'desconocida'}. ${emb.toLocaleString('es-CO')} productos vectorizados.`,
      });
    }

    // ── Puente de WhatsApp y líneas ────────────────────────────────────────
    const { data: dbLines } = await (admin as any)
      .from('whatsapp_lines')
      .select('line_key, display_name, phone_number, status')
      .eq('organization_id', orgId);

    const bridge: any = await timed(
      fetch(`${getBridgeUrl()}/diagnostic`, {
        headers: bridgeHeaders({}), signal: AbortSignal.timeout(6000),
      }).then(r => r.ok ? r.json() : null),
      7000
    );

    if (!bridge) {
      checks.push({
        id: 'bridge', label: 'Puente de WhatsApp', level: 'error',
        value: 'Inalcanzable',
        detail: 'No responde el servicio que envía y recibe los mensajes. Ninguna línea puede operar.',
        fix: 'Reiniciar el contenedor: docker compose up -d whatsapp-bridge',
      });
    } else {
      const sessions = bridge.sessions || {};
      const lines = (dbLines || []).map((l: any) => {
        const s = sessions[l.line_key] || {};
        const connected = s.loaded === true && s.status === 'connected';
        const zombie = l.status === 'connected' && !connected;
        return {
          line_key: l.line_key,
          display_name: l.display_name,
          phone_number: s.phoneNumber || l.phone_number,
          level: (connected ? 'ok' : zombie ? 'error' : 'warn') as Level,
          state: connected ? 'Conectada' : zombie ? 'Caída silenciosa' : 'Desconectada',
          detail: connected
            ? `Activa desde ${s.connectedAt ? new Date(s.connectedAt).toLocaleString('es-CO') : 'hace un momento'}.`
            : zombie
              ? 'El sistema la da por conectada pero el puente no la tiene cargada: los mensajes no llegan.'
              : (s.lastError || 'La sesión no está iniciada.'),
          fix: connected ? undefined
            : zombie ? 'Volver a escanear el QR desde Integraciones para restablecer la sesión.'
              : 'Iniciar la línea y escanear el código QR desde Integraciones.',
          keepAliveErrors: s.keepAliveErrors || 0,
        };
      });

      const down = lines.filter((l: any) => l.level !== 'ok').length;
      checks.push({
        id: 'bridge', label: 'Puente de WhatsApp', level: down === 0 ? 'ok' : 'warn',
        value: `${lines.length - down}/${lines.length} líneas activas`,
        detail: down === 0 ? 'Todas las líneas responden.' : `${down} línea(s) requieren atención.`,
        fix: down === 0 ? undefined : 'Revisar el detalle de cada línea más abajo.',
      });

      (checks as any).__lines = lines;
    }

    // ── Catálogo ───────────────────────────────────────────────────────────
    const [{ count: activos }, { count: conFoto }] = await Promise.all([
      (admin as any).from('products').select('id', { count: 'exact', head: true }).eq('active', true),
      (admin as any).from('products').select('id', { count: 'exact', head: true })
        .eq('active', true).not('image_url', 'is', null),
    ]);

    const sinFoto = (activos || 0) - (conFoto || 0);
    checks.push({
      id: 'fotos', label: 'Fotos de producto',
      level: sinFoto === 0 ? 'ok' : sinFoto <= 50 ? 'warn' : 'error',
      value: `${conFoto || 0}/${activos || 0}`,
      detail: sinFoto === 0
        ? 'Todos los productos activos tienen imagen.'
        : `${sinFoto} producto(s) sin foto: el bot no puede mostrarlos si el cliente la pide.`,
      fix: sinFoto === 0 ? undefined : 'Subir las imágenes desde Base de Conocimiento (filtro "Sin foto").',
    });

    // Cotizables: se cuenta con un inner join, porque PostgREST devuelve como
    // máximo 1000 filas por consulta y traer el catálogo entero daba cifras
    // truncadas (456 de 1000 en vez del total real).
    const { count: cotizablesCount } = await (admin as any)
      .from('products')
      .select('id, price_tiers!inner(product_id)', { count: 'exact', head: true })
      .eq('active', true);

    const cotizables = cotizablesCount || 0;
    const sinPrecio = (activos || 0) - cotizables;

    checks.push({
      id: 'precios', label: 'Productos cotizables',
      level: sinPrecio <= 0 ? 'ok' : sinPrecio <= 100 ? 'warn' : 'error',
      value: `${cotizables}/${activos || 0}`,
      detail: sinPrecio === 0
        ? 'Todo el catálogo activo tiene tarifas.'
        : `${sinPrecio} producto(s) sin tarifa: el bot no los ofrece porque no puede darles precio.`,
      fix: sinPrecio === 0 ? undefined : 'Cargar sus rangos de precio en Base de Conocimiento.',
    });

    // Referencias duplicadas (la causa de que el bot repitiera el mismo
    // producto). Se pagina porque PostgREST corta en 1000 filas por consulta.
    const seen = new Map<string, number>();
    for (let from = 0; from < 20000; from += 1000) {
      const { data: page } = await (admin as any)
        .from('products').select('reference').eq('active', true)
        .range(from, from + 999);
      if (!page || page.length === 0) break;
      for (const r of page) {
        const k = (r.reference || '').trim();
        if (k) seen.set(k, (seen.get(k) || 0) + 1);
      }
      if (page.length < 1000) break;
    }
    const dupes = [...seen.values()].filter(v => v > 1).length;
    checks.push({
      id: 'duplicados', label: 'Referencias duplicadas',
      level: dupes === 0 ? 'ok' : 'error',
      value: String(dupes),
      detail: dupes === 0
        ? 'Cada referencia identifica a un solo producto.'
        : `${dupes} referencia(s) apuntan a más de un producto: el bot puede cotizar el precio equivocado.`,
      fix: dupes === 0 ? undefined : 'Fusionar los duplicados desde Base de Conocimiento.',
    });

    // ── Configuración del agente ───────────────────────────────────────────
    const { data: cfg } = await (admin as any)
      .from('agent_configs').select('metadata, system_prompt, bot_globally_enabled')
      .eq('organization_id', orgId).single();

    const persona = cfg?.metadata?.persona || {};
    const badPrompt = /asistente virtual|inteligencia artificial|modelo de lenguaje/i
      .test(cfg?.system_prompt || '');

    checks.push({
      id: 'persona', label: 'Identidad del agente',
      level: !persona.agent_name ? 'warn' : badPrompt ? 'error' : 'ok',
      value: persona.agent_name ? `${persona.agent_name} · ${persona.role || ''}`.trim() : 'Sin configurar',
      detail: badPrompt
        ? 'Las indicaciones del negocio describen al agente como una IA. Eso contradice su identidad y hace que se delate ante el cliente.'
        : persona.agent_name
          ? `Se presenta como ${persona.agent_name} de ${persona.company || 'la empresa'}.`
          : 'No hay identidad definida; el agente usará los valores por defecto.',
      fix: badPrompt || !persona.agent_name ? 'Ajustarlo en Personalización → Identidad del agente.' : undefined,
    });

    checks.push({
      id: 'bot', label: 'Bot',
      level: cfg?.bot_globally_enabled === false ? 'warn' : 'ok',
      value: cfg?.bot_globally_enabled === false ? 'Apagado' : 'Activo',
      detail: cfg?.bot_globally_enabled === false
        ? 'El bot está apagado globalmente: ninguna conversación recibe respuesta automática.'
        : 'Respondiendo automáticamente a los clientes.',
      fix: cfg?.bot_globally_enabled === false ? 'Encenderlo desde el interruptor global.' : undefined,
    });

    // ── Actividad real (últimos 14 días) ───────────────────────────────────
    const since = new Date(Date.now() - 14 * 86400_000).toISOString();
    const { data: msgs } = await (admin as any)
      .from('messages')
      .select('created_at, direction, conversation_id')
      .eq('organization_id', orgId)
      .gte('created_at', since)
      .limit(20000);

    const byDay = new Map<string, { in: number; out: number }>();
    for (let i = 13; i >= 0; i--) {
      byDay.set(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10), { in: 0, out: 0 });
    }
    const convSet = new Set<string>();
    for (const m of (msgs || [])) {
      const d = String(m.created_at).slice(0, 10);
      const slot = byDay.get(d);
      if (slot) (m.direction === 'inbound' ? slot.in++ : slot.out++);
      convSet.add(m.conversation_id);
    }

    const activity = [...byDay.entries()].map(([date, v]) => ({ date, ...v }));

    return NextResponse.json({
      checks: checks.filter(c => c.id),
      lines: (checks as any).__lines || [],
      activity,
      totals: {
        messages14d: (msgs || []).length,
        conversations14d: convSet.size,
        productsActive: activos || 0,
        productsQuotable: cotizables,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error('health: error', { error: err?.message || String(err) });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
