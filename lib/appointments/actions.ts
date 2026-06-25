'use server';

import { createClient } from '@/lib/supabase/server';
import { cancelCalendarEvent } from '@/lib/google/calendar';
import { revalidatePath } from 'next/cache';

export async function updateAppointmentStatusAction(
  appointmentId: string,
  status: 'confirmed' | 'cancelled' | 'completed'
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'No autorizado' };

  // Fetch appointment
  const { data: apt } = await (supabase as any)
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single();

  if (!apt) {
    return { error: 'Cita no encontrada' };
  }

  // If status is cancelled, also delete from Google Calendar
  if (status === 'cancelled' && apt.google_event_id) {
    const { data: calConfig } = await (supabase as any)
      .from('google_calendar_configs')
      .select('*')
      .eq('organization_id', apt.organization_id)
      .single();

    if (calConfig) {
      await cancelCalendarEvent(calConfig, apt.google_event_id);
    }
  }

  // Update DB status
  const { error } = await (supabase as any)
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/citas');
  return { success: true };
}
