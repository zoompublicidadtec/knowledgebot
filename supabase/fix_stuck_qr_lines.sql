-- ============================================================
-- Fix: Reset stuck 'awaiting_qr' lines to 'disconnected'
-- Run this in Supabase SQL Editor to fix lines stuck in 
-- awaiting_qr state without a QR code.
-- ============================================================

-- 1. Reset all lines stuck in awaiting_qr WITH NO QR code to disconnected
UPDATE whatsapp_lines
SET status = 'disconnected', qr_code = NULL
WHERE status = 'awaiting_qr' AND qr_code IS NULL;

-- 2. Also reset any awaiting_qr lines that have an expired QR 
--    (QR codes expire after ~60 seconds)
UPDATE whatsapp_lines
SET status = 'disconnected', qr_code = NULL
WHERE status = 'awaiting_qr';

-- 3. Create whatsapp_sessions table if it doesn't exist
-- (Required for RemoteAuth session persistence in the bridge)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_name text UNIQUE NOT NULL,
  session_data text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_name ON whatsapp_sessions(session_name);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_whatsapp_sessions_updated_at ON whatsapp_sessions;
CREATE TRIGGER update_whatsapp_sessions_updated_at
    BEFORE UPDATE ON whatsapp_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: only service role can access sessions (the bridge uses service role key)
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role only" ON whatsapp_sessions;
CREATE POLICY "Service role only" ON whatsapp_sessions
  USING (auth.role() = 'service_role');

-- 4. Verify the result
SELECT line_key, display_name, status, 
       CASE WHEN qr_code IS NOT NULL THEN 'HAS_QR' ELSE 'NO_QR' END as qr_state,
       phone_number
FROM whatsapp_lines
ORDER BY created_at;
