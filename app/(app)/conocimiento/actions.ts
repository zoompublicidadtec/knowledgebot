'use server';

import { createClient } from '@/lib/supabase/server';
import { embedText } from '@/lib/embeddings';
import { logger } from '@/lib/logger';
import { revalidatePath } from 'next/cache';

// Helper to get organization_id for current user
async function getOrgId() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No autenticado');

  const { data: profile } = await (supabase as any)
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) throw new Error('Organización no encontrada');
  return profile.organization_id;
}

// ─── CATEGORIES ───
export async function getCategories() {
  try {
    const supabase = await createClient();
    
    // Select with synonyms and subcategories
    const { data, error } = await (supabase as any)
      .from('categories')
      .select('id, name, group_name, synonyms, subcategories(id, name, synonyms)')
      .order('name', { ascending: true });

    if (error) {
      // Fallback if column 'synonyms' or table 'subcategories' doesn't exist yet in the DB
      const { data: fallbackData, error: fallbackError } = await (supabase as any)
        .from('categories')
        .select('id, name, group_name')
        .order('name', { ascending: true });
      
      if (fallbackError) throw fallbackError;
      
      // Return categories mapping with synonyms null and a flag indicating missing migration
      return (fallbackData || []).map((cat: any) => ({ 
        ...cat, 
        synonyms: null, 
        requiresMigration: true 
      }));
    }
    return data || [];
  } catch (error: any) {
    logger.error('Error fetching categories', { error: error.message });
    return [];
  }
}

export async function createCategory(name: string, groupName?: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await (supabase as any)
      .from('categories')
      .insert({ name, group_name: groupName || null })
      .select()
      .single();

    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true, data };
  } catch (error: any) {
    logger.error('Error creating category', { error: error.message });
    return { success: false, error: error.message };
  }
}

export async function createSubcategory(categoryId: string, name: string) {
  try {
    const supabase = await createClient();
    const { data, error } = await (supabase as any)
      .from('subcategories')
      .insert({ category_id: categoryId, name })
      .select()
      .single();

    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true, data };
  } catch (error: any) {
    logger.error('Error creating subcategory', { error: error.message });
    return { success: false, error: error.message };
  }
}

export async function saveCategorySynonyms(categoryId: string, synonyms: string) {
  try {
    const supabase = await createClient();
    
    // 1. Update synonyms in categories table
    const { error: catErr } = await (supabase as any)
      .from('categories')
      .update({ synonyms: synonyms || null })
      .eq('id', categoryId);
    
    if (catErr) throw catErr;

    // 2. Fetch all products in this category to trigger cascade search_text rebuild
    const { data: products, error: prodErr } = await (supabase as any)
      .from('products')
      .select('id, name, reference, description, unit, price_includes_iva, min_order_qty, notes, active, search_text')
      .eq('category_id', categoryId);

    if (prodErr) throw prodErr;

    // 3. Rebuild search_text and embeddings for each product in this category
    if (products && products.length > 0) {
      const categoryData = await (supabase as any).from('categories').select('name').eq('id', categoryId).single();
      const categoryName = categoryData.data?.name || '';
      const catSynonymsPart = synonyms ? ` Sinónimos Categoría: ${synonyms}.` : '';

      for (const prod of products) {
        // Extract product's own synonyms if any existed in its search_text
        let prodSynonyms = '';
        if (prod.search_text && prod.search_text.includes('Sinónimos Producto:')) {
          const match = prod.search_text.match(/Sinónimos Producto:\s*([^.]+)\./);
          if (match && match[1]) {
            prodSynonyms = match[1];
          }
        } else if (prod.search_text && prod.search_text.includes('Sinónimos:')) {
          // Backward compatibility for old synonyms format
          const match = prod.search_text.match(/Sinónimos:\s*([^.]+)\./);
          if (match && match[1]) {
            prodSynonyms = match[1];
          }
        }

        const prodSynonymsPart = prodSynonyms ? ` Sinónimos Producto: ${prodSynonyms}.` : '';
        const searchText = `${categoryName} - ${prod.name} - ${prod.reference || ''} - ${prod.description || ''}.${catSynonymsPart}${prodSynonymsPart}`.trim();

        let embedding: number[] | null = null;
        if (process.env.EMBEDDINGS_API_KEY) {
          try {
            embedding = await embedText(searchText);
          } catch (e) {
            logger.warn('Error generating embedding in cascade trigger', { error: (e as any).message });
          }
        }

        await (supabase as any)
          .from('products')
          .update({
            search_text: searchText,
            ...(embedding ? { embedding } : {})
          })
          .eq('id', prod.id);
      }
    }

    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error saving category synonyms', { error: error.message, categoryId });
    return { success: false, error: error.message };
  }
}

// ─── PRODUCTS ───
export async function getCatalog(params: {
  page: number;
  limit: number;
  search: string;
  categoryId?: string;
  sort?: 'name' | 'reference' | 'price' | 'active' | 'created_at';
  sortDir?: 'asc' | 'desc';
  onlyActive?: boolean;
}) {
  try {
    const supabase = await createClient();
    const offset = (params.page - 1) * params.limit;
    const sort = params.sort || 'name';
    const sortDir = params.sortDir || 'asc';

    // Build query. We include price_tiers to derive the "vigente" price in the
    // client without an extra round-trip per row. Keeps the bot contract intact:
    // we only READ these tables, never alter them here.
    let queryBuilder = (supabase as any)
      .from('products')
      // Se piden las columnas UNA POR UNA en vez de '*'.
      //
      // La tabla tiene una columna llamada embedding con los numeros que usa el
      // buscador: 19.272 caracteres POR PRODUCTO. El panel no la muestra
      // nunca, pero con '*' la pedia igual: 675 KB por pagina en vez de 72 KB,
      // y 0,83 s de espera. Medido el 04-ago-2026.
      //
      // No es solo lentitud: el menu precarga sus paginas al pasar el raton, y
      // una peticion tan pesada ocupaba una de las pocas conexiones que el
      // navegador permite a la vez. Con varias asi, el panel se congelaba.
      .select(
        'id, name, reference, active, unit, image_url, description, notes, ' +
          'min_order_qty, price_includes_iva, category_id, search_text, ' +
          'categories(name), price_tiers(id, variant, min_qty, max_qty, price, price_basis)',
        { count: 'exact' }
      );

    // Filter by Category or Subcategory
    if (params.categoryId && params.categoryId !== 'all') {
      // Allow passing categoryId as "cat-UUID" or "sub-UUID" to distinguish
      if (params.categoryId.startsWith('sub-')) {
        queryBuilder = queryBuilder.eq('subcategory_id', params.categoryId.replace('sub-', ''));
      } else if (params.categoryId.startsWith('cat-')) {
        queryBuilder = queryBuilder.eq('category_id', params.categoryId.replace('cat-', ''));
      } else {
        queryBuilder = queryBuilder.eq('category_id', params.categoryId);
      }
    }

    if (params.onlyActive) {
      queryBuilder = queryBuilder.eq('active', true);
    }

    // Filter by Search Query
    if (params.search) {
      // Use text search on search_text
      queryBuilder = queryBuilder.or(
        `name.ilike.%${params.search}%,reference.ilike.%${params.search}%,search_text.ilike.%${params.search}%`
      );
    }

    // Sorting. 'price' is special: it's not a column, so we keep the default
    // name ordering and let the client re-sort the page by derived price.
    // For column-backed sorts we map directly.
    if (sort === 'price') {
      // Fall back to name; client re-sorts the visible page by price.
      queryBuilder = queryBuilder.order('active', { ascending: false }).order('name', { ascending: sortDir === 'asc' });
    } else {
      queryBuilder = queryBuilder.order('active', { ascending: false }).order(sort, { ascending: sortDir === 'asc' });
    }

    const { data, count, error } = await queryBuilder.range(offset, offset + params.limit - 1);

    if (error) throw error;

    return {
      products: data || [],
      totalCount: count || 0,
      totalPages: Math.ceil((count || 0) / params.limit),
    };
  } catch (error: any) {
    logger.error('Error fetching catalog', { error: error.message });
    return { products: [], totalCount: 0, totalPages: 0 };
  }
}

