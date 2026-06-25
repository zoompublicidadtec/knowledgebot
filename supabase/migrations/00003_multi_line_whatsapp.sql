-- ============================================
-- Multi-Line WhatsApp Manager Schema Update
-- ============================================

-- Create ENUM for status if it doesn't exist
DO $$ BEGIN
    CREATE TYPE whatsapp_line_status AS ENUM ('disconnected', 'awaiting_qr', 'connected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- whatsapp_lines: configure up to 8 lines per organization
CREATE TABLE whatsapp_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  line_key text UNIQUE NOT NULL,
  display_name text,
  phone_number text,
  status whatsapp_line_status DEFAULT 'disconnected',
  qr_code text,
  last_connected_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Add line_key to conversations
ALTER TABLE conversations ADD COLUMN line_key text;

-- Add line_key to messages
ALTER TABLE messages ADD COLUMN line_key text;

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_whatsapp_lines_org ON whatsapp_lines(organization_id);
CREATE INDEX idx_conversations_line_key ON conversations(line_key);
CREATE INDEX idx_messages_line_key ON messages(line_key);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE whatsapp_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own whatsapp lines" ON whatsapp_lines FOR SELECT USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can insert own whatsapp lines" ON whatsapp_lines FOR INSERT WITH CHECK (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can update own whatsapp lines" ON whatsapp_lines FOR UPDATE USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY "Users can delete own whatsapp lines" ON whatsapp_lines FOR DELETE USING (organization_id IN (SELECT organization_id FROM profiles WHERE id = auth.uid()));
