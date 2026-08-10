#!/bin/bash
set -e

echo "Validating track 3 (dunes-03) seed ghosts..."

SEED_DIR="seeds/track_3"
TOTAL=$(ls "$SEED_DIR"/*.blob 2>/dev/null | wc -l)

if [ "$TOTAL" -eq 0 ]; then
    echo "ERROR: No seed blobs found in $SEED_DIR"
    exit 1
fi

echo "Found $TOTAL seed files"
echo ""

VALID=0
INVALID=0
DELETE_LIST=""

for blob in "$SEED_DIR"/*.blob; do
    filename=$(basename "$blob")

    # Check file size (should be > 100 bytes for a valid ghost)
    SIZE=$(stat -c%s "$blob" 2>/dev/null || stat -f%z "$blob" 2>/dev/null)

    if [ "$SIZE" -lt 100 ]; then
        echo "✗ $filename: Too small (${SIZE} bytes)"
        INVALID=$((INVALID + 1))
        DELETE_LIST="$DELETE_LIST $blob"
        continue
    fi

    # Check magic bytes
    MAGIC=$(xxd -p -l 4 "$blob" 2>/dev/null | tr '[:lower:]' '[:upper:]')
    if [ "$MAGIC" != "44524748" ]; then
        echo "✗ $filename: Invalid magic bytes"
        INVALID=$((INVALID + 1))
        DELETE_LIST="$DELETE_LIST $blob"
        continue
    fi

    # Extract version byte (offset 4)
    VERSION=$(xxd -p -s 4 -l 1 "$blob" 2>/dev/null)
    # Extract track_id (offset 5-6, little endian)
    # For track_id=3, little-endian bytes are 03 00, which xxd shows as 0300
    TRACK_ID=$(xxd -p -s 5 -l 2 "$blob" 2>/dev/null | tr '[:lower:]' '[:upper:]')

    if [ "$VERSION" != "08" ]; then
        echo "⚠ $filename: Version $VERSION (expected 08)"
    fi

    if [ "$TRACK_ID" != "0300" ]; then
        echo "✗ $filename: Wrong track_id $TRACK_ID (expected 0300)"
        INVALID=$((INVALID + 1))
        DELETE_LIST="$DELETE_LIST $blob"
        continue
    fi

    echo "✓ $filename: Valid (${SIZE} bytes)"
    VALID=$((VALID + 1))
done

echo ""
echo "Validation complete:"
echo "  Valid:   $VALID"
echo "  Invalid: $INVALID"

# Delete invalid files
if [ -n "$DELETE_LIST" ]; then
    echo ""
    echo "Deleting $INVALID invalid seed files..."
    for file in $DELETE_LIST; do
        rm -f "$file" && echo "  Deleted: $(basename "$file")"
    done
fi

if [ "$INVALID" -gt 0 ]; then
    exit 1
fi

echo ""
echo "✓ All track 3 seed ghosts validated successfully!"