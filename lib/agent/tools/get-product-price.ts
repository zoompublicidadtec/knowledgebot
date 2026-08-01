import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '../../supabase/admin';
import { logger } from '../../logger';
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
        // `unit` es la Unidad de medida que el dueño eligió en el panel. Faltaba
        // en este select, así que `unit` valía siempre '' y NINGUNA de las reglas
        // de abajo podía consultarla: el modo de cobro terminaba decidiéndose
        // solo por palabras del nombre. Ver el comentario de `porCantidad`.
        const { data: prodData } = await (supabase as any).from('products').select('min_order_qty, notes, name, unit').eq('id', uuid).single();
        
        // Formatear mensaje para la IA con todas las variantes y rangos (solo limpios)
        const variantesMsg = cleanTiers.map((r: any) => {
          const unitLabel = r.price_basis === 'lote_total' ? 'por el lote completo' : 'unitario';
          const maxL = r.max_qty ? r.max_qty : 'en adelante';
          return `- Variante: ${r.variant} | De ${r.min_qty} a ${maxL} unidades -> $${r.price} ${r.currency} (${unitLabel}).`;
        }).join('\n');
        
        let msg = `PRODUCTO: ${prodData?.name}\n`;
        if (prodData?.min_order_qty && quantity < prodData.min_order_qty) {
          msg += `CANTIDAD MINIMA HABITUAL: ${prodData.min_order_qty} unidades.\n`;
          msg += `IMPORTANTE PARA EL BOT: El cliente pidio ${quantity} unidades, que es MENOS del minimo habitual de ${prodData.min_order_qty}. Debes INFORMARLE amablemente que el minimo habitual es ${prodData.min_order_qty}, PERO igual DALE el precio referencial de ${quantity} unidades (calculado abajo). CIERRA SIEMPRE con la nota exacta: "sujeto a aprobacion y disponibilidad". NUNCA rechaces la venta ni dejes al cliente sin precio.\n`;
        }
        if (prodData?.notes) {
          msg += `NOTAS DEL PRODUCTO: ${prodData.notes}\n`;
        }
        
        let mathHelp = `\nCÁLCULO EXACTO PARA LA CANTIDAD SOLICITADA (${quantity} unidades):\n`;
        const nameUpper = (prodData?.name || '').toUpperCase();
        const unit = (prodData?.unit || '').toLowerCase();

        /**
         * EL MODO DE COBRO SALE DE LA CONFIGURACIÓN, NO DEL NOMBRE.
         *
         * Las reglas de abajo se eligen por palabras del nombre ('DTF TEXTIL',
         * 'VINILO', 'BANNER'…). Eso secuestra a cualquier producto que lleve esa
         * palabra aunque se venda de otra forma.
         *
         * Medido el 01-ago-2026, con un cliente real: la **Gorra Dril 5 Paneles
         * DTF Textil** (ZM-TEX-031) está bien configurada —`unidad`, mínimo 6 y
         * seis rangos por cantidad, de $14.000 a $10.500— pero su nombre
         * contiene "DTF TEXTIL", así que entraba en la regla del rollo de
         * transferencia: el bot le pidió al cliente el ancho y el alto del logo,
         * el cliente insistió y los dio (5x5 cm), y la cotización terminó en un
         * error. Nunca miró los seis precios que tenía al lado. La venta se
         * perdió pidiendo un dato que no hacía ninguna falta.
         *
         * Un producto vendido POR UNIDAD se cotiza por cantidad y punto. Las
         * reglas por área quedan para lo que de verdad se mide (m², metro).
         * `Araña 2x1m con Impresión Banner` ($110.000 la unidad) estaba rota por
         * lo mismo y se arregla sola con esto.
         */
        const porCantidad = unit === 'unidad';
        if (porCantidad) {
          logger.info('Get price: producto por unidad, se cotiza por cantidad', {
            product_id, name: prodData?.name, quantity,
          });
        }

        let customCalculated = false;

        // 1. DTF UV / DTF TEXTIL
        if (
          !porCantidad && (
          uuid === 'a20da0d7-4149-4ed1-ad1a-aaa4cfe63458' ||
          uuid === '198d6ebf-6fb7-4906-8f35-32adb6f76cf3' ||
          nameUpper.includes('DTF UV') ||
          nameUpper.includes('DTF TEXTIL'))
        ) {
          customCalculated = true;
          const isUV = uuid === 'a20da0d7-4149-4ed1-ad1a-aaa4cfe63458' || nameUpper.includes('UV');
          const rollWidth = isUV ? 59 : 58;
          const pricePerCmHeight = isUV ? 700 : 250;
          const prodName = isUV ? 'DTF UV' : 'DTF Textil';
          
          if (!width_cm || !height_cm) {
            mathHelp += `- ERROR: Este producto (${prodName}) requiere ancho y alto. Dile al cliente: "Para cotizar ${prodName}, ¿me podrías indicar de qué ancho y alto (en centímetros) necesitas tus diseños/logos?"\n`;
          } else {
            const w = parseFloat(String(width_cm));
            const h = parseFloat(String(height_cm));
            
            // Orientación A: w a lo ancho, h a lo largo
            const acrossA = Math.floor(rollWidth / w);
            // Orientación B: h a lo ancho, w a lo largo
            const acrossB = Math.floor(rollWidth / h);
            
            let piecesAcross = 0;
            let heightUsed = 0;
            let orientationDesc = '';
            
            if (acrossA > 0 && acrossB > 0) {
              if (acrossA >= acrossB) {
                piecesAcross = acrossA;
                heightUsed = h;
                orientationDesc = `${w}cm a lo ancho, ${h}cm a lo largo`;
              } else {
                piecesAcross = acrossB;
                heightUsed = w;
                orientationDesc = `${h}cm a lo ancho, ${w}cm a lo largo`;
              }
            } else if (acrossA > 0) {
              piecesAcross = acrossA;
              heightUsed = h;
              orientationDesc = `${w}cm a lo ancho, ${h}cm a lo largo`;
            } else if (acrossB > 0) {
              piecesAcross = acrossB;
              heightUsed = w;
              orientationDesc = `${h}cm a lo ancho, ${w}cm a lo largo`;
            }
            
            if (piecesAcross === 0) {
              mathHelp += `- ERROR: La pieza de ${w}x${h} cm es demasiado grande para el ancho del rollo de ${rollWidth} cm.\n`;
            } else {
              const rowsNeeded = Math.ceil(quantity / piecesAcross);
              const totalHeightCm = rowsNeeded * heightUsed;
              const totalCost = totalHeightCm * pricePerCmHeight;
              
              mathHelp += `- **Ancho del rollo:** ${rollWidth} cm.\n`;
              mathHelp += `- **Distribución óptima:** Caben ${piecesAcross} piezas a lo ancho (${orientationDesc}).\n`;
              mathHelp += `- Para ${quantity} piezas se necesitan ${rowsNeeded} filas.\n`;
              mathHelp += `- **Largo total del material:** ${totalHeightCm} cm.\n`;
              mathHelp += `- **Precio total:** $${totalCost} COP.\n`;
            }
          }
        }
        // 2. Vinilo + Poliestireno (impresión rígida) calibres 10 a 80
        else if (
          !porCantidad && (
          uuid === '318776b0-ac26-46a6-a028-25a22a92c90d' || // cal 10
          uuid === '80daaf1a-6d0c-47a6-a7e7-103d27c89053' || // cal 20
          uuid === 'bd1ca085-0ddd-4687-a651-515876a6a67c' || // cal 30
          uuid === '8fda083f-7243-4014-97cb-b7ec3536b656' || // cal 40
          uuid === '7f86b358-fb63-40be-aca0-9978a5be9e5f' || // cal 60
          uuid === 'f3bbb32f-73ae-42d8-8ff8-3505d19cd99e' ||  // cal 80
          nameUpper.includes('VINILO LAMINADO + POLI'))
        ) {
          customCalculated = true;
          if (!width_cm || !height_cm) {
            mathHelp += `- ERROR: Este producto requiere las dimensiones. Dile al cliente: "¿Me podrías indicar de qué ancho y alto (en centímetros) necesitas la pieza para darte el precio exacto?".\n`;
          } else {
            const w = parseFloat(String(width_cm));
            const h = parseFloat(String(height_cm));
            const area = w * h;
            const unitPrice = area * 10;
            const total = unitPrice * quantity;
            mathHelp += `- **Área por pieza:** ${area} cm².\n`;
            mathHelp += `- **Precio unitario:** $${unitPrice} COP.\n`;
            mathHelp += `- **Precio total por ${quantity} unidades:** $${total} COP.\n`;
          }
        }
        // 3. Vinilos y Banners (unidad m2)
        else if (
          !porCantidad && (
          unit === 'm2' ||
          unit === 'metro' ||
          nameUpper.includes('VINILO') ||
          nameUpper.includes('BANNER') ||
          nameUpper.includes('PANAFLEX') ||
          nameUpper.includes('FROSTED'))
        ) {
          customCalculated = true;
          if (!width_cm || !height_cm) {
            mathHelp += `- ERROR: Este producto se cobra por metro cuadrado (m²). Dile al cliente: "Para cotizar este material, ¿me podrías indicar el ancho y alto (en centímetros) que necesitas para cada pieza?"\n`;
          } else {
            const w = parseFloat(String(width_cm));
            const h = parseFloat(String(height_cm));
            // Regla de aproximación a 100cm (1 metro)
            const calcW = Math.max(w, 100);
            const calcH = Math.max(h, 100);
            const areaPerPieceM2 = (calcW * calcH) / 10000;
            const totalAreaM2 = areaPerPieceM2 * quantity;
            
            const tier = cleanTiers[0]; // Usar el primer tier disponible
            if (tier) {
              const totalCost = totalAreaM2 * tier.price;
              mathHelp += `- **Dimensiones reales:** ${w} x ${h} cm.\n`;
              if (w < 100 || h < 100) {
                mathHelp += `- **Aproximación mínima de cobro (100cm):** ${calcW} x ${calcH} cm.\n`;
              }
              mathHelp += `- **Área por pieza:** ${areaPerPieceM2.toFixed(4)} m².\n`;
              mathHelp += `- **Área total para ${quantity} piezas:** ${totalAreaM2.toFixed(4)} m².\n`;
              mathHelp += `- **Precio por m²:** $${tier.price} COP.\n`;
              mathHelp += `- **Precio total:** $${totalCost} COP.\n`;
            } else {
              mathHelp += `- ERROR: No se encontró precio por m² configurado para este producto.\n`;
            }
          }
        }
        // 3.5 Tarjetas y Volantes (Venta por Millares)
        else if (
          uuid === 'bdcdfa57-b7a3-4e03-92e0-ea385e822f7f' ||
          uuid === '65f234b4-110a-49bf-b0a3-95c4631e9824' ||
          uuid === '6f8b8ccc-fb7a-4a36-9f7a-7d2e03a96682' ||
          nameUpper.includes('TARJETA') ||
          uuid === '55c67e68-da7e-4411-aa54-fefeeb8142c1' ||
          uuid === '0fe1e882-9c7c-45a6-b81e-95fe55b76e39' ||
          uuid === '21caaaec-28bb-41a5-bb12-a57fd2435e97' ||
          uuid === '0ca38acf-53e4-4add-a380-3e9cd151cc3d' ||
          uuid === 'f42daada-b85e-4e7c-9069-1dca8a31990c' ||
          uuid === '3863281e-bbf1-4a34-97f3-de58d0921b21' ||
          nameUpper.includes('VOLANTE')
        ) {
          customCalculated = true;
          const isTarjeta = nameUpper.includes('TARJETA');
          
          // Normalizar cantidad a millares (si nos pasan 1000 unidades lo convertimos a 1 millar)
          let millares = quantity;
          if (quantity >= 100) {
            millares = Math.ceil(quantity / 1000);
          }
          
          let basePricePerMillar = 0;
          let minMillares = 1;
          const prodName = prodData?.name || 'Producto';
          
          if (uuid === 'bdcdfa57-b7a3-4e03-92e0-ea385e822f7f' || nameUpper.includes('TARJETAS BRILLANTES')) {
            basePricePerMillar = 55000;
          } else if (uuid === '65f234b4-110a-49bf-b0a3-95c4631e9824' || nameUpper.includes('TARJETAS MATE UV')) {
            basePricePerMillar = 75000;
          } else if (uuid === '6f8b8ccc-fb7a-4a36-9f7a-7d2e03a96682' || nameUpper.includes('TARJETAS IMANADAS')) {
            basePricePerMillar = 180000;
          } else if (uuid === '55c67e68-da7e-4411-aa54-fefeeb8142c1' || nameUpper.includes('VOLANTE CARTA 4X4')) {
            basePricePerMillar = 260000;
          } else if (uuid === '0fe1e882-9c7c-45a6-b81e-95fe55b76e39' || nameUpper.includes('VOLANTE CARTA 4X0')) {
            basePricePerMillar = 140000;
          } else if (uuid === '21caaaec-28bb-41a5-bb12-a57fd2435e97' || nameUpper.includes('VOLANTE MEDIA CARTA 4X4')) {
            basePricePerMillar = 130000;
          } else if (uuid === '0ca38acf-53e4-4add-a380-3e9cd151cc3d' || nameUpper.includes('VOLANTE MEDIA CARTA 4X0')) {
            basePricePerMillar = 70000;
          } else if (uuid === 'f42daada-b85e-4e7c-9069-1dca8a31990c' || nameUpper.includes('VOLANTE 1/4 DE CARTA 4X4')) {
            basePricePerMillar = 65000; // $130,000 por lote de 2 millares
            minMillares = 2;
          } else if (uuid === '3863281e-bbf1-4a34-97f3-de58d0921b21' || nameUpper.includes('VOLANTE 1/4 DE CARTA 4X0')) {
            basePricePerMillar = 35000; // $70,000 por lote de 2 millares
            minMillares = 2;
          } else {
            basePricePerMillar = cleanTiers[0]?.price || 0;
            if (cleanTiers[0]?.price_basis === 'lote_total' && cleanTiers[0]?.min_qty > 0) {
              basePricePerMillar = cleanTiers[0].price / cleanTiers[0].min_qty;
            }
          }
          
          if (millares < minMillares) {
            mathHelp += `- ERROR: La cantidad mínima de pedido para ${prodName} es de ${minMillares} millar(es) (${minMillares * 1000} unidades). Dile al cliente que el pedido mínimo es de ${minMillares} millar(es).\n`;
          } else {
            const baseTotal = basePricePerMillar * millares;
            mathHelp += `- **Producto:** ${prodName}\n`;
            mathHelp += `- **Cantidad solicitada:** ${millares} millar(es) (${millares * 1000} unidades).\n`;
            mathHelp += `- **Valor base por millar:** $${basePricePerMillar} COP.\n`;
            mathHelp += `- **Valor base total:** $${baseTotal} COP.\n`;
            
            if (isTarjeta) {
              mathHelp += `\n**ADICIONALES TÉCNICOS (SOLO si el cliente los solicita explícitamente - ¡SILENCIO PROACTIVO!):**\n`;
              mathHelp += `- Despunte Normal: +$10.000 COP por millar. (Total adicional para ${millares} millar(es): $${10000 * millares} COP)\n`;
              mathHelp += `- Despunte Imán: +$20.000 COP por millar. (Total adicional para ${millares} millar(es): $${20000 * millares} COP)\n`;
              mathHelp += `- Troquel Especial: +$80.000 COP por millar. (Total adicional para ${millares} millar(es): $${80000 * millares} COP)\n`;
              mathHelp += `\n*Fórmula si aplica adicional:* Sumar el costo del adicional solicitado al valor base total.\n`;
            }
          }
        }

        // 4. Standard Product Price Tiers
        if (!customCalculated) {
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
            // La cantidad solicitada no entra en ningún rango de la tabla.
            // Forma 3: calcular precio referencial con el rango más cercano
            // y dejar claro que es "sujeto a aprobación y disponibilidad".
            // Buscar el tier con el min_qty más bajo como referencia.
            const refTier = cleanTiers
              .slice().sort((a: any, b: any) => a.min_qty - b.min_qty)[0];
            if (refTier && refTier.price_basis !== 'cm2' && refTier.price_basis !== 'lote_total') {
              const refUnitPrice = refTier.price;
              const refTotal = refUnitPrice * quantity;
              mathHelp += `- CANTIDAD MENOR AL MINIMO: El cliente pidio ${quantity} unidades. El minimo habitual de la tabla es ${refTier.min_qty}.\n`;
              mathHelp += `- PRECIO REFERENCIAL para ${quantity} unidades (tarifa de ${refTier.min_qty}+): $${refUnitPrice} unitario COP, $${refTotal} total COP.\n`;
              mathHelp += `- INSTRUCCION: Informale al cliente que el minimo habitual es ${refTier.min_qty} unidades, PERO dile que para ${quantity} unidades el valor referencial seria $${refTotal} COP, sujeto a aprobacion y disponibilidad. NUNCA lo dejes sin precio.\n`;
            } else if (refTier) {
              // Caso lote_total u otros: usar el tier tal cual
              mathHelp += `- CANTIDAD MENOR AL MINIMO: El minimo habitual de la tabla empieza en ${refTier.min_qty} unidades.\n`;
              mathHelp += `- INSTRUCCION: Informale al cliente que el minimo habitual es ${refTier.min_qty}, pero que puedes consultar el precio referencial de ${quantity} unidades sujeto a aprobacion y disponibilidad. NUNCA lo dejes sin respuesta.\n`;
            } else {
              mathHelp += `(La cantidad ${quantity} no entra en ningun rango de la tabla, ofrécele el rango más cercano, sujeto a aprobacion y disponibilidad).\n`;
            }
          }
        }
        
        msg += `\nTABLA COMPLETA DE PRECIOS PARA ESTE PRODUCTO:\n${variantesMsg}\n\nCantidad solicitada por el cliente: ${quantity}\n${mathHelp}`;

        return {
          success: true,
          opciones: cleanTiers,
          message: msg,
          note: 'REGLAS ESTRICTAS PARA TI: 1. Usa EXACTAMENTE el cálculo provisto en el mensaje, no intentes adivinar ni recalcular los precios. 2. Si la cantidad es MENOR al mínimo habitual, INFORMA el mínimo PERO da el precio referencial de la cantidad pedida con la nota obligatoria "sujeto a aprobación y disponibilidad". NUNCA rechaces ni dejes al cliente sin precio. 3. OJO: Revisa si el precio es por lote o unitario. 4. NO intentes hacer UPSELL ni cotizar otras cantidades por tu cuenta (ej. no inventes cuánto valdrían 50 si pidieron 20) porque vas a dar precios erróneos. 5. ¡PROHIBIDO USAR TABLAS MARKDOWN (|---|)! Usa UNICAMENTE listas con viñetas (-) porque las tablas se rompen en WhatsApp. ¡ESTO ES CRITICO Y OBLIGATORIO!'
        };
      } catch (err: any) {
        logger.error('Get price exception', { error: String(err) });
        return { success: false, error: err.message || String(err) };
      }
    },
  } as any);
}
