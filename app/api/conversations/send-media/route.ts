import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/actions';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWhatsAppMedia } from '@/lib/whatsapp/send';
import { convertirANotaDeVoz, MIME_NOTA_DE_VOZ } from '@/lib/whatsapp/nota-de-voz';
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
    // El micrófono del panel manda `ptt=1`. Un clip normal no manda nada y
    // sigue el mismo camino de siempre.
    const esNotaDeVoz = String(form.get('ptt') || '') === '1';
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

    // El tipo se anota a mano: `Buffer.from` devuelve `Buffer<ArrayBuffer>` y
    // `Buffer.concat` —lo que sale del conversor— devuelve `Buffer<ArrayBufferLike>`.
    // Sin la anotacion, TypeScript no deja reasignar la variable.
    let bytes: Buffer = Buffer.from(await file.arrayBuffer());
    let mimetype = file.type || 'application/octet-stream';

    /**
     * SI NO SE PUEDE CONVERTIR, NO SE MANDA NADA.
     *
     * El navegador graba en webm/opus y WhatsApp solo pinta la onda de una nota
     * de voz si llega en ogg/opus. Mandarla sin convertir le llegaría al cliente
     * como un archivo que tiene que descargar y abrir aparte. Antes que eso,
     * se corta aquí y se le dice al asesor.
     */
    if (esNotaDeVoz) {
      try {
        bytes = await convertirANotaDeVoz(bytes);
        mimetype = MIME_NOTA_DE_VOZ;
      } catch (err) {
        logger.error('No se pudo preparar la nota de voz', {
          error: String(err), conversationId, mime: file.type,
        });
        return NextResponse.json(
          { error: 'No se pudo preparar la nota de voz. No se envió nada.' },
          { status: 400 },
        );
      }
    }

    const resultado = await sendWhatsAppMedia(
      orgId,
      conversationId,
      to,
      bytes.toString('base64'),
      mimetype,
      caption,
      esNotaDeVoz,
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
