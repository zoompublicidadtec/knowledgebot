import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '../../supabase/admin';
import { logger } from '../../logger';
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
      let { product_id } = args;
      const { quantity, piece_width_cm, piece_height_cm } = args;
      
      const logMessage = `\n[${new Date().toISOString()}] [TOOL CALL] calculateCustomPriceTool: product=${product_id}, qty=${quantity}, w=${piece_width_cm}, h=${piece_height_cm}`;
      try { fs.appendFileSync('agent_calls.log', logMessage + '\n'); } catch(e) {}

      try {
        const supabase = createAdminClient();

        // 1. El agente recibe de searchCatalog la referencia comercial
        //    (ZM-GEN-310), no el UUID. Sin resolverla, DTF UV y DTF Textil
        //    nunca se podían cotizar: la búsqueda por `id` no encontraba nada.
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(String(product_id));

        const query = (supabase as any)
          .from('products')
          .select('id, category_id, subcategory_id, name, unit, reference');

        const { data: rows } = isUUID
          ? await query.eq('id', product_id).limit(1)
          : await query.eq('reference', product_id).eq('active', true).limit(1);

        const prodData = rows?.[0];
        if (!prodData) return { success: false, error: 'Producto no encontrado.' };

        // A partir de aquí siempre se trabaja con el UUID real.
        product_id = prodData.id;

        // 2. Look for a pricing rule matching the category (wrap in try-catch to avoid crashing if table is missing)
        let rule: any = null;
        try {
          const { data } = await (supabase as any)
            .from('pricing_rules')
            .select('*')
            .eq('category_id', prodData.category_id)
            .eq('active', true)
            .single();
          rule = data;
        } catch (e) {
          logger.warn('pricing_rules table not available, falling back to programmatic logic', { error: String(e) });
        }

        // 3. Get the price tiers to find the cost per cm2 or linear meter
        let tiers: any[] = [];
        try {
          const { data } = await (supabase as any).rpc('get_product_price_tiers', {
            p_product_id: product_id
          });
          tiers = data || [];
        } catch (e) {
          logger.warn('get_product_price_tiers failed, will use hardcoded rates if applicable', { error: String(e) });
        }

        let mathHelp = `\nCÁLCULO EXACTO PARA LA CANTIDAD SOLICITADA (${quantity} unidades):\n`;
        let totalCost = 0;
        let isCalculated = false;

        /**
         * Un producto vendido POR UNIDAD no se calcula por área.
         *
         * Abajo, el atajo de DTF se dispara por el nombre, y "Gorra Dril 5
         * Paneles DTF Textil" lo contiene. Sin esta puerta, una gorra entraba al
         * cálculo de aprovechamiento del rollo: 12 gorras de 5x5 cm salían en
         * $2.500 en total. Sus seis rangos por cantidad quedaban sin mirar.
         *
         * Si la CATEGORÍA tiene una regla de cálculo declarada (`pricing_rules`),
         * eso es una decisión explícita del negocio y manda. Sin regla y vendido
         * por unidad, aquí no hay nada que calcular: lo cotiza getProductPrice.
         */
        if (!rule && String(prodData.unit || '').toLowerCase() === 'unidad') {
          logger.info('calculateCustomPrice: producto por unidad, se devuelve a getProductPrice', {
            product_id, name: prodData.name,
          });
          return {
            success: false,
            error:
              `"${prodData.name}" se vende POR UNIDAD: su precio depende solo de la cantidad, ` +
              `no de las medidas. Ejecuta getProductPrice con este product_id y la cantidad que ` +
              `pidió el cliente. NO le pidas ancho ni alto: ese dato no cambia el precio.`,
          };
        }

        const prodNameUpper = (prodData.name || '').toUpperCase();
        
        // --- HARDCODED FALLBACK FOR DTF UV / DTF TEXTIL ---
        if (
          product_id === 'a20da0d7-4149-4ed1-ad1a-aaa4cfe63458' ||
          product_id === '198d6ebf-6fb7-4906-8f35-32adb6f76cf3' ||
          prodNameUpper.includes('DTF UV') ||
          prodNameUpper.includes('DTF TEXTIL')
        ) {
          const isUV = product_id === 'a20da0d7-4149-4ed1-ad1a-aaa4cfe63458' || prodNameUpper.includes('UV');
          const rollWidth = isUV ? 59 : 58;
          const ratePerCmHeight = isUV ? 700 : 250;
          const prodLabel = isUV ? 'DTF UV' : 'DTF Textil';

          const w = parseFloat(String(piece_width_cm));
          const h = parseFloat(String(piece_height_cm));
          
          // Orientación A: w a lo ancho, h a lo largo
          const acrossA = Math.floor(rollWidth / w);
          // Orientación B: h a lo ancho, w a lo largo
          const acrossB = Math.floor(rollWidth / h);

          let bestOrientation = 1;
          let piecesPerWidth = acrossA;
          let heightUsed = h;
          let widthUsed = w;

          if (acrossB > 0 && (acrossB > acrossA || acrossA === 0)) {
            bestOrientation = 2;
            piecesPerWidth = acrossB;
            heightUsed = w;
            widthUsed = h;
          }

          if (piecesPerWidth === 0) {
            return { success: false, error: `La pieza de ${w}x${h} cm es muy grande para el ancho del rollo de ${rollWidth} cm.` };
          }

          const rowsNeeded = Math.ceil(quantity / piecesPerWidth);
          const totalLengthCm = rowsNeeded * heightUsed;
          const totalAreaCm2 = totalLengthCm * rollWidth;
          const usedAreaCm2 = quantity * (w * h);
          const wasteAreaCm2 = totalAreaCm2 - usedAreaCm2;

          totalCost = totalLengthCm * ratePerCmHeight;
          isCalculated = true;

          mathHelp += `- **Ancho del rollo:** ${rollWidth} cm.\n`;
          mathHelp += `- **Orientación óptima:** ${widthUsed}cm a lo ancho, ${heightUsed}cm a lo largo.\n`;
          mathHelp += `- Caben **${piecesPerWidth} piezas** a lo ancho.\n`;
          mathHelp += `- Para sacar ${quantity} piezas, se necesitan **${rowsNeeded} filas**.\n`;
          mathHelp += `- **Papel total a imprimir:** ${rollWidth} cm de ancho x ${totalLengthCm} cm de largo.\n`;
          mathHelp += `- **Precio calculado por largo:** ${totalLengthCm} cm x $${ratePerCmHeight} = $${totalCost} COP.\n`;
          mathHelp += `- **Desperdicio estimado:** ${wasteAreaCm2.toFixed(1)} cm².\n`;
        }
        
        // --- DATABASE RULE FALLBACK ---
        if (!isCalculated && rule && rule.calculation_type === 'roll_optimization') {
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
          if (prodData.unit === 'metro') {
              const lengthMeters = totalLengthCm / 100;
              const applicableTier = tiers.find((r: any) => lengthMeters >= r.min_qty && (!r.max_qty || lengthMeters <= r.max_qty));
              
              if (applicableTier) {
                  totalCost = lengthMeters * applicableTier.price;
                  mathHelp += `Precio calculado por metro lineal: ${lengthMeters} metros x $${applicableTier.price} = $${totalCost} COP.\n`;
              }
          } 
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
          isCalculated = true;
        }

        if (!isCalculated) {
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
