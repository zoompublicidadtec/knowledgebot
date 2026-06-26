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

      // 1. Intentar buscar en el microservicio RAG (Python FastAPI)
      try {
        const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8001';
        logger.info('Querying RAG microservice', { url: RAG_SERVICE_URL, query: rawQuery });
        
        const response = await fetch(`${RAG_SERVICE_URL}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: rawQuery, top_k: 5 }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          const matches = (data.products || []).map((prod: any) => ({
            product_id: prod.product_id,
            category: prod.category || '',
            name: prod.name,
            unit: prod.unit || 'unidad',
            description: prod.description || '',
            notes: prod.notes || '',
            requires_area: prod.requires_area || false,
            image_urls: prod.image_urls || [],
            score: prod.score
          }));

          logger.info('RAG microservice response success', { count: matches.length });
          
          return {
            success: true,
            query: rawQuery,
            matches,
            rag_response: data.response,
            note: 'Se ha realizado una búsqueda semántica usando el Motor de Conocimiento RAG. Las rutas de imágenes relativas están disponibles en `image_urls` (ej: /images/...).',
          };
        } else {
          logger.warn(`RAG microservice returned status ${response.status}, falling back to database search`);
        }
      } catch (err: any) {
        logger.warn('Failed to connect to RAG microservice, falling back to database search', { error: err.message || String(err) });
      }

      // 2. Fallback original a Supabase / Postgres
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

        logger.info('Search catalog result (database)', { query, count: data?.length || 0 });

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
          requires_area: row.requires_area,
          image_urls: []
        }));

        return {
          success: true,
          query,
          matches,
          note: 'OJO: He retornado hasta 100 resultados de la base de datos de fallback. Si el cliente pidio un atributo fisico (ej. "grande", "pequeña", "mediana"), TU DEBES LEER mentalmente las descripciones y medidas de estos 100 resultados y filtrar cuales aplican antes de responderle al cliente. Muestrale solo las opciones que se ajusten a su tamaño/color solicitado.',
        };
      } catch (err: any) {
        logger.error('Search catalog exception', { error: String(err) });
        return { success: false, error: err.message || String(err) };
      }
    },
  } as any);
}
