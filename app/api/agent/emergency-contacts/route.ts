import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth/actions';

export const dynamic = 'force-dynamic';

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  role: string;
  notify_on_handoff: boolean;
}

/**
 * GET /api/agent/emergency-contacts
 * Returns the list of emergency contacts for this org.
 */
export async function GET() {
  try {
    const profile = await getCurrentUser();
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const orgId = profile.organization_id;
    const supabase = createAdminClient();

    const { data: config } = await (supabase as any)
      .from('agent_configs')
      .select('metadata')
      .eq('organization_id', orgId)
      .single();

    const contacts: EmergencyContact[] = (config?.metadata as any)?.emergency_contacts || [];
    return NextResponse.json({ contacts });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/agent/emergency-contacts
 * Save/replace the full list of emergency contacts.
 */
export async function POST(req: NextRequest) {
  try {
    const profile = await getCurrentUser();
    if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const orgId = profile.organization_id;
    const supabase = createAdminClient();

    const body = await req.json();
    const contacts: EmergencyContact[] = body.contacts || [];

    // Get current metadata to merge
    const { data: current } = await (supabase as any)
      .from('agent_configs')
      .select('metadata')
      .eq('organization_id', orgId)
      .single();

    const existingMeta = (current?.metadata as Record<string, unknown>) || {};
    const newMeta = { ...existingMeta, emergency_contacts: contacts };

    const { error } = await (supabase as any)
      .from('agent_configs')
      .update({ metadata: newMeta })
      .eq('organization_id', orgId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, contacts });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
