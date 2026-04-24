-- Flag all pre-migration ghosts as legacy.
-- Existing blobs use the single-polygon binary layout and cannot be replayed
-- with the new wheels[] format.  Per plan §Multiplayer 5 Option 2: mark
-- is_legacy=true and suppress from matchmaking and leaderboard; direct fetch
-- by ghost_id remains unaffected.

UPDATE ghosts SET is_legacy = true;

-- Partial index for the hot matchmake/leaderboard filter path.
CREATE INDEX idx_ghosts_not_legacy ON ghosts (track_id, time_ms ASC) WHERE is_legacy = false;

-- Rebuild the materialized view so bucket percentiles exclude legacy ghosts.
-- Without this, legacy entries would shift bucket boundaries for future runs.
DROP MATERIALIZED VIEW IF EXISTS leaderboard_buckets;

CREATE MATERIALIZED VIEW leaderboard_buckets AS
SELECT track_id,
       ghost_id,
       player_uuid,
       time_ms,
       percent_rank() OVER (PARTITION BY track_id ORDER BY time_ms ASC) AS pr
  FROM ghosts
 WHERE is_pb = true AND is_legacy = false;

CREATE UNIQUE INDEX idx_lb_track_ghost ON leaderboard_buckets (track_id, ghost_id);
