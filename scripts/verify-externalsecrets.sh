#!/bin/bash
#
# verify-externalsecrets.sh
#
# Verify that DrawRace ExternalSecrets are properly configured and syncing
# Acceptance Criteria:
# - All 3 ExternalSecrets in drawrace namespace are Ready
# - Secrets are successfully populated from OpenBao
# - No ExternalSecret resources show sync errors
#
# Usage: ./scripts/verify-externalsecrets.sh [--verbose]
#

set -euo pipefail

# Configuration
NAMESPACE="drawrace"
CLUSTER_ENDPOINT="http://traefik-rs-manager:8001"
EXPECTED_SECRETS=(
    "drawrace-postgres"
    "drawrace-cloudflare"
    "docker-hub-registry"
    "drawrace-postgres-backup"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_detail() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${BLUE}[DEBUG]${NC} $1"
    fi
}

# Help function
show_help() {
    cat << EOF
Usage: $0 [--verbose] [--help]

Verify DrawRace ExternalSecrets are properly configured and syncing.

Options:
  --verbose    Show detailed information for each ExternalSecret
  --help       Show this help message

Acceptance Criteria:
  ✓ All ExternalSecrets in drawrace namespace are Ready
  ✓ Secrets are successfully populated from OpenBao
  ✓ No ExternalSecret resources show sync errors

EOF
    exit 0
}

# Parse arguments
VERBOSE=false
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            show_help
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            ;;
    esac
done

# Test cluster connectivity
test_connectivity() {
    log_info "Testing cluster connectivity..."

    if kubectl --server="$CLUSTER_ENDPOINT" get namespace "$NAMESPACE" &>/dev/null; then
        log_info "✓ Cluster connectivity confirmed"
        return 0
    else
        log_error "Cannot connect to cluster or namespace does not exist"
        return 1
    fi
}