/**
 * NOTE: computeDisplayPrice() has been moved to lib/catalog-utils.ts because this
 * file is a 'use server' module and cannot export sync functions for client use.
 * Import it from '@/lib/catalog-utils' in client components.
 */

export async function getProductDetails(productId: string) {
  try {
    const supabase = await createClient();
    const { data: product, error: prodErr } = await (supabase as any)
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (prodErr) throw prodErr;

    const { data: tiers, error: tiersErr } = await (supabase as any)
      .from('price_tiers')
      .select('*')
      .eq('product_id', productId)
      .order('variant', { ascending: true })
      .order('min_qty', { ascending: true });

    if (tiersErr) throw tiersErr;

    return { product, priceTiers: tiers || [] };
  } catch (error: any) {
    logger.error('Error fetching product details', { error: error.message, productId });
    throw error;
  }
}

export async function saveProduct(
  productData: {
    id?: string;
    category_id: string;
    subcategory_id?: string;
    name: string;
    reference: string;
    description: string;
    unit: string;
    price_includes_iva: boolean;
    min_order_qty: number;
    notes: string;
    active: boolean;
    synonyms: string; // Comma-separated string in the form (specific product synonyms)
    image_url?: string;
  },
  priceTiers: Array<{
    variant: string;
    min_qty: number;
    max_qty: number | null;
    price: number;
    price_basis: string;
  }>
) {
  try {
    const supabase = await createClient();
    
    // Get category name and synonyms for search_text composition
    const { data: category } = await (supabase as any)
      .from('categories')
      .select('name, synonyms')
      .eq('id', productData.category_id)
      .single();

    const categoryName = category?.name || '';
    const catSynonyms = (category as any)?.synonyms || '';
    const catSynonymsPart = catSynonyms ? ` Sinónimos Categoría: ${catSynonyms}.` : '';
    
    // Construct search_text
    const rawSynonyms = productData.synonyms
      ? productData.synonyms.split(',').map(s => s.trim()).filter(Boolean).join(', ')
      : '';
    const prodSynonymsPart = rawSynonyms ? ` Sinónimos Producto: ${rawSynonyms}.` : '';
    
    const searchText = `${categoryName} - ${productData.name} - ${productData.reference || ''} - ${productData.description || ''}.${catSynonymsPart}${prodSynonymsPart}`.trim();

    // Generate vector embedding (optional, if configured)
    let embedding: number[] | null = null;
    if (process.env.EMBEDDINGS_API_KEY) {
      try {
        embedding = await embedText(searchText);
      } catch (err: any) {
        logger.warn('Skipping product embedding generation due to error', { error: err.message });
      }
    }

    const dbProduct = {
      category_id: productData.category_id,
      subcategory_id: productData.subcategory_id || null,
      name: productData.name,
      reference: productData.reference || null,
      description: productData.description || null,
      unit: productData.unit || 'unidad',
      price_includes_iva: productData.price_includes_iva,
      min_order_qty: productData.min_order_qty || null,
      notes: productData.notes || null,
      active: productData.active,
      search_text: searchText,
      image_url: productData.image_url || null,
      ...(embedding ? { embedding } : {}),
    };

    let savedProductId = productData.id;

    // Resilient upsert helper to dynamically strip missing columns on database error
    const executeResilientUpsert = async (payload: any): Promise<string> => {
      let currentPayload = { ...payload };
      while (true) {
        try {
          if (productData.id) {
            const { error } = await (supabase as any)
              .from('products')
              .update(currentPayload)
              .eq('id', productData.id);
            if (error) throw error;
            return productData.id;
          } else {
            const { data, error } = await (supabase as any)
              .from('products')
              .insert(currentPayload)
              .select('id')
              .single();
            if (error) throw error;
            return data.id;
          }
        } catch (err: any) {
          const errMsg = err.message || '';
          // Detect missing columns (e.g. image_url or subcategory_id)
          const matchMissingCol = errMsg.match(/Could not find the '([^']+)' column/) ||
                                  errMsg.match(/column "([^"]+)" of relation "products" does not exist/) ||
                                  errMsg.match(/column "([^"]+)" does not exist/);
          
          if (matchMissingCol && matchMissingCol[1]) {
            const colName = matchMissingCol[1];
            if (colName in currentPayload) {
              logger.warn(`Column '${colName}' not found in products table. Stripping from payload and retrying...`);
              delete currentPayload[colName];
              continue;
            }
          }
          throw err;
        }
      }
    };

    savedProductId = await executeResilientUpsert(dbProduct);

    // Now handle price tiers. Clean out existing tiers first
    if (productData.id) {
      const { error: deleteTiersErr } = await (supabase as any)
        .from('price_tiers')
        .delete()
        .eq('product_id', savedProductId);
      if (deleteTiersErr) throw deleteTiersErr;
    }

    // Insert new price tiers
    if (priceTiers.length > 0) {
      const tiersToInsert = priceTiers.map(t => ({
        product_id: savedProductId!,
        variant: t.variant || 'Estándar',
        min_qty: t.min_qty,
        max_qty: t.max_qty || null,
        price: t.price,
        price_basis: t.price_basis || 'unitario',
        currency: 'COP',
        source_sheet: 'Web SaaS Dashboard',
      }));

      const { error: insertTiersErr } = await (supabase as any)
        .from('price_tiers')
        .insert(tiersToInsert);
      if (insertTiersErr) throw insertTiersErr;
    }

    revalidatePath('/conocimiento');
    return { success: true, productId: savedProductId };
  } catch (error: any) {
    logger.error('Error saving product', { error: error.message, productData });
    return { success: false, error: error.message };
  }
}

export async function deleteProduct(productId: string) {
  try {
    const supabase = await createClient();
    // Soft delete by setting active = false to preserve reference integrity
    const { error } = await (supabase as any)
      .from('products')
      .update({ active: false })
      .eq('id', productId);

    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error soft-deleting product', { error: error.message, productId });
    return { success: false, error: error.message };
  }
}

// ─── GLOSARIO COMERCIAL (RAG DOCK) ───
export async function getGlosario() {
  try {
    const supabase = await createClient();
    const orgId = await getOrgId();

    // Find the Glossary document
    let { data: doc, error: docErr } = await (supabase as any)
      .from('knowledge_documents')
      .select('id')
      .eq('organization_id', orgId)
      .eq('title', 'Glosario de Términos Comerciales')
      .single();

    if (docErr && docErr.code !== 'PGRST116') throw docErr;

    if (!doc) {
      return [];
    }

    // Retrieve chunks
    const { data: chunks, error: chunksErr } = await (supabase as any)
      .from('knowledge_chunks')
      .select('id, content, metadata')
      .eq('document_id', doc.id)
      .order('created_at', { ascending: false });

    if (chunksErr) throw chunksErr;

    return chunks || [];
  } catch (error: any) {
    logger.error('Error fetching glosario', { error: error.message });
    return [];
  }
}

