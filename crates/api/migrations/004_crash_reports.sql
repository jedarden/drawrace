CREATE TABLE IF NOT EXISTS crash_reports (
    id BIGSERIAL PRIMARY KEY,
    player_uuid UUID REFERENCES players(player_uuid),
    message TEXT NOT NULL,
    stack TEXT,
    url TEXT,
    line INTEGER,
    column INTEGER,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crash_reports_player ON crash_reports (player_uuid);
CREATE INDEX idx_crash_reports_created ON crash_reports (created_at DESC);