# Check ExternalSecrets
check_externalsecrets() {
    log_info "Checking ExternalSecrets in namespace '$NAMESPACE'..."

    local all_ready=true
    local es_count=0
    local ready_count=0

    # Get all ExternalSecrets in the namespace
    local external_secrets=($(kubectl --server="$CLUSTER_ENDPOINT" get externalsecrets -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo ""))

    if [ ${#external_secrets[@]} -eq 0 ]; then
        log_error "No ExternalSecrets found in namespace '$NAMESPACE'"
        return 1
    fi

    log_info "Found ${#external_secrets[@]} ExternalSecret(s)"

    for es in "${external_secrets[@]}"; do
        es_count=$((es_count + 1))

        # Get ExternalSecret status
        local ready=$(kubectl --server="$CLUSTER_ENDPOINT" get externalsecret "$es" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "False")
        local message=$(kubectl --server="$CLUSTER_ENDPOINT" get externalsecret "$es" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].message}' 2>/dev/null || echo "Unknown")

        if [ "$ready" = "True" ]; then
            log_info "✓ $es: Ready"
            ready_count=$((ready_count + 1))
        else
            log_error "✗ $es: Not Ready - $message"
            all_ready=false
        fi

        # Show detailed info if verbose
        if [ "$VERBOSE" = true ]; then
            local refresh_interval=$(kubectl --server="$CLUSTER_ENDPOINT" get externalsecret "$es" -n "$NAMESPACE" -o jsonpath='{.spec.refreshInterval}')
            local store=$(kubectl --server="$CLUSTER_ENDPOINT" get externalsecret "$es" -n "$NAMESPACE" -o jsonpath='{.spec.secretStoreRef.name}')
            local target_secret=$(kubectl --server="$CLUSTER_ENDPOINT" get externalsecret "$es" -n "$NAMESPACE" -o jsonpath='{.spec.target.name}')

            log_detail "  Store: $store"
            log_detail "  Target Secret: $target_secret"
            log_detail "  Refresh Interval: $refresh_interval"
        fi
    done

    log_info "ExternalSecrets: $ready_count/$es_count Ready"

    if [ "$all_ready" = true ]; then
        return 0
    else
        return 1
    fi
}

# Check synced Secrets
check_secrets() {
    log_info "Checking synced Secrets in namespace '$NAMESPACE'..."

    local all_present=true

    for secret in "${EXPECTED_SECRETS[@]}"; do
        if kubectl --server="$CLUSTER_ENDPOINT" get secret "$secret" -n "$NAMESPACE" &>/dev/null; then
            local age=$(kubectl --server="$CLUSTER_ENDPOINT" get secret "$secret" -n "$NAMESPACE" -o jsonpath='{.metadata.creationTimestamp}' | cut -d'T' -f1 | sed 's/-//g')
            log_info "✓ $secret: Present (created: $age)"

            # Show secret keys if verbose
            if [ "$VERBOSE" = true ]; then
                local keys=$(kubectl --server="$CLUSTER_ENDPOINT" get secret "$secret" -n "$NAMESPACE" -o jsonpath='{.data}' | jq -r 'keys[]' 2>/dev/null || echo "N/A")
                log_detail "  Keys: $keys"
            fi
        else
            log_error "✗ $secret: Not found"
            all_present=false
        fi
    done

    if [ "$all_present" = true ]; then
        return 0
    else
        return 1
    fi
}

# Check for sync errors
check_sync_errors() {
    log_info "Checking for ExternalSecret sync errors..."

    local has_errors=false

    # Get ExternalSecrets with error conditions
    local error_es=($(kubectl --server="$CLUSTER_ENDPOINT" get externalsecrets -n "$NAMESPACE" -o jsonpath='{.items[?(@.status.conditions[0].type=="SecretSynced" && @.status.conditions[0].status=="False")].metadata.name}' 2>/dev/null || echo ""))

    if [ ${#error_es[@]} -eq 0 ]; then
        log_info "✓ No sync errors found"
        return 0
    else
        log_error "Found ${#error_es[@]} ExternalSecret(s) with sync errors:"
        for es in "${error_es[@]}"; do
            local error_msg=$(kubectl --server="$CLUSTER_ENDPOINT" get externalsecret "$es" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="SecretSynced")].message}')
            log_error "  ✗ $es: $error_msg"
        done
        return 1
    fi
}

# Check OpenBao connectivity (if ClusterSecretStore is used)
check_openbao_store() {
    log_info "Checking OpenBao ClusterSecretStore..."

    # Check if openbao ClusterSecretStore exists
    if kubectl --server="$CLUSTER_ENDPOINT" get clustersecretstore openbao &>/dev/null; then
        log_info "✓ OpenBao ClusterSecretStore found"

        # Show store info if verbose
        if [ "$VERBOSE" = true ]; then
            local endpoint=$(kubectl --server="$CLUSTER_ENDPOINT" get clustersecretstore openbao -o jsonpath='{.spec.provider.vault.server}')
            local path=$(kubectl --server="$CLUSTER_ENDPOINT" get clustersecretstore openbao -o jsonpath='{.spec.provider.vault.path}')
            log_detail "  Endpoint: $endpoint"
            log_detail "  Path: $path"
        fi
        return 0
    else
        log_warn "OpenBao ClusterSecretStore not found (may be using different store)"
        return 0
    fi
}

# Summary
print_summary() {
    local exit_code=$1

    echo ""
    echo "================================================"
    echo "DrawRace ExternalSecrets Verification Summary"
    echo "================================================"

    if [ $exit_code -eq 0 ]; then
        echo "Status: ✅ PASSED"
        echo ""
        echo "All acceptance criteria met:"
        echo "  ✓ All ExternalSecrets are Ready"
        echo "  ✓ Secrets are successfully populated from OpenBao"
        echo "  ✓ No ExternalSecret resources show sync errors"
    else
        echo "Status: ❌ FAILED"
        echo ""
        echo "Some acceptance criteria not met:"
        echo "  ✗ ExternalSecrets may not be Ready"
        echo "  ✗ Secrets may not be populated correctly"
        echo "  ✗ Sync errors may be present"
    fi

    echo "================================================"
}

# Main execution
main() {
    echo "DrawRace ExternalSecrets Verification"
    echo "===================================="
    echo ""

    local exit_code=0

    # Run all checks
    if ! test_connectivity; then
        exit_code=1
    fi

    if ! check_openbao_store; then
        exit_code=1
    fi

    if ! check_externalsecrets; then
        exit_code=1
    fi

    if ! check_secrets; then
        exit_code=1
    fi

    if ! check_sync_errors; then
        exit_code=1
    fi

    print_summary $exit_code
    exit $exit_code
}

main "$@"