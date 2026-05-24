-- Daily challenges: same track with modifiers, seeded from UTC date
CREATE TABLE IF NOT EXISTS daily_challenges (
    challenge_date DATE PRIMARY KEY,
    track_id        SMALLINT NOT NULL,
    -- Modifiers applied to the base track physics
    gravity_multiplier     NUMERIC(5, 2) NOT NULL DEFAULT 1.0 CHECK (gravity_multiplier BETWEEN 0.5 AND 2.0),
    friction_multiplier   NUMERIC(5, 2) NOT NULL DEFAULT 1.0 CHECK (friction_multiplier BETWEEN 0.1 AND 2.0),
    chassis_mass_multiplier NUMERIC(5, 2) NOT NULL DEFAULT 1.0 CHECK (chassis_mass_multiplier BETWEEN 0.5 AND 3.0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for looking up recent challenges
CREATE INDEX idx_daily_challenges_date ON daily_challenges (challenge_date DESC);

-- Add daily_challenge_date column to ghosts table
-- Null for normal runs, set to challenge_date for daily challenge runs
ALTER TABLE ghosts
ADD COLUMN IF NOT EXISTS daily_challenge_date DATE REFERENCES daily_challenges(challenge_date) ON DELETE SET NULL;

-- Index for daily challenge leaderboard queries
CREATE INDEX idx_ghosts_daily_challenge ON ghosts (daily_challenge_date, time_ms ASC)
WHERE daily_challenge_date IS NOT NULL;

-- Partial index for daily challenge PB queries
CREATE INDEX idx_ghosts_daily_challenge_pb ON ghosts (daily_challenge_date, player_uuid, is_pb)
WHERE daily_challenge_date IS NOT NULL AND is_pb = true;
