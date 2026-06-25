import { createAdminClient as createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { SquaresFour, CalendarBlank, ChatCircleDots, TrendUp, Users } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { ActivityChart } from '@/components/dashboard/activity-chart';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  
  if (!profile) redirect('/login?error=profile_not_found');
  const orgId = profile.organization_id;

  // KPI 1: Conversations last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { count: conversationCount } = await (supabase as any)
    .from('conversations')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('last_message_at', thirtyDaysAgo);

  // KPI 2: Appointments this week
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  const { count: appointmentCount } = await (supabase as any)
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('starts_at', monday.toISOString())
    .lte('starts_at', sunday.toISOString());

  // KPI 3: Total contacts
  const { count: contactCount } = await (supabase as any)
    .from('contacts')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  // Last 5 conversations
  const { data: recentConversations } = await (supabase as any)
    .from('conversations')
    .select('*, contacts(full_name, wa_phone)')
    .eq('organization_id', orgId)
    .order('last_message_at', { ascending: false })
    .limit(5);

  return (
    <div className="animate-fade-in space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <SquaresFour size={28} weight="fill" className="text-primary-400" />
          Dashboard
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
          Resumen de actividad de tu negocio
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>Conversaciones (30 días)</span>
            <ChatCircleDots size={22} className="text-primary-400" />
          </div>
          <p className="text-3xl font-bold text-white">{conversationCount ?? 0}</p>
          <div className="flex items-center gap-1 mt-2">
            <TrendUp size={14} className="text-emerald-400" />
            <span className="text-xs text-emerald-400">Últimos 30 días</span>
          </div>
        </div>

        <div className="card animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>Citas esta semana</span>
            <CalendarBlank size={22} className="text-emerald-400" />
          </div>
          <p className="text-3xl font-bold text-white">{appointmentCount ?? 0}</p>
          <div className="flex items-center gap-1 mt-2">
            <CalendarBlank size={14} className="text-primary-400" />
            <span className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Lun — Dom</span>
          </div>
        </div>

        <div className="card animate-slide-up" style={{ animationDelay: '0.2s' }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: 'rgba(148, 163, 184, 0.7)' }}>Contactos totales</span>
            <Users size={22} className="text-amber-400" />
          </div>
          <p className="text-3xl font-bold text-white">{contactCount ?? 0}</p>
          <div className="flex items-center gap-1 mt-2">
            <Users size={14} style={{ color: 'rgba(148, 163, 184, 0.5)' }} />
            <span className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>Clientes vía WhatsApp</span>
          </div>
        </div>
      </div>

      {/* Activity Chart */}
      <ActivityChart />

      {/* Recent conversations */}
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-4">Últimas conversaciones</h2>
        {recentConversations && recentConversations.length > 0 ? (
          <div className="space-y-2">
            {recentConversations.map((conv: any) => {
              const contact = conv.contacts as { full_name: string | null; wa_phone: string } | null;
              return (
                <Link
                  key={conv.id}
                  href={`/conversaciones/${conv.id}`}
                  className="flex items-center justify-between p-3 rounded-xl hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'rgba(99, 102, 241, 0.2)', color: '#a5b4fc' }}>
                      {(contact?.full_name || contact?.wa_phone || '?').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{contact?.full_name || contact?.wa_phone || 'Desconocido'}</p>
                      <p className="text-xs" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>
                        {new Date(conv.last_message_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!conv.bot_active && (
                      <span className="badge badge-warning text-xs">Humano</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <ChatCircleDots size={40} className="mx-auto mb-3" style={{ color: 'rgba(148, 163, 184, 0.3)' }} />
            <p className="text-sm" style={{ color: 'rgba(148, 163, 184, 0.5)' }}>
              Aún no hay conversaciones. Conecta tu WhatsApp para empezar.
            </p>
            <Link href="/integraciones" className="btn-primary mt-4 inline-flex">
              Configurar WhatsApp
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
