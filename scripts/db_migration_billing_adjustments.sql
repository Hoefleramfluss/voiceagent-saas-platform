DO $$ BEGIN
  CREATE TYPE billing_adjustment_type AS ENUM ('discount_percent','discount_fixed_cents','extra_free_minutes');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS billing_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  type billing_adjustment_type NOT NULL,
  value_percent INT,
  value_cents INT,
  value_minutes INT,
  minute_scope VARCHAR(20),
  effective_from TIMESTAMP,
  effective_to TIMESTAMP,
  applies_to_period VARCHAR(7),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_settings ADD COLUMN IF NOT EXISTS email_templates JSONB;