export async function saveGlosarioItem(
  termino: string,
  significado: string,
  chunkId?: string
) {
  try {
    const supabase = await createClient();
    const orgId = await getOrgId();

    // 1. Get or Create the glossary document
    let { data: doc, error: docErr } = await (supabase as any)
      .from('knowledge_documents')
      .select('id')
      .eq('organization_id', orgId)
      .eq('title', 'Glosario de Términos Comerciales')
      .single();

    if (docErr && docErr.code !== 'PGRST116') throw docErr;

    if (!doc) {
      const { data: newDoc, error: createDocErr } = await (supabase as any)
        .from('knowledge_documents')
        .insert({
          organization_id: orgId,
          title: 'Glosario de Términos Comerciales',
          source_type: 'manual',
        })
        .select('id')
        .single();

      if (createDocErr) throw createDocErr;
      doc = newDoc;
    }

    // 2. Format content
    const content = `Término: "${termino}". Significado/Jerga Comercial: ${significado}.`;

    // 3. Generate Embedding (mandatory for knowledge chunks!)
    const embedding = await embedText(content);

    const chunkData = {
      organization_id: orgId,
      document_id: doc.id,
      content,
      embedding,
      token_count: Math.ceil(content.length / 4), // Simple token estimate
      metadata: { termino, significado },
    };

    if (chunkId) {
      const { error } = await (supabase as any)
        .from('knowledge_chunks')
        .update(chunkData)
        .eq('id', chunkId);
      if (error) throw error;
    } else {
      const { error } = await (supabase as any)
        .from('knowledge_chunks')
        .insert(chunkData);
      if (error) throw error;
    }

    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error saving glosario item', { error: error.message, termino });
    return { success: false, error: error.message };
  }
}

export async function deleteGlosarioItem(chunkId: string) {
  try {
    const supabase = await createClient();
    const { error } = await (supabase as any)
      .from('knowledge_chunks')
      .delete()
      .eq('id', chunkId);

    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error deleting glosario item', { error: error.message, chunkId });
    return { success: false, error: error.message };
  }
}

// ════════════════════════════════════════════════════════════════
//  EXTENSIONES: Gestión completa del catálogo (CRUD masivo, hard
//  delete, categorías/subcategorías, import/export Excel).
//  Todas respetan el contrato del bot: cualquier mutación de un
//  producto regenera search_text + embedding (Gemini 1536D) igual
//  que saveProduct. NO se tocan las RPCs que el bot invoca.
// ════════════════════════════════════════════════════════════════

/**
 * Internal helper: recomposes search_text and (re)generates the Gemini 1536D
 * embedding for a single product, identical to the format used by saveProduct.
 * Returns the patch to apply. Throws only on embedding failure (caller catches).
 *
 * Format (MUST stay byte-identical to saveProduct to preserve bot recall):
 *   "{Categoria} - {name} - {reference} - {description}.{ Sinónimos Categoría: x.}{ Sinónimos Producto: y.}"
 */
async function buildSearchPatch(
  supabase: any,
  productId: string,
  productRow: {
    name: string;
    reference?: string | null;
    description?: string | null;
    category_id?: string | null;
    search_text?: string | null;
  }
): Promise<{ search_text: string; embedding?: number[] }> {
  // Fetch category name + synonyms
  let categoryName = '';
  let catSynonyms = '';
  if (productRow.category_id) {
    const { data: cat } = await supabase
      .from('categories')
      .select('name, synonyms')
      .eq('id', productRow.category_id)
      .single();
    categoryName = cat?.name || '';
    catSynonyms = cat?.synonyms || '';
  }
  const catSynonymsPart = catSynonyms ? ` Sinónimos Categoría: ${catSynonyms}.` : '';

  // Preserve the product's own synonyms already encoded in search_text
  let prodSynonyms = '';
  const st = productRow.search_text || '';
  let m = st.match(/Sinónimos Producto:\s*([^.]+)\./);
  if (!m) m = st.match(/Sinónimos:\s*([^.]+)\./);
  if (m && m[1]) prodSynonyms = m[1].trim();
  const prodSynonymsPart = prodSynonyms ? ` Sinónimos Producto: ${prodSynonyms}.` : '';

  const searchText =
    `${categoryName} - ${productRow.name} - ${productRow.reference || ''} - ${productRow.description || ''}.${catSynonymsPart}${prodSynonymsPart}`.trim();

  const patch: { search_text: string; embedding?: number[] } = { search_text: searchText };
  if (process.env.EMBEDDINGS_API_KEY) {
    try {
      patch.embedding = await embedText(searchText);
    } catch (e) {
      logger.warn('buildSearchPatch: embedding skipped', { error: (e as any).message, productId });
    }
  }
  return patch;
}

// ─── HARD DELETE (Hito 3) ───
export async function hardDeleteProduct(productId: string) {
  try {
    const supabase = await createClient();
    // price_tiers has ON DELETE CASCADE on product_id, so it cleans up automatically.
    const { error } = await (supabase as any)
      .from('products')
      .delete()
      .eq('id', productId);

    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error hard-deleting product', { error: error.message, productId });
    return { success: false, error: error.message };
  }
}

export async function bulkHardDelete(productIds: string[]) {
  try {
    const supabase = await createClient();
    const { error } = await (supabase as any)
      .from('products')
      .delete()
      .in('id', productIds);

    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true, count: productIds.length };
  } catch (error: any) {
    logger.error('Error bulk hard-deleting products', { error: error.message, count: productIds.length });
    return { success: false, error: error.message };
  }
}

// ─── BULK UPDATE (Hito 2) ───
/**
 * Applies a partial patch to many products at once.
 * Supported patches: { active?: boolean; category_id?: string; subcategory_id?: string|null }
 * When category_id changes, search_text + embedding are rebuilt for each affected product
 * so the bot keeps finding them under the right category terms.
 */
export async function bulkUpdateProducts(
  productIds: string[],
  patch: {
    active?: boolean;
    category_id?: string;
    subcategory_id?: string | null;
  }
) {
  try {
    const supabase = await createClient();
    if (!productIds.length) return { success: false, error: 'Sin productos seleccionados.' };

    const dbPatch: Record<string, unknown> = {};
    if (patch.active !== undefined) dbPatch.active = patch.active;
    if (patch.category_id !== undefined) dbPatch.category_id = patch.category_id;
    if (patch.subcategory_id !== undefined) dbPatch.subcategory_id = patch.subcategory_id;

    const { error } = await (supabase as any)
      .from('products')
      .update(dbPatch)
      .in('id', productIds);

    if (error) throw error;

    // If the category changed, the bot's recall depends on search_text containing
    // the category name. Rebuild search_text + embedding for each touched product.
    if (patch.category_id !== undefined) {
      const { data: rows } = await (supabase as any)
        .from('products')
        .select('id, name, reference, description, category_id, search_text')
        .in('id', productIds);
      for (const row of rows || []) {
        try {
          const searchPatch = await buildSearchPatch(supabase, row.id, row);
          await (supabase as any).from('products').update(searchPatch).eq('id', row.id);
        } catch (e) {
          logger.warn('bulkUpdate: search rebuild failed for row', { id: row.id, error: (e as any).message });
        }
      }
    }

    revalidatePath('/conocimiento');
    return { success: true, count: productIds.length };
  } catch (error: any) {
    logger.error('Error bulk updating products', { error: error.message, count: productIds.length });
    return { success: false, error: error.message };
  }
}

