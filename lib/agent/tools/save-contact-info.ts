import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';

interface ToolContext {
  orgId: string;
  contactPhone: string;
  contactName: string | null;
  conversationId: string;
}

export function saveContactInfoTool(ctx: ToolContext) {
  return tool({
    description: 'Guarda o actualiza datos utiles del cliente: nombre, empresa, email, interes, necesidad y notas de seguimiento.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        fullName: { type: 'string', description: 'Nombre completo del cliente' },
        isNewCustomer: { type: 'boolean', description: 'Si parece ser un cliente nuevo' },
        companyName: { type: 'string', description: 'Empresa u organizacion del cliente' },
        email: { type: 'string', description: 'Correo electronico del cliente' },
        interest: { type: 'string', description: 'Producto, servicio, tramite o tema de interes' },
        notes: { type: 'string', description: 'Notas breves para seguimiento humano' }
      }
    }),
    execute: async (args: any) => {
      const { fullName, isNewCustomer, companyName, email, interest, notes } = args;
      const supabase = createAdminClient();

      try {
        const { data: contact, error: fetchErr } = await (supabase as any)
          .from('contacts')
          .select('metadata, full_name, is_new_patient')
          .eq('organization_id', ctx.orgId)
          .eq('wa_phone', ctx.contactPhone)
          .single();

        if (fetchErr || !contact) {
          return { success: false, error: 'Contacto no encontrado' };
        }

        const metadata = (contact.metadata as Record<string, any>) || {};
        const customerProfile = {
          ...(metadata.customer_profile || {}),
          ...(companyName !== undefined ? { companyName } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(interest !== undefined ? { interest } : {}),
          ...(notes !== undefined ? { notes } : {}),
          updatedAt: new Date().toISOString(),
        };

        const updateData: Record<string, any> = {
          metadata: {
            ...metadata,
            customer_profile: customerProfile,
          }
        };

        if (fullName !== undefined) updateData.full_name = fullName;
        if (isNewCustomer !== undefined) updateData.is_new_patient = isNewCustomer;

        const { error: updateErr } = await (supabase as any)
          .from('contacts')
          .update(updateData)
          .eq('organization_id', ctx.orgId)
          .eq('wa_phone', ctx.contactPhone);

        if (updateErr) {
          return { success: false, error: updateErr.message };
        }

        return { success: true, message: 'Informacion del cliente actualizada exitosamente.' };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },
  } as any);
}
