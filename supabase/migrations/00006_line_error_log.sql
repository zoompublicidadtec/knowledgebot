-- ============================================
-- Tabla de seguimiento de errores operacionales por línea
-- ============================================
-- Registra errores que hoy solo van a logs de Docker y no son visibles
-- en el panel: transcripción de audios, descarga de media, fallos de webhook,
-- keep-alive, inserciones en BD, etc.
--
-- Esto permite que el panel "Líneas de WhatsApp" muestre una sección
-- "Errores recientes" por línea, en tiempo real.

CREATE TABLE IF NOT EXISTS line_error_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  line_key text NOT NULL,
  -- Tipo de error, para filtrar/agrupar en el panel:
  -- 'transcription' | 'media_download' | 'webhook' | 'keep_alive'
  -- | 'db_insert' | 'describe_image' | 'connection' | 'other'
  error_type text NOT NULL,
  severity text NOT NULL DEFAULT 'error',  -- 'warn' | 'error'
  message text NOT NULL,
  -- Contexto variable (wa_message_id, modelo, mimetype, etc.)
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices para las consultas comunes del panel:
-- 1) "Errores recientes por línea" (últimas N, ordenadas por fecha)
CREATE INDEX IF NOT EXISTS idx_line_error_log_line_created
  ON line_error_log (line_key, created_at DESC);

-- 2) "Errores de toda la organización" (para un resumen global)
CREATE INDEX IF NOT EXISTS idx_line_error_log_org_created
  ON line_error_log (organization_id, created_at DESC);

-- 3) Filtrar por tipo de error (ej. solo transcripción)
CREATE INDEX IF NOT EXISTS idx_line_error_log_type
  ON line_error_log (error_type);

-- Habilitar RLS (la tabla contiene info operacional sensible).
ALTER TABLE line_error_log ENABLE ROW LEVEL SECURITY;

-- Política: solo el owner de la organización puede leer sus errores.
-- (Sigue el mismo patrón de sub-consulta de whatsapp_lines, robusto
-- para cualquier entorno sin depender de helpers locales.)
CREATE POLICY "owners_can_read_line_errors" ON line_error_log
  FOR SELECT
  USING (
    organization_id IN (
      SELECT p.organization_id
      FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'owner'
    )
  );

-- Nota: las escrituras las hace el backend (service_role) que ignora RLS,
-- así que no se necesita política de INSERT para usuarios autenticados.
