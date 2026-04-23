#!/usr/bin/env bash
# Promote top real beta ghosts to the seed pool for launch.
#
# This replaces the synthetic seed ghosts (from seed.rs) with the top-30
# real player runs from beta. Run once after beta concludes, before launch.
#
# Usage:
#   ./scripts/seed-from-beta.sh [--dry-run] [LIMIT]
#
# Examples:
#   ./scripts/seed-from-beta.sh --dry-run    # preview SQL without executing
#   ./scripts/seed-from-beta.sh              # promote top 30
#   ./scripts/seed-from-beta.sh 50           # promote top 50
#
# Requires psql access to the drawrace Postgres database.
# Set DATABASE_URL or PG environment variables.
set -euo pipefail

SEED_PLAYER="00000000-0000-4000-8000-000000000001"
LIMIT="${1:-30}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  LIMIT="${2:-30}"
fi

if [[ "$LIMIT" -lt 10 || "$LIMIT" -gt 100 ]]; then
  echo "ERROR: LIMIT must be between 10 and 100, got $LIMIT" >&2
  exit 1
fi

echo "-- Seed-from-beta: promoting top $LIMIT real ghosts to seed pool"
echo "-- Seed player UUID: $SEED_PLAYER"
echo ""

# Step 1: Count existing real ghosts (excluding seed player)
EXISTING=$(psql -t -A -c "
  SELECT COUNT(*) FROM ghosts
  WHERE player_uuid != '$SEED_PLAYER'::uuid
    AND is_pb = true
    AND track_id = 1
;" 2>/dev/null || echo "0")

if [[ "$EXISTING" -lt "$LIMIT" ]]; then
  echo "WARNING: Only $EXISTING real ghosts found, requested $LIMIT" >&2
  echo "WARNING: Will promote all available ghosts instead" >&2
  LIMIT="$EXISTING"
fi

if [[ "$LIMIT" -lt 5 ]]; then
  echo "ERROR: Need at least 5 real ghosts to seed, found $LIMIT" >&2
  exit 1
fi

echo "-- Found $EXISTING real ghosts, promoting top $LIMIT"
echo ""

# Step 2: Generate the migration SQL
SQL=$(cat <<EOSQL
BEGIN;

-- Delete existing synthetic seed ghosts
DELETE FROM ghosts WHERE player_uuid = '${SEED_PLAYER}'::uuid;

-- Copy top real ghosts as seed entries (reusing original S3 blobs)
-- Each real ghost gets duplicated with the seed player UUID and is_pb=true.
-- S3 keys are kept as-is so blobs remain accessible without copying.
INSERT INTO ghosts (player_uuid, track_id, physics_version, time_ms, is_pb, is_legacy, s3_key)
SELECT
  '${SEED_PLAYER}'::uuid,
  g.track_id,
  g.physics_version,
  g.time_ms,
  true,
  false,
  g.s3_key
FROM (
  SELECT ghost_id, track_id, physics_version, time_ms, s3_key
  FROM ghosts
  WHERE player_uuid != '${SEED_PLAYER}'::uuid
    AND is_pb = true
    AND track_id = 1
  ORDER BY time_ms ASC
  LIMIT ${LIMIT}
) g;

-- Refresh materialized view so matchmaking picks up new seeds
REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_buckets;

COMMIT;
EOSQL
)

if $DRY_RUN; then
  echo "-- DRY RUN — printing SQL without executing:"
  echo ""
  echo "$SQL"
  echo ""
  echo "-- To apply, re-run without --dry-run"
else
  echo "-- Applying seed promotion..."
  echo "$SQL" | psql -v ON_ERROR_STOP=1
  echo ""
  echo "-- Seed promotion complete. Verifying..."

  NEW_COUNT=$(psql -t -A -c "
    SELECT COUNT(*) FROM ghosts
    WHERE player_uuid = '${SEED_PLAYER}'::uuid;
  " 2>/dev/null || echo "0")

  echo "-- Seed player now has $NEW_COUNT ghost(s)"

  FASTEST=$(psql -t -A -c "
    SELECT MIN(time_ms) FROM ghosts
    WHERE player_uuid = '${SEED_PLAYER}'::uuid;
  " 2>/dev/null || echo "?")

  SLOWEST=$(psql -t -A -c "
    SELECT MAX(time_ms) FROM ghosts
    WHERE player_uuid = '${SEED_PLAYER}'::uuid;
  " 2>/dev/null || echo "?")

  echo "-- Time range: ${FASTEST}ms — ${SLOWEST}ms"
fi
