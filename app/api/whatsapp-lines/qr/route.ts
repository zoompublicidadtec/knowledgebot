import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { line_key, qr_base64 } = body;

    if (!line_key || !qr_base64) {
      return NextResponse.json({ error: 'Missing line_key or qr_base64' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { error } = await (supabase as any)
      .from('whatsapp_lines')
      .update({ status: 'awaiting_qr', qr_code: qr_base64 })
      .eq('line_key', line_key);

    if (error) {
      logger.error('Failed to update QR', { error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
