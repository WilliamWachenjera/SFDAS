-- ═══════════════════════════════════════════════════════════════
-- SFDAASS — Complete Database Schema
-- Smart Fire Detection, Alerting & Automated Suppression System
-- ═══════════════════════════════════════════════════════════════

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for text search

-- ── ENUMS ────────────────────────────────────────────────────────

CREATE TYPE user_role AS ENUM ('admin', 'operator', 'viewer');
CREATE TYPE device_status AS ENUM ('online', 'offline', 'warning', 'maintenance');
CREATE TYPE geofence_type AS ENUM ('circle', 'polygon');
CREATE TYPE incident_severity AS ENUM ('low', 'warning', 'critical');
CREATE TYPE incident_status AS ENUM ('active', 'monitoring', 'resolved', 'false_alarm');
CREATE TYPE sprinkler_status AS ENUM ('standby', 'active', 'fault', 'disabled');
CREATE TYPE alert_channel AS ENUM ('sms', 'email', 'push', 'dashboard');
CREATE TYPE alert_status AS ENUM ('pending', 'sent', 'failed');
CREATE TYPE suppression_trigger AS ENUM ('automatic', 'manual', 'override');

-- ── USERS ────────────────────────────────────────────────────────

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            user_role NOT NULL DEFAULT 'viewer',
    phone           VARCHAR(20),
    is_active       BOOLEAN DEFAULT TRUE,
    last_login      TIMESTAMPTZ,
    login_attempts  INTEGER DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ── GEOFENCES ────────────────────────────────────────────────────

