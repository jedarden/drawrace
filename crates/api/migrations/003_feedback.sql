-- Feedback table for beta tester input
CREATE TABLE IF NOT EXISTS feedback (
    id          BIGSERIAL PRIMARY KEY,
    player_uuid UUID REFERENCES players(player_uuid) ON DELETE SET NULL,
    category    TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'other')),
    body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_created ON feedback (created_at DESC);
