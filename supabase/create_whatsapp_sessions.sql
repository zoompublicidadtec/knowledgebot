-- Tabla para persistir sesiones de WhatsApp Web en la nube
-- Ejecuta este SQL en Supabase > SQL Editor

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name TEXT NOT NULL UNIQUE,
    session_data TEXT NOT NULL,  -- JSON serializado de la sesión de whatsapp-web.js
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índice para búsquedas rápidas por nombre de sesión
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_name ON whatsapp_sessions(session_name);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_whatsapp_sessions_updated_at
    BEFORE UPDATE ON whatsapp_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Politica de seguridad: solo el service_role puede acceder
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role only" ON whatsapp_sessions
    USING (auth.role() = 'service_role');
