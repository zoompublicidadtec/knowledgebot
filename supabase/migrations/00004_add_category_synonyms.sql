-- Migration: Add synonyms column to categories table
ALTER TABLE categories ADD COLUMN IF NOT EXISTS synonyms text;

-- Add comment for documentation
COMMENT ON COLUMN categories.synonyms IS 'Sinónimos globales heredados por todos los productos de la categoría';
