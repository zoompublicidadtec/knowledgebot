import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/actions';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMedia } from '@/lib/whatsapp/send';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/conversations/send-media
 *
 * Manda una imagen o un archivo al cliente desde el panel.
 *
 * POR QUÉ ES UNA RUTA Y NO UNA SERVER ACTION
 * ------------------------------------------
 * Una server action de Next admite **1 MB** de cuerpo por defecto, y una foto
 * de celular pesa más que eso. Subir el límite global tocaría toda la app; una
 * ruta con `FormData` recibe el binario sin convertirlo a texto y sin cambiarle
 * nada al resto del sistema.
 *
 * Exige sesión, y además comprueba que la conversación sea de la organización
 * de quien la pide: la clave de servicio salta las políticas de la base, así
 * que ese filtro tiene que estar escrito aquí.
 */
export async function POST(request: NextRequest) {
  try {
    const profile = await getCurrentUser();
    if (!profile) {
      return NextResponse.json({ error: 'Sesión no válida.' }, { status: 401 });
    }
    const orgId = profile.organization_id;

    const form = await request.formData();
    const conversationId = String(form.get('conversationId') || '').trim();
    const to = String(form.get('to') || '').trim();
    const caption = String(form.get('caption') || '').trim();
    const file = form.get('file');

    if (!conversationId || !to || !(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: 'Faltan datos para enviar el archivo.' },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    const { data: conv } = await (supabase as any)
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('organization_id', orgId)
      .single();

    if (!conv) {
      return NextResponse.json({ error: 'Conversación no encontrada.' }, { status: 404 });
    }

    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const resultado = await sendWhatsAppMedia(
      orgId,
      conversationId,
      to,
      base64,
      file.type || 'application/octet-stream',
      caption,
    );

    if (!resultado.ok) {
      return NextResponse.json({ error: resultado.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('No se pudo enviar el archivo desde el panel', { error: String(err) });
    return NextResponse.json(
      { error: 'No se pudo enviar el archivo. Intentá de nuevo.' },
      { status: 500 },
    );
  }
}
