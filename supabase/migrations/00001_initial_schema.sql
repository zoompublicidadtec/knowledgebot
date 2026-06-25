-- ============================================
-- KnowledgeBot SaaS - Initial Database Schema
-- ============================================
-- Multi-tenant schema with RLS for all tables

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ============================================
-- TABLES
-- ============================================

-- organizations: business account
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Mexico_City',
  created_at timestamptz DEFAULT now()
);

-- profiles: extends auth.users, links to organization
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  full_name text,
  role text CHECK (role IN ('owner', 'staff')) DEFAULT 'owner',
  created_at timestamptz DEFAULT now()
);

-- whatsapp_configs: credentials per organization
CREATE TABLE whatsapp_configs (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number_id text NOT NULL DEFAULT '',
  waba_id text NOT NULL DEFAULT '',
  access_token_encrypted text NOT NULL DEFAULT '',
  verify_token text NOT NULL DEFAULT '',
  app_secret_encrypted text NOT NULL DEFAULT '',
  -- OpenWA fields (for testing)
  openwa_api_url text,
  openwa_session_id text,
  openwa_api_key text,
  provider text CHECK (provider IN ('meta', 'openwa')) DEFAULT 'openwa',
  updated_at timestamptz DEFAULT now()
);

-- google_calendar_configs: OAuth tokens per organization
CREATE TABLE google_calendar_configs (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  calendar_id text NOT NULL DEFAULT '',
  refresh_token_encrypted text NOT NULL DEFAULT '',
  access_token_encrypted text,
  token_expires_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- agent_configs: prompt customization and business data
CREATE TABLE agent_configs (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  system_prompt text NOT NULL DEFAULT 'Eres un asistente virtual profesional para empresas con bases de conocimiento grandes. Atiendes por WhatsApp, respondes con informacion recuperada desde la base documental, ayudas a agendar citas o demos y escalas con un humano cuando no exista informacion confiable.',
  tone text NOT NULL DEFAULT 'profesional, claro y confiable',
  business_info jsonb NOT NULL DEFAULT '{
    "name": "KnowledgeBot",
    "address": "",
    "phone": "",
    "email": "",
    "cancellation_policy": "Las citas pueden cancelarse con al menos 2 horas de anticipacion.",
    "faq": []
  }'::jsonb,
  services jsonb NOT NULL DEFAULT '[
    {"name": "Llamada de asesoria", "duration_minutes": 30, "description": "Revision de la necesidad del cliente con un asesor"},
    {"name": "Demo comercial", "duration_minutes": 45, "description": "Presentacion de productos, servicios o soluciones"},
    {"name": "Soporte especializado", "duration_minutes": 30, "description": "Escalamiento para dudas tecnicas o casos complejos"}
  ]'::jsonb,
  business_hours jsonb NOT NULL DEFAULT '{
    "mon": [{"start": "09:00", "end": "18:00"}],
    "tue": [{"start": "09:00", "end": "18:00"}],
    "wed": [{"start": "09:00", "end": "18:00"}],
    "thu": [{"start": "09:00", "end": "18:00"}],
    "fri": [{"start": "09:00", "end": "18:00"}],
    "sat": [{"start": "09:00", "end": "14:00"}],
    "sun": []
  }'::jsonb,
  handoff_message text DEFAULT 'Te paso con un humano en un momento. Por favor espera.',
  metadata jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- knowledge_documents: high-level sources loaded into the RAG knowledge base
CREATE TABLE knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  source_type text CHECK (source_type IN ('manual', 'pdf', 'url', 'doc', 'sheet', 'api')) DEFAULT 'manual',
  source_url text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- knowledge_chunks: searchable fragments with pgvector embeddings
CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  document_id uuid REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  content text NOT NULL,
  embedding vector(1536) NOT NULL,
  token_count integer,
  tags text[] DEFAULT '{}'::text[],
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- contacts: WhatsApp customers
CREATE TABLE contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  wa_phone text NOT NULL,
  full_name text,
  is_new_patient boolean,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (organization_id, wa_phone)
);

-- conversations: thread per contact
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  bot_active boolean DEFAULT true,
  last_message_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- messages: each message (inbound or outbound)
CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  wa_message_id text,
  direction text CHECK (direction IN ('inbound', 'outbound')) NOT NULL,
  sender text CHECK (sender IN ('contact', 'bot', 'human')) NOT NULL,
  content text,
  raw jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (wa_message_id)
);

-- appointments: scheduled appointments
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  service text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  google_event_id text,
  status text CHECK (status IN ('confirmed', 'cancelled', 'completed')) DEFAULT 'confirmed',
  is_new_patient boolean,
  full_name text NOT NULL,
  phone text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_conversations_org_last_message ON conversations(organization_id, last_message_at DESC);
