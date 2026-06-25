import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import ClientPage from './client-page';

export const metadata = {
  title: 'Líneas de WhatsApp | KnowledgeBot',
};

export default async function WhatsappLinesPage() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();

  if (!profile) {
    redirect('/login');
  }

  const { data: lines } = await (supabase as any)
    .from('whatsapp_lines')
    .select('*')
    .eq('organization_id', profile.organization_id)
    .order('created_at', { ascending: true });

  return <ClientPage initialLines={lines || []} />;
}
