import { tool, jsonSchema } from 'ai';
import { logger } from '../../logger';
import { moverEtapaSiAvanza } from '../pipeline-automatico';

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
 *
 * ESTA HERRAMIENTA YA NO ES LA ÚNICA VÍA, NI LA PRINCIPAL.
 * -------------------------------------------------------
 * Medido el 02-ago-2026: de 32 conversaciones el modelo movió 2 tarjetas,
 * mientras 18 clientes habían recibido una cotización con precio. Depender de
 * que se acuerde no funciona, así que ahora la etapa se deduce de los hechos
 * del turno en `lib/agent/pipeline-automatico.ts`.
 *
 * La herramienta se conserva por decisión del dueño (02-ago): mueven las dos
 * vías, la primera que se dé cuenta. Pero **la escritura es una sola** —
 * `moverEtapaSiAvanza`— para que las dos garantías se cumplan venga de donde
 * venga: solo se avanza, y una etapa puesta por una persona no se toca.
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

      const resultado = await moverEtapaSiAvanza({
        orgId: ctx.orgId,
        contactId: ctx.contactId,
        conversationId: ctx.conversationId,
        destino: stage,
        motivo: `pedido por el modelo: ${reason}`,
      });

      const previousStage = resultado.etapaAnterior ?? 'inbox';

      if (!resultado.movido) {
        // Que no se moviera casi nunca es un error: lo normal es que la regla
        // automática ya la hubiera movido, o que una persona la tenga en una
        // etapa que el código no toca. El modelo no necesita saber más.
        if (resultado.razon === 'contacto-no-encontrado') {
          return { success: false, error: 'No se encontró el contacto.' };
        }
        if (resultado.razon === 'error-al-escribir') {
          return { success: false, error: 'Error al actualizar la etapa.' };
        }
        return {
          success: true,
          previousStage,
          newStage: previousStage,
          message: 'El cliente ya estaba en esa etapa o en una más avanzada.',
        };
      }

      return {
        success: true,
        previousStage,
        newStage: stage,
        message: `Cliente movido a ${stage === 'sold' ? 'Listo para pagar' : 'Ventas'}.`,
      };
    },
  } as any);
}
