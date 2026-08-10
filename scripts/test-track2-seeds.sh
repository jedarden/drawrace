#!/bin/bash
# Test script to validate existing track 2 seed files

cd /home/coding/drawrace

echo "Testing track 2 seed files..."

for file in seeds/track_2/seed-*.blob; do
    filename=$(basename "$file")
    size=$(stat -c%s "$file")

    # Check if file has minimum size (header 36 bytes + at least wheel_count 1 + basic wheel data)
    if [ $size -lt 50 ]; then
        echo "✗ $filename: Too small ($size bytes)"
    else
        # Check magic number
        magic=$(xxd -l 4 -p "$file")
        if [ "$magic" = "44524748" ]; then
            # Extract version
            version=$(xxd -s 4 -l 1 -p "$file")
            track_id=$(xxd -s 5 -l 2 -p "$file | xxd -r -p | rev | sed 's/\(..\)/\1\n/g' | tac")

            echo "✓ $filename: size=$size bytes, version=$version, track_id=$track_id"
        else
            echo "✗ $filename: Invalid magic number ($magic)"
        fi
    fi
done

echo ""
echo "Analysis complete."