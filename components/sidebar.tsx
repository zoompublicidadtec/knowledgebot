'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SquaresFour,
  BookBookmark,
  ChatCircleDots,
  SlidersHorizontal,
  Plugs,
  SignOut,
  WhatsappLogo,
  List,
  X,
  Kanban,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { logoutAction } from '@/lib/auth/actions';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: SquaresFour },
  { href: '/conocimiento', label: 'Base de Conocimiento', icon: BookBookmark },
  { href: '/conversaciones', label: 'Conversaciones', icon: ChatCircleDots },
  { href: '/kanban', label: 'Pipeline / Kanban', icon: Kanban },
  { href: '/personalizacion', label: 'Personalización', icon: SlidersHorizontal },
  { href: '/integraciones', label: 'Integraciones', icon: Plugs },
];

export function Sidebar({ orgName }: { orgName?: string }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 rounded-xl glass"
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X size={22} /> : <List size={22} />}
      </button>

      {/* Overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed top-0 left-0 z-40 h-full w-64
          glass rounded-r-2xl
          flex flex-col
          transition-transform duration-300
          lg:translate-x-0 lg:static lg:z-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Brand */}
        <div className="p-6 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
                <WhatsappLogo size={22} weight="fill" className="text-white" />
              </div>
              <div>
                <h1 className="font-bold text-white text-sm">KnowledgeBot</h1>
                <p className="text-xs truncate max-w-[120px]" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
                  {orgName || 'Mi Negocio'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileOpen(false)}
              >
                <item.icon size={20} weight={isActive ? 'fill' : 'regular'} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 mt-auto">
          <form action={logoutAction}>
            <button type="submit" className="sidebar-link w-full text-left hover:text-rose-400">
              <SignOut size={20} />
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
