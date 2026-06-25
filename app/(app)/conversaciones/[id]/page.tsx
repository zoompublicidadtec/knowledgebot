import { createAdminClient as createClient } from '@/lib/supabase/server';
import ChatClientPage from './client-page';
import { redirect } from 'next/navigation';

interface ChatPageProps {
  params: Promise<{ id: string }>;
}

export default async function ChatPage({ params }: ChatPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();

  if (!profile) redirect('/login');
  const orgId = profile.organization_id;

  // Get current conversation details
  const { data: currentConversation } = await (supabase as any)
    .from('conversations')
    .select('*, contacts(*)')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single();

  if (!currentConversation) redirect('/conversaciones');

  // Load list of conversations for sidebar
  const { data: conversations } = await (supabase as any)
    .from('conversations')
    .select('*, contacts(*)')
    .eq('organization_id', orgId)
    .order('last_message_at', { ascending: false });

  // Load chat messages
  const { data: messages } = await (supabase as any)
    .from('messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true });

  return (
    <ChatClientPage
      conversationId={id}
      initialConversations={conversations || []}
      initialMessages={messages || []}
      currentConversation={currentConversation}
    />
  );
}
