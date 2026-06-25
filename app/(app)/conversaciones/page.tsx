import { createAdminClient as createClient } from '@/lib/supabase/server';
import { ConversationList } from '@/components/chat/conversation-list';
import { ChatCircleDots } from '@phosphor-icons/react/dist/ssr';
import { redirect } from 'next/navigation';

export default async function ConversationsIndexPage() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();

  if (!profile) redirect('/login');
  const orgId = profile.organization_id;

  // Fetch recent conversations
  const { data: list } = await (supabase as any)
    .from('conversations')
    .select('*, contacts(full_name, wa_phone)')
    .eq('organization_id', orgId)
    .order('last_message_at', { ascending: false });

  return (
    <div className="animate-fade-in h-[calc(100vh-140px)] min-h-[450px] grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Sidebar (List) */}
      <div className="lg:col-span-1 glass rounded-2xl overflow-hidden h-full">
        <ConversationList list={list || []} />
      </div>

      {/* Main chat window - Empty state */}
      <div className="lg:col-span-3 glass rounded-2xl flex flex-col items-center justify-center text-center p-6 h-full">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: 'rgba(99, 102, 241, 0.1)' }}>
          <ChatCircleDots size={32} className="text-primary-400" />
        </div>
        <h2 className="text-lg font-semibold text-white">Mensajería en tiempo real</h2>
        <p className="text-sm max-w-sm mt-2" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
          Selecciona una conversación del menú de la izquierda para ver los mensajes y responder directamente a tus clientes.
        </p>
      </div>
    </div>
  );
}
