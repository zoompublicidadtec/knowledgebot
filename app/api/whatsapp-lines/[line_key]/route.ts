import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getBridgeUrl, bridgeHeaders } from '@/lib/whatsapp/bridge';

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

    // Bridge URL + key come from env (WHATSAPP_BRIDGE_URL / BRIDGE_API_KEY).
    const baseUrl = getBridgeUrl();

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
