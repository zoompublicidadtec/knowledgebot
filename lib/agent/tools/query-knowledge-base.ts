import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { embedText } from '@/lib/embeddings';

interface ToolContext {
  orgId: string;
}

export function queryKnowledgeBaseTool(ctx: ToolContext) {
  return tool({
    description:
      'Busca informacion en la base de conocimiento vectorial de Supabase. Uso obligatorio antes de responder preguntas sobre politicas, productos, procesos, precios, requisitos, documentacion, soporte, inventario, manuales, contratos o cualquier dato que pueda estar en la base documental del negocio. No inventes respuestas si esta herramienta no devuelve resultados.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Pregunta o termino de busqueda del cliente, redactado con suficiente contexto.',
        },
        limit: {
          type: 'number',
          description: 'Cantidad maxima de fragmentos a recuperar. Usa 4 a 8 normalmente.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Etiquetas opcionales para filtrar la busqueda, por ejemplo: precios, soporte, politicas.',
        },
      },
      required: ['query'],
    }),
    execute: async (args: any) => {
      const query = String(args.query || '').trim();
      const limit = Math.min(Math.max(Number(args.limit || 8), 1), 30);
      const tags = Array.isArray(args.tags) ? args.tags.filter(Boolean).map(String) : null;
      const threshold = Number(process.env.RAG_MATCH_THRESHOLD) || 0.35;

      if (!query) {
        return { success: false, error: 'Debes enviar una pregunta o termino de busqueda.' };
      }

      logger.info('queryKnowledgeBase called', { orgId: ctx.orgId, query, limit, threshold });

      try {
        const supabase = createAdminClient();

        // Defensive: verify there are chunks to search. The knowledge base is OPTIONAL —
        // the catalog (products table) is the primary source and does not use this tool.
        const { count } = await (supabase as any)
          .from('knowledge_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', ctx.orgId);

        if (!count || count === 0) {
          return {
            success: false,
            query,
            records: [],
            note: 'La base de conocimiento documental esta vacia. Para productos y precios usa SIEMPRE las herramientas searchCatalog y getProductPrice. Para politicas o info de la empresa, responde con lo que sepas del system prompt o escala a un humano.',
          };
        }

        // Generate the query embedding via the OpenAI-compatible API.
        const embedding = await embedText(query);

        const { data, error } = await (supabase as any).rpc('match_knowledge_chunks', {
          target_organization_id: ctx.orgId,
          query_embedding: embedding,
          match_count: limit,
          match_threshold: threshold,
          filter_tags: tags && tags.length > 0 ? tags : null,
        });

        if (error) {
          logger.error('Knowledge base query RPC error', { error: error.message });
          return { success: false, error: `Error al consultar la base de conocimiento: ${error.message}` };
        }

        const records = (data || []).map((row: any) => ({
          id: row.chunk_id,
          documentId: row.document_id,
          title: row.document_title,
          sourceUrl: row.source_url,
          content: row.content,
          similarity: row.similarity,
          tags: row.tags || [],
          metadata: row.metadata || {},
        }));

        logger.info('Knowledge base query result', { orgId: ctx.orgId, query, count: records.length });

        return {
          success: true,
          query,
          records,
          note: records.length > 0
            ? 'Usa solo estos fragmentos para responder. Si falta un dato especifico, dilo.'
            : 'No se encontro informacion confiable en la base de conocimiento para esta pregunta.',
        };
      } catch (err: any) {
        logger.error('Knowledge base query error', { error: String(err) });
        // Fail gracefully: tell the agent to fall back to catalog tools instead of crashing.
        return {
          success: false,
          query,
          error: err.message || String(err),
          note: 'La busqueda en la base de conocimiento fallo. Usa searchCatalog y getProductPrice para productos y precios.',
        };
      }
    },
  } as any);
}
