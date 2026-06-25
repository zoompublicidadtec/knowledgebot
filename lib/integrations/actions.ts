'use server';

import { createAdminClient as createClient } from '@/lib/supabase/server';
import { encrypt } from '@/lib/crypto';
import { getGoogleAuthUrl, exchangeCodeForTokens } from '@/lib/google/calendar';
import { redirect } from 'next/navigation';
import { getBridgeUrl, bridgeHeaders } from '@/lib/whatsapp/bridge';

export async function saveWhatsAppConfigAction(formData: FormData) {
  const supabase = await createClient();
  
  const provider = formData.get('provider') as 'meta' | 'openwa';
  const openwaApiUrl = formData.get('openwaApiUrl') as string;
  const openwaSessionId = formData.get('openwaSessionId') as string;
  const openwaApiKey = formData.get('openwaApiKey') as string;
  
  const phoneNumberId = formData.get('phoneNumberId') as string;
  const wabaId = formData.get('wabaId') as string;
  const accessToken = formData.get('accessToken') as string;
  const verifyToken = formData.get('verifyToken') as string;
  const appSecret = formData.get('appSecret') as string;

  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { error: 'Organización no encontrada' };
  const orgId = profile.organization_id;

  const updateData: Record<string, unknown> = {
    provider,
    openwa_api_url: openwaApiUrl || null,
    openwa_session_id: openwaSessionId || null,
    openwa_api_key: openwaApiKey || null,
    phone_number_id: phoneNumberId || '',
    waba_id: wabaId || '',
    verify_token: verifyToken || '',
  };

  if (accessToken) {
    updateData.access_token_encrypted = encrypt(accessToken);
  }
  if (appSecret) {
    updateData.app_secret_encrypted = encrypt(appSecret);
  }

  const { error } = await (supabase as any)
    .from('whatsapp_configs')
    .upsert({
      organization_id: orgId,
      ...updateData,
    });

  if (error) {
    return { error: 'Error al guardar la configuración: ' + error.message };
  }

  return { success: true };
}

export async function connectGoogleCalendarAction() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { error: 'Organización no encontrada' };
  const orgId = profile.organization_id;

  const authUrl = getGoogleAuthUrl(orgId);
  redirect(authUrl);
}

export async function saveGoogleCalendarIdAction(calendarId: string) {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { error: 'Organización no encontrada' };
  const orgId = profile.organization_id;

  const { error } = await (supabase as any)
    .from('google_calendar_configs')
    .update({ calendar_id: calendarId })
    .eq('organization_id', orgId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function disconnectGoogleCalendarAction() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { error: 'Organización no encontrada' };
  const orgId = profile.organization_id;

  const { error } = await (supabase as any)
    .from('google_calendar_configs')
    .delete()
    .eq('organization_id', orgId);

  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

export async function disconnectWhatsAppAction() {
  const supabase = await createClient();
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { error: 'Organización no encontrada' };

  const baseUrl = getBridgeUrl();

  try {
    const res = await fetch(`${baseUrl}/api/sessions/logout`, {
      method: 'POST',
      headers: bridgeHeaders(),
      body: JSON.stringify({}),
    });
    // Defensive: the bridge may return HTML (404) instead of JSON in some edge cases.
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { success: true, note: 'Sesión cerrada desde el panel multi-línea.' };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Error al cerrar sesión en el servidor local.');
    }
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'No se pudo conectar con el bridge. Revisa WHATSAPP_BRIDGE_URL.' };
  }
}

export async function checkWhatsAppStatusAction() {
  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { connected: false };

  const baseUrl = getBridgeUrl();

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    
    const res = await fetch(`${baseUrl}/health`, {
      signal: controller.signal
    }).catch(() => null);
    
    clearTimeout(timeoutId);
    
    return { connected: !!res };
  } catch {
    return { connected: false };
  }
}
