#!/usr/bin/env bash
# Generate seed ghost blob files for the seed pool.
# This script runs the seed generation as a Rust program.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$WORKSPACE_ROOT"

# Create seeds directory
mkdir -p seeds/track_1

# Build and run the seed generator as a test binary
echo "Building seed ghost generator..."
cargo build --release -p drawrace-api --bin generate-seed-ghosts 2>&1 | tail -5

# Check if binary exists
if [ -f "./target/release/generate-seed-ghosts" ]; then
    echo "Running seed ghost generator..."
    ./target/release/generate-seed-ghosts
else
    echo "Binary not found, trying cargo run..."
    cargo run --release -p drawrace-api --bin generate-seed-ghosts
fi

echo ""
echo "Seed ghost files generated in seeds/track_1/"
ls -lh seeds/track_1/*.blob 2>/dev/null || echo "No .blob files found"
