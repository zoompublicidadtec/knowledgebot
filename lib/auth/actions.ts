'use server';

import { createClient, createAdminClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { cache } from 'react';

export async function loginAction(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect('/dashboard');
}

export async function signupAction(formData: FormData) {
  const supabase = await createClient();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const businessName = formData.get('businessName') as string;

  // 1. Create user
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (authError || !authData.user) {
    return { error: authError?.message || 'Error al crear la cuenta' };
  }

  // 2. Create organization
  const adminClient = await createAdminClient();
  const slug = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    + '-' + Math.random().toString(36).substring(2, 6);

  const { data: org, error: orgError } = await (adminClient as any)
    .from('organizations')
    .insert({ name: businessName, slug })
    .select()
    .single();

  if (orgError || !org) {
    return { error: 'Error al crear la organización: ' + orgError?.message };
  }

  // 3. Create profile
  const { error: profileError } = await (adminClient as any)
    .from('profiles')
    .insert({
      id: authData.user.id,
      organization_id: org.id,
      full_name: email.split('@')[0],
      role: 'owner',
    });

  if (profileError) {
    return { error: 'Error al crear el perfil: ' + profileError.message };
  }

  // 4. Create default agent config
  const { error: agentError } = await (adminClient as any)
    .from('agent_configs')
    .insert({ organization_id: org.id });

  if (agentError) {
    return { error: 'Error al crear la configuración del agente: ' + agentError.message };
  }

  // 5. Create default WhatsApp config
  const { error: waError } = await (adminClient as any)
    .from('whatsapp_configs')
    .insert({ organization_id: org.id });

  if (waError) {
    return { error: 'Error al crear la configuración de WhatsApp: ' + waError.message };
  }

  redirect('/dashboard');
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

export const getCurrentUser = cache(async function getCurrentUser(): Promise<any> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const adminClient = await createAdminClient();
  const { data: profile } = await adminClient
    .from('profiles')
    .select('*, organizations(*)')
    .eq('id', user.id)
    .single();

  return profile;
});
