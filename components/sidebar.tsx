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
  Pulse,
  Cpu,
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

// /lineas es una herramienta de administración sutil: no aparece como sección
// principal. Se accede por un ícono pequeño (sin texto) en el pie del sidebar,
// separado del botón "Cerrar sesión" por un divisor para evitar clics por error.
function isLineasActive(pathname: string) {
  return pathname === '/lineas' || pathname.startsWith('/lineas/');
}

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
          {/* Divisor que separa claramente el pie del sidebar */}
          <div className="border-t border-white/5 my-2" />

          <div className="flex items-center justify-between px-1">
            {/* Controles técnicos ocultos (Líneas y Centro de Operaciones) */}
            <div className="flex items-center gap-2">
              {/* Ícono de Líneas */}
              <Link
                href="/lineas"
                onClick={() => setMobileOpen(false)}
                title="Líneas de WhatsApp"
                aria-label="Líneas"
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                  isLineasActive(pathname)
                    ? 'bg-primary-500/20 text-primary-300'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                <Pulse size={18} weight={isLineasActive(pathname) ? 'fill' : 'regular'} />
              </Link>

              {/* Ícono oculto del Centro de Control (para el desarrollador/líder) */}
              <Link
                href="/control-room"
                onClick={() => setMobileOpen(false)}
                title="Centro de Control"
                aria-label="Centro de Control"
                className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
                  pathname === '/control-room' || pathname.startsWith('/control-room/')
                    ? 'bg-primary-500/20 text-primary-300'
                    : 'text-slate-600/30 hover:text-slate-300 hover:bg-white/5'
                }`}
              >
                <Cpu size={18} weight={pathname === '/control-room' || pathname.startsWith('/control-room/') ? 'fill' : 'regular'} />
              </Link>
            </div>

            {/* Cerrar sesión como ícono minimalista al extremo derecho */}
            <form action={logoutAction} className="m-0">
              <button
                type="submit"
                title="Cerrar sesión"
                aria-label="Cerrar sesión"
                className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer"
              >
                <SignOut size={18} />
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}
