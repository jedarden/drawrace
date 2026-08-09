#!/usr/bin/env bash
# Generate seed ghost blob files for the seed pool.
# This script supports multiple tracks with friendly names or track IDs.
#
# Usage: ./generate-seed-ghosts.sh [TRACK_ID_OR_NAME] [TARGET_TIME_MS]
# Examples:
#   ./generate-seed-ghosts.sh              # Generate for all tracks (1, 2, 3)
#   ./generate-seed-ghosts.sh 2            # Generate for track 2 only
#   ./generate-seed-ghosts.sh canyon-02    # Generate for canyon-02 only
#   ./generate-seed-ghosts.sh 2 50000      # Generate for track 2 with 50s target

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$WORKSPACE_ROOT"

# Function to convert friendly name to track ID
get_track_id() {
    case "$1" in
        hills-01|track_1|1) echo 1 ;;
        canyon-02|track_2|2) echo 2 ;;
        dunes-03|track_3|3) echo 3 ;;
        *) echo "" ;;
    esac
}

# Function to get default target time for a track
get_target_time() {
    case "$1" in
        1) echo 38000 ;;   # hills-01: 38s target
        2) echo 50000 ;;   # canyon-02: 50s target
        3) echo 55000 ;;   # dunes-03: 55s target
        *) echo 0 ;;
    esac
}

# Determine which tracks to generate
if [ -z "$1" ]; then
    # No argument provided, generate for all tracks
    TRACKS=(1 2 3)
    MANUAL_TARGET=""
elif [ "$1" = "all" ]; then
    # Explicit "all" argument
    TRACKS=(1 2 3)
    MANUAL_TARGET="$2"
else
    # Parse track identifier
    TRACK_ID=$(get_track_id "$1")
    if [ -z "$TRACK_ID" ]; then
        echo "Error: Unknown track '$1'. Use: hills-01, canyon-02, dunes-03, or track ID 1-3"
        exit 1
    fi
    TRACKS=($TRACK_ID)
    MANUAL_TARGET="$2"
fi

# Build the multi-track generator
echo "Building seed ghost generator..."
cargo build --release -p drawrace-api --bin generate-seed-ghosts-multi 2>&1 | tail -5

# Find or run the binary
GENERATOR_CMD=""
if [ -f "./target/release/generate-seed-ghosts-multi" ]; then
    GENERATOR_CMD="./target/release/generate-seed-ghosts-multi"
else
    GENERATOR_CMD="cargo run --release -p drawrace-api --bin generate-seed-ghosts-multi"
fi

# Generate ghosts for each requested track
for track in "${TRACKS[@]}"; do
    echo ""
    echo "=========================================="
    echo "Generating seed ghosts for track $track..."
    echo "=========================================="

    # Create seeds directory
    mkdir -p "seeds/track_$track"

    # Determine target time
    if [ -n "$MANUAL_TARGET" ]; then
        TARGET_TIME="$MANUAL_TARGET"
    else
        TARGET_TIME=$(get_target_time "$track")
    fi

    # Run the generator
    if [ -n "$TARGET_TIME" ] && [ "$TARGET_TIME" != "0" ]; then
        $GENERATOR_CMD "$track" "$TARGET_TIME"
    else
        $GENERATOR_CMD "$track"
    fi

    echo ""
    echo "Seed ghost files generated in seeds/track_$track/"
    ls -lh "seeds/track_$track/"*.blob 2>/dev/null || echo "No .blob files found"
done

echo ""
echo "=========================================="
echo "Summary of generated seed ghosts:"
echo "=========================================="
for track in "${TRACKS[@]}"; do
    COUNT=$(ls "seeds/track_$track/"*.blob 2>/dev/null | wc -l)
    echo "Track $track: $COUNT seed ghosts"
done
