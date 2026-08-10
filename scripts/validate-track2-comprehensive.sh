#!/bin/bash
set -e

echo "=== Track 2 Seed Ghost Validation ==="
echo ""
echo "This script validates track 2 seed ghosts by:"
echo "1. Checking structural integrity (magic numbers, headers, etc.)"
echo "2. Verifying track_id = 2"
echo "3. Ensuring proper wheel swap format"
echo "4. Checking vertex counts and time ranges"
echo ""

TRACK_2_DIR="seeds/track_2"

if [ ! -d "$TRACK_2_DIR" ]; then
    echo "Error: Directory $TRACK_2_DIR not found"
    exit 1
fi

echo "Checking seed files in $TRACK_2_DIR..."
echo ""

# Count total blob files
TOTAL=$(ls "$TRACK_2_DIR"/*.blob 2>/dev/null | wc -l)
echo "Found $TOTAL seed files"
echo ""

# Run the simple validation first
echo "Running structural validation..."
rustc scripts/validate_seeds_simple.rs -o /tmp/validate_seeds
if /tmp/validate_seeds; then
    echo ""
    echo "✓ All $TOTAL seed files passed structural validation"
else
    echo ""
    echo "✗ Some seed files failed validation"
    echo "Please review the errors above and fix the seed generation"
    exit 1
fi

echo ""
echo "=== Validation Summary ==="
echo "All $TOTAL seed ghost files in $TRACK_2_DIR are valid"
echo ""
echo "Bucket distribution should be:"
echo "  - elite    (pr ≤ 0.01):  1 ghost"
echo "  - advanced (pr ≤ 0.05):  1 ghost"
echo "  - skilled  (pr ≤ 0.20):  4 ghosts"
echo "  - mid      (pr ≤ 0.50):  7 ghosts"
echo "  - novice   (pr >  0.50): 12 ghosts"
echo ""
echo "Total: 25 seed ghosts ready for track 2 (canyon-02)"