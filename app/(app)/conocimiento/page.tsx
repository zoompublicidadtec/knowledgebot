import { BookBookmark } from '@phosphor-icons/react/dist/ssr';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/actions';
import { getCategories } from './actions';
import KnowledgeBaseClient from './KnowledgeBaseClient';

export default async function KnowledgeBasePage() {
  const profile = await getCurrentUser();

  if (!profile) redirect('/login');

  // Fetch initial categories on the server side for SSR
  const initialCategories = await getCategories();

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <BookBookmark size={28} weight="fill" className="text-primary-400" />
            Base de Conocimiento
          </h1>
          <p className="text-xs mt-1" style={{ color: 'rgba(148, 163, 184, 0.6)' }}>
            Administra tus productos, precios por volumen, sinónimos y jerga comercial que usa tu bot para vender en WhatsApp.
          </p>
        </div>
      </div>

      {/* Main Interactive Panel */}
      <div className="glass p-6 rounded-2xl border border-white/5">
        <KnowledgeBaseClient initialCategories={initialCategories} />
      </div>
    </div>
  );
}
