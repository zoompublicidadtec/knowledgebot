import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '../../supabase/admin';
import { logger } from '../../logger';

interface ToolContext {
  orgId: string;
  contactId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
}

/**
 * HERRAMIENTA: updatePipelineStage
 * -------------------------------
 * Permite al agente mover un contacto a las etapas COMERCIALES del Pipeline CRM:
 *   - 'sales' (Ventas): negociación activa o seguimiento.
 *   - 'sold' (Listo para pagar): el cliente acepto y va a pagar.
 *
 * ⚠️ 'sold' NO ES "PAGADO". Se llamaba "Vendido" y se movia cuando el cliente
 * DECIA "lo tomo": eso es una intencion, no una venta. Un bot no puede
 * verificar un pago -- un comprobante se falsifica, y el peor caso es dar por
 * despachado algo que nadie despacho. Confirmar el pago es acto humano, y esta
 * herramienta no lo hace ni lo simula.
 *
 * ⚠️ RESTRICCIÓN DE SEGURIDAD:
 * Esta herramienta SOLO acepta 'sales' o 'sold'. Está TERMINANTEMENTE PROHIBIDO
 * que el agente mueva a 'angry', 'unhandled' o 'ignore' por cuenta propia: esas
 * etapas apagan el bot y son decisiones humanas. La molestia/queja se canaliza
 * exclusivamente a través de requestHumanHandoff.
 *
 * No escribe en la tabla messages (evita duplicados en el panel de conversaciones).
 * Tampoco pausa el bot: 'sales' y 'sold' mantienen la IA activa según la lógica
 * central de actions.ts.
 */
export function updatePipelineStageTool(ctx: ToolContext) {
  return tool({
    description:
      'Mueve al cliente a una etapa comercial del Pipeline CRM (Ventas o Vendido). ' +
      "Usa stage='sales' cuando hay negociación activa o seguimiento. " +
      "Usa stage='sold' cuando el cliente ACEPTA y va a pagar ('lo tomo', 'lo compro', 'a donde pago'). " +
      "OJO: 'sold' NO significa que ya pago. Un pago solo lo confirma una persona; tu no puedes verificarlo " +
      "ni aunque el cliente mande una foto de un comprobante. " +
      'NO uses esta herramienta para quejas ni molestias: en ese caso usa requestHumanHandoff.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        stage: {
          type: 'string',
          enum: ['sales', 'sold'],
          description: "Etapa destino: 'sales' (Ventas) o 'sold' (Vendido).",
        },
        reason: {
          type: 'string',
          description: 'Motivo breve del movimiento (ej. "cliente confirma compra", "negociación activa").',
        },
      },
      required: ['stage', 'reason'],
    }),
    execute: async (args: any) => {
      const { stage, reason } = args;

      // Doble verificación defensiva: aunque el schema enum ya lo restringe,
      // bloqueamos explícitamente cualquier etapa que apague el bot.
      if (stage !== 'sales' && stage !== 'sold') {
        logger.error('updatePipelineStage: etapa prohibida bloqueada', {
          stage, orgId: ctx.orgId, conversationId: ctx.conversationId,
        });
        return {
          success: false,
          error: 'Etapa no permitida. Solo se puede mover a Ventas o Vendido.',
        };
      }

      const supabase = createAdminClient();

      // 1. Leer metadata actual del contacto (para conservar otros campos y registrar previousStage)
      const { data: contact, error: fetchErr } = await (supabase as any)
        .from('contacts')
        .select('id, metadata')
        .eq('id', ctx.contactId)
        .single();

      if (fetchErr || !contact) {
        logger.error('updatePipelineStage: contacto no encontrado', {
          error: fetchErr?.message, contactId: ctx.contactId,
        });
        return { success: false, error: 'No se encontró el contacto.' };
      }

      const previousStage = (contact.metadata || {}).stage || 'inbox';

      // No-op si ya está en esa etapa
      if (previousStage === stage) {
        return { success: true, previousStage, newStage: stage, message: 'Ya estaba en esta etapa.' };
      }

      // 2. Actualizar el stage conservando el resto de metadata
      const { error: updateErr } = await (supabase as any)
        .from('contacts')
        .update({ metadata: { ...(contact.metadata || {}), stage } })
        .eq('id', ctx.contactId);

      if (updateErr) {
        logger.error('updatePipelineStage: error actualizando stage', {
          error: updateErr.message, contactId: ctx.contactId,
        });
        return { success: false, error: 'Error al actualizar la etapa.' };
      }

      // 3. NO tocar bot_active: 'sales' y 'sold' mantienen el bot activo
      //    (coherente con la lógica central de lib/conversations/actions.ts).

      logger.info('Pipeline stage actualizado por el agente', {
        orgId: ctx.orgId,
        conversationId: ctx.conversationId,
        contactId: ctx.contactId,
        contactName: ctx.contactName,
        previousStage,
        newStage: stage,
        reason,
      });

      return {
        success: true,
        previousStage,
        newStage: stage,
        message: `Cliente movido a ${stage === 'sold' ? 'Vendido' : 'Ventas'}.`,
      };
    },
  } as any);
}