CREATE INDEX idx_appointments_org_starts ON appointments(organization_id, starts_at);
CREATE INDEX idx_contacts_org_phone ON contacts(organization_id, wa_phone);
CREATE INDEX idx_knowledge_documents_org ON knowledge_documents(organization_id);
CREATE INDEX idx_knowledge_chunks_org_document ON knowledge_chunks(organization_id, document_id);
CREATE INDEX idx_knowledge_chunks_tags ON knowledge_chunks USING gin(tags);
CREATE INDEX idx_knowledge_chunks_embedding ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

-- Helper function: get org_id for authenticated user
CREATE OR REPLACE FUNCTION public.user_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT organization_id FROM profiles WHERE id = auth.uid()
$$;

-- organizations: users can only see their own org
CREATE POLICY "Users can view own organization"
  ON organizations FOR SELECT
  USING (id = public.user_org_id());

CREATE POLICY "Users can update own organization"
  ON organizations FOR UPDATE
  USING (id = public.user_org_id());

-- profiles: users can see profiles in their org
CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (id = auth.uid());

CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- whatsapp_configs
CREATE POLICY "Users can view own whatsapp config"
  ON whatsapp_configs FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can upsert own whatsapp config"
  ON whatsapp_configs FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

CREATE POLICY "Users can update own whatsapp config"
  ON whatsapp_configs FOR UPDATE
  USING (organization_id = public.user_org_id());

-- google_calendar_configs
CREATE POLICY "Users can view own calendar config"
  ON google_calendar_configs FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can upsert own calendar config"
  ON google_calendar_configs FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

CREATE POLICY "Users can update own calendar config"
  ON google_calendar_configs FOR UPDATE
  USING (organization_id = public.user_org_id());

-- agent_configs
CREATE POLICY "Users can view own agent config"
  ON agent_configs FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can upsert own agent config"
  ON agent_configs FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

CREATE POLICY "Users can update own agent config"
  ON agent_configs FOR UPDATE
  USING (organization_id = public.user_org_id());

-- knowledge_documents
CREATE POLICY "Users can view own knowledge documents"
  ON knowledge_documents FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can insert own knowledge documents"
  ON knowledge_documents FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

CREATE POLICY "Users can update own knowledge documents"
  ON knowledge_documents FOR UPDATE
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can delete own knowledge documents"
  ON knowledge_documents FOR DELETE
  USING (organization_id = public.user_org_id());

-- knowledge_chunks
CREATE POLICY "Users can view own knowledge chunks"
  ON knowledge_chunks FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can insert own knowledge chunks"
  ON knowledge_chunks FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

CREATE POLICY "Users can update own knowledge chunks"
  ON knowledge_chunks FOR UPDATE
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can delete own knowledge chunks"
  ON knowledge_chunks FOR DELETE
  USING (organization_id = public.user_org_id());

-- contacts
CREATE POLICY "Users can view own contacts"
  ON contacts FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can insert own contacts"
  ON contacts FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

CREATE POLICY "Users can update own contacts"
  ON contacts FOR UPDATE
  USING (organization_id = public.user_org_id());

-- conversations
CREATE POLICY "Users can view own conversations"
  ON conversations FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can insert own conversations"
  ON conversations FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

CREATE POLICY "Users can update own conversations"
  ON conversations FOR UPDATE
  USING (organization_id = public.user_org_id());

-- messages
CREATE POLICY "Users can view own messages"
  ON messages FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can insert own messages"
  ON messages FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

-- appointments
CREATE POLICY "Users can view own appointments"
  ON appointments FOR SELECT
  USING (organization_id = public.user_org_id());

CREATE POLICY "Users can insert own appointments"
  ON appointments FOR INSERT
  WITH CHECK (organization_id = public.user_org_id());

CREATE POLICY "Users can update own appointments"
  ON appointments FOR UPDATE
  USING (organization_id = public.user_org_id());

-- ============================================
-- REALTIME
-- ============================================

-- Enable realtime for messages and conversations
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- ============================================
-- RAG SEARCH
-- ============================================

CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  target_organization_id uuid,
  query_embedding vector(1536),
  match_count int DEFAULT 6,
  match_threshold float DEFAULT 0.72,
  filter_tags text[] DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  source_url text,
  content text,
  similarity float,
  tags text[],
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id AS chunk_id,
    kd.id AS document_id,
    kd.title AS document_title,
    kd.source_url,
    kc.content,
    1 - (kc.embedding <=> query_embedding) AS similarity,
    kc.tags,
    kc.metadata
  FROM knowledge_chunks kc
  JOIN knowledge_documents kd ON kd.id = kc.document_id
  WHERE kc.organization_id = target_organization_id
    AND kd.organization_id = target_organization_id
    AND (filter_tags IS NULL OR kc.tags && filter_tags)
    AND 1 - (kc.embedding <=> query_embedding) >= match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