/**
 * Adjusts the price of every tier for the given products by a percentage.
 * deltaPercent may be negative (discount) or positive (markup). Prices are
 * rounded to the nearest integer (COP). Corrupt prices (<=0 or >1e9) are skipped.
 */
export async function bulkAdjustPrices(productIds: string[], deltaPercent: number) {
  try {
    const supabase = await createClient();
    if (!productIds.length) return { success: false, error: 'Sin productos seleccionados.' };
    if (!Number.isFinite(deltaPercent)) return { success: false, error: 'Porcentaje inválido.' };

    const { data: tiers, error } = await (supabase as any)
      .from('price_tiers')
      .select('id, price')
      .in('product_id', productIds);

    if (error) throw error;

    const factor = 1 + deltaPercent / 100;
    let updated = 0;
    for (const t of tiers || []) {
      const p = Number(t.price);
      if (!Number.isFinite(p) || p <= 0 || p > 1e9) continue; // skip corrupt
      const np = Math.round(p * factor);
      const { error: uErr } = await (supabase as any)
        .from('price_tiers')
        .update({ price: np })
        .eq('id', t.id);
      if (uErr) {
        logger.warn('bulkAdjustPrices tier update error', { id: t.id, error: uErr.message });
      } else {
        updated++;
      }
    }

    revalidatePath('/conocimiento');
    return { success: true, updatedTiers: updated };
  } catch (error: any) {
    logger.error('Error bulk adjusting prices', { error: error.message });
    return { success: false, error: error.message };
  }
}

// ─── INLINE PRICE EDIT (Hito 2) ───
/**
 * Updates a single tier's price directly (inline edit in the table).
 * Includes the anti-corrupt safeguard from getProductPriceTool: >1e9 is rejected.
 */
export async function updateTierPrice(tierId: string, newPrice: number) {
  try {
    const supabase = await createClient();
    if (!Number.isFinite(newPrice) || newPrice < 0) {
      return { success: false, error: 'Precio inválido.' };
    }
    if (newPrice > 1e9) {
      return { success: false, error: 'Precio sospechosamente alto (salvaguarda anti-dato-corrupto).' };
    }
    const { error } = await (supabase as any)
      .from('price_tiers')
      .update({ price: newPrice })
      .eq('id', tierId);

    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error updating tier price', { error: error.message, tierId });
    return { success: false, error: error.message };
  }
}

// ─── CATEGORY / SUBCATEGORY MANAGEMENT (Hito 4) ───
export async function renameCategory(categoryId: string, newName: string) {
  try {
    const supabase = await createClient();
    const name = newName.trim();
    if (!name) return { success: false, error: 'Nombre vacío.' };
    const { error } = await (supabase as any).from('categories').update({ name }).eq('id', categoryId);
    if (error) throw error;

    // Rebuild search_text for all products in this category (category name is part of search_text)
    const { data: rows } = await (supabase as any)
      .from('products')
      .select('id, name, reference, description, category_id, search_text')
      .eq('category_id', categoryId);
    for (const row of rows || []) {
      try {
        const sp = await buildSearchPatch(supabase, row.id, row);
        await (supabase as any).from('products').update(sp).eq('id', row.id);
      } catch (e) {
        logger.warn('renameCategory search rebuild failed', { id: row.id, error: (e as any).message });
      }
    }

    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error renaming category', { error: error.message, categoryId });
    return { success: false, error: error.message };
  }
}

export async function deleteCategory(categoryId: string, reassignToCategoryId?: string) {
  try {
    const supabase = await createClient();
    // Option A: reassign products to another category. Option B: detach (set null).
    if (reassignToCategoryId) {
      const { error: rErr } = await (supabase as any)
        .from('products')
        .update({ category_id: reassignToCategoryId, subcategory_id: null })
        .eq('category_id', categoryId);
      if (rErr) throw rErr;
      // Rebuild search_text for reassigned products
      const { data: rows } = await (supabase as any)
        .from('products')
        .select('id, name, reference, description, category_id, search_text')
        .eq('category_id', reassignToCategoryId);
      for (const row of rows || []) {
        try {
          const sp = await buildSearchPatch(supabase, row.id, row);
          await (supabase as any).from('products').update(sp).eq('id', row.id);
        } catch {
          logger.warn('deleteCategory reassign search rebuild failed', { id: row.id });
        }
      }
    } else {
      const { error: dErr } = await (supabase as any)
        .from('products')
        .update({ category_id: null, subcategory_id: null })
        .eq('category_id', categoryId);
      if (dErr) throw dErr;
    }

    // Delete subcategories then the category itself
    const { error: sErr } = await (supabase as any).from('subcategories').delete().eq('category_id', categoryId);
    if (sErr) throw sErr;
    const { error: cErr } = await (supabase as any).from('categories').delete().eq('id', categoryId);
    if (cErr) throw cErr;

    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error deleting category', { error: error.message, categoryId });
    return { success: false, error: error.message };
  }
}

export async function renameSubcategory(subcategoryId: string, newName: string) {
  try {
    const supabase = await createClient();
    const name = newName.trim();
    if (!name) return { success: false, error: 'Nombre vacío.' };
    const { error } = await (supabase as any).from('subcategories').update({ name }).eq('id', subcategoryId);
    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error renaming subcategory', { error: error.message, subcategoryId });
    return { success: false, error: error.message };
  }
}

export async function deleteSubcategory(subcategoryId: string) {
  try {
    const supabase = await createClient();
    // Detach products from this subcategory (keep them in the parent category)
    const { error: pErr } = await (supabase as any)
      .from('products')
      .update({ subcategory_id: null })
      .eq('subcategory_id', subcategoryId);
    if (pErr) throw pErr;
    const { error } = await (supabase as any).from('subcategories').delete().eq('id', subcategoryId);
    if (error) throw error;
    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error deleting subcategory', { error: error.message, subcategoryId });
    return { success: false, error: error.message };
  }
}

export async function moveProduct(productId: string, categoryId: string | null, subcategoryId: string | null) {
  try {
    const supabase = await createClient();
    const { error } = await (supabase as any)
      .from('products')
      .update({ category_id: categoryId, subcategory_id: subcategoryId })
      .eq('id', productId);
    if (error) throw error;

    // Rebuild search_text since category name is part of it
    const { data: row } = await (supabase as any)
      .from('products')
      .select('id, name, reference, description, category_id, search_text')
      .eq('id', productId)
      .single();
    if (row) {
      try {
        const sp = await buildSearchPatch(supabase, productId, row);
        await (supabase as any).from('products').update(sp).eq('id', productId);
      } catch (e) {
        logger.warn('moveProduct search rebuild failed', { id: productId, error: (e as any).message });
      }
    }

    revalidatePath('/conocimiento');
    return { success: true };
  } catch (error: any) {
    logger.error('Error moving product', { error: error.message, productId });
    return { success: false, error: error.message };
  }
}

// ─── EXPORT / IMPORT EXCEL (Hito 5) ───
/**
 * Exports the full catalog as an array of plain rows (client builds the .xlsx).
 * Includes derived price tier rows flattened: one row per product+variant+range.
 */
