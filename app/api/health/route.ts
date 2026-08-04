import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchMergedBridgeState } from '@/lib/whatsapp/bridge';
import { logger } from '@/lib/logger';
import { lineasApagadas } from '@/lib/whatsapp/lineas-apagadas';

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

    // Se pregunta a TODOS los puentes configurados y se une por línea. Con la
    // migración a Baileys hay más de un puente y cada línea vive en uno solo:
    // consultar únicamente el puente por defecto haría que el Centro de Control
    // diera por caída una línea que está sana en el otro.
    const bridge: any = await timed(fetchMergedBridgeState(6000), 7000);

    if (!bridge || !bridge.anyReachable) {
      const urls = (bridge?.probes || []).map((p: any) => p.url).join(', ');
      checks.push({
        id: 'bridge', label: 'Puente de WhatsApp', level: 'error',
        value: 'Inalcanzable',
        detail: `No responde ningún puente${urls ? ` (${urls})` : ''}. Es el servicio que envía y recibe los mensajes: ninguna línea puede operar.`,
        fix: 'Reiniciar los contenedores: docker compose up -d whatsapp-bridge whatsapp-bridge-baileys',
      });
    } else {
      const sessions = bridge.sessions || {};

      // Un puente caído con otro en pie: el Centro de Control lo dice en vez
      // de mostrar solo las líneas afectadas sin explicar por qué.
      for (const p of bridge.probes) {
        if (!p.reachable) {
          checks.push({
            id: `bridge-${p.url}`, label: `Puente ${p.isDefault ? 'principal' : 'secundario'}`,
            level: 'error',
            value: 'Inalcanzable',
            detail: `El puente en ${p.url} no responde${p.lines.length ? `, y atiende: ${p.lines.join(', ')}` : ''}. Error: ${p.error || 'sin detalle'}.`,
            fix: 'Revisar el contenedor de ese puente con docker ps y docker logs.',
          });
        }
      }
      // Las que el dueño apagó a propósito no son un problema: son una
      // decisión. Se muestran, pero no cuentan como alarma.
      const apagadas = new Set(await lineasApagadas(orgId));

      const lines = (dbLines || []).map((l: any) => {
        const s = sessions[l.line_key] || {};
        const connected = s.loaded === true && s.status === 'connected';
        const apagada = apagadas.has(l.line_key) && !connected;
        const zombie = l.status === 'connected' && !connected;
        return {
          line_key: l.line_key,
          display_name: l.display_name,
          phone_number: s.phoneNumber || l.phone_number,
          level: (connected ? 'ok' : apagada ? 'ok' : zombie ? 'error' : 'warn') as Level,
          state: connected ? 'Conectada' : apagada ? 'Apagada por usted' : zombie ? 'Caída silenciosa' : 'Desconectada',
          detail: apagada
            ? 'La desvinculó usted. No cuenta como problema; pídale el QR cuando quiera usarla.'
            : connected
            ? `Activa desde ${s.connectedAt ? new Date(s.connectedAt).toLocaleString('es-CO') : 'hace un momento'}.`
            : zombie
              ? 'El sistema la da por conectada pero el puente no la tiene cargada: los mensajes no llegan.'
              : (s.lastError || 'La sesión no está iniciada.'),
          fix: connected || apagada ? undefined
            : zombie ? 'Volver a escanear el QR desde Integraciones para restablecer la sesión.'
              : 'Iniciar la línea y escanear el código QR desde Integraciones.',
          keepAliveErrors: s.keepAliveErrors || 0,
        };
      });

      /**
       * El rotulo decia «7/8 lineas activas» contando como activas las que solo
       * estaban sin marcar. Activa significa CONECTADA y nada mas: si el dueno
       * ve un 7 cuando tiene una sola linea funcionando, el Centro de Control
       * deja de servir para lo unico que sirve.
       */
      const conectadas = lines.filter((l: any) => l.state === 'Conectada').length;
      const apagadasPorUsted = lines.filter((l: any) => l.state === 'Apagada por usted').length;
      const requierenAtencion = lines.filter((l: any) => l.level !== 'ok').length;

      const partes: string[] = [];
      if (requierenAtencion > 0) partes.push(`${requierenAtencion} requiere(n) atencion`);
      if (apagadasPorUsted > 0) partes.push(`${apagadasPorUsted} apagada(s) por usted`);

      checks.push({
        id: 'bridge', label: 'Puente de WhatsApp',
        level: requierenAtencion === 0 ? 'ok' : 'warn',
        value: `${conectadas}/${lines.length} conectadas`,
        detail: partes.length === 0
          ? 'Todas las lineas responden.'
          : partes.join(' · ') + '.',
        fix: requierenAtencion === 0 ? undefined : 'Revisar el detalle de cada linea mas abajo.',
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

    // ── Precios sospechosos ────────────────────────────────────────────────
    // Dos patrones que producen cotizaciones absurdas y que el bot no puede
    // detectar por su cuenta, porque la cifra viene de la calculadora:
    //   a) el precio SUBE al aumentar el volumen (error de captura);
    //   b) el precio se dispara frente al resto de su categoría.
    const suspects: Array<{ reference: string; name: string; issue: string }> = [];
    try {
      const tiersByProd = new Map<string, any[]>();
      for (let from = 0; from < 30000; from += 1000) {
        const { data: page } = await (admin as any)
          .from('price_tiers').select('product_id, variant, min_qty, price')
          .range(from, from + 999);
        if (!page?.length) break;
        for (const t of page) {
          if (!tiersByProd.has(t.product_id)) tiersByProd.set(t.product_id, []);
          tiersByProd.get(t.product_id)!.push(t);
        }
        if (page.length < 1000) break;
      }

      const { data: prodMeta } = await (admin as any)
        .from('products').select('id, reference, name').eq('active', true).limit(1000);

      for (const p of (prodMeta || [])) {
        const ts = tiersByProd.get(p.id) || [];
        const byVariant = new Map<string, any[]>();
        for (const t of ts) {
          const k = String(t.variant || '');
          if (!byVariant.has(k)) byVariant.set(k, []);
          byVariant.get(k)!.push(t);
        }
        for (const [, list] of byVariant) {
          const ord = list.slice().sort((a, b) => a.min_qty - b.min_qty);
          for (let i = 1; i < ord.length; i++) {
            if (Number(ord[i].price) > Number(ord[i - 1].price) * 1.05) {
              suspects.push({
                reference: p.reference, name: p.name,
                issue: `sube de $${Number(ord[i - 1].price).toLocaleString('es-CO')} (${ord[i - 1].min_qty} uds) a $${Number(ord[i].price).toLocaleString('es-CO')} (${ord[i].min_qty} uds)`,
              });
              break;
            }
          }
        }
      }
    } catch { /* el diagnóstico nunca debe tumbar la página */ }

    checks.push({
      id: 'precios_raros', label: 'Precios incoherentes',
      level: suspects.length === 0 ? 'ok' : 'warn',
      value: String(suspects.length),
      detail: suspects.length === 0
        ? 'Ningún producto encarece al aumentar la cantidad.'
        : `${suspects.length} producto(s) cuestan más al pedir más unidades. Ejemplo: ${suspects[0].reference} ${suspects[0].issue}.`,
      fix: suspects.length === 0 ? undefined
        : 'Revisar sus rangos en Base de Conocimiento: suele ser un error de captura del Excel de origen.',
    });

    // Precios imposibles: la importación dejó celdas concatenadas (unas gafas
    // a $850.010.900). El bot los ignora, pero hay que corregirlos.
    const corruptos: Array<{ reference: string; name: string; price: number }> = [];
    try {
      // Solo tarifas unitarias: una cifra alta con base "lote_total" es legítima
      // (es el precio del pedido completo, no de una unidad).
      const { data: caros } = await (admin as any)
        .from('price_tiers')
        .select('price, price_basis, products!inner(reference, name, active)')
        .eq('products.active', true)
        .eq('price_basis', 'unitario')
        .gt('price', 1_500_000)
        .order('price', { ascending: false })
        .limit(500);
      const vistos = new Set<string>();
      for (const t of (caros || [])) {
        const p = (t as any).products;
        if (!p || vistos.has(p.reference)) continue;
        vistos.add(p.reference);
        corruptos.push({ reference: p.reference, name: p.name, price: Number(t.price) });
      }
    } catch { /* nunca tumbar el diagnóstico */ }

    checks.push({
      id: 'precios_imposibles', label: 'Precios imposibles',
      level: corruptos.length === 0 ? 'ok' : 'error',
      value: String(corruptos.length),
      detail: corruptos.length === 0
        ? 'Ningún producto tiene una cifra fuera de rango.'
        : `${corruptos.length} producto(s) superan $1.500.000 por unidad, señal de celdas concatenadas al importar. Ejemplo: ${corruptos[0].reference} (${corruptos[0].name.slice(0, 34)}) a $${corruptos[0].price.toLocaleString('es-CO')}. El bot los descarta para no cotizarlos.`,
      fix: corruptos.length === 0 ? undefined
        : 'Corregir su precio real en Base de Conocimiento; mientras tanto no se ofrecen.',
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
