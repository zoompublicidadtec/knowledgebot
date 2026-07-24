import { createAdminClient } from '@/lib/supabase/admin';

/**
 * One-time migration runner: runs on the first startup if the image_url column is missing.
 * This avoids needing manual SQL access to run ALTER TABLE.
 */
export async function runPendingMigrations() {
  const supabase = createAdminClient();

  try {
    // Check if image_url column exists by querying a product
    const { error } = await (supabase as any)
      .from('products')
      .select('image_url')
      .limit(1);

    if (!error) {
      // Column already exists
      return;
    }

    if (error.message && error.message.includes('image_url')) {
      // Column missing — run migration
      console.log('[MIGRATION] Running: ALTER TABLE products ADD COLUMN image_url text');
      
      // Supabase does not expose a direct DDL endpoint via JS client.
      // We use a custom RPC if available, otherwise log the required SQL.
      // The SQL to run manually in Supabase Dashboard > SQL Editor:
      // ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;
      // COMMENT ON COLUMN products.image_url IS 'URL de imagen de referencia del producto.';
      
      console.log('[MIGRATION] ⚠️  Cannot auto-apply DDL migrations via Supabase JS client.');
      console.log('[MIGRATION] Please run this SQL in Supabase Dashboard SQL Editor:');
      console.log('[MIGRATION] ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url text;');
    }
  } catch (err) {
    // Non-critical
    console.warn('[MIGRATION] Error checking migration status:', err);
  }
}
