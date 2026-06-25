import { createClient } from '@/lib/supabase/server';
import { saveAgentConfigAction } from '@/lib/personalization/actions';
import { AgentSandbox } from '@/components/agent-sandbox';
import { SlidersHorizontal, SpinnerGap, Info, BookOpen } from '@phosphor-icons/react/dist/ssr';
import { redirect } from 'next/navigation';
import CustomizationClientForm from './client-form';

export default async function CustomizationPage() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();

  if (!profile) redirect('/login');
  const orgId = profile.organization_id;

  const { createAdminClient } = await import('@/lib/supabase/server');
  const adminClient = await createAdminClient();

  // Get current agent configuration
  const { data: agentConfig } = await adminClient
    .from('agent_configs')
    .select('*')
    .eq('organization_id', orgId)
    .single();

  if (!agentConfig) redirect('/dashboard');

  // Load or create a sandbox conversation for testing
  let sandboxConversationId = '';
  let sandboxMessages: any[] = [];

  try {
    const { data: sandboxContact } = await (adminClient as any)
      .from('contacts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('wa_phone', '+10000000000')
      .single();

    let sandboxContactId = sandboxContact?.id;

    if (!sandboxContactId) {
      const { data: newContact } = await (adminClient as any)
        .from('contacts')
        .insert({ organization_id: orgId, wa_phone: '+10000000000', full_name: 'Cliente Demo' })
        .select('id')
        .single();
      sandboxContactId = newContact?.id;
    }

    if (sandboxContactId) {
      const { data: existingConv } = await (adminClient as any)
        .from('conversations')
        .select('id')
        .eq('organization_id', orgId)
        .eq('contact_id', sandboxContactId)
        .single();

      let sandboxConvId = existingConv?.id;

      if (!sandboxConvId) {
        const { data: newConv } = await (adminClient as any)
          .from('conversations')
          .insert({ organization_id: orgId, contact_id: sandboxContactId, bot_active: true })
          .select('id')
          .single();
        sandboxConvId = newConv?.id;
      }

      if (sandboxConvId) {
        sandboxConversationId = sandboxConvId;
        const { data: msgs } = await adminClient
          .from('messages')
          .select('*')
          .eq('conversation_id', sandboxConvId)
          .order('created_at', { ascending: true });
        sandboxMessages = msgs || [];
      }
    }
  } catch (e) {
    // Sandbox failed silently — page still works
    console.warn('Sandbox setup failed:', e);
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <SlidersHorizontal size={28} weight="fill" className="text-primary-400" />
          Personalización del Agente
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
          Configura las respuestas de tu bot de IA, sus servicios, tono de voz y horarios de atención.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        {/* Form Settings (Span 2) */}
        <div className="xl:col-span-2 space-y-6">
          <CustomizationClientForm initialConfig={agentConfig} />
        </div>

        {/* Sandbox simulator (Span 1) */}
        <div className="xl:col-span-1">
          <div className="sticky top-6">
            <AgentSandbox
              orgId={orgId}
              conversationId={sandboxConversationId}
              initialMessages={sandboxMessages}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
