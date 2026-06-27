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
}) {
  try {
    const supabase = await createClient();
    const offset = (params.page - 1) * params.limit;

    // Build query
    let queryBuilder = (supabase as any)
      .from('products')
      .select('*, categories(name)', { count: 'exact' });

    // Filter by Category or Subcategory
    if (params.categoryId && params.categoryId !== 'all') {
      // Check if the ID belongs to a category or subcategory
      // For now, assume it's a category. If we add subcategory filtering, we can check a prefix or just do an OR.
      // We will add subcategory filtering explicitly in Phase 2
      // Let's allow passing categoryId as "cat-UUID" or "sub-UUID" to distinguish
      if (params.categoryId.startsWith('sub-')) {
        queryBuilder = queryBuilder.eq('subcategory_id', params.categoryId.replace('sub-', ''));
      } else if (params.categoryId.startsWith('cat-')) {
        queryBuilder = queryBuilder.eq('category_id', params.categoryId.replace('cat-', ''));
      } else {
        queryBuilder = queryBuilder.eq('category_id', params.categoryId);
      }
    }

    // Filter by Search Query
    if (params.search) {
      // Use text search on search_text
      queryBuilder = queryBuilder.or(
        `name.ilike.%${params.search}%,reference.ilike.%${params.search}%,search_text.ilike.%${params.search}%`
      );
    }

    const { data, count, error } = await queryBuilder
      .order('active', { ascending: false })
      .order('name', { ascending: true })
      .range(offset, offset + params.limit - 1);

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
