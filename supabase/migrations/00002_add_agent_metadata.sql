-- Add metadata column to agent_configs for storing emergency contacts and other config
ALTER TABLE agent_configs 
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Add a comment for documentation
COMMENT ON COLUMN agent_configs.metadata IS 'Stores emergency contacts, handoff settings, and other flexible configuration data';
