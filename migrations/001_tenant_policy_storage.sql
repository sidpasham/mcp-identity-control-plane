CREATE TABLE IF NOT EXISTS tenant_security_policies (
  tenant_id TEXT PRIMARY KEY,
  bot_detection_enabled BOOLEAN NOT NULL DEFAULT false,
  suspicious_ip_throttling BOOLEAN NOT NULL DEFAULT false,
  rate_limit_threshold INTEGER NOT NULL DEFAULT 100 CHECK (rate_limit_threshold > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS policy_audit_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenant_security_policies(tenant_id),
  actor_sub TEXT NOT NULL,
  action TEXT NOT NULL,
  policy_before JSONB,
  policy_after JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS policy_audit_events_tenant_created_idx
  ON policy_audit_events (tenant_id, created_at DESC);

INSERT INTO tenant_security_policies (
  tenant_id,
  bot_detection_enabled,
  suspicious_ip_throttling,
  rate_limit_threshold
) VALUES (
  'tenant:company_alpha',
  true,
  false,
  100
) ON CONFLICT (tenant_id) DO NOTHING;
