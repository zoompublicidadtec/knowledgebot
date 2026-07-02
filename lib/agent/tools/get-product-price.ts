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

        let uuid = product_id;
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(product_id);

        if (!isUUID) {
          // Normaliza quitando acentos y bajando a minúsculas (sin slugify agresivo).
          const norm = (t: string) => (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          const pid = norm(product_id);

          // 1. Coincidencia EXACTA por reference (tolera duplicados: usamos .limit(1), NO maybeSingle).
          let resolved: { id: string } | null = null;
          const { data: byRef } = await (supabase as any)
            .from('products')
            .select('id')
            .eq('reference', product_id)
            .limit(1);
          if (byRef && byRef.length > 0) {
            resolved = { id: byRef[0].id };
          }

          // 2. Si no, coincidencia EXACTA por nombre normalizado.
          if (!resolved) {
            const { data: byName } = await (supabase as any)
              .from('products')
              .select('id, name')
              .limit(2000);
            const exact = (byName || []).find((p: any) => norm(p.name) === pid);
            if (exact) resolved = { id: exact.id };
          }

          // 3. Si no, coincidencia PARCIAL: el nombre del producto contiene el
          // identificador recibido (o viceversa). Esto cubre el caso en que el
          // agente pasó el nombre real del catálogo en vez del código.
          if (!resolved) {
            const { data: allProds } = await (supabase as any)
              .from('products')
              .select('id, name, reference')
              .limit(3000);
            const partial = (allProds || []).find((p: any) => {
              const n = norm(p.name);
              const r = norm(p.reference || '');
              return (n && (n.includes(pid) || pid.includes(n))) ||
                     (r && (r.includes(pid) || pid.includes(r)));
            });
            if (partial) resolved = { id: partial.id };
          }

          if (resolved) {
            uuid = resolved.id;
          } else {
            return { success: false, error: `No se encontró el producto con identificador o referencia "${product_id}" en la base de datos.` };
          }
        }
        
        // Llamar a la funcion SQL que devuelve TODOS los rangos de precio del producto
        const { data, error } = await (supabase as any).rpc('get_product_price_tiers', {
          p_product_id: uuid
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

        // SALVAGUARDA ANTI-PRECIO-CORRUPTO: la base tiene valores basura (ej.
        // 1e+36) en algunos productos. Cualquier precio absurdo (>1e9 COP) o
        // no numérico invalida la cotización para evitar alucinaciones numéricas.
        const isPriceCorrupt = (p: any) => {
          const n = Number(p);
          return !Number.isFinite(n) || n <= 0 || n > 1e9;
        };
        const cleanTiers = data.filter((r: any) => !isPriceCorrupt(r.price));
        if (cleanTiers.length === 0) {
          logger.warn('Get price: todos los tiers corruptos', { product_id, uuid });
          return {
            success: false,
            error: 'PRECIO_NO_DISPONIBLE: Este producto tiene datos de precio inconsistentes en el sistema. No se puede cotizar de forma confiable.'
          };
        }

        // Fetch product details to get min_order_qty and notes
        const { data: prodData } = await (supabase as any).from('products').select('min_order_qty, notes, name').eq('id', uuid).single();
        
        // Formatear mensaje para la IA con todas las variantes y rangos (solo limpios)
        const variantesMsg = cleanTiers.map((r: any) => {
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
        const aplicables = cleanTiers.filter((r: any) => quantity >= r.min_qty && (!r.max_qty || quantity <= r.max_qty));
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
          opciones: cleanTiers,
          message: msg,
          note: 'REGLAS ESTRICTAS PARA TI: 1. Usa EXACTAMENTE el cálculo provisto en el mensaje, no intentes adivinar ni recalcular los precios. 2. Si la cantidad es MENOR al mínimo absoluto de la tabla, RECHAZA la venta. 3. OJO: Revisa si el precio es por lote o unitario. 4. NO intentes hacer UPSELL ni cotizar otras cantidades por tu cuenta (ej. no inventes cuánto valdrían 50 si pidieron 20) porque vas a dar precios erróneos. 5. ¡PROHIBIDO USAR TABLAS MARKDOWN (|---|)! Usa UNICAMENTE listas con viñetas (-) porque las tablas se rompen en WhatsApp. ¡ESTO ES CRITICO Y OBLIGATORIO!'
        };
      } catch (err: any) {
        logger.error('Get price exception', { error: String(err) });
        return { success: false, error: err.message || String(err) };
      }
    },
  } as any);
}
