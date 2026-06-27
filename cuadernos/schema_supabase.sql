-- =========================================================
-- ESQUEMA SUPABASE PARA CATÁLOGO DE PRECIOS VRS DIGITAL
-- Diseñado para que un agente de IA pueda consultar precios
-- EXACTOS por SQL (sin depender de embeddings para los números)
-- =========================================================

create extension if not exists "uuid-ossp";
create extension if not exists vector;       -- pgvector, para búsqueda semántica de productos
create extension if not exists pg_trgm;       -- para búsquedas por similitud de texto (fuzzy)

-- ---------------------------------------------------------
-- 1. CATEGORÍAS
-- Corresponde a las pestañas/grupos de la hoja PRINCIPAL
-- ---------------------------------------------------------
create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,        -- ej: "Bolsas", "Llaveros", "Bolígrafos"
  group_name text,                  -- agrupador superior, ej: "Tampografía / Marcas", "Papelería"
  synonyms text                     -- sinónimos a nivel de categoría padre
);

create table subcategories (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,               -- ej: "Plana Troquelada", "Plastisol", "Metálicos"
  synonyms text,                    -- sinónimos específicos de la subcategoría
  unique(category_id, name)
);

-- ---------------------------------------------------------
-- 2. PRODUCTOS
-- Un registro por cada ítem/referencia concreta que el
-- cliente puede pedir (no por hoja de Excel)
-- ---------------------------------------------------------
create table products (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid references categories(id),
  subcategory_id uuid references subcategories(id),
  name text not null,                -- ej: "Bolsa Kraft 2 - 15.5x23x8cm con manija"
  reference text,                    -- código si existe, ej: "S-841", "USB 16GB FULL"
  description text,                  -- medidas, materiales, detalles técnicos
  unit text not null default 'unidad', -- 'unidad' | 'm2' | 'metro' | 'millar' | 'servicio'
  price_includes_iva boolean default false,
  min_order_qty numeric,             -- cantidad mínima de pedido si aplica
  notes text,                        -- condiciones especiales ("consultar para grabados extra", etc.)
  active boolean default true,
  search_text text,                  -- texto plano (nombre + categoría + descripción) para embeddings/búsqueda
  embedding vector(3072)             -- embedding Gemini 3072D del search_text (opcional, solo para encontrar el producto)
);

create index idx_products_category on products(category_id);
create index idx_products_subcategory on products(subcategory_id);
create index idx_products_search_trgm on products using gin (search_text gin_trgm_ops);
create index idx_products_search_tsv on products using gin (to_tsvector('spanish', coalesce(search_text,'')));

-- ---------------------------------------------------------
-- 2.5 ATRIBUTOS DE PRODUCTO (Fase 2)
-- ---------------------------------------------------------
create table product_attributes (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  attribute_key text not null,       -- ej: "material", "color", "capacidad", "tecnica_sugerida"
  attribute_value text not null,     -- ej: "acero inoxidable", "rojo", "16GB", "DTF"
  unique(product_id, attribute_key)
);
create index idx_product_attributes_pid on product_attributes(product_id);

-- ---------------------------------------------------------
-- 3. NIVELES DE PRECIO (price tiers)
-- Un registro por cada combinación producto + variante + rango de cantidad
-- Esta es la tabla que el agente consulta para dar el precio EXACTO
-- ---------------------------------------------------------
create table price_tiers (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  variant text not null default 'Estándar', -- ej: "1 Tinta", "2 Tintas", "Marca 2 Cascos",
                                              -- "Bordado tamaño bolsillo", "Sin marca", "Marcado DTF UV 1 cara"
  min_qty numeric not null default 1,
  max_qty numeric,                           -- null = sin límite superior (1000 en adelante, etc.)
  price numeric,                              -- null = "consultar" (precio no definido)
  price_basis text not null default 'unitario', -- 'unitario' (precio por unidad dentro del rango)
                                                  -- 'lote_total' (precio TOTAL para exactamente esa cantidad)
  currency text not null default 'COP',
  source_sheet text,                         -- de qué hoja del Excel viene (trazabilidad)
  source_cell text                           -- celda original (trazabilidad, ej: "Bolsas Kraft!C5")
);

create index idx_price_tiers_product on price_tiers(product_id);
create index idx_price_tiers_qty on price_tiers(product_id, min_qty, max_qty);

-- ---------------------------------------------------------
-- 4. FUNCIONES RPC PARA EL AGENTE
-- ---------------------------------------------------------

-- 4a. Buscar productos por texto (lo usa el agente para identificar
--     a qué producto se refiere el cliente)
create or replace function search_products(query text, limit_n int default 8)
returns table (
  id uuid,
  name text,
  category text,
  description text,
  unit text,
  notes text,
  requires_area boolean,
  min_order_qty numeric,
  similarity real
)
language sql stable
as $$
  select p.id, p.name, c.name as category, p.description, p.unit, p.notes,
         (p.unit = 'm2' or p.unit = 'metro') as requires_area,
         p.min_order_qty,
         similarity(p.search_text, query) as similarity
  from products p
  join categories c on c.id = p.category_id
  where p.active
    and (p.search_text % query
         or to_tsvector('spanish', p.search_text) @@ to_tsquery('spanish', query))
  order by similarity desc
  limit limit_n;
$$;

-- 4b. Obtener TODOS los niveles de precio de un producto (catálogo completo del producto)
create or replace function get_product_price_tiers(p_product_id uuid)
returns table (
  variant text,
  min_qty numeric,
  max_qty numeric,
  price numeric,
  price_basis text,
  currency text
)
language sql stable
as $$
  select variant, min_qty, max_qty, price, price_basis, currency
  from price_tiers
  where product_id = p_product_id
  order by variant, min_qty;
$$;

-- 4c. Obtener el precio EXACTO para una cantidad específica
--     (esto es lo que evita las alucinaciones: cálculo exacto, no generado)
create or replace function get_price_for_quantity(p_product_id uuid, p_quantity numeric)
returns table (
  variant text,
  price numeric,
  price_basis text,
  currency text,
  min_qty numeric,
  max_qty numeric
)
language sql stable
as $$
  select variant, price, price_basis, currency, min_qty, max_qty
  from price_tiers
  where product_id = p_product_id
    and p_quantity >= min_qty
    and (max_qty is null or p_quantity <= max_qty)
  order by variant;
$$;

-- ---------------------------------------------------------
-- 5. VISTA DE CONSULTA RÁPIDA (para depurar / revisar en Supabase Studio)
-- ---------------------------------------------------------
create view v_catalogo as
select
  c.name as categoria,
  p.name as producto,
  p.reference,
  p.unit,
  pt.variant,
  pt.min_qty,
  pt.max_qty,
  pt.price,
  pt.currency
from price_tiers pt
join products p on p.id = pt.product_id
join categories c on c.id = p.category_id
order by c.name, p.name, pt.variant, pt.min_qty;
