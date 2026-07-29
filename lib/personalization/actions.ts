'use server';

import { createAdminClient as createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function saveAgentConfigAction(formData: FormData) {
  const supabase = await createClient();

  const systemPrompt = (formData.get('systemPrompt') as string) || '';
  const tone = (formData.get('tone') as string) || 'profesional y amable';
  const handoffMessage = (formData.get('handoffMessage') as string) || null;

  // Business Info
  const businessName = (formData.get('businessName') as string) || '';
  const businessAddress = (formData.get('businessAddress') as string) || '';
  const businessPhone = (formData.get('businessPhone') as string) || '';
  const businessEmail = (formData.get('businessEmail') as string) || '';
  const cancellationPolicy = (formData.get('cancellationPolicy') as string) || '';

  // Services JSON parse
  const servicesRaw = formData.get('servicesJson') as string;
  let services: any[] = [];
  try {
    services = servicesRaw ? JSON.parse(servicesRaw) : [];
  } catch {
    return { error: 'Formato de servicios inválido. Intenta de nuevo.' };
  }

  // Business Hours JSON parse
  const hoursRaw = formData.get('businessHoursJson') as string;
  let businessHours: any = {};
  try {
    businessHours = hoursRaw ? JSON.parse(hoursRaw) : {};
  } catch {
    return { error: 'Formato de horarios inválido. Intenta de nuevo.' };
  }

  const { getCurrentUser } = await import('@/lib/auth/actions');
  const profile = await getCurrentUser();
  if (!profile) return { error: 'Sesión expirada. Por favor recarga la página.' };
  const orgId = profile.organization_id;

  // Se lee la config actual para conservar las FAQ y el resto de metadata:
  // antes se sobrescribían con [] en cada guardado y se perdían.
  const { data: existing } = await (supabase as any)
    .from('agent_configs')
    .select('organization_id, business_info, metadata')
    .eq('organization_id', orgId)
    .single();

  const businessInfo = {
    name: businessName,
    address: businessAddress,
    phone: businessPhone,
    email: businessEmail,
    cancellation_policy: cancellationPolicy,
    faq: (existing as any)?.business_info?.faq || [],
  };

  // Identidad del agente: lo que se escriba aquí manda sobre el prompt.
  const persona = {
    agent_name: ((formData.get('agentName') as string) || '').trim(),
    role: ((formData.get('agentRole') as string) || '').trim(),
    company: ((formData.get('agentCompany') as string) || businessName).trim(),
    greeting: ((formData.get('agentGreeting') as string) || '').trim(),
    scope: ((formData.get('agentScope') as string) || '').trim(),
    offtopic_redirect: ((formData.get('agentOfftopic') as string) || '').trim(),
    payment_methods: ((formData.get('paymentMethods') as string) || '').trim(),
    payment_terms: ((formData.get('paymentTerms') as string) || '').trim(),
    free_mockup: formData.get('freeMockup') === 'on',
  };

  const cleanPersona = Object.fromEntries(
    Object.entries(persona).filter(([, v]) => v !== '' && v !== null && v !== undefined)
  );

  const metadata = { ...((existing as any)?.metadata || {}), persona: cleanPersona };

  const payload = {
    system_prompt: systemPrompt,
    tone,
    handoff_message: handoffMessage,
    business_info: businessInfo,
    services: services,
    business_hours: businessHours,
    metadata,
    updated_at: new Date().toISOString(),
  };

  let dbError;
  if (existing) {
    const { error } = await (supabase as any)
      .from('agent_configs')
      .update(payload)
      .eq('organization_id', orgId);
    dbError = error;
  } else {
    const { error } = await (supabase as any)
      .from('agent_configs')
      .insert({ organization_id: orgId, ...payload });
    dbError = error;
  }

  if (dbError) {
    return { error: `Error al guardar: ${dbError.message}` };
  }

  revalidatePath('/personalizacion');
  return { success: true };
}