export async function exportCatalogRows(categoryId?: string) {
  try {
    const supabase = await createClient();
    let q = (supabase as any)
      .from('products')
      .select('id, name, reference, description, unit, price_includes_iva, min_order_qty, notes, active, categories(name), price_tiers(variant, min_qty, max_qty, price, price_basis, currency)')
      .order('name', { ascending: true });
    if (categoryId && categoryId !== 'all') {
      const id = categoryId.replace(/^(cat|sub)-/, '');
      if (categoryId.startsWith('sub-')) q = q.eq('subcategory_id', id);
      else q = q.eq('category_id', id);
    }
    const { data, error } = await q;
    if (error) throw error;

    const rows: Record<string, unknown>[] = [];
    for (const p of data || []) {
      const catName = (p as any).categories?.name || '';
      const tiers = (p as any).price_tiers || [];
      if (tiers.length === 0) {
        rows.push({
          categoria: catName,
          nombre: p.name,
          referencia: p.reference || '',
          descripcion: p.description || '',
          unidad: p.unit,
          precio_incluye_iva: p.price_includes_iva ? 'SI' : 'NO',
          cantidad_minima: p.min_order_qty || '',
          notas: p.notes || '',
          activo: p.active ? 'SI' : 'NO',
          variante: '',
          cantidad_min: '',
          cantidad_max: '',
          precio: '',
          base_precio: '',
          moneda: '',
        });
      } else {
        for (const t of tiers) {
          rows.push({
            categoria: catName,
            nombre: p.name,
            referencia: p.reference || '',
            descripcion: p.description || '',
            unidad: p.unit,
            precio_incluye_iva: p.price_includes_iva ? 'SI' : 'NO',
            cantidad_minima: p.min_order_qty || '',
            notas: p.notes || '',
            activo: p.active ? 'SI' : 'NO',
            variante: t.variant || 'Estándar',
            cantidad_min: t.min_qty ?? '',
            cantidad_max: t.max_qty ?? '',
            precio: t.price ?? '',
            base_precio: t.price_basis || 'unitario',
            moneda: t.currency || 'COP',
          });
        }
      }
    }
    return { success: true, rows };
  } catch (error: any) {
    logger.error('Error exporting catalog', { error: error.message });
    return { success: false, error: error.message, rows: [] };
  }
}

/**
 * Imports products from normalized row objects (parsed client-side from xlsx/csv).
 * Matches existing products by `referencia` (case-insensitive, trimmed) when present;
 * otherwise creates a new product. Returns a report.
 *
 * Each row should contain: categoria, nombre, referencia?, descripcion?, unidad?,
 * precio_incluye_iva?(SI/NO), cantidad_minima?, notas?, activo?(SI/NO), and price
 * tier fields variante?, cantidad_min?, cantidad_max?, precio?, base_precio?, moneda?
 *
 * NOTE: This is a long-running operation. Caller should batch reasonably.
 */
export async function importCatalogRows(
  rows: Array<Record<string, unknown>>
): Promise<{ inserted: number; updated: number; errors: string[] }> {
  const report = { inserted: 0, updated: 0, errors: [] as string[] };
  try {
    const supabase = await createClient();

    // Preload category map (name -> id) to resolve category names quickly
    const { data: allCats } = await (supabase as any).from('categories').select('id, name');
    const catByName = new Map<string, string>();
    const catNorm = (s: string) => s.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const c of allCats || []) catByName.set(catNorm(c.name), c.id);

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const nombre = String(r.nombre || '').trim();
      const categoriaNombre = String(r.categoria || '').trim();
      if (!nombre) { report.errors.push(`Fila ${i + 2}: falta nombre.`); continue; }
      if (!categoriaNombre) { report.errors.push(`Fila ${i + 2}: falta categoría.`); continue; }

      let categoryId = catByName.get(catNorm(categoriaNombre));
      if (!categoryId) {
        // Auto-create the missing category
        const { data: nc, error: ncErr } = await (supabase as any)
          .from('categories').insert({ name: categoriaNombre }).select('id').single();
        if (ncErr) { report.errors.push(`Fila ${i + 2}: no se pudo crear categoría "${categoriaNombre}".`); continue; }
        categoryId = nc.id;
        catByName.set(catNorm(categoriaNombre), nc.id);
      }

      const referencia = r.referencia ? String(r.referencia).trim() : '';
      const descripcion = r.descripcion ? String(r.descripcion) : null;
      const unit = r.unidad ? String(r.unidad) : 'unidad';
      const includesIva = String(r.precio_incluye_iva || '').toUpperCase().startsWith('SI');
      const minQty = r.cantidad_minima ? Number(r.cantidad_minima) : null;
      const notes = r.notas ? String(r.notas) : null;
      const activo = r.activo === undefined ? true : String(r.activo).toUpperCase().startsWith('SI');

      // Try to resolve existing product by reference, else by exact name within category
      let existingId: string | null = null;
      if (referencia) {
        const { data: byRef } = await (supabase as any)
          .from('products').select('id').eq('reference', referencia).limit(1);
        if (byRef && byRef.length) existingId = byRef[0].id;
      }
      if (!existingId) {
        const { data: byName } = await (supabase as any)
          .from('products').select('id').eq('name', nombre).eq('category_id', categoryId).limit(1);
        if (byName && byName.length) existingId = byName[0].id;
      }

      // Build search_text (reuse saveProduct format)
      const searchText = `${categoriaNombre} - ${nombre} - ${referencia} - ${descripcion || ''}.`.trim();
      let embedding: number[] | null = null;
      if (process.env.EMBEDDINGS_API_KEY) {
        try { embedding = await embedText(searchText); } catch (e) {
          report.errors.push(`Fila ${i + 2}: embedding falló (${(e as any).message}). Producto guardado sin vector.`);
        }
      }

      const dbProduct = {
        category_id: categoryId,
        name: nombre,
        reference: referencia || null,
        description: descripcion,
        unit,
        price_includes_iva: includesIva,
        min_order_qty: minQty && Number.isFinite(minQty) ? minQty : null,
        notes,
        active: activo,
        search_text: searchText,
        ...(embedding ? { embedding } : {}),
      };

      let productId: string;
      if (existingId) {
        const { error } = await (supabase as any).from('products').update(dbProduct).eq('id', existingId);
        if (error) { report.errors.push(`Fila ${i + 2}: error actualizando (${error.message}).`); continue; }
        productId = existingId;
        report.updated++;
        // Replace tiers on update
        await (supabase as any).from('price_tiers').delete().eq('product_id', productId);
      } else {
        const { data, error } = await (supabase as any).from('products').insert(dbProduct).select('id').single();
        if (error) { report.errors.push(`Fila ${i + 2}: error insertando (${error.message}).`); continue; }
        productId = data.id;
        report.inserted++;
      }

      // Insert price tier if price data present
      const variante = r.variante ? String(r.variante) : 'Estándar';
      const minQ = r.cantidad_min !== undefined && r.cantidad_min !== '' ? Number(r.cantidad_min) : 1;
      const maxQ = r.cantidad_max !== undefined && r.cantidad_max !== '' ? Number(r.cantidad_max) : null;
      const precio = r.precio !== undefined && r.precio !== '' ? Number(r.precio) : null;
      const basis = r.base_precio ? String(r.base_precio) : 'unitario';
      const moneda = r.moneda ? String(r.moneda) : 'COP';
      if (precio !== null && Number.isFinite(precio) && precio < 1e9) {
        const { error: tErr } = await (supabase as any).from('price_tiers').insert({
          product_id: productId,
          variant: variante,
          min_qty: Number.isFinite(minQ) && minQ > 0 ? minQ : 1,
          max_qty: maxQ && Number.isFinite(maxQ) ? maxQ : null,
          price: precio,
          price_basis: basis,
          currency: moneda,
          source_sheet: 'Importación Web SaaS',
        });
        if (tErr) report.errors.push(`Fila ${i + 2}: precio no guardado (${tErr.message}).`);
      }
    }

    revalidatePath('/conocimiento');
    return report;
  } catch (error: any) {
    logger.error('Error importing catalog', { error: error.message });
    report.errors.push('Error general: ' + error.message);
    return report;
  }
}

// ─── SERVICIOS Y MARCACIONES ───
//
// Servicios que se cobran aparte del producto o que se combinan con él:
// marcaciones (tampografía, screen, láser, bordado), impresión por área
// (DTF UV, DTF Textil, vinilos, banners) y los componentes de cuaderno.
// Hasta ahora el panel mostraba estas tarifas escritas a mano en el código,
// con cifras que no existían en la base: el bot cotizaba una cosa y el panel
// mostraba otra. Esto lee la fuente real.

const SERVICE_NAME_HINTS = [
  'tampograf', 'screen', 'laser', 'láser', 'bordado', 'dtf', 'vinilo',
  'sublima', 'marcado', 'marcación', 'marcacion', 'servicio de',
  'adicional:', 'impresión', 'impresion', 'calandra', 'panaflex', 'banner',
];

const AREA_UNITS = ['m2', 'cm2', 'metro', 'm'];

export type ServiceGroup = {
  group: string;
  items: Array<{
    id: string;
    reference: string | null;
    name: string;
    unit: string;
    description: string | null;
    notes: string | null;
    active: boolean;
    tiers: Array<{
      id: string;
      variant: string | null;
      min_qty: number;
      max_qty: number | null;
      price: number;
      price_basis: string;
    }>;
  }>;
};

export async function getServiciosYMarcaciones(): Promise<ServiceGroup[]> {
  try {
    const supabase = await createClient();

    const { data: cats } = await (supabase as any).from('categories').select('id, name');
    const catName = new Map<string, string>((cats || []).map((c: any) => [c.id, c.name]));

    // Se pagina: PostgREST devuelve como máximo 1000 filas por consulta.
    const products: any[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data: page } = await (supabase as any)
        .from('products')
        .select('id, reference, name, unit, description, notes, active, category_id')
        .eq('active', true)
        .range(from, from + 999);
      if (!page?.length) break;
      products.push(...page);
      if (page.length < 1000) break;
    }

    const isService = (p: any) => {
      const unit = (p.unit || '').toLowerCase();
      if (AREA_UNITS.includes(unit)) return true;
      const hay = `${p.name || ''} ${catName.get(p.category_id) || ''}`.toLowerCase();
      return SERVICE_NAME_HINTS.some(h => hay.includes(h));
    };

    const services = products.filter(isService);
    if (services.length === 0) return [];

    // Tarifas de esos servicios, por lotes para no exceder el largo de la URL.
    const tiersByProduct = new Map<string, any[]>();
    const ids = services.map(s => s.id);
    for (let i = 0; i < ids.length; i += 100) {
      const { data: tiers } = await (supabase as any)
        .from('price_tiers')
        .select('id, product_id, variant, min_qty, max_qty, price, price_basis')
        .in('product_id', ids.slice(i, i + 100));
      for (const t of (tiers || [])) {
        if (!tiersByProduct.has(t.product_id)) tiersByProduct.set(t.product_id, []);
        tiersByProduct.get(t.product_id)!.push(t);
      }
    }

    const groupOf = (p: any): string => {
      const n = (p.name || '').toLowerCase();
      const c = (catName.get(p.category_id) || '').toLowerCase();
      if (c.includes('cuaderno')) return 'Cuadernos: base y adicionales';
      if (n.includes('dtf')) return 'DTF (UV y Textil)';
      if (n.includes('tampograf')) return 'Tampografía';
      if (n.includes('bordado')) return 'Bordado';
      if (n.includes('laser') || n.includes('láser')) return 'Marcación láser';
      if (n.includes('screen') || n.includes('serigraf')) return 'Screen / serigrafía';
      if (n.includes('vinilo') || n.includes('poli cal')) return 'Vinilos y adhesivos';
      if (n.includes('banner') || n.includes('panaflex')) return 'Banners y lonas';
      if (n.includes('calandra') || n.includes('tela')) return 'Impresión sobre tela';
      if (n.includes('sublima')) return 'Sublimación';
      return 'Otros servicios';
    };

    const grouped = new Map<string, ServiceGroup['items']>();
    for (const p of services) {
      const g = groupOf(p);
      if (!grouped.has(g)) grouped.set(g, []);
      const tiers = (tiersByProduct.get(p.id) || [])
        .sort((a, b) => String(a.variant || '').localeCompare(String(b.variant || '')) || a.min_qty - b.min_qty);
      grouped.get(g)!.push({
        id: p.id,
        reference: p.reference,
        name: p.name,
        unit: p.unit || 'unidad',
        description: p.description,
        notes: p.notes,
        active: p.active,
        tiers,
      });
    }

    return [...grouped.entries()]
      .map(([group, items]) => ({
        group,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.group.localeCompare(b.group));
  } catch (error: any) {
    logger.error('Error loading servicios y marcaciones', { error: error.message });
    return [];
  }
}

// ─── HOJAS DE CATEGORÍA ────────────────────────────────────────────────────
/**
 * La HOJA es la chuleta del asesor, no un cuestionario para el cliente.
 *
 * POR QUÉ EXISTE. Hasta el 04-ago-2026 el sistema tenía UNA sola hoja, la de
 * cuadernos, escrita a mano DENTRO del prompt («REGLA ESPECIAL: Cuadernos —
 * necesitas 4 datos: tamaño, hojas, cantidad, argollado o cosido»). Funcionaba,
 * pero era una de 82 categorías y el dueño no podía verla ni cambiarla.
 * Resultado medido el 03-ago: a «¿y ya vienen marcados?» sobre cuadernos, el
 * bot —sin hoja que le dijera que el Diseño ya está en la tabla— se inventó un
 * interrogatorio de tres turnos (tamaño del logo, técnica, número de tintas) y
 * terminó en «hubo un error al cotizar». Cinco mensajes, cero venta.
 *
 * DÓNDE VIVE. En `agent_configs.metadata.hojas`, igual que las cuentas de pago,
 * los temas libres y las sedes. Sin tabla nueva y sin migración: el mismo patrón
 * que ya funciona en este panel.
 *
 * UNA HOJA PUEDE CUBRIR VARIAS CATEGORÍAS. Es la respuesta a «¿qué más se puede
 * combinar?»: el dueño agrupa por **qué hay que preguntar para cotizar**, no por
 * lo que el producto es. Un mug, un termo y un vaso se preguntan igual; un
 * martillo y una sombrilla también. Una hoja, varias categorías enganchadas.
 *
 * LO QUE FALTA SE OMITE. Un campo vacío no se rellena con un ejemplo: la hoja
 * simplemente no dice nada de eso y el bot consulta con el equipo. Es la misma
 * regla de DEFAULT_PERSONA, y el motivo es el mismo — un ejemplo puesto «para
 * que no quede vacío» se convierte en una mentira dicha con total seguridad.
 */
export interface HojaDeCategoria {
  id: string;
  nombre: string;
  /** Categorías que usan esta hoja. Vacío + general = cubre todo lo demás. */
  categorias: string[];
  /** Si es la hoja de respaldo para las categorías sin hoja propia. */
  general?: boolean;
  /** Lo que el ASESOR necesita saber para cotizar. No es lo que se le pregunta al cliente. */
  preguntar: string;
  /** Lo que NO hay que preguntar, y por qué. */
  no_preguntar: string;
  /** Cómo pedir esos datos en palabras que el cliente entienda. */
  como_preguntar: string;
  /**
   * Cómo llama el cliente a estos productos. Es lo que permite encontrar la
   * hoja ANTES de buscar, y por tanto que `buscar_como` mande la consulta.
   */
  dice_el_cliente: string;
  /** Con qué palabras se busca en el catálogo. */
  buscar_como: string;
  /** Palabras que NO existen en el catálogo y no hay que usar al buscar. */
  nunca_buscar: string;
  /** Qué se le puede sumar al producto. */
  adicionales: string;
  /** incluida | aparte | no_aplica | '' (sin definir) */
  marcacion: string;
  /** Aclaración de la marcación, en una línea. */
  marcacion_nota: string;
  /** Cualquier otra cosa que el asesor deba tener presente. */
  notas: string;
  /** Referencia del producto que se ofrece cuando la venta ya está cerrada. */
  ofrecer_al_cerrar: string;
  /** La frase con que se ofrece, con {precio} o {total} donde va la cifra. */
  frase_al_cerrar: string;
}

function limpiarHoja(h: any, indice: number): HojaDeCategoria {
  const texto = (v: any) => String(v ?? '').trim();
  const MARCACIONES = ['incluida', 'aparte', 'no_aplica'];
  const marcacion = texto(h?.marcacion).toLowerCase();
  return {
    id: texto(h?.id) || `hoja_${indice + 1}`,
    nombre: texto(h?.nombre),
    categorias: Array.isArray(h?.categorias) ? h.categorias.map(texto).filter(Boolean) : [],
    general: h?.general === true,
    preguntar: texto(h?.preguntar),
    no_preguntar: texto(h?.no_preguntar),
    como_preguntar: texto(h?.como_preguntar),
    dice_el_cliente: texto(h?.dice_el_cliente),
    buscar_como: texto(h?.buscar_como),
    nunca_buscar: texto(h?.nunca_buscar),
    adicionales: texto(h?.adicionales),
    // Un valor raro NO se corrige a uno que suene bien: se deja vacío, y con el
    // campo vacío el bot dice que lo confirma en vez de afirmar de más.
    marcacion: MARCACIONES.includes(marcacion) ? marcacion : '',
    marcacion_nota: texto(h?.marcacion_nota),
    notas: texto(h?.notas),
    ofrecer_al_cerrar: texto(h?.ofrecer_al_cerrar),
    frase_al_cerrar: texto(h?.frase_al_cerrar),
  };
}

/** Lee las hojas que el dueño escribió en el panel. */
export async function getHojas(): Promise<HojaDeCategoria[]> {
  try {
    const supabase = await createClient();
    const orgId = await getOrgId();
    const { data } = await (supabase as any)
      .from('agent_configs')
      .select('metadata')
      .eq('organization_id', orgId)
      .single();

    const crudas = (data?.metadata as any)?.hojas;
    if (!Array.isArray(crudas)) return [];
    return crudas.map(limpiarHoja);
  } catch (error: any) {
    logger.error('getHojas', { error: error.message });
    return [];
  }
}

/**
 * Guarda la lista COMPLETA de hojas.
 *
 * Se lee el resto de `metadata` y se conserva: escribir solo `{ hojas }`
 * borraría `persona` —el nombre del agente, su saludo, las cuentas de pago— y
 * eso ya pasó antes en este proyecto con las FAQ.
 */
export async function saveHojas(hojas: any[]) {
  try {
    const supabase = await createClient();
    const orgId = await getOrgId();

    const limpias = (Array.isArray(hojas) ? hojas : [])
      .map(limpiarHoja)
      // Una hoja sin nombre no se puede ni nombrar: no se guarda a medias.
      .filter(h => h.nombre);

    // Solo puede haber UNA hoja general: si hubiera dos, ninguna de las dos
    // sabría cuál manda para una categoría sin hoja propia.
    let yaHayGeneral = false;
    for (const h of limpias) {
      if (h.general && yaHayGeneral) h.general = false;
      if (h.general) yaHayGeneral = true;
    }

    const { data: existente } = await (supabase as any)
      .from('agent_configs')
      .select('metadata')
      .eq('organization_id', orgId)
      .single();

    const metadata = { ...((existente as any)?.metadata || {}), hojas: limpias };

    const { error } = await (supabase as any)
      .from('agent_configs')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('organization_id', orgId);

    if (error) throw error;

    logger.info('Hojas de categoria guardadas', {
      orgId,
      cuantas: limpias.length,
      categoriasCubiertas: limpias.reduce((n, h) => n + h.categorias.length, 0),
    });

    revalidatePath('/conocimiento');
    return { success: true, guardadas: limpias.length };
  } catch (error: any) {
    logger.error('saveHojas', { error: error.message });
    return { success: false, error: error.message };
  }
}

/**
 * EL TABLERO DE LAS HOJAS — qué hay, qué falta y qué está repetido.
 *
 * POR QUÉ EXISTE. El dueño lo dijo con todas las letras el 11-ago-2026: «cada
 * vez que creo una hoja nueva me tengo que salir de la de ejemplo y ya no tengo
 * referencia; una vez llena una hoja no hay forma de saber si estoy repitiendo
 * una que ya llené, ni cuáles me faltan, ni dónde miro». Estaba trabajando a
 * ciegas, y con 12 hojas ya no se puede sostener de memoria.
 *
 * Y pidió expresamente **menos texto explicativo, no más**: el panel ya está
 * lleno de ayudas y aun así no se entiende. Lo que hacía falta no era otra
 * explicación, sino los tres números que contestan sus tres preguntas.
 */
export interface DiagnosticoDeHojas {
  /** Productos activos que alguna hoja reconoce, y el total. */
  cubiertos: number;
  totalProductos: number;
  /** Familias que ninguna hoja reconoce, de más productos a menos. */
  faltan: Array<{ palabra: string; productos: number }>;
  /** La misma palabra en dos hojas: el bot usa una y descarta la otra. */
  repetidas: Array<{ palabra: string; hojas: string[] }>;
  /** Hojas con vocabulario pero sin nada de lo comercial. */
  aMedias: string[];
}

/** Palabras que no nombran una familia de productos. */
const VACIAS = new Set([
  'set', 'kit', 'juego', 'de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin',
  'para', 'por', 'en', 'y', 'o', 'a', 'un', 'una', 'mini', 'gran', 'x1', 'x2',
  'color', 'blanco', 'blanca', 'negro', 'negra', 'iva', 'incluido', 'oferta',
  'nacional', 'produccion', 'producción', 'premium', 'eco', 'nuevo', 'nueva',
]);

function limpiar(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La palabra con la que un cliente llamaría a este producto: la primera útil. */
function familiaDe(nombre: string): string {
  for (const p of limpiar(nombre).split(' ')) {
    if (p.length >= 4 && !VACIAS.has(p)) return p;
  }
  return '';
}

export async function diagnosticoDeHojas(): Promise<DiagnosticoDeHojas> {
  const vacio: DiagnosticoDeHojas = {
    cubiertos: 0, totalProductos: 0, faltan: [], repetidas: [], aMedias: [],
  };
  try {
    const supabase = await createClient();
    const hojas = await getHojas();

    // El vocabulario de todas las hojas, y de quién es cada palabra.
    const duenoDeLaPalabra = new Map<string, string[]>();
    for (const h of hojas) {
      const suyas = new Set(
        `${h.dice_el_cliente || ''},${h.buscar_como || ''}`
          .split(/[,;\n·|]/)
          .map((t) => limpiar(t))
          .filter((t) => t.length >= 3)
      );
      for (const p of suyas) {
        duenoDeLaPalabra.set(p, [...(duenoDeLaPalabra.get(p) || []), h.nombre || 'sin nombre']);
      }
    }

    const repetidas = [...duenoDeLaPalabra.entries()]
      .filter(([, quienes]) => quienes.length > 1)
      .map(([palabra, hojas]) => ({ palabra, hojas }))
      .slice(0, 20);

    // Los productos activos, por páginas: la base devuelve 1.000 y se calla.
    const nombres: string[] = [];
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await (supabase as any)
        .from('products')
        .select('name')
        .eq('active', true)
        .range(desde, desde + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      nombres.push(...data.map((p: any) => String(p.name || '')));
      if (data.length < 1000) break;
    }

    let cubiertos = 0;
    const sinCubrir = new Map<string, number>();
    for (const nombre of nombres) {
      const palabras = limpiar(nombre).split(' ');
      const loReconoce = palabras.some((p) => duenoDeLaPalabra.has(p));
      if (loReconoce) {
        cubiertos++;
        continue;
      }
      const fam = familiaDe(nombre);
      if (fam) sinCubrir.set(fam, (sinCubrir.get(fam) || 0) + 1);
    }

    const faltan = [...sinCubrir.entries()]
      .map(([palabra, productos]) => ({ palabra, productos }))
      .sort((a, b) => b.productos - a.productos)
      .slice(0, 12);

    // Una hoja «a medias» tiene el vocabulario puesto pero nada que ayude a
    // vender: sirve para encontrar el producto y para nada más.
    const aMedias = hojas
      .filter(
        (h) =>
          (h.dice_el_cliente || '').trim() &&
          !(h.preguntar || '').trim() &&
          !(h.como_preguntar || '').trim() &&
          !(h.marcacion || '').trim() &&
          !(h.notas || '').trim()
      )
      .map((h) => h.nombre || 'sin nombre');

    return { cubiertos, totalProductos: nombres.length, faltan, repetidas, aMedias };
  } catch (error: any) {
    logger.error('diagnosticoDeHojas', { error: error.message });
    return vacio;
  }
}

/**
 * EL BUSCADOR DEL PRODUCTO QUE SE OFRECE AL CERRAR.
 *
 * El campo guarda la REFERENCIA, no el nombre escrito a mano, porque «bolígrafo»
 * son 27 productos distintos y el sistema no elige a dedo entre dos candidatos:
 * si hay duda, no ofrece nada y el dueño no se entera de por qué.
 *
 * Devuelve el precio ya calculado para la cantidad de ejemplo, que es lo único
 * que responde a la pregunta que el dueño de verdad se hace: «¿qué le va a
 * decir el bot al cliente?». Sin esto, escribir una hoja es escribir a ciegas.
 */
export async function buscarProductoParaOferta(
  texto: string,
  cantidad = 20
): Promise<Array<{ reference: string; name: string; precio: number | null }>> {
  try {
    const clave = String(texto || '').trim();
    if (clave.length < 2) return [];

    const supabase = await createClient();
    const n = Number(cantidad) > 0 ? Math.round(Number(cantidad)) : 20;

    const { data: productos, error } = await (supabase as any)
      .from('products')
      .select('id, reference, name')
      .eq('active', true)
      .or(`name.ilike.*${clave}*,reference.ilike.*${clave}*`)
      .limit(8);

    // Una consulta rota devuelve vacío sin avisar: el 10-ago costó una tarde.
    if (error) {
      logger.error('buscarProductoParaOferta', { error: error.message, clave });
      return [];
    }
    if (!productos?.length) return [];

    const { data: tarifas } = await (supabase as any)
      .from('price_tiers')
      .select('product_id, price, min_qty, max_qty, price_basis')
      .in('product_id', productos.map((p: any) => p.id));

    return productos.map((p: any) => {
      const suyas = (tarifas || []).filter((t: any) => {
        if (t.product_id !== p.id) return false;
        const base = String(t.price_basis || 'unitario').toLowerCase();
        if (base !== 'unitario') return false;
        const precio = Number(t.price);
        if (!Number.isFinite(precio) || precio <= 0 || precio > 1e9) return false;
        return n >= (t.min_qty || 0) && (t.max_qty == null || n <= t.max_qty);
      });
      const precios: number[] = suyas.map((t: any) => Number(t.price));
      const distintos = precios.filter((p, i) => precios.indexOf(p) === i);
      // Con dos precios posibles para la misma cantidad no hay un precio: hay
      // una duda, y el bot tampoco va a poder resolverla en el cierre.
      return {
        reference: String(p.reference || ''),
        name: String(p.name || ''),
        precio: distintos.length === 1 ? distintos[0] : null,
      };
    });
  } catch (error: any) {
    logger.error('buscarProductoParaOferta', { error: error.message });
    return [];
  }
}

/**
 * Cuántos productos activos tiene cada categoría.
 *
 * Sirve para que cada hoja muestre a cuántos productos está llegando de verdad.
 * Una hoja en CERO es una hoja muerta —le borraron la categoría, o nunca le
 * marcaron ninguna— y hoy se ve exactamente igual que una viva.
 *
 * El dueño lo planteó el 04-ago-2026 preguntando cuántas hojas habría en diez
 * años. El número no es el problema (se agrupan por cómo se cotiza, así que son
 * diez o quince). El problema es no poder distinguir, dentro de tres años, cuál
 * sigue sirviendo y cuál quedó apuntando al vacío.
 */
export async function contarProductosPorCategoria(): Promise<Record<string, number>> {
  try {
    const supabase = await createClient();

    // Se piden solo los identificadores y se cuenta acá: traer los productos
    // enteros arrastraría la columna del buscador, que pesa 19 KB POR PRODUCTO.
    const conteo: Record<string, number> = {};
    let desde = 0;
    for (;;) {
      const { data, error } = await (supabase as any)
        .from('products')
        .select('category_id')
        .eq('active', true)
        .range(desde, desde + 999);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const fila of data) {
        const id = String(fila.category_id || '');
        if (id) conteo[id] = (conteo[id] || 0) + 1;
      }

      // La base NUNCA devuelve más de 1000 filas por petición, y pedir un
      // límite mayor no lo cambia: devuelve 1000 y se queda callada.
      if (data.length < 1000) break;
      desde += 1000;
    }

    return conteo;
  } catch (error: any) {
    logger.error('contarProductosPorCategoria', { error: error.message });
    return {};
  }
}
