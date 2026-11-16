-- FR-ADM-005
CREATE TABLE IF NOT EXISTS analytics_event (
  event_id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('page_view', 'click', 'session_end')),
  path TEXT NOT NULL,
  target TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_analytics_event_at ON analytics_event (at);
CREATE INDEX IF NOT EXISTS ix_analytics_event_device_at ON analytics_event (device_id, at);

ALTER TABLE analytics_event ENABLE ROW LEVEL SECURITY;
