import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForTokens } from '@/lib/google/calendar';
import { encrypt } from '@/lib/crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // Contains orgId

  if (!code || !state) {
    return NextResponse.redirect(new URL('/integraciones?error=invalid_oauth', request.url));
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    const supabase = createAdminClient();

    const insertData: Record<string, unknown> = {
      organization_id: state,
      refresh_token_encrypted: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
      access_token_encrypted: tokens.access_token ? encrypt(tokens.access_token) : null,
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      updated_at: new Date().toISOString(),
    };

    // If refresh token wasn't returned because we already have consent, we'll keep the existing one
    // Remove undefined properties
    if (!insertData.refresh_token_encrypted) {
      delete insertData.refresh_token_encrypted;
    }

    const { error } = await (supabase as any)
      .from('google_calendar_configs')
      .upsert(insertData, { onConflict: 'organization_id' });

    if (error) {
      logger.error('Google OAuth callback DB save error', { error: error.message, orgId: state });
      return NextResponse.redirect(new URL('/integraciones?error=db_save_error', request.url));
    }

    return NextResponse.redirect(new URL('/integraciones?success=google_connected', request.url));
  } catch (err) {
    logger.error('Google OAuth callback error', { error: String(err), orgId: state });
    return NextResponse.redirect(new URL('/integraciones?error=oauth_failed', request.url));
  }
}
