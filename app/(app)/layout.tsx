import { Sidebar } from '@/components/sidebar';
import { NotificationBell } from '@/components/notification-bell';
import { MobileNav } from '@/components/mobile-nav';
import { getCurrentUser } from '@/lib/auth/actions';
import { redirect } from 'next/navigation';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login?error=profile_not_found');

  const orgName = (user as Record<string, unknown>).organizations
    ? ((user as Record<string, unknown>).organizations as { name: string })?.name
    : undefined;

  return (
    <div className="flex min-h-screen">
      <Sidebar orgName={orgName} />
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Top bar with notification bell — renders above all content, no overflow clip */}
        <header className="sticky top-0 z-50 flex items-center justify-end px-4 lg:px-8 py-3 border-b"
          style={{
            background: 'rgba(10, 15, 30, 0.85)',
            backdropFilter: 'blur(16px)',
            borderColor: 'rgba(255,255,255,0.05)',
          }}
        >
          {orgName && (
            <span className="text-xs mr-auto hidden lg:block" style={{ color: 'rgba(148,163,184,0.4)' }}>
              {orgName}
            </span>
          )}
          <NotificationBell />
        </header>

        {/* Page content — pb-20 on mobile so floating nav doesn't cover content */}
        <main className="flex-1 p-4 lg:p-8 pb-24 lg:pb-8 overflow-auto">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile floating bottom nav */}
      <MobileNav />
    </div>
  );
}
