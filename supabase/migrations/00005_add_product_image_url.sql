-- ============================================================
-- MIGRACIÓN: Agregar image_url a products
-- Ejecutar en Supabase SQL Editor
-- ============================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS image_url text;

COMMENT ON COLUMN products.image_url IS 'URL de la imagen de referencia del producto. Solo para visualización humana en el panel. El bot usa search_text/embeddings, no la imagen.';
