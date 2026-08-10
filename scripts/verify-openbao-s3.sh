#!/usr/bin/env bash
# Verify S3 credentials in OpenBao
# This script checks that S3 credentials are properly stored in OpenBao
# and can be read back via the OpenBao API.
#
# Usage: OPENBAO_TOKEN=<token> ./scripts/verify-openbao-s3.sh

set -euo pipefail

# Configuration
OPENBAO_ADDR="${OPENBAO_ADDR:-https://openbao.ardenone.com}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

info() {
    echo -e "${BLUE}[CHECK]${NC} $1"
}

success() {
    echo -e "${GREEN}[✅]${NC} $1"
}

fail() {
    echo -e "${RED}[❌]${NC} $1"
}

# Check OpenBao token
if [ -z "${OPENBAO_TOKEN:-}" ]; then
    error "OPENBAO_TOKEN environment variable not set. Usage: OPENBAO_TOKEN=<token> $0"
fi

log "Verifying S3 credentials in OpenBao at ${OPENBAO_ADDR}..."

# Test OpenBao connectivity
info "Testing OpenBao connectivity..."
if ! curl -s -f "${OPENBAO_ADDR}/v1/sys/health" >/dev/null; then
    error "Cannot reach OpenBao at ${OPENBAO_ADDR}"
fi
success "OpenBao is reachable"

# Verify API S3 credentials
info "Verifying API S3 credentials (secret/rs-manager/drawrace/s3)..."

api_response=$(curl -s -X GET "${OPENBAO_ADDR}/v1/secret/data/rs-manager/drawrace/s3" \
    -H "X-Vault-Token: ${OPENBAO_TOKEN}")

if echo "$api_response" | jq -e '.errors' >/dev/null; then
    fail "Failed to read API S3 credentials"
    error "Error: $(echo "$api_response" | jq -r '.errors[0]')"
fi

# Check all required fields for API S3 credentials
api_fields_ok=true
required_api_fields=("AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "AWS_ENDPOINT_URL" "AWS_REGION")

echo ""
echo "API S3 Credential Fields:"
for field in "${required_api_fields[@]}"; do
    value=$(echo "$api_response" | jq -r ".data.data.${field} // empty")
    if [ -n "$value" ]; then
        success "  ${field}: *** ($(echo -n "$value" | wc -c) bytes)"
    else
        fail "  ${field}: MISSING"
        api_fields_ok=false
    fi
done

if [ "$api_fields_ok" = true ]; then
    log "✅ All API S3 credential fields present"
else
    error "API S3 credentials are missing required fields"
fi

# Verify Backup S3 credentials
info "Verifying Backup S3 credentials (secret/rs-manager/drawrace/postgres-backup)..."

backup_response=$(curl -s -X GET "${OPENBAO_ADDR}/v1/secret/data/rs-manager/drawrace/postgres-backup" \
    -H "X-Vault-Token: ${OPENBAO_TOKEN}")

if echo "$backup_response" | jq -e '.errors' >/dev/null; then
    fail "Failed to read backup S3 credentials"
    error "Error: $(echo "$backup_response" | jq -r '.errors[0]')"
fi

# Check all required fields for Backup S3 credentials
backup_fields_ok=true
required_backup_fields=("accessKeyId" "secretAccessKey")

echo ""
echo "Backup S3 Credential Fields:"
for field in "${required_backup_fields[@]}"; do
    value=$(echo "$backup_response" | jq -r ".data.data.${field} // empty")
    if [ -n "$value" ]; then
        success "  ${field}: *** ($(echo -n "$value" | wc -c) bytes)"
    else
        fail "  ${field}: MISSING"
        backup_fields_ok=false
    fi
done

if [ "$backup_fields_ok" = true ]; then
    log "✅ All Backup S3 credential fields present"
else
    error "Backup S3 credentials are missing required fields"
fi

# Display summary
echo ""
success "✅ All S3 credentials verification passed!"
echo ""
echo "Summary:"
echo "  📁 API S3: secret/rs-manager/drawrace/s3"
echo "     • AWS_ACCESS_KEY_ID ✓"
echo "     • AWS_SECRET_ACCESS_KEY ✓"
echo "     • AWS_ENDPOINT_URL ✓"
echo "     • AWS_REGION ✓"
echo ""
echo "  📁 Backup S3: secret/rs-manager/drawrace/postgres-backup"
echo "     • accessKeyId ✓"
echo "     • secretAccessKey ✓"
echo ""
