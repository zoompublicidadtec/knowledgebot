import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { cancelCalendarEvent } from '@/lib/google/calendar';
import { logger } from '@/lib/logger';

interface ToolContext {
  orgId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
}

export function cancelAppointmentTool(ctx: ToolContext) {
  return tool({
    description: 'Cancela una o todas las citas existentes y confirmadas del cliente.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        appointmentId: { type: 'string', description: 'ID de la cita a cancelar (si se conoce)' },
        searchTerm: { type: 'string', description: 'Texto para buscar la cita por servicio, nombre o notas' },
        cancelAll: { type: 'boolean', description: 'Si es true, cancela todas las citas activas del cliente' }
      }
    }),
    execute: async (args: any) => {
      const { appointmentId, searchTerm, cancelAll } = args;
      const logMessage = `\n[${new Date().toISOString()}] [TOOL CALL] cancelAppointment: appointmentId="${appointmentId}", searchTerm="${searchTerm}", cancelAll=${cancelAll}`;
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

        // Handle cancel all appointments
        if (cancelAll) {
          const { data: appointments } = await (supabase as any)
            .from('appointments')
            .select('*')
            .eq('organization_id', ctx.orgId)
            .eq('contact_id', contact.id)
            .eq('status', 'confirmed');

          if (!appointments || appointments.length === 0) {
            return { success: false, error: 'No tienes ninguna cita confirmada para cancelar.' };
          }

          // Get calendar config
          const { data: calConfig } = await (supabase as any)
            .from('google_calendar_configs')
            .select('*')
            .eq('organization_id', ctx.orgId)
            .single();

          let cancelledCount = 0;
          for (const apt of appointments) {
            if (apt.google_event_id && calConfig) {
              try {
                await cancelCalendarEvent(calConfig, apt.google_event_id);
              } catch (err) {
                logger.warn('Could not cancel event during cancelAll', { error: String(err) });
              }
            }
            await (supabase as any)
              .from('appointments')
              .update({ status: 'cancelled' })
              .eq('id', apt.id);
            cancelledCount++;
          }

          return {
            success: true,
            message: `Se han cancelado todas tus citas (${cancelledCount} en total) exitosamente.`,
          };
        }

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
            return { success: false, error: 'No tienes ninguna cita confirmada para cancelar.' };
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
                message: 'Encontré múltiples citas para esa busqueda. ¿Cuál deseas cancelar?',
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
                message: 'Tienes más de una cita programada. ¿Cuál deseas cancelar?',
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
          return { success: false, error: 'No se pudo identificar la cita a cancelar.' };
        }

        // Cancel on Google Calendar if event exists
        if (targetApt.google_event_id) {
          const { data: calConfig } = await (supabase as any)
            .from('google_calendar_configs')
            .select('*')
            .eq('organization_id', ctx.orgId)
            .single();

          if (calConfig) {
            await cancelCalendarEvent(calConfig, targetApt.google_event_id);
          }
        }

        // Update DB status to cancelled
        const { error } = await (supabase as any)
          .from('appointments')
          .update({ status: 'cancelled' })
          .eq('id', targetApt.id);

        if (error) {
          return { success: false, error: error.message };
        }

        return {
          success: true,
          message: 'Cita cancelada exitosamente.',
          details: {
            service: targetApt.service,
            startsAt: targetApt.starts_at,
          }
        };

      } catch (err) {
        logger.error('Cancel appointment tool error', { error: String(err) });
        return { success: false, error: 'Error interno al cancelar la cita.' };
      }
    }
  } as any);
}
