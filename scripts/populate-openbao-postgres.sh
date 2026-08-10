#!/bin/bash
# Generate and populate Postgres credentials in OpenBao for DrawRace
# This script handles only the Postgres credentials portion of the OpenBao setup

set -euo pipefail

# Configuration
DRAWRACE_NAMESPACE="drawrace"
OPENBAO_ADDR="http://openbao.external-secrets.svc.cluster.local:8200"
OPENBAO_SECRET_PATH="secret/rs-manager/drawrace/postgres"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
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

# Check for OpenBao token
check_openbao_token() {
    if [ -z "${OPENBAO_TOKEN:-}" ]; then
        error "OPENBAO_TOKEN environment variable not set.
Please set it with: export OPENBAO_TOKEN='<your-openbao-root-token>'"
    fi
    log "OpenBao token found."
}

# Generate secure Postgres credentials
generate_postgres_credentials() {
    log "Generating secure Postgres credentials..."

    # Set username
    POSTGRES_USERNAME="drawrace"

    # Generate cryptographically secure random password (32 bytes base64-encoded)
    POSTGRES_PASSWORD=$(openssl rand -base64 32)

    # Display what was generated (without exposing the actual password)
    log "Postgres username: $POSTGRES_USERNAME"
    log "Postgres password: [generated - $(echo "$POSTGRES_PASSWORD" | wc -c) characters]"

    # Validate the password meets basic requirements
    if [ ${#POSTGRES_PASSWORD} -lt 32 ]; then
        error "Generated password is too short. Expected at least 32 characters."
    fi

    log "✅ Postgres credentials generated successfully."
}

# Populate OpenBao with Postgres credentials
populate_openbao_postgres() {
    log "Writing Postgres credentials to OpenBao at $OPENBAO_SECRET_PATH..."

    # Write the credentials to OpenBao
    RESPONSE=$(curl -s -X POST "$OPENBAO_ADDR/v1/secret/data/$OPENBAO_SECRET_PATH" \
        -H "X-Vault-Token: $OPENBAO_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"data\": {
                \"username\": \"$POSTGRES_USERNAME\",
                \"password\": \"$POSTGRES_PASSWORD\"
            }
        }")

    # Check for successful response
    if echo "$RESPONSE" | jq -e '.data.created_time' >/dev/null 2>&1; then
        log "✅ Postgres credentials successfully written to OpenBao."
    else
        error "Failed to write to OpenBao. Response: $RESPONSE"
    fi
}

# Verify the credentials were stored correctly
verify_openbao_secret() {
    log "Verifying Postgres credentials in OpenBao..."

    # Read back the secret
    RESPONSE=$(curl -s -X GET "$OPENBAO_ADDR/v1/secret/data/$OPENBAO_SECRET_PATH" \
        -H "X-Vault-Token: $OPENBAO_TOKEN")

    # Verify the username matches
    STORED_USERNAME=$(echo "$RESPONSE" | jq -r '.data.data.username')
    STORED_PASSWORD=$(echo "$RESPONSE" | jq -r '.data.data.password')

    if [ "$STORED_USERNAME" = "$POSTGRES_USERNAME" ] && [ "$STORED_PASSWORD" = "$POSTGRES_PASSWORD" ]; then
        log "✅ Verification successful - credentials stored correctly."
        return 0
    else
        error "Verification failed - stored credentials don't match what was generated."
    fi
}

# Check ExternalSecret sync status
check_external_secret_sync() {
    log "Checking if ExternalSecret is syncing..."

    if kubectl --server=http://traefik-iad-acb:8001 get externalsecret drawrace-postgres-credentials -n "$DRAWRACE_NAMESPACE" >/dev/null 2>&1; then
        STATUS=$(kubectl --server=http://traefik-iad-acb:8001 get externalsecret drawrace-postgres-credentials -n "$DRAWRACE_NAMESPACE" -o jsonpath='{.status.conditions[0].status}')

        if [ "$STATUS" = "True" ]; then
            log "✅ ExternalSecret 'drawrace-postgres-credentials' is Ready and synced."
        else
            warn "ExternalSecret status: $STATUS - may take a few moments to sync."
        fi
    else
        warn "ExternalSecret 'drawrace-postgres-credentials' not found - may need to be created first."
    fi
}

# Main execution
main() {
    log "Starting Postgres credentials generation and OpenBao population..."
    echo ""

    check_openbao_token
    generate_postgres_credentials
    populate_openbao_postgres
    verify_openbao_secret
    check_external_secret_sync

    echo ""
    log "✅ Postgres credentials successfully generated and stored in OpenBao!"
    log ""
    log "Summary:"
    log "  - Username: $POSTGRES_USERNAME"
    log "  - Password length: ${#POSTGRES_PASSWORD} characters"
    log "  - OpenBao path: $OPENBAO_SECRET_PATH"
    log "  - Cryptographically secure generation: openssl rand -base64 32"
}

# Run main function
main "$@"