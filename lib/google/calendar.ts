import { google } from 'googleapis';
import { decrypt, encrypt } from '@/lib/crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import type { GoogleCalendarConfig } from '@/lib/database.types';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
  );
}

/**
 * Get an authenticated OAuth2 client for a given org's calendar config.
 * Handles automatic token refresh.
 */
async function getAuthenticatedClient(config: GoogleCalendarConfig) {
  const oauth2Client = getOAuth2Client();
  const refreshToken = decrypt(config.refresh_token_encrypted);

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  // Check if access token needs refresh
  if (config.access_token_encrypted && config.token_expires_at) {
    const expiresAt = new Date(config.token_expires_at).getTime();
    if (expiresAt > Date.now() + 5 * 60 * 1000) {
      // Token still valid (5 min buffer)
      const accessToken = decrypt(config.access_token_encrypted);
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
        access_token: accessToken,
      });
      return oauth2Client;
    }
  }

  // Refresh the token
  const { credentials } = await oauth2Client.refreshAccessToken();
  oauth2Client.setCredentials(credentials);

  // Save refreshed token
  if (credentials.access_token) {
    const supabase = createAdminClient();
    await (supabase as any)
      .from('google_calendar_configs')
      .update({
        access_token_encrypted: encrypt(credentials.access_token),
        token_expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : null,
      })
      .eq('organization_id', config.organization_id);
  }

  return oauth2Client;
}

/**
 * Get FreeBusy slots for a specific date.
 * Returns array of { start, end } busy periods.
 */
export async function getFreeBusySlots(
  config: GoogleCalendarConfig,
  date: string
): Promise<{ start: string; end: string }[]> {
  const auth = await getAuthenticatedClient(config);
  const calendar = google.calendar({ version: 'v3', auth });

  const timeMin = new Date(date + 'T00:00:00').toISOString();
  const timeMax = new Date(date + 'T23:59:59').toISOString();

  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: config.calendar_id }],
    },
  });

  const busy = res.data.calendars?.[config.calendar_id]?.busy || [];
  return busy.map(b => ({
    start: b.start || '',
    end: b.end || '',
  }));
}

/**
 * Create a Google Calendar event.
 * Returns the event ID.
 */
export async function createCalendarEvent(
  config: GoogleCalendarConfig,
  event: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    location?: string;
  }
): Promise<string | null> {
  try {
    const auth = await getAuthenticatedClient(config);
    const calendar = google.calendar({ version: 'v3', auth });

    const supabase = createAdminClient();
    const { data: org } = await (supabase as any)
      .from('organizations')
      .select('timezone')
      .eq('id', config.organization_id)
      .single();

    const timeZone = org?.timezone || 'America/Mexico_City';

    const res = await calendar.events.insert({
      calendarId: config.calendar_id,
      requestBody: {
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: { 
          dateTime: event.start,
          timeZone: timeZone
        },
        end: { 
          dateTime: event.end,
          timeZone: timeZone
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 30 },
          ],
        },
      },
    });

    return res.data.id || null;
  } catch (err) {
    logger.error('Failed to create calendar event', { error: String(err) });
    return null;
  }
}

/**
 * Cancel (delete) a Google Calendar event.
 */
export async function cancelCalendarEvent(
  config: GoogleCalendarConfig,
  eventId: string
): Promise<boolean> {
  try {
    const auth = await getAuthenticatedClient(config);
    const calendar = google.calendar({ version: 'v3', auth });

    await calendar.events.delete({
      calendarId: config.calendar_id,
      eventId,
    });

    return true;
  } catch (err) {
    logger.error('Failed to cancel calendar event', { error: String(err), eventId });
    return false;
  }
}

/**
 * List available calendars for the authenticated user.
 */
export async function listCalendars(
  config: GoogleCalendarConfig
): Promise<{ id: string; name: string }[]> {
  try {
    const auth = await getAuthenticatedClient(config);
    const calendar = google.calendar({ version: 'v3', auth });

    const res = await calendar.calendarList.list();
    return (res.data.items || []).map(cal => ({
      id: cal.id || '',
      name: cal.summary || cal.id || '',
    }));
  } catch (err) {
    logger.error('Failed to list calendars', { error: String(err) });
    return [];
  }
}

/**
 * Generate Google OAuth authorization URL.
 */
export function getGoogleAuthUrl(state: string): string {
  const oauth2Client = getOAuth2Client();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar'
    ],
    state,
  });
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCodeForTokens(code: string) {
  const oauth2Client = getOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}
