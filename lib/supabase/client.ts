'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/database.types';

export function createClient() {
  const url = typeof window !== 'undefined' && (window as any).__ENV?.NEXT_PUBLIC_SUPABASE_URL
    ? (window as any).__ENV.NEXT_PUBLIC_SUPABASE_URL
    : process.env.NEXT_PUBLIC_SUPABASE_URL!;

  const anonKey = typeof window !== 'undefined' && (window as any).__ENV?.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? (window as any).__ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createBrowserClient<Database>(url, anonKey);
}
