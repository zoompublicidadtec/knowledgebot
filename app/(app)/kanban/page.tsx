import { createAdminClient as createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { KanbanBoard } from './client-page';

export default async function KanbanPage() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();

  if (!profile) redirect('/login');
  const orgId = profile.organization_id;

  // We fetch conversations joined with contacts.
  // We'll use the contact's metadata.stage to determine the Kanban column.
  const { data: list } = await (supabase as any)
    .from('conversations')
    .select('*, contacts(id, full_name, wa_phone, metadata)')
    .eq('organization_id', orgId)
    .order('last_message_at', { ascending: false });

  return (
    <div className="animate-fade-in h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Pipeline CRM</h1>
          <p className="text-sm mt-1" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>
            Arrastra y suelta a tus clientes entre las diferentes etapas comerciales.
          </p>
        </div>
      </div>

      {/* Desktop (PC): full Kanban board */}
      <div className="hidden lg:block">
        <KanbanBoard initialConversations={list || []} orgId={orgId} />
      </div>

      {/* Mobile: desktop-only notice (Pipeline is designed for wide screens) */}
      <div className="lg:hidden glass rounded-2xl p-8 text-center max-w-md mx-auto mt-8">
        <div
          className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: 'rgba(124, 58, 237, 0.15)' }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-white mb-2">Disponible solo en PC</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>
          El Pipeline CRM está diseñado para pantallas anchas y se usa desde el computador de la oficina.
          Abre esta página desde un PC para gestionar tus clientes.
        </p>
        <a
          href="/dashboard"
          className="btn-primary inline-flex items-center gap-2 mt-5"
        >
          Ir al Dashboard
        </a>
      </div>
    </div>
  );
}
