import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { line_key, status, phone_number } = body;

    if (!line_key || !status) {
      return NextResponse.json({ error: 'Missing line_key or status' }, { status: 400 });
    }

    const updateData: any = { status };
    
    if (status === 'connected') {
      updateData.last_connected_at = new Date().toISOString();
      updateData.qr_code = null;
      if (phone_number) {
        updateData.phone_number = phone_number;
      }
    } else if (status === 'disconnected') {
      updateData.qr_code = null;
    }

    const supabase = createAdminClient();
    const { error } = await (supabase as any)
      .from('whatsapp_lines')
      .update(updateData)
      .eq('line_key', line_key);

    if (error) {
      logger.error('Failed to update line status', { error: error.message });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
