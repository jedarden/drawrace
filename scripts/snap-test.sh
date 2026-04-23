#!/bin/bash
# Run Layer 3 snapshot tests in the pinned CI container
# This ensures deterministic font rendering and cross-platform consistency

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default to verify mode unless UPDATE=1 is set
SNAPSHOT_UPDATE="${SNAPSHOT_UPDATE:-}"

echo "Running Layer 3 snapshot tests in container..."
echo "Project root: $PROJECT_ROOT"

if [ -n "$SNAPSHOT_UPDATE" ]; then
    echo "Mode: UPDATE (will generate new baselines)"
else
    echo "Mode: VERIFY (will compare against existing baselines)"
fi

docker run --rm -it \
    -v "$PROJECT_ROOT:/work" \
    -w /work \
    -e SNAPSHOT_UPDATE="$SNAPSHOT_UPDATE" \
    ghcr.io/drawrace/ci-snap:2026-04-21 \
    sh -c "pnpm install && pnpm test:snapshot"
