import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { createCalendarEvent } from '@/lib/google/calendar';
import { localToUtc } from '@/lib/timezone';
import { logger } from '@/lib/logger';

interface ToolContext {
  orgId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
}

export function bookAppointmentTool(ctx: ToolContext) {
  return tool({
    description: 'Agenda una cita, llamada, demo, asesoria o servicio. Solo usar cuando el cliente ya confirmo el horario y el servicio.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        fullName: { type: 'string', description: 'Nombre completo del cliente' },
        service: { type: 'string', description: 'Nombre del servicio, llamada, demo o asesoria' },
        startsAt: { type: 'string', description: 'Fecha/hora de inicio en ISO 8601' },
        endsAt: { type: 'string', description: 'Fecha/hora de fin en ISO 8601' },
        isNewCustomer: { type: 'boolean', description: 'Si es un cliente nuevo' },
        requestDetails: { type: 'string', description: 'Resumen de la necesidad, producto, tramite o tema de la cita' },
        notes: { type: 'string', description: 'Notas adicionales para el equipo humano' }
      },
      required: ['service', 'startsAt', 'endsAt']
    }),
    execute: async (args: any) => {
      const { fullName, service, startsAt, endsAt, isNewCustomer, requestDetails, notes } = args;
      const finalFullName = fullName || ctx.contactName || 'Cliente WhatsApp';
      const finalIsNewCustomer = isNewCustomer ?? false;
      const combinedNotes = [
        requestDetails ? `Solicitud: ${requestDetails}` : null,
        notes ? `Notas: ${notes}` : null,
      ].filter(Boolean).join(' | ') || null;

      const logMessage = `\n[${new Date().toISOString()}] [TOOL CALL] bookAppointment: fullName="${finalFullName}", service="${service}", startsAt="${startsAt}", endsAt="${endsAt}"`;
      console.log(logMessage);
      const fs = require('fs');
      try { fs.appendFileSync('agent_calls.log', logMessage + '\n'); } catch(e) {}

      const supabase = createAdminClient();

      try {
        const { data: org } = await (supabase as any)
          .from('organizations')
          .select('name, timezone')
          .eq('id', ctx.orgId)
          .single();
        const timeZone = org?.timezone || 'America/Bogota';

        const hasOffset = startsAt.endsWith('Z') || startsAt.includes('+') || startsAt.match(/-\d{2}:\d{2}$/);
        const utcStartsAt = hasOffset ? new Date(startsAt) : localToUtc(startsAt, timeZone);
        const utcEndsAt = hasOffset ? new Date(endsAt) : localToUtc(endsAt, timeZone);

        const startsAtIso = utcStartsAt.toISOString();
        const endsAtIso = utcEndsAt.toISOString();

        const { data: contact } = await (supabase as any)
          .from('contacts')
          .select('id, metadata')
          .eq('organization_id', ctx.orgId)
          .eq('wa_phone', ctx.contactPhone)
          .single();

        if (!contact) {
          return { success: false, error: 'Contacto no encontrado' };
        }

        const { data: existing } = await (supabase as any)
          .from('appointments')
          .select('id')
          .eq('organization_id', ctx.orgId)
          .eq('contact_id', contact.id)
          .eq('starts_at', startsAtIso)
          .eq('status', 'confirmed')
          .single();

        if (existing) {
          return {
            success: true,
            message: 'La cita ya estaba agendada',
            appointmentId: existing.id,
          };
        }

        let googleEventId: string | null = null;
        const { data: calConfig } = await (supabase as any)
          .from('google_calendar_configs')
          .select('*')
          .eq('organization_id', ctx.orgId)
          .single();

        if (calConfig?.calendar_id && calConfig?.refresh_token_encrypted) {
          try {
            googleEventId = await createCalendarEvent(calConfig, {
              summary: `${service} - ${finalFullName}`,
              description: `Servicio: ${service}\nCliente: ${finalFullName}\nTelefono: ${ctx.contactPhone}${requestDetails ? `\nSolicitud: ${requestDetails}` : ''}${notes ? `\nNotas: ${notes}` : ''}${finalIsNewCustomer ? '\nCliente nuevo' : ''}`,
              start: startsAtIso,
              end: endsAtIso,
              location: org?.name || undefined,
            });
          } catch (err) {
            logger.warn('Could not create calendar event', { error: String(err) });
          }
        }

        const { data: appointment, error: aptErr } = await (supabase as any)
          .from('appointments')
          .insert({
            organization_id: ctx.orgId,
            contact_id: contact.id,
            service,
            starts_at: startsAtIso,
            ends_at: endsAtIso,
            google_event_id: googleEventId,
            is_new_patient: finalIsNewCustomer,
            full_name: finalFullName,
            phone: ctx.contactPhone,
            notes: combinedNotes,
          })
          .select('id')
          .single();

        if (aptErr) {
          logger.error('Failed to create appointment', { error: aptErr.message });
          return { success: false, error: 'Error al agendar la cita' };
        }

        try {
          const currentMetadata = (contact.metadata as Record<string, any>) || {};
          await (supabase as any)
            .from('contacts')
            .update({
              metadata: {
                ...currentMetadata,
                customer_profile: {
                  ...(currentMetadata.customer_profile || {}),
                  lastRequestDetails: requestDetails || currentMetadata.customer_profile?.lastRequestDetails,
                  lastService: service,
                  updatedAt: new Date().toISOString(),
                },
              },
              ...(fullName ? { full_name: fullName } : {}),
              is_new_patient: finalIsNewCustomer,
            })
            .eq('id', contact.id);
        } catch (metaErr) {
          logger.warn('Failed to update contact metadata during booking', { error: String(metaErr) });
        }

        const result = {
          success: true,
          message: 'Cita agendada exitosamente',
          appointmentId: appointment?.id,
          details: {
            service,
            fullName: finalFullName,
            date: utcStartsAt.toLocaleDateString('es-MX', { timeZone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
            time: utcStartsAt.toLocaleTimeString('es-MX', { timeZone, hour: '2-digit', minute: '2-digit' }),
            googleCalendarSynced: !!googleEventId,
          },
        };

        try { fs.appendFileSync('agent_calls.log', `[RESULT] bookAppointment: ${JSON.stringify(result)}\n`); } catch(e) {}
        return result;
      } catch (err) {
        const errorResult = { success: false, error: 'Error interno al agendar' };
        try { fs.appendFileSync('agent_calls.log', `[RESULT ERROR] bookAppointment: ${String(err)}\n`); } catch(e) {}
        logger.error('Book appointment error', { error: String(err) });
        return errorResult;
      }
    },
  } as any);
}
