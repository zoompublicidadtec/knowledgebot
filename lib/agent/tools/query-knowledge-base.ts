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
 * Arma en una línea lo que el bot puede decir de una sede: dónde queda y a qué
 * número se llama o se escribe.
 *
 * Cada teléfono lleva su tipo porque no es lo mismo un fijo que un WhatsApp: si
 * el cliente pregunta «¿a qué número llamo?» y el bot le da un número que solo
 * recibe mensajes, lo manda a un teléfono que nunca va a timbrar.
 *
 * Los grupos se nombran «solo llamadas» y «solo WhatsApp», y no se mezclan.
 * La primera versión decía «para llamar X, por WhatsApp Y» y el modelo lo leyó
 * como una sola bolsa: medido el 03-ago-2026, remató con «también puedes
 * escribirnos por WhatsApp a esos mismos números» incluyendo el fijo. El dato
 * estaba bien; la redacción admitía esa lectura. Si una frase se puede leer de
 * dos maneras, el modelo va a elegir una de las dos, y no siempre la correcta.
 *
 * Lo que falta se OMITE, nunca se rellena: una sede sin teléfono se dice sin
 * teléfono. Es la misma regla de DEFAULT_PERSONA — un dato de ejemplo puesto
 * para que no quede vacío se convierte en una mentira dicha con seguridad.
 */
