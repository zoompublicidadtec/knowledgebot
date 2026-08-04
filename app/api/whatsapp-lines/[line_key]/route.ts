import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBridgeUrl, bridgeHeaders } from '@/lib/whatsapp/bridge';
import { marcarLineaApagada } from '@/lib/whatsapp/lineas-apagadas';

/**
 * PATCH /api/whatsapp-lines/[line_key]
 * Body: { display_name }
 *
 * Renombra la línea. `line_key` NO se toca: es la clave con la que se enrutan
 * los mensajes, se nombran las sesiones en disco y se agrupan las
 * conversaciones. Cambiarla rompería los chats existentes.
 *
 * El nombre visible sí es libre: "WhatsApp de Juanita", "Local 211", "Soporte
 * técnico". Antes solo se podía fijar al crear la línea y después no había
 * forma de cambiarlo, así que todas quedaban como "Línea 1", "Línea 2"… — que
 * a nadie le dice de quién es cada una.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ line_key: string }> }
) {
  try {
    const { line_key } = await params;
    if (!line_key) return NextResponse.json({ error: 'Falta el identificador de la línea' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const nombre = String(body?.display_name || '').trim();

    if (!nombre) {
      return NextResponse.json({ error: 'El nombre no puede quedar vacío' }, { status: 400 });
    }
    if (nombre.length > 60) {
      return NextResponse.json({ error: 'El nombre no puede pasar de 60 caracteres' }, { status: 400 });
    }

    const supabase = await createClient();

    // Se comprueba que la línea exista y pertenezca a la organización del
    // usuario: la sesión de Supabase ya aplica RLS sobre esta consulta.
    const { data: line, error: lineErr } = await (supabase as any)
      .from('whatsapp_lines')
      .select('organization_id')
      .eq('line_key', line_key)
      .single();

    if (lineErr || !line) {
      return NextResponse.json({ error: 'La línea no existe o no es de esta cuenta' }, { status: 404 });
    }

    const admin = createAdminClient();
    const { error } = await (admin as any)
      .from('whatsapp_lines')
      .update({ display_name: nombre })
      .eq('line_key', line_key)
      .eq('organization_id', line.organization_id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, line_key, display_name: nombre });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ line_key: string }> }
) {
  try {
    const { line_key } = await params;
    if (!line_key) return NextResponse.json({ error: 'Missing line_key' }, { status: 400 });

    const supabase = await createClient();
    
    // Fetch line to verify org
    const { data: line, error: lineErr } = await (supabase as any)
      .from('whatsapp_lines')
      .select('organization_id')
      .eq('line_key', line_key)
      .single();

    if (lineErr || !line) {
      return NextResponse.json({ error: 'Line not found or unauthorized' }, { status: 404 });
    }

    // Update status in DB
    const adminSupabase = createAdminClient();
    await (adminSupabase as any)
      .from('whatsapp_lines')
      .update({ status: 'disconnected', qr_code: null })
      .eq('line_key', line_key);

    // Desvincular ES la señal de que el dueño no quiere esta línea conectada.
    // Sin esto, cada ranura apagada quedaba como alarma permanente en el
    // Centro de Control: con 8 líneas, 7 alarmas por decisión propia.
    await marcarLineaApagada((line as any).organization_id, line_key, true);

    // El puente depende de la línea: durante la migración a Baileys cada
    // línea puede vivir en un puerto distinto (WHATSAPP_BRIDGE_ROUTES).
    const baseUrl = getBridgeUrl(line_key);

    // Send logout request to bridge
    try {
      await fetch(`${baseUrl}/api/sessions/${line_key}/logout`, {
        method: 'POST',
        headers: bridgeHeaders(),
      });
    } catch (e) {
       console.error('Bridge logout failed', e);
       // Ignore bridge error, we just updated the DB
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
