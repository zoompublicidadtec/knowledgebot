import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import * as fs from 'fs';

export function getProductPriceTool() {
  return tool({
    description:
      'Calcula u obtiene el precio exacto de un producto segun la cantidad solicitada (y el area, si aplica). Usa esta herramienta SIEMPRE antes de dar un precio, enviando el product_id obtenido de searchCatalogTool.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        product_id: {
          type: 'string',
          description: 'El ID del producto, obtenido previamente con searchCatalogTool.',
        },
        quantity: {
          type: 'number',
          description: 'La cantidad que el cliente quiere cotizar (ej. 500).',
        },
        width_cm: {
          type: 'number',
          description: 'El ancho en centimetros (SOLO obligatorio si el producto es por metro/centimetro como Vinilos, Banners o DTF).',
        },
        height_cm: {
          type: 'number',
          description: 'El alto en centimetros (SOLO obligatorio si el producto es por metro/centimetro como Vinilos, Banners o DTF).',
        }
      },
      required: ['product_id', 'quantity'],
    }),
    execute: async (args: any) => {
      const { product_id, quantity, width_cm, height_cm } = args;
      
      const logMessage = `\n[${new Date().toISOString()}] [TOOL CALL] getProductPriceTool: product=${product_id}, qty=${quantity}, w=${width_cm}, h=${height_cm}`;
      try { fs.appendFileSync('agent_calls.log', logMessage + '\n'); } catch(e) {}

      try {
        const supabase = createAdminClient();
        
        // Llamar a la funcion SQL que devuelve TODOS los rangos de precio del producto
        const { data, error } = await (supabase as any).rpc('get_product_price_tiers', {
          p_product_id: product_id
        });

        if (error) {
          logger.error('Get price error', { error: error.message });
          return { success: false, error: `Error al cotizar: ${error.message}` };
        }

        const resultLog = `[RESULT] getProductPriceTool: ${JSON.stringify(data)}\n`;
        try { fs.appendFileSync('agent_calls.log', resultLog); } catch(e) {}

        if (!data || data.length === 0) {
          return {
            success: true,
            note: 'Este producto no tiene configurada ninguna tabla de precios en la base de datos. MODO ENTRENAMIENTO: Informa esto al administrador.'
          };
        }
        
        // Fetch product details to get min_order_qty and notes
        const { data: prodData } = await (supabase as any).from('products').select('min_order_qty, notes, name').eq('id', product_id).single();
        
        // Formatear mensaje para la IA con todas las variantes y rangos
        const variantesMsg = data.map((r: any) => {
          const unitLabel = r.price_basis === 'lote_total' ? 'por el lote completo' : 'unitario';
          const maxL = r.max_qty ? r.max_qty : 'en adelante';
          return `- Variante: ${r.variant} | De ${r.min_qty} a ${maxL} unidades -> $${r.price} ${r.currency} (${unitLabel}).`;
        }).join('\n');
        
        let msg = `PRODUCTO: ${prodData?.name}\n`;
        if (prodData?.min_order_qty) {
          msg += `CANTIDAD MINIMA ABSOLUTA DE PEDIDO REQUERIDA POR EL FABRICANTE: ${prodData.min_order_qty} unidades (NO puedes vender por debajo de este numero bajo ninguna circunstancia, ignora si la tabla empieza antes).\n`;
        }
        if (prodData?.notes) {
          msg += `NOTAS DEL PRODUCTO: ${prodData.notes}\n`;
        }
        
        let mathHelp = `\nCÁLCULO EXACTO PARA LA CANTIDAD SOLICITADA (${quantity} unidades):\n`;
        const aplicables = data.filter((r: any) => quantity >= r.min_qty && (!r.max_qty || quantity <= r.max_qty));
        if (aplicables.length > 0) {
          aplicables.forEach((r: any) => {
            if (r.price_basis === 'cm2') {
              if (!width_cm || !height_cm) {
                mathHelp += `- ERROR: Este producto se cobra por área (cm2), pero no me diste el ancho y el alto. Dile al cliente: "¿Me podrías indicar de qué ancho y alto (en centímetros) necesitas la pieza para darte el precio exacto?".\n`;
              } else {
                const area = width_cm * height_cm;
                let unitPrice = area * r.price;
                if (unitPrice < 200) unitPrice = 200; // Minimum price per piece rule
                const total = unitPrice * quantity;
                mathHelp += `- Si elige "${r.variant}": El área de una pieza es ${area} cm2. El precio unitario es $${unitPrice} COP. El precio total por las ${quantity} unidades es $${total} COP.\n`;
              }
            } else {
              const total = r.price_basis === 'lote_total' ? r.price : (r.price * quantity);
              mathHelp += `- Si elige "${r.variant}": El precio total a cobrar por las ${quantity} unidades es $${total} ${r.currency}.\n`;
            }
          });
        } else {
          mathHelp += `(La cantidad ${quantity} no entra en ningun rango de la tabla, ofrécele el rango más cercano).\n`;
        }
        
        msg += `\nTABLA COMPLETA DE PRECIOS PARA ESTE PRODUCTO:\n${variantesMsg}\n\nCantidad solicitada por el cliente: ${quantity}\n${mathHelp}`;

        return {
          success: true,
          opciones: data,
          message: msg,
          note: 'REGLAS ESTRICTAS PARA TI: 1. Busca en la tabla el rango donde encaja la cantidad solicitada. 2. Si la cantidad es MENOR al minimo absoluto de la tabla, RECHAZA la venta. 3. OJO: Revisa si el precio es por lote o unitario. 4. ¡Haz UPSELL usando el siguiente rango!. 5. ¡PROHIBIDO USAR TABLAS MARKDOWN (|---|) PARA MOSTRAR ESTOS PRECIOS AL CLIENTE! Usa UNICAMENTE listas con viñetas (-) porque las tablas se rompen en WhatsApp. ¡ESTO ES CRITICO Y OBLIGATORIO!'
        };
      } catch (err: any) {
        logger.error('Get price exception', { error: String(err) });
        return { success: false, error: err.message || String(err) };
      }
    },
  } as any);
}