function detalleDeSede(sede: any): string {
  const partes: string[] = [];

  const direccion = String(sede?.direccion || '').trim();
  if (direccion) partes.push(direccion);

  const telefonos = Array.isArray(sede?.telefonos) ? sede.telefonos : [];
  const numerosDeTipo = (tipoBuscado: string) =>
    telefonos
      .filter((t: any) => String(t?.tipo || '').trim().toLowerCase() === tipoBuscado)
      .map((t: any) => String(t?.numero || '').trim())
      .filter(Boolean);

  const agrupar = (etiqueta: string, numeros: string[]) => {
    if (numeros.length) partes.push(`${etiqueta}: ${numeros.join(' o ')}`);
  };

  agrupar('llamadas y WhatsApp', numerosDeTipo('ambos'));
  agrupar('solo llamadas, NO recibe WhatsApp', numerosDeTipo('llamada'));
  agrupar('solo WhatsApp, NO recibe llamadas', numerosDeTipo('whatsapp'));
  // Sin tipo declarado no se descarta el número: se ofrece a secas, sin
  // afirmar para qué sirve, que es lo honesto cuando no se sabe.
  agrupar('teléfono', numerosDeTipo(''));

  return partes.join(' | ');
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

  /**
   * Sedes. Un negocio con varios locales no cabe en un solo campo de dirección
   * y un solo teléfono, que es lo único que había hasta el 03-ago-2026.
   *
   * Cuando hay sedes cargadas, ellas son la única verdad y NO se emiten las
   * fichas sueltas de dirección y teléfono: si no, el bot tendría dos fuentes
   * para lo mismo y a «¿dónde quedan?» podría contestar con una sola. Sin
   * sedes cargadas se mantienen las fichas de siempre, para no dejar mudo a
   * ningún negocio que todavía no las haya llenado.
   */
  const sedes = (Array.isArray(info.sedes) ? info.sedes : []).filter(
    (s: any) => String(s?.direccion || '').trim() || (Array.isArray(s?.telefonos) && s.telefonos.length)
  );

  if (sedes.length > 0) {
    for (const s of sedes) {
      const nombre = String(s?.nombre || '').trim();
      const detalle = detalleDeSede(s);
      if (detalle) agregar(`sede:${nombre || detalle}`, nombre ? `Sede ${nombre}` : 'Sede', detalle);
    }

    /**
     * Ficha de resumen. El título nombra a propósito todas las palabras con
     * las que un cliente pregunta esto —sede, sucursal, dirección, ubicación, local,
     * sucursal, teléfono—, porque el buscador puntúa el título por encima del
     * contenido y así una pregunta suelta («¿dónde quedan?») cae aquí y se
     * lleva TODAS las sedes, no una.
     */
    const resumen = sedes
      .map((s: any) => {
        const nombre = String(s?.nombre || '').trim();
        const detalle = detalleDeSede(s);
        return nombre ? `${nombre}: ${detalle}` : detalle;
      })
      .filter(Boolean)
      .join('\n');

    agregar(
      'sedes',
      'Sedes, sucursales, direcciones, ubicación, locales y teléfonos de contacto',
      `El negocio atiende en ${sedes.length} sede(s):\n${resumen}`
    );
  } else {
    agregar('direccion', 'Dirección', info.address);
    agregar('telefono', 'Teléfono de contacto', info.phone);
  }

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
 * Palabras vacías del español: no dicen nada del negocio y solo hacen ruido.
 *
 * Sustituyen al filtro que había antes —descartar toda palabra de 3 letras o
 * menos—, que es la causa del fallo medido el 03-ago-2026: a «¿tienen página
 * web?» el bot contestó «no tenemos una página web como tal» teniendo la
 * dirección guardada en el panel. El bot buscó bien; lo que se perdió por el
 * camino fue la palabra **web**, de tres letras. Medir por longitud descarta
 * justo lo que importa (web, iva, nit, pdf) y deja pasar lo que no (para,
 * como, esta), así que en vez de medirlas se nombran.
 */
const PALABRAS_VACIAS = new Set([
  'para', 'como', 'que', 'los', 'las', 'del', 'una', 'uno', 'unos', 'unas',
  'con', 'por', 'sus', 'mas', 'muy', 'este', 'esta', 'esto', 'esos', 'esas',
  'ese', 'esa', 'sobre', 'donde', 'cual', 'cuales', 'cuanto', 'cuanta',
  'tienen', 'tiene', 'hay', 'dame', 'decir', 'saber', 'favor', 'porfa',
  'quiero', 'necesito', 'ustedes', 'usted', 'ademas', 'tambien', 'algun',
  'alguna', 'hola', 'buenas', 'gracias', 'sera', 'seria', 'puedes', 'podrias',
]);

/**
 * Quita el plural del español, para poder comparar singular con plural.
 *
 * Sin esto, «direcciones» no encontraba la ficha «Dirección»: la comparación
 * era en un solo sentido (¿cabe el término dentro del título?) y el plural,
 * al ser más largo que el singular, nunca cabía. Medido el 03-ago-2026: a
 * «dame direcciones y números de contacto» devolvió teléfono y correo y se
 * saltó la dirección, que sí estaba guardada en el panel.
 */
function raiz(palabra: string): string {
  if (palabra.length > 5 && palabra.endsWith('es')) return palabra.slice(0, -2);
  if (palabra.length > 4 && palabra.endsWith('s')) return palabra.slice(0, -1);
  return palabra;
}

/**
 * Busca por palabras, sin embeddings: son pocas fichas y el coste debe ser 0.
 * Puntúa las coincidencias en el título por encima de las del contenido, porque
 * el título es lo que el dueño eligió para nombrar el tema.
 *
 * El título se compara **palabra por palabra**, no como un solo texto: así
 * «web» encuentra «Sitio web» sin que una palabra corta pueda colarse dentro
 * de otra cualquiera. Una raíz de 3 letras solo vale si es la palabra entera;
 * a partir de 4 se acepta que una contenga a la otra, que es lo que hace que
 * «garantias» y «garantía» sean la misma cosa.
 */
function buscarEnFichas(fichas: FichaNegocio[], consulta: string): FichaNegocio[] {
  const términos = normalizar(consulta)
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3 && !PALABRAS_VACIAS.has(t))
    .map(raiz);
  if (términos.length === 0) return [];

  const casan = (palabraDelTitulo: string, término: string): boolean =>
    palabraDelTitulo === término ||
    (término.length >= 4 && palabraDelTitulo.includes(término)) ||
    (palabraDelTitulo.length >= 4 && término.includes(palabraDelTitulo)) ||
    // Misma familia de palabra: «ubicados» y «ubicación» comparten «ubica».
    // Sin esto, a «¿dónde quedan ubicados?» el buscador no encontraba nada.
    (palabraDelTitulo.length >= 5 &&
      término.length >= 5 &&
      palabraDelTitulo.slice(0, 5) === término.slice(0, 5));

  return fichas
    .map(f => {
      const palabrasDelTitulo = normalizar(f.title)
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(raiz);
      const contenido = normalizar(f.content);
      let puntos = 0;
      for (const t of términos) {
        if (palabrasDelTitulo.some(p => casan(p, t))) puntos += 3;
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
