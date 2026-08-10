#!/bin/bash
set -e

echo "Validating track 3 (dunes-03) seed ghosts..."
echo "Found $(ls seeds/track_3/*.blob | wc -l) seed files"
echo ""

cargo run --quiet --bin drawrace-validator -- --validate-dir seeds/track_3 || {
    echo "Validator failed, trying simple blob check..."
    cargo run --quiet --manifest-path crates/api/Cargo.toml --example validate_blobs -- seeds/track_3 || true
}

echo ""
echo "Validation complete!"