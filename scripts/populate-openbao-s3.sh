#!/usr/bin/env bash
# Populate S3 credentials from Garage into OpenBao
# This script extracts S3 credentials from Garage-generated Kubernetes secrets
# and populates them into OpenBao for use by DrawRace components.
#
# Usage: OPENBAO_TOKEN=<root-token> ./scripts/populate-openbao-s3.sh
#
# Prerequisites:
# - OpenBao root token available
# - Garage resources created (secrets exist in garage-operator namespace)
# - kubectl access to the cluster

set -euo pipefail

# Configuration
DRAWRACE_NAMESPACE="drawrace"
GARAGE_NAMESPACE="garage-operator"
OPENBAO_ADDR="${OPENBAO_ADDR:-https://openbao.ardenone.com}"
KUBERNETES_PROXY="${KUBERNETES_PROXY:-http://traefik-rs-manager:8001}"

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
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    info "Checking prerequisites..."

    # Check OpenBao token
    if [ -z "${OPENBAO_TOKEN:-}" ]; then
        error "OPENBAO_TOKEN environment variable not set. Usage: OPENBAO_TOKEN=<token> $0"
    fi

    # Test OpenBao connectivity
    log "Testing OpenBao connectivity at ${OPENBAO_ADDR}..."
    if ! curl -s -f "${OPENBAO_ADDR}/v1/sys/health" >/dev/null; then
        error "Cannot reach OpenBao at ${OPENBAO_ADDR}"
    fi

    # Test Kubernetes access
    log "Testing Kubernetes access via ${KUBERNETES_PROXY}..."
    if ! kubectl --server="${KUBERNETES_PROXY}" get namespace "${GARAGE_NAMESPACE}" >/dev/null 2>&1; then
        error "Cannot access Kubernetes cluster via ${KUBERNETES_PROXY}"
    fi

    log "✅ All prerequisites met"
}

# Extract S3 credentials from Garage-generated Kubernetes secret
extract_garage_secret() {
    local secret_name="$1"
    local namespace="$2"

    log "Extracting credentials from secret ${secret_name} in ${namespace}..."

    # Get the secret data
    local secret_data
    secret_data=$(kubectl --server="${KUBERNETES_PROXY}" get secret "${secret_name}" -n "${namespace}" -o json)

    if [ -z "$secret_data" ]; then
        error "Secret ${secret_name} not found in namespace ${namespace}"
    fi

    # Extract and decode the fields
    # GarageKey secrets use these keys: accessKey, secretKey, and optionally endpoint
    local access_key secret_key endpoint

    access_key=$(echo "$secret_data" | jq -r '.data.accessKey // .data.ACCESS_KEY_ID // .data.accessKeyId // empty' | base64 -d 2>/dev/null || echo "")
    secret_key=$(echo "$secret_data" | jq -r '.data.secretKey // .data.SECRET_ACCESS_KEY // .data.secretAccessKey // empty' | base64 -d 2>/dev/null || echo "")
    endpoint=$(echo "$secret_data" | jq -r '.data.endpoint // .data.S3_ENDPOINT // .data.AWS_ENDPOINT_URL // empty' | base64 -d 2>/dev/null || echo "")

    if [ -z "$access_key" ] || [ -z "$secret_key" ]; then
        error "Failed to extract access_key or secret_key from secret ${secret_name}"
    fi

    # Export as environment variables for caller
    export EXTRACTED_ACCESS_KEY="$access_key"
    export EXTRACTED_SECRET_KEY="$secret_key"
    export EXTRACTED_ENDPOINT="${endpoint:-http://garage.ardenone-hub.svc:3900}"

    log "✅ Successfully extracted credentials from ${secret_name}"
}

# Write API S3 credentials to OpenBao
write_api_s3_credentials() {
    info "Writing API S3 credentials to OpenBao..."

    local secret_path="secret/rs-manager/drawrace/s3"

    # Construct the payload
    local payload
    payload=$(jq -n \
        --arg access_key "$EXTRACTED_ACCESS_KEY" \
        --arg secret_key "$EXTRACTED_SECRET_KEY" \
        --arg endpoint "$EXTRACTED_ENDPOINT" \
        --arg region "garage" \
        '{
            data: {
                AWS_ACCESS_KEY_ID: $access_key,
                AWS_SECRET_ACCESS_KEY: $secret_key,
                AWS_ENDPOINT_URL: $endpoint,
                AWS_REGION: $region
            }
        }')

    # Write to OpenBao
    local response
    response=$(curl -s -X POST "${OPENBAO_ADDR}/v1/${secret_path}" \
        -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$payload")

    # Check for errors
    if echo "$response" | jq -e '.errors' >/dev/null; then
        error "Failed to write API S3 credentials: $(echo "$response" | jq -r '.errors[0]')"
    fi

    log "✅ API S3 credentials written to ${secret_path}"
}

# Write backup S3 credentials to OpenBao
write_backup_s3_credentials() {
    info "Writing backup S3 credentials to OpenBao..."

    local secret_path="secret/rs-manager/drawrace/postgres-backup"

    # Construct the payload
    local payload
    payload=$(jq -n \
        --arg access_key "$EXTRACTED_ACCESS_KEY" \
        --arg secret_key "$EXTRACTED_SECRET_KEY" \
        '{
            data: {
                accessKeyId: $access_key,
                secretAccessKey: $secret_key
            }
        }')

    # Write to OpenBao
    local response
    response=$(curl -s -X POST "${OPENBAO_ADDR}/v1/${secret_path}" \
        -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$payload")

    # Check for errors
    if echo "$response" | jq -e '.errors' >/dev/null; then
        error "Failed to write backup S3 credentials: $(echo "$response" | jq -r '.errors[0]')"
    fi

    log "✅ Backup S3 credentials written to ${secret_path}"
}

# Verify secrets can be read back
verify_secrets() {
    info "Verifying secrets can be read back from OpenBao..."

    # Verify API S3 credentials
    log "Reading API S3 credentials from secret/rs-manager/drawrace/s3..."
    local api_response
    api_response=$(curl -s -X GET "${OPENBAO_ADDR}/v1/secret/data/rs-manager/drawrace/s3" \
        -H "X-Vault-Token: ${OPENBAO_TOKEN}")

    if echo "$api_response" | jq -e '.errors' >/dev/null; then
        error "Failed to read API S3 credentials: $(echo "$api_response" | jq -r '.errors[0]')"
    fi

    # Check required fields
    local required_fields=("AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "AWS_ENDPOINT_URL" "AWS_REGION")
    for field in "${required_fields[@]}"; do
        if ! echo "$api_response" | jq -e ".data.data.${field}" >/dev/null; then
            error "Missing required field in API S3 credentials: ${field}"
        fi
    done

    log "✅ API S3 credentials verified (all required fields present)"

    # Verify backup S3 credentials
    log "Reading backup S3 credentials from secret/rs-manager/drawrace/postgres-backup..."
    local backup_response
    backup_response=$(curl -s -X GET "${OPENBAO_ADDR}/v1/secret/data/rs-manager/drawrace/postgres-backup" \
        -H "X-Vault-Token: ${OPENBAO_TOKEN}")

    if echo "$backup_response" | jq -e '.errors' >/dev/null; then
        error "Failed to read backup S3 credentials: $(echo "$backup_response" | jq -r '.errors[0]')"
    fi

    # Check required fields
    local backup_fields=("accessKeyId" "secretAccessKey")
    for field in "${backup_fields[@]}"; do
        if ! echo "$backup_response" | jq -e ".data.data.${field}" >/dev/null; then
            error "Missing required field in backup S3 credentials: ${field}"
        fi
    done

    log "✅ Backup S3 credentials verified (all required fields present)"
}

# Display summary
show_summary() {
    info "Summary of OpenBao S3 credentials populated:"

    echo ""
    echo "📁 API S3 Credentials:"
    echo "   Path: secret/rs-manager/drawrace/s3"
    echo "   Fields:"
    echo "     - AWS_ACCESS_KEY_ID"
    echo "     - AWS_SECRET_ACCESS_KEY"
    echo "     - AWS_ENDPOINT_URL"
    echo "     - AWS_REGION"
    echo ""
    echo "📁 Backup S3 Credentials:"
    echo "   Path: secret/rs-manager/drawrace/postgres-backup"
    echo "   Fields:"
    echo "     - accessKeyId"
    echo "     - secretAccessKey"
    echo ""
}

# Main execution
main() {
    log "Starting S3 credentials population to OpenBao..."

    check_prerequisites

    # Extract and write API S3 credentials
    # From the garage-resources.yaml, the API key secret is: drawrace-api-s3-credentials
    if ! extract_garage_secret "drawrace-api-s3-credentials" "${GARAGE_NAMESPACE}"; then
        error "Failed to extract API S3 credentials"
    fi
    write_api_s3_credentials

    # Extract and write backup S3 credentials
    # From the garage-resources.yaml, the backup key secret is: drawrace-postgres-backup-s3
    if ! extract_garage_secret "drawrace-postgres-backup-s3" "${GARAGE_NAMESPACE}"; then
        error "Failed to extract backup S3 credentials"
    fi
    write_backup_s3_credentials

    # Verify
    verify_secrets

    show_summary

    log "🎉 S3 credentials successfully populated to OpenBao!"
}

# Run main function
main "$@"
