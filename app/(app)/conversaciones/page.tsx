import { ConversationList } from '@/components/chat/conversation-list';
import { NotificationBell } from '@/components/notification-bell';
import { cargarConversaciones } from '@/lib/conversations/list';
import { ChatCircleDots } from '@phosphor-icons/react/dist/ssr';
import { redirect } from 'next/navigation';

export default async function ConversationsIndexPage() {
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();

  if (!profile) redirect('/login');

  const list = await cargarConversaciones(profile.organization_id);

  return (
    /* `lista-pantalla` solo existe por debajo de 1024px: alli la lista sale del
       <main> del panel y ocupa el telefono entero, sin tarjeta, sin borde y sin
       la banda superior que solo llevaba la campana — que se muda a la cabecera
       de la lista. En escritorio no aplica y manda la rejilla de siempre. */
    <div className="animate-fade-in lista-pantalla lg:grid lg:grid-cols-4 lg:gap-6 lg:h-[calc(100vh-140px)] lg:min-h-[450px]">
      <div className="flex flex-1 min-h-0 flex-col glass lg:col-span-1 lg:h-full lg:rounded-2xl lg:overflow-hidden">
        <ConversationList list={list} accionesMovil={<NotificationBell />} />
      </div>

      {/* Main chat window - Empty state (solo desktop) */}
      <div className="hidden lg:flex lg:col-span-3 glass rounded-2xl flex-col items-center justify-center text-center p-6 h-full">
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
