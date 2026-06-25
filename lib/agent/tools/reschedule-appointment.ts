import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { cancelCalendarEvent, createCalendarEvent } from '@/lib/google/calendar';
import { localToUtc } from '@/lib/timezone';
import { logger } from '@/lib/logger';

interface ToolContext {
  orgId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
}

export function rescheduleAppointmentTool(ctx: ToolContext) {
  return tool({
    description: 'Reprograma o edita el horario de una cita existente.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        startsAt: { type: 'string', description: 'Nueva fecha/hora de inicio en ISO 8601' },
        endsAt: { type: 'string', description: 'Nueva fecha/hora de fin en ISO 8601' },
        appointmentId: { type: 'string', description: 'ID de la cita a reprogramar (si se conoce)' },
        searchTerm: { type: 'string', description: 'Texto para buscar la cita por servicio, nombre o notas' }
      },
      required: ['startsAt', 'endsAt']
    }),
    execute: async (args: any) => {
      const { startsAt, endsAt, appointmentId, searchTerm } = args;
      const logMessage = `\n[${new Date().toISOString()}] [TOOL CALL] rescheduleAppointment: appointmentId="${appointmentId}", searchTerm="${searchTerm}", startsAt="${startsAt}", endsAt="${endsAt}"`;
      console.log(logMessage);
      const fs = require('fs');
      try { fs.appendFileSync('agent_calls.log', logMessage + '\n'); } catch(e){}

      const supabase = createAdminClient();

      try {
        // Find contact
        const { data: contact } = await (supabase as any)
          .from('contacts')
          .select('id')
          .eq('organization_id', ctx.orgId)
          .eq('wa_phone', ctx.contactPhone)
          .single();

        if (!contact) {
          return { success: false, error: 'Contacto no encontrado' };
        }

        // Get organization timezone
        const { data: org } = await (supabase as any)
          .from('organizations')
          .select('name, timezone')
          .eq('id', ctx.orgId)
          .single();
        const timeZone = org?.timezone || 'America/Mexico_City';

        // Convert parameters to UTC if they don't contain timezone offsets
        const hasOffset = startsAt.endsWith('Z') || startsAt.includes('+') || startsAt.match(/-\d{2}:\d{2}$/);
        const utcStartsAt = hasOffset ? new Date(startsAt) : localToUtc(startsAt, timeZone);
        const utcEndsAt = hasOffset ? new Date(endsAt) : localToUtc(endsAt, timeZone);

        const startsAtIso = utcStartsAt.toISOString();
        const endsAtIso = utcEndsAt.toISOString();

        let targetApt: any = null;

        if (appointmentId) {
          const { data: apt } = await (supabase as any)
            .from('appointments')
            .select('*')
            .eq('id', appointmentId)
            .eq('organization_id', ctx.orgId)
            .single();
          targetApt = apt;
        } else {
          // Query all active confirmed appointments
          const { data: appointments } = await (supabase as any)
            .from('appointments')
            .select('*')
            .eq('organization_id', ctx.orgId)
            .eq('contact_id', contact.id)
            .eq('status', 'confirmed');

          if (!appointments || appointments.length === 0) {
            return { success: false, error: 'No tienes ninguna cita confirmada para reprogramar.' };
          }

          if (searchTerm) {
            const filtered = appointments.filter((apt: any) => 
              (apt.notes && apt.notes.toLowerCase().includes(searchTerm.toLowerCase())) ||
              (apt.full_name && apt.full_name.toLowerCase().includes(searchTerm.toLowerCase()))
            );
            if (filtered.length === 1) {
              targetApt = filtered[0];
            } else if (filtered.length > 1) {
              return {
                success: false,
                needsSelection: true,
                message: 'Encontré múltiples citas para esa busqueda. ¿Cuál deseas reprogramar?',
                appointments: filtered.map((apt: any) => ({
                  id: apt.id,
                  service: apt.service,
                  startsAt: apt.starts_at,
                  notes: apt.notes,
                })),
              };
            }
          }

          if (!targetApt) {
            if (appointments.length === 1) {
              targetApt = appointments[0];
            } else {
              return {
                success: false,
                needsSelection: true,
                message: 'Tienes más de una cita programada. ¿Cuál deseas reprogramar?',
                appointments: appointments.map((apt: any) => ({
                  id: apt.id,
                  service: apt.service,
                  startsAt: apt.starts_at,
                  notes: apt.notes,
                })),
              };
            }
          }
        }

        if (!targetApt) {
          return { success: false, error: 'No se pudo identificar la cita a reprogramar.' };
        }

        // Handle Google Calendar sync
        let newGoogleEventId: string | null = targetApt.google_event_id;
        const { data: calConfig } = await (supabase as any)
          .from('google_calendar_configs')
          .select('*')
          .eq('organization_id', ctx.orgId)
          .single();

        if (calConfig?.calendar_id && calConfig?.refresh_token_encrypted) {
          // Delete old calendar event
          if (targetApt.google_event_id) {
            try {
              await cancelCalendarEvent(calConfig, targetApt.google_event_id);
            } catch (err) {
              logger.warn('Could not cancel old calendar event for reschedule', { error: String(err) });
            }
          }
          // Create new calendar event
          try {
            newGoogleEventId = await createCalendarEvent(calConfig, {
              summary: `${targetApt.service} — ${targetApt.full_name}`,
              description: `Servicio: ${targetApt.service}\nCliente: ${targetApt.full_name}\nTeléfono: ${ctx.contactPhone}\n${targetApt.notes ? `Notas: ${targetApt.notes}` : ''}${targetApt.is_new_patient ? '\n⭐ Paciente nuevo' : ''}`,
              start: startsAtIso,
              end: endsAtIso,
              location: org?.name || undefined,
            });
          } catch (err) {
            logger.warn('Could not create new calendar event for reschedule', { error: String(err) });
            newGoogleEventId = null;
          }
        }

        // Update DB appointment with new time and new calendar event id
        const { error } = await (supabase as any)
          .from('appointments')
          .update({
            starts_at: startsAtIso,
            ends_at: endsAtIso,
            google_event_id: newGoogleEventId,
          })
          .eq('id', targetApt.id);

        if (error) {
          return { success: false, error: error.message };
        }

        return {
          success: true,
          message: 'Cita reprogramada exitosamente.',
          details: {
            service: targetApt.service,
            fullName: targetApt.full_name,
            date: utcStartsAt.toLocaleDateString('es-MX', { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            time: utcStartsAt.toLocaleTimeString('es-MX', { timeZone, hour: '2-digit', minute: '2-digit' }),
            googleCalendarSynced: !!newGoogleEventId,
          }
        };

      } catch (err) {
        logger.error('Reschedule appointment tool error', { error: String(err) });
        return { success: false, error: 'Error interno al reprogramar la cita.' };
      }
    }
  } as any);
}
