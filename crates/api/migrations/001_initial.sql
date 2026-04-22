-- DrawRace initial schema
-- players: lightweight identity table (no auth in v1)
CREATE TABLE IF NOT EXISTS players (
    player_uuid UUID PRIMARY KEY,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- names: claim-on-first-use display names
CREATE TABLE IF NOT EXISTS names (
    player_uuid   UUID PRIMARY KEY REFERENCES players(player_uuid) ON DELETE CASCADE,
    name          TEXT      NOT NULL,
    name_lowercase TEXT     NOT NULL,
    claimed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ,
    CONSTRAINT uq_names_name_lowercase UNIQUE (name_lowercase)
);

-- ghosts: one row per accepted run (replay blob stored in Garage S3)
CREATE TABLE IF NOT EXISTS ghosts (
    ghost_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_uuid     UUID        NOT NULL REFERENCES players(player_uuid) ON DELETE CASCADE,
    track_id        SMALLINT    NOT NULL,
    physics_version SMALLINT    NOT NULL CHECK (physics_version BETWEEN 0 AND 255),
    time_ms         INTEGER     NOT NULL CHECK (time_ms > 0),
    is_pb           BOOLEAN     NOT NULL DEFAULT false,
    is_legacy       BOOLEAN     NOT NULL DEFAULT false,
    s3_key          TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ghosts_track_time ON ghosts (track_id, time_ms ASC);
CREATE INDEX idx_ghosts_player_track ON ghosts (player_uuid, track_id);

-- submissions: tracks validation state for each submitted run
CREATE TABLE IF NOT EXISTS submissions (
    submission_id UUID        PRIMARY KEY,
    player_uuid   UUID        NOT NULL REFERENCES players(player_uuid) ON DELETE CASCADE,
    track_id      SMALLINT    NOT NULL,
    physics_version SMALLINT  NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'pending_validation'
                              CHECK (status IN ('pending_validation', 'accepted', 'rejected')),
    ghost_id      UUID        REFERENCES ghosts(ghost_id),
    reject_reason TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at   TIMESTAMPTZ
);

CREATE INDEX idx_submissions_player ON submissions (player_uuid);

-- leaderboard_buckets: materialized view for matchmaking percentile queries
CREATE MATERIALIZED VIEW IF NOT EXISTS leaderboard_buckets AS
SELECT track_id,
       ghost_id,
       player_uuid,
       time_ms,
       percent_rank() OVER (PARTITION BY track_id ORDER BY time_ms ASC) AS pr
  FROM ghosts
 WHERE is_pb = true;

CREATE UNIQUE INDEX idx_lb_track_ghost ON leaderboard_buckets (track_id, ghost_id);
