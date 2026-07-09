-- Shadowban system: rolling 50-submission rejection rate tracking
-- Players exceeding 20% rejection rate are shadowbanned
-- Shadowbanned players' accepted runs are excluded from leaderboard/matchmaking

-- Add shadowbanned flag to players table
ALTER TABLE players ADD COLUMN IF NOT EXISTS shadowbanned BOOLEAN NOT NULL DEFAULT false;

-- Create player_submission_history to track last 50 submissions per player
CREATE TABLE IF NOT EXISTS player_submission_history (
    player_uuid UUID NOT NULL REFERENCES players(player_uuid) ON DELETE CASCADE,
    submission_id UUID NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_uuid, submission_id)
);

-- Index for efficient lookup of a player's recent submissions
CREATE INDEX IF NOT EXISTS idx_submission_history_player_created
    ON player_submission_history (player_uuid, created_at DESC);

-- Index for cleanup of old history entries
CREATE INDEX IF NOT EXISTS idx_submission_history_created
    ON player_submission_history (created_at);

-- Add comment documenting shadowban policy
COMMENT ON COLUMN players.shadowbanned IS 'Shadowban flag: true when player exceeds 20% rejection rate over last 50 submissions. Shadowbanned players'' accepted submissions are still inserted into ghosts but excluded from leaderboard/matchmaking queries.';
