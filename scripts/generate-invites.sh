#!/usr/bin/env bash
# Generate additional invite codes for DrawRace beta testing.
#
# Usage:
#   ./scripts/generate-invites.sh [COUNT] [MAX_USES]
#
# Examples:
#   ./scripts/generate-invites.sh 10        # 10 codes, 1 use each
#   ./scripts/generate-invites.sh 5 3       # 5 codes, 3 uses each
#   ./scripts/generate-invites.sh 1 100     # 1 code, 100 uses (open beta)
#
# Requires psql access to the drawrace Postgres database.
# Set DATABASE_URL or PG environment variables.
set -euo pipefail

COUNT="${1:-5}"
MAX_USES="${2:-1}"
PREFIX="BETA-DRAW"

echo "-- Generating $COUNT invite codes (max_uses=$MAX_USES)"
echo "-- Run against the drawrace database:"
echo ""

VALUES=""
for i in $(seq 1 "$COUNT"); do
  SUFFIX=$(printf "%03d" "$((RANDOM % 900 + 100))")
  CODE="${PREFIX}-${SUFFIX}"
  VALUES="${VALUES}('${CODE}', ${MAX_USES})"
  if [ "$i" -lt "$COUNT" ]; then
    VALUES="${VALUES},"
  fi
  echo "-- Code: $CODE"
done

echo ""
echo "INSERT INTO invite_codes (code, max_uses) VALUES ${VALUES} ON CONFLICT DO NOTHING;"
