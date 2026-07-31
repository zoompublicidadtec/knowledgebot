import { tool, jsonSchema } from 'ai';
import { createAdminClient } from '../../supabase/admin';
import { logger } from '../../logger';
import { embedText } from '@/lib/embeddings';

interface ToolContext {
  orgId: string;
}

/** Una ficha consultable: un título y su contenido, venga de donde venga. */
interface FichaNegocio {
  id: string;
  title: string;
  content: string;
}

/**
 * Convierte lo que el dueño configuró en el panel en fichas consultables.
 *
 * Los nombres de los campos son genéricos a propósito (`garantía`, `entrega`,
 * `sitio web`), y `topics` es libre: eso es lo que permite que el mismo sistema
 * sirva para cualquier negocio sin cambiar código.
 */
async function fichasDelNegocio(supabase: any, orgId: string): Promise<FichaNegocio[]> {
  const { data } = await supabase
    .from('agent_configs')
    .select('business_info, business_hours, services')
    .eq('organization_id', orgId)
    .single();

  if (!data) return [];
  const info = (data.business_info || {}) as Record<string, any>;
  const fichas: FichaNegocio[] = [];

  const agregar = (id: string, title: string, content: unknown) => {
    const texto = String(content ?? '').trim();
    if (texto) fichas.push({ id, title, content: texto });
  };

  agregar('direccion', 'Dirección', info.address);
  agregar('telefono', 'Teléfono de contacto', info.phone);
  agregar('email', 'Correo de contacto', info.email);
  agregar('web', 'Sitio web', info.website);
  agregar('garantia', 'Garantía', info.warranty);
  agregar('entrega', 'Tiempos de entrega', info.delivery_times);
  agregar('cancelacion', 'Política de cancelación', info.cancellation_policy);

  if (data.business_hours && Object.keys(data.business_hours).length > 0) {
    const horario = Object.entries(data.business_hours)
      .map(([dia, valor]: [string, any]) =>
        typeof valor === 'string' ? `${dia}: ${valor}` : `${dia}: ${JSON.stringify(valor)}`
      )
      .join(' · ');
    agregar('horarios', 'Horarios de atención', horario);
  }

  for (const t of Array.isArray(info.topics) ? info.topics : []) {
    agregar(`tema:${t?.titulo}`, String(t?.titulo || ''), t?.contenido);
  }

  for (const f of Array.isArray(info.faq) ? info.faq : []) {
    agregar(`faq:${f?.question}`, String(f?.question || ''), f?.answer);
  }

  return fichas;
}

/** Quita tildes y baja a minúsculas, para que "garantia" encuentre "garantía". */
function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Busca por palabras, sin embeddings: son pocas fichas y el coste debe ser 0.
 * Puntúa las coincidencias en el título por encima de las del contenido, porque
 * el título es lo que el dueño eligió para nombrar el tema.
 */
function buscarEnFichas(fichas: FichaNegocio[], consulta: string): FichaNegocio[] {
  const términos = normalizar(consulta)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 3);
  if (términos.length === 0) return [];

  return fichas
    .map(f => {
      const titulo = normalizar(f.title);
      const contenido = normalizar(f.content);
      let puntos = 0;
      for (const t of términos) {
        if (titulo.includes(t)) puntos += 3;
        else if (contenido.includes(t)) puntos += 1;
      }
      return { f, puntos };
    })
    .filter(x => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos)
    .map(x => x.f);
}

export function queryKnowledgeBaseTool(ctx: ToolContext) {
  return tool({
    description:
      'Consulta los datos oficiales del negocio que el dueno configuro en el panel: politicas, garantia, tiempos de entrega, horarios, sitio web, datos de contacto y los temas propios de su oficio. Uso obligatorio antes de responder cualquier pregunta sobre el negocio que no sea de catalogo o precio de producto. Si no devuelve el dato, NO lo inventes: dilo y ofrece consultarlo con el equipo.',
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

        /**
         * PRIMERA FUENTE: lo que el dueño escribió en el panel.
         *
         * Antes esta herramienta solo miraba `knowledge_chunks`, una tabla con
         * 0 filas en producción que nadie llena (sus scripts de ingesta nunca
         * se han ejecutado). Resultado medido el 01-ago-2026: al bot se le
         * ordenaba consultar la base de conocimiento y SIEMPRE recibía nada,
         * justo el escenario que le hace inventar respuestas.
         *
         * Mientras tanto, el panel YA guardaba dirección, teléfono, correo,
         * política de cancelación, horarios y servicios en
         * `agent_configs.business_info`... y el bot no podía leerlos.
         *
         * Ahora los lee de ahí. Es determinista, no gasta embeddings y se
         * actualiza en el momento en que el dueño guarda el panel. Los `topics`
         * libres son los que hacen que esto sirva para cualquier oficio: una
         * imprenta, un despacho de abogados o una clínica escriben sus propios
         * temas sin que nadie toque código.
         */
        const fichas = await fichasDelNegocio(supabase, ctx.orgId);
        const encontradas = buscarEnFichas(fichas, query);

        if (encontradas.length > 0) {
          logger.info('queryKnowledgeBase: respondido desde el panel', {
            orgId: ctx.orgId,
            query,
            encontradas: encontradas.map(f => f.title),
          });
          return {
            success: true,
            query,
            records: encontradas.slice(0, limit),
            note: 'Datos del negocio configurados por el dueño en el panel. Son la fuente oficial: úsalos tal cual y no los adornes.',
          };
        }

        // Defensive: verify there are chunks to search. The knowledge base is OPTIONAL —
        // the catalog (products table) is the primary source and does not use this tool.
        const { count } = await (supabase as any)
          .from('knowledge_chunks')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', ctx.orgId);

        if (!count || count === 0) {
          // Se le dice al modelo QUÉ temas existen configurados. Así, si el
          // cliente pregunta algo cercano, el bot puede reconducir en vez de
          // inventar; y si no hay nada, sabe que debe admitirlo.
          const disponibles = fichas.map(f => f.title);
          return {
            success: false,
            query,
            records: [],
            disponibles,
            note: disponibles.length > 0
              ? `No hay un dato configurado para esta pregunta. Los temas que SÍ están configurados son: ${disponibles.join(', ')}. No inventes lo que no esté ahí: si falta, dilo y ofrece consultarlo con el equipo.`
              : 'No hay ningun dato del negocio configurado en el panel. NO inventes politicas, garantias, tiempos de entrega ni datos de contacto: dilo con naturalidad y ofrece consultarlo con el equipo.',
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
