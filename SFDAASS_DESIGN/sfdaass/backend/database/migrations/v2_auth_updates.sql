-- ── AUTH UPDATES MIGRATION ─────────────────────────────────────────
-- Adds support for password reset tokens
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(64) UNIQUE NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    used_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reset_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens(user_id);

-- Audit log entry for migration
INSERT INTO audit_log (action, details) VALUES ('migration', '{"name": "v2_auth_updates", "description": "added password_reset_tokens table"}'::jsonb);
