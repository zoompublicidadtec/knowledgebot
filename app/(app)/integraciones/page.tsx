import { createClient } from '@/lib/supabase/server';
import { listCalendars } from '@/lib/google/calendar';
import IntegrationsClientPage from './client-page';
import { redirect } from 'next/navigation';

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();

  if (!profile) redirect('/login');
  const orgId = profile.organization_id;

  // Get current configs
  const { data: waConfig } = await (supabase as any)
    .from('whatsapp_configs')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  const { data: calendarConfig } = await (supabase as any)
    .from('google_calendar_configs')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  let calendarsList: { id: string; name: string }[] = [];

  if (calendarConfig?.refresh_token_encrypted) {
    try {
      calendarsList = await listCalendars(calendarConfig);
    } catch {
      // Failed to list calendars, token might be invalid or expired
    }
  }

  return (
    <IntegrationsClientPage
      initialWaConfig={waConfig}
      initialCalendarConfig={calendarConfig}
      calendarsList={calendarsList}
    />
  );
}
