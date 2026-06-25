import { tool, jsonSchema } from 'ai';
import { getFreeBusySlots } from '@/lib/google/calendar';
import { createAdminClient } from '@/lib/supabase/admin';
import { localToUtc } from '@/lib/timezone';
import type { BusinessHours, ServiceConfig } from '@/lib/database.types';

interface ToolContext {
  orgId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
}

export function getAvailableSlotsTool(ctx: ToolContext) {
  return tool({
    description: 'Busca horarios disponibles para agendar una cita. Devuelve hasta 3 opciones de horarios libres.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Fecha a consultar en formato YYYY-MM-DD' },
        serviceName: { type: 'string', description: 'Nombre del servicio que el cliente necesita' },
      },
      required: ['date', 'serviceName'],
    }),
    execute: async (args: any) => {
      const { date, serviceName } = args;
      const logMessage = `\n[${new Date().toISOString()}] [TOOL CALL] getAvailableSlots: date="${date}", serviceName="${serviceName}"`;
      console.log(logMessage);
      const fs = require('fs');
      try { fs.appendFileSync('agent_calls.log', logMessage + '\n'); } catch(e){}

      const supabase = createAdminClient();

      // Get organization and timezone
      const { data: org } = await (supabase as any)
        .from('organizations')
        .select('timezone')
        .eq('id', ctx.orgId)
        .single();
      const timeZone = org?.timezone || 'America/Mexico_City';

      // Get agent config for business hours and services
      const { data: agentConfig } = await (supabase as any)
        .from('agent_configs')
        .select('business_hours, services')
        .eq('organization_id', ctx.orgId)
        .single();

      if (!agentConfig) {
        return { error: 'Configuración no encontrada', slots: [] };
      }

      const services = agentConfig.services as unknown as ServiceConfig[];
      const service = services.find(
        s => s.name.toLowerCase().includes(serviceName.toLowerCase())
      );
      const durationMinutes = service?.duration_minutes || 30;

      // Check business hours for the day
      const hours = agentConfig.business_hours as unknown as BusinessHours;
      const dayMap: Record<number, keyof BusinessHours> = {
        0: 'sun', 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat',
      };
      // We parse using UTC representation to avoid timezone shifts during local day resolution
      const requestedDate = new Date(date + 'T00:00:00Z');
      const dayKey = dayMap[requestedDate.getUTCDay()];
      const dayHours = hours[dayKey];

      if (!dayHours || dayHours.length === 0) {
        return {
          error: 'El negocio está cerrado ese día',
          slots: [],
          dayOfWeek: dayKey,
        };
      }

      // Get Google Calendar config
      const { data: calConfig } = await (supabase as any)
        .from('google_calendar_configs')
        .select('*')
        .eq('organization_id', ctx.orgId)
        .single();

      let busySlots: { start: string; end: string }[] = [];

      if (calConfig?.calendar_id && calConfig?.refresh_token_encrypted) {
        try {
          busySlots = await getFreeBusySlots(calConfig, date);
        } catch {
          // Calendar not configured or error — continue without
        }
      }

      // Generate available slots
      const availableSlots: { start: string; end: string }[] = [];

      for (const range of dayHours) {
        const [startH, startM] = range.start.split(':').map(Number);
        const [endH, endM] = range.end.split(':').map(Number);

        let currentMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        while (currentMinutes + durationMinutes <= endMinutes && availableSlots.length < 3) {
          const localStartStr = `${date}T${String(Math.floor(currentMinutes / 60)).padStart(2, '0')}:${String(currentMinutes % 60).padStart(2, '0')}:00`;
          const slotStart = localToUtc(localStartStr, timeZone);

          const slotEnd = new Date(slotStart);
          slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes);

          // Check if slot conflicts with busy times
          const isConflict = busySlots.some(busy => {
            const busyStart = new Date(busy.start).getTime();
            const busyEnd = new Date(busy.end).getTime();
            return slotStart.getTime() < busyEnd && slotEnd.getTime() > busyStart;
          });

          // Check if slot is in the past
          const isPast = slotStart.getTime() < Date.now();

          if (!isConflict && !isPast) {
            availableSlots.push({
              start: slotStart.toISOString(),
              end: slotEnd.toISOString(),
            });
          }

          currentMinutes += 30; // Check every 30 min
        }
      }

      const result = {
        date,
        service: serviceName,
        duration_minutes: durationMinutes,
        slots: availableSlots.map((s, i) => ({
          option: i + 1,
          start: s.start,
          end: s.end,
          startFormatted: new Date(s.start).toLocaleTimeString('es-MX', { timeZone, hour: '2-digit', minute: '2-digit' }),
          endFormatted: new Date(s.end).toLocaleTimeString('es-MX', { timeZone, hour: '2-digit', minute: '2-digit' }),
        })),
      };

      try {
        const fs = require('fs');
        fs.appendFileSync('agent_calls.log', `[RESULT] getAvailableSlots: Found ${result.slots.length} slots. Data: ${JSON.stringify(result)}\n`);
      } catch(e){}

      return result;
    },
  } as any);
}