CREATE TABLE geofences (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL DEFAULT 'Main Facility',
    type            geofence_type NOT NULL DEFAULT 'circle',
    center_lat      DOUBLE PRECISION,
    center_lng      DOUBLE PRECISION,
    radius_meters   DOUBLE PRECISION,
    polygon_coords  JSONB,          -- [{lat, lng}, ...] for polygon type
    is_active       BOOLEAN DEFAULT TRUE,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── DEVICES ──────────────────────────────────────────────────────

CREATE TABLE devices (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_code         VARCHAR(20) UNIQUE NOT NULL,   -- e.g. DEV-007
    name                VARCHAR(100),
    location_label      VARCHAR(200),
    firmware_version    VARCHAR(20) DEFAULT '1.0.0',
    mac_address         VARCHAR(17),
    api_key             VARCHAR(64) UNIQUE NOT NULL,   -- device auth key
    geofence_id         UUID REFERENCES geofences(id),
    is_active           BOOLEAN DEFAULT TRUE,
    registered_at       TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_devices_code ON devices(device_code);
CREATE INDEX idx_devices_api_key ON devices(api_key);

-- ── SENSOR READINGS ──────────────────────────────────────────────

CREATE TABLE sensor_readings (
    id              BIGSERIAL PRIMARY KEY,
    device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    smoke_ppm       NUMERIC(10,2),
    temperature_c   NUMERIC(6,2),
    gas_ppm         NUMERIC(10,2),
    humidity_pct    NUMERIC(5,2),
    flame_detected  BOOLEAN DEFAULT FALSE,
    gps_lat         DOUBLE PRECISION,
    gps_lng         DOUBLE PRECISION,
    gps_accuracy_m  NUMERIC(8,2),
    inside_geofence BOOLEAN,
    rssi            INTEGER,        -- WiFi signal strength
    battery_pct     NUMERIC(5,2),
    raw_payload     JSONB           -- full original MQTT payload
);

-- Time-series optimized index
CREATE INDEX idx_readings_device_time ON sensor_readings(device_id, recorded_at DESC);
CREATE INDEX idx_readings_time ON sensor_readings(recorded_at DESC);
CREATE INDEX idx_readings_flame ON sensor_readings(flame_detected) WHERE flame_detected = TRUE;

-- ── DEVICE STATUS (latest per device) ────────────────────────────

CREATE TABLE device_telemetry (
    device_id           UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    status              device_status NOT NULL DEFAULT 'offline',
    last_seen           TIMESTAMPTZ,
    last_reading_id     BIGINT REFERENCES sensor_readings(id),
    smoke_ppm           NUMERIC(10,2),
    temperature_c       NUMERIC(6,2),
    gas_ppm             NUMERIC(10,2),
    humidity_pct        NUMERIC(5,2),
    flame_detected      BOOLEAN DEFAULT FALSE,
    gps_lat             DOUBLE PRECISION,
    gps_lng             DOUBLE PRECISION,
    inside_geofence     BOOLEAN,
    battery_pct         NUMERIC(5,2),
    rssi                INTEGER,
    uptime_seconds      BIGINT,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── FIRE INCIDENTS ───────────────────────────────────────────────

CREATE TABLE incidents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    incident_code       VARCHAR(20) UNIQUE NOT NULL,  -- INC-2025-047
    device_id           UUID NOT NULL REFERENCES devices(id),
    severity            incident_severity NOT NULL,
    status              incident_status NOT NULL DEFAULT 'active',
    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at        TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    gps_lat             DOUBLE PRECISION,
    gps_lng             DOUBLE PRECISION,
    inside_geofence     BOOLEAN,
    -- Sensor values at detection
    smoke_ppm           NUMERIC(10,2),
    temperature_c       NUMERIC(6,2),
    gas_ppm             NUMERIC(10,2),
    flame_detected      BOOLEAN,
    -- Response
    sprinkler_activated BOOLEAN DEFAULT FALSE,
    sprinkler_zones     TEXT[],
    suppression_trigger suppression_trigger,
    sprinkler_on_at     TIMESTAMPTZ,
    sprinkler_off_at    TIMESTAMPTZ,
    -- Escalation
    escalated           BOOLEAN DEFAULT FALSE,
    escalated_at        TIMESTAMPTZ,
    -- Resolution
    resolved_by         UUID REFERENCES users(id),
    resolution_notes    TEXT,
    -- Report
    report_pdf_path     TEXT,
    report_csv_path     TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_incidents_device ON incidents(device_id);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_detected ON incidents(detected_at DESC);
CREATE INDEX idx_incidents_severity ON incidents(severity);

-- ── INCIDENT TIMELINE ────────────────────────────────────────────

CREATE TABLE incident_events (
    id          BIGSERIAL PRIMARY KEY,
    incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type  VARCHAR(50) NOT NULL,  -- detected, confirmed, sms_sent, sprinkler_on, resolved, etc.
    description TEXT NOT NULL,
    actor       VARCHAR(100),          -- 'system' or user name
    metadata    JSONB
);

CREATE INDEX idx_inc_events_incident ON incident_events(incident_id, occurred_at);

-- ── SPRINKLER ZONES ──────────────────────────────────────────────

CREATE TABLE sprinkler_zones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    zone_code       VARCHAR(20) UNIQUE NOT NULL,   -- ZONE-A
    name            VARCHAR(100) NOT NULL,
    device_id       UUID REFERENCES devices(id),   -- controlling device
    status          sprinkler_status DEFAULT 'standby',
    last_activated  TIMESTAMPTZ,
    last_deactivated TIMESTAMPTZ,
    flow_rate_lpm   NUMERIC(8,2),                  -- liters per minute
    activated_by    VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sprinkler_activations (
    id              BIGSERIAL PRIMARY KEY,
    zone_id         UUID NOT NULL REFERENCES sprinkler_zones(id),
    incident_id     UUID REFERENCES incidents(id),
    trigger_type    suppression_trigger NOT NULL,
    activated_by    VARCHAR(100),
    activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deactivated_at  TIMESTAMPTZ,
    duration_secs   INTEGER GENERATED ALWAYS AS (
                        EXTRACT(EPOCH FROM (deactivated_at - activated_at))::INTEGER
                    ) STORED,
    water_used_liters NUMERIC(10,2)
);

-- ── ALERTS / NOTIFICATIONS ───────────────────────────────────────

CREATE TABLE alert_notifications (
    id              BIGSERIAL PRIMARY KEY,
    incident_id     UUID REFERENCES incidents(id),
    channel         alert_channel NOT NULL,
    recipient       VARCHAR(255) NOT NULL,
    subject         VARCHAR(255),
    message         TEXT NOT NULL,
    status          alert_status DEFAULT 'pending',
    sent_at         TIMESTAMPTZ,
    error_msg       TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_alerts_incident ON alert_notifications(incident_id);

-- ── CONTACT MESSAGES ─────────────────────────────────────────────

CREATE TABLE contact_messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    subject     VARCHAR(255),
    message     TEXT NOT NULL,
    is_read     BOOLEAN DEFAULT FALSE,
    replied_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── AUDIT LOG ────────────────────────────────────────────────────

CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES users(id),
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   UUID,
    details     JSONB,
    ip_address  VARCHAR(45),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);

-- ── SYSTEM CONFIG ─────────────────────────────────────────────────

CREATE TABLE system_config (
    key         VARCHAR(100) PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════
-- SEED DATA
-- ════════════════════════════════════════════════════════════════

-- Default geofence (University of Malawi, Zomba)
INSERT INTO geofences (id, name, type, center_lat, center_lng, radius_meters, is_active)
VALUES (
    uuid_generate_v4(), 'Main Facility', 'circle',
    -13.9626, 33.7741, 500, TRUE
);

-- Default system config
INSERT INTO system_config (key, value, description) VALUES
('thresholds', '{
    "smoke_warning": 300, "smoke_critical": 500,
    "temp_warning": 60, "temp_critical": 100,
    "gas_warning": 400, "gas_critical": 700,
    "confirm_duration_ms": 5000
}'::jsonb, 'Fire detection thresholds'),
('notifications', '{
    "sms_enabled": true,
    "email_enabled": true,
    "push_enabled": true
}'::jsonb, 'Notification channels'),
('suppression', '{
    "auto_activate": true,
    "critical_only": true,
    "notify_before_ms": 10000
}'::jsonb, 'Suppression settings');

-- Sprinkler zones
INSERT INTO sprinkler_zones (zone_code, name, status) VALUES
('ZONE-A', 'Zone A — Building 3', 'standby'),
('ZONE-B', 'Zone B — Warehouse', 'standby'),
('ZONE-C', 'Zone C — Lab Block', 'standby'),
('ZONE-D', 'Zone D — Admin', 'standby');

-- Admin user (password: Admin@1234 — CHANGE IN PRODUCTION)
-- Hash generated by: bcryptjs.hashSync('Admin@1234', 12)
INSERT INTO users (name, email, password_hash, role, phone) VALUES
('System Admin', 'admin@sfdaass.io',
 '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oFl5z7Xga',
 'admin', '+265999000001'),
('Operator One', 'operator@sfdaass.io',
 '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4oFl5z7Xga',
 'operator', '+265999000002');

-- ════════════════════════════════════════════════════════════════
-- VIEWS
-- ════════════════════════════════════════════════════════════════

-- Active incidents with device info
CREATE VIEW v_active_incidents AS
SELECT
    i.id, i.incident_code, i.severity, i.status,
    i.detected_at, i.gps_lat, i.gps_lng, i.inside_geofence,
    i.smoke_ppm, i.temperature_c, i.gas_ppm, i.flame_detected,
    i.sprinkler_activated, i.sprinkler_zones,
    d.device_code, d.location_label,
    EXTRACT(EPOCH FROM (NOW() - i.detected_at))::INTEGER AS age_seconds
FROM incidents i
JOIN devices d ON d.id = i.device_id
WHERE i.status IN ('active', 'monitoring')
ORDER BY i.detected_at DESC;

-- Device dashboard view
CREATE VIEW v_device_dashboard AS
SELECT
    d.id, d.device_code, d.name, d.location_label,
    dt.status, dt.last_seen, dt.smoke_ppm, dt.temperature_c,
    dt.gas_ppm, dt.humidity_pct, dt.flame_detected,
    dt.gps_lat, dt.gps_lng, dt.inside_geofence,
    dt.battery_pct, dt.rssi,
    EXTRACT(EPOCH FROM (NOW() - dt.last_seen))::INTEGER AS seconds_since_seen
FROM devices d
LEFT JOIN device_telemetry dt ON dt.device_id = d.id
WHERE d.is_active = TRUE
ORDER BY d.device_code;

-- Incident statistics
CREATE VIEW v_incident_stats AS
SELECT
    COUNT(*) FILTER (WHERE status = 'active') AS active_count,
    COUNT(*) FILTER (WHERE status = 'resolved') AS resolved_count,
    COUNT(*) FILTER (WHERE detected_at >= DATE_TRUNC('month', NOW())) AS this_month,
    COUNT(*) FILTER (WHERE detected_at >= DATE_TRUNC('day', NOW())) AS today,
    AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at))) FILTER (WHERE resolved_at IS NOT NULL) AS avg_resolution_secs,
    COUNT(*) TOTAL
FROM incidents;

-- ════════════════════════════════════════════════════════════════
-- FUNCTIONS & TRIGGERS
-- ════════════════════════════════════════════════════════════════

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_devices_updated BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_incidents_updated BEFORE UPDATE ON incidents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_geofences_updated BEFORE UPDATE ON geofences FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-generate incident code
CREATE OR REPLACE FUNCTION generate_incident_code()
RETURNS TRIGGER AS $$
DECLARE
    yr TEXT := TO_CHAR(NOW(), 'YYYY');
    seq INTEGER;
BEGIN
    SELECT COALESCE(MAX(CAST(SPLIT_PART(incident_code, '-', 3) AS INTEGER)), 0) + 1
    INTO seq FROM incidents WHERE incident_code LIKE 'INC-' || yr || '-%';
    NEW.incident_code := 'INC-' || yr || '-' || LPAD(seq::TEXT, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_incident_code
    BEFORE INSERT ON incidents
    FOR EACH ROW WHEN (NEW.incident_code IS NULL OR NEW.incident_code = '')
    EXECUTE FUNCTION generate_incident_code();
