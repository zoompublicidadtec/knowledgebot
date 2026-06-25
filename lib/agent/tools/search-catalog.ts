import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export function searchCatalogTool() {
  return tool({
    description:
      'Busca productos en el catalogo por nombre, categoria o descripcion. Devuelve el ID del producto (product_id), nombre y unidad de medida. Usalo SIEMPRE para identificar de que producto habla el cliente antes de pedir el precio.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'El termino de busqueda del producto (ej. "llavero plastisol", "mug magico", "gorra dril").',
        },
      },
      required: ['query'],
    }),
    execute: async (args: any) => {
      const rawQuery = String(args.query || '').trim();

      if (!rawQuery) {
        return { success: false, error: 'Debes enviar un termino de busqueda.' };
      }

      // Format query for PostgreSQL to_tsquery (e.g. 'cuaderno 100 hojas' -> 'cuaderno & 100 & hojas')
      const query = rawQuery.replace(/[^a-zA-Z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean).join(' & ');

      try {
        const supabase = createAdminClient();
        // Pedirle a Supabase hasta 100 resultados para categorias grandes como bolsas
        const { data, error } = await (supabase as any).rpc('search_products', { query: query, limit_n: 100 });

        if (error) {
          logger.error('Search catalog error', { error: error.message });
          return { success: false, error: `Error al buscar: ${error.message}` };
        }

        logger.info('Search catalog result', { query, count: data?.length || 0 });

        if (!data || data.length === 0) {
          return {
            success: true,
            query,
            matches: [],
            note: 'No se encontraron productos con ese nombre. MODO ENTRENAMIENTO: Explicale literalmente al usuario el problema. Dile: "Busque \'' + query + '\' en la base de datos pero no obtuve ningun resultado. ¿Podrias revisar el nombre exacto en el Excel o darme otro termino?"'
          };
        }

        // Devolver maximo los primeros 100 resultados
        const matches = data.slice(0, 100).map((row: any) => ({
          product_id: row.id,
          category: row.category,
          name: row.name,
          unit: row.unit,
          description: row.description,
          notes: row.notes,
          requires_area: row.requires_area
        }));

        return {
          success: true,
          query,
          matches,
          note: 'OJO: He retornado hasta 100 resultados. Si el cliente pidio un atributo fisico (ej. "grande", "pequeña", "mediana"), TU DEBES LEER mentalmente las descripciones y medidas de estos 100 resultados y filtrar cuales aplican antes de responderle al cliente. Muestrale solo las opciones que se ajusten a su tamaño/color solicitado.',
        };
      } catch (err: any) {
        logger.error('Search catalog exception', { error: String(err) });
        return { success: false, error: err.message || String(err) };
      }
    },
  } as any);
}
