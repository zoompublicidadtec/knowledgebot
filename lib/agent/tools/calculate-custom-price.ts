import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import * as fs from 'fs';

export function calculateCustomPriceTool() {
  return tool({
    description:
      'Calcula precios avanzados para productos que requieren matemáticas complejas, como la optimización de rollo (DTF Textil, Screen) donde hay que calcular cuántas piezas caben en un área o ancho fijo de papel.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        product_id: {
          type: 'string',
          description: 'El ID del producto.',
        },
        quantity: {
          type: 'number',
          description: 'La cantidad de piezas que el cliente quiere cotizar.',
        },
        piece_width_cm: {
          type: 'number',
          description: 'El ancho de la pieza/texto en centímetros.',
        },
        piece_height_cm: {
          type: 'number',
          description: 'El alto de la pieza/texto en centímetros.',
        }
      },
      required: ['product_id', 'quantity', 'piece_width_cm', 'piece_height_cm'],
    }),
    execute: async (args: any) => {
      const { product_id, quantity, piece_width_cm, piece_height_cm } = args;
      
      const logMessage = `\n[${new Date().toISOString()}] [TOOL CALL] calculateCustomPriceTool: product=${product_id}, qty=${quantity}, w=${piece_width_cm}, h=${piece_height_cm}`;
      try { fs.appendFileSync('agent_calls.log', logMessage + '\n'); } catch(e) {}

      try {
        const supabase = createAdminClient();
        
        // 1. Fetch product and category to find pricing rules
        const { data: prodData } = await (supabase as any)
          .from('products')
          .select('category_id, subcategory_id, name, unit')
          .eq('id', product_id)
          .single();

        if (!prodData) return { success: false, error: 'Producto no encontrado.' };

        // 2. Look for a pricing rule matching the category
        const { data: rule } = await (supabase as any)
          .from('pricing_rules')
          .select('*')
          .eq('category_id', prodData.category_id)
          .eq('active', true)
          .single();

        // 3. Get the price tiers to find the cost per cm2 or linear meter
        const { data: tiers } = await (supabase as any).rpc('get_product_price_tiers', {
          p_product_id: product_id
        });

        if (!rule && (!tiers || tiers.length === 0)) {
           return { success: false, error: 'No hay reglas de cálculo ni precios para este producto.' };
        }

        let mathHelp = `\nCÁLCULO EXACTO PARA LA CANTIDAD SOLICITADA (${quantity} unidades):\n`;
        let totalCost = 0;

        // --- LÓGICA DE OPTIMIZACIÓN DE ROLLO (DTF / SCREEN) ---
        if (rule && rule.calculation_type === 'roll_optimization') {
           const rollWidth = rule.parameters.roll_width_cm || 58;
           const minPricePerPiece = rule.parameters.min_price_per_piece || 200;

           // Orientación 1: piece_width a lo ancho del rollo, piece_height a lo largo
           const piecesAcrossWidth1 = Math.floor(rollWidth / piece_width_cm);
           // Orientación 2: piece_height a lo ancho del rollo, piece_width a lo largo
           const piecesAcrossWidth2 = Math.floor(rollWidth / piece_height_cm);

           let bestOrientation = 1;
           let piecesPerWidth = piecesAcrossWidth1;
           let heightUsed = piece_height_cm;
           let widthUsed = piece_width_cm;

           // Escoger la orientación que desperdicie menos ancho
           if (piecesAcrossWidth2 > 0 && (rollWidth - (piecesAcrossWidth2 * piece_height_cm) < rollWidth - (piecesAcrossWidth1 * piece_width_cm))) {
               bestOrientation = 2;
               piecesPerWidth = piecesAcrossWidth2;
               heightUsed = piece_width_cm;
               widthUsed = piece_height_cm;
           }

           if (piecesPerWidth === 0) {
               return { success: false, error: `La pieza es muy grande para el ancho del rollo (${rollWidth}cm).` };
           }

           const rowsNeeded = Math.ceil(quantity / piecesPerWidth);
           const totalLengthCm = rowsNeeded * heightUsed;
           const totalAreaCm2 = totalLengthCm * rollWidth;
           const usedAreaCm2 = quantity * (piece_width_cm * piece_height_cm);
           const wasteAreaCm2 = totalAreaCm2 - usedAreaCm2;

           mathHelp += `- **Ancho del rollo:** ${rollWidth} cm.\n`;
           mathHelp += `- **Orientación óptima:** ${widthUsed}cm a lo ancho, ${heightUsed}cm a lo largo.\n`;
           mathHelp += `- Caben **${piecesPerWidth} piezas** a lo ancho.\n`;
           mathHelp += `- Para sacar ${quantity} piezas, se necesitan **${rowsNeeded} filas**.\n`;
           mathHelp += `- **Papel total a imprimir:** ${rollWidth} cm de ancho x ${totalLengthCm} cm de largo.\n`;
           mathHelp += `- **Desperdicio estimado:** ${wasteAreaCm2} cm2.\n\n`;

           // Encontrar precio
           // Si cobran por metro lineal:
           if (prodData.unit === 'metro') {
               const lengthMeters = totalLengthCm / 100;
               const applicableTier = tiers.find((r: any) => lengthMeters >= r.min_qty && (!r.max_qty || lengthMeters <= r.max_qty));
               
               if (applicableTier) {
                   totalCost = lengthMeters * applicableTier.price;
                   mathHelp += `Precio calculado por metro lineal: ${lengthMeters} metros x $${applicableTier.price} = $${totalCost} COP.\n`;
               }
           } 
           // Si cobran por cm2:
           else if (prodData.unit === 'cm2' || prodData.unit === 'unidad') {
               const applicableTier = tiers.find((r: any) => quantity >= r.min_qty && (!r.max_qty || quantity <= r.max_qty));
               if (applicableTier) {
                   const pieceArea = piece_width_cm * piece_height_cm;
                   let unitPrice = pieceArea * applicableTier.price;
                   if (unitPrice < minPricePerPiece) unitPrice = minPricePerPiece;
                   totalCost = unitPrice * quantity;
                   mathHelp += `Precio por pieza: $${unitPrice} COP (Mínimo $${minPricePerPiece} por pieza).\n`;
                   mathHelp += `Total = $${totalCost} COP.\n`;
               }
           }

        } else {
            return { success: false, error: 'Este producto no tiene una regla de cálculo matemático especial. Usa getProductPriceTool en su lugar.' };
        }

        const msg = `PRODUCTO: ${prodData?.name}\n${mathHelp}`;

        return {
          success: true,
          message: msg,
          totalCost: totalCost,
          note: 'Dale al cliente un resumen de cómo se acomodan las piezas y por qué se utiliza esa cantidad de papel (explicando la orientación y el largo total).'
        };
      } catch (err: any) {
        logger.error('Calculate custom price exception', { error: String(err) });
        return { success: false, error: err.message || String(err) };
      }
    },
  } as any);
}
