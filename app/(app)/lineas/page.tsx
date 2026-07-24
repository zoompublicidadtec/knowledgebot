import { redirect } from 'next/navigation';
import LineasClient from './lineas-client';

export const metadata = {
  title: 'Líneas | KnowledgeBot',
};

/**
 * Vista de SEGUIMIENTO (solo lectura) del estado real de las líneas de WhatsApp.
 * Solo visible para el owner (administrador). No realiza ninguna acción sobre
 * las sesiones — solo muestra diagnóstico para que el admin decida qué hacer.
 */
export default async function LineasPage() {
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();

  if (!profile) {
    redirect('/login');
  }

  // Restricción a owner: esta es una herramienta de administración.
  if (profile.role !== 'owner') {
    redirect('/dashboard');
  }

  return <LineasClient />;
}
