'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFour,
  ChatCircleDots,
  SlidersHorizontal,
  Plugs,
} from '@phosphor-icons/react';

// NOTE: Pipeline (Kanban) is intentionally NOT in the mobile nav.
// It is a desktop-only feature (designed for wide screens, used in the office).
const mobileNavItems = [
  { href: '/dashboard', label: 'Dashboard', icon: SquaresFour },
  { href: '/conversaciones', label: 'Chats', icon: ChatCircleDots },
  { href: '/personalizacion', label: 'Config', icon: SlidersHorizontal },
  { href: '/integraciones', label: 'Integrar', icon: Plugs },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50"
      style={{
        background: 'rgba(10, 14, 26, 0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div className="flex items-center justify-around px-2 py-1.5">
        {mobileNavItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all relative"
              style={{
                color: isActive ? '#a78bfa' : 'rgba(148, 163, 184, 0.5)',
                minWidth: '56px',
              }}
            >
              {isActive && (
                <span
                  className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full"
                  style={{ background: 'linear-gradient(90deg, #7c3aed, #a78bfa)' }}
                />
              )}
              <item.icon
                size={22}
                weight={isActive ? 'fill' : 'regular'}
              />
              <span className="text-[10px] font-medium leading-tight">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
