#!/bin/bash
# Check for kubectl in standard installation paths
# Returns 0 if found in any location, 1 otherwise

set -euo pipefail

# Standard paths to check
PATHS=(
  "/usr/local/bin/kubectl"
  "/usr/bin/kubectl"
  "$HOME/.local/bin/kubectl"
)

FOUND=0
FOUND_PATH=""

echo "Checking for kubectl in standard installation paths..."
echo ""

for path in "${PATHS[@]}"; do
  if [ -x "$path" ]; then
    echo "✓ Found: $path"
    FOUND=1
    FOUND_PATH="$path"
    # Show version if available
    "$path" version --client 2>/dev/null | head -1 || true
  else
    echo "✗ Not found: $path"
  fi
done

echo ""
if [ $FOUND -eq 1 ]; then
  echo "SUCCESS: kubectl found at $FOUND_PATH"
  exit 0
else
  echo "FAILURE: kubectl not found in any standard location"
  echo "Checked paths:"
  for path in "${PATHS[@]}"; do
    echo "  - $path"
  done
  exit 1
fi
