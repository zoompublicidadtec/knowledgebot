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
      // Fallback if column 'synonyms' doesn't exist yet in the DB
      if (error.code === 'PGRST100' || error.message.includes('column') || error.message.includes('synonyms')) {
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
      throw error;
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
      .select('*, categories(name), price_tiers(id, variant, min_qty, max_qty, price, price_basis)', { count: 'exact' });

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
      ...(embedding ? { embedding } : {}),
    };

    let savedProductId = productData.id;

    if (productData.id) {
      // Update
      const { error } = await (supabase as any)
        .from('products')
        .update(dbProduct)
        .eq('id', productData.id);
      if (error) throw error;
    } else {
      // Insert
      const { data, error } = await (supabase as any)
        .from('products')
        .insert(dbProduct)
        .select('id')
        .single();
      if (error) throw error;
      savedProductId = data.id;
    }

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
