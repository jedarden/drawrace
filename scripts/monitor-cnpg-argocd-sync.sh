#!/bin/bash
# CloudNativePG ArgoCD Sync Monitoring Script
# This script monitors the ArgoCD sync status for CloudNativePG operator on rs-manager cluster

set -euo pipefail

# Configuration
APP_NAME="cnpg-rs-manager"
APP_NAMESPACE="argocd"
TARGET_NAMESPACE="cnpg-system"
CLUSTER_NAME="rs-manager"
KUBECONFIG="${KUBECONFIG:-/home/coding/.kube/rs-manager.kubeconfig}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if kubectl is available
check_kubectl() {
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl is not installed or not in PATH"
        exit 1
    fi
    log_success "kubectl is available"
}

# Check cluster connectivity
check_cluster_connectivity() {
    log_info "Checking cluster connectivity to ${CLUSTER_NAME}..."

    if kubectl --kubeconfig="${KUBECONFIG}" cluster-info &> /dev/null; then
        log_success "Connected to ${CLUSTER_NAME} cluster"
        return 0
    else
        log_error "Cannot connect to ${CLUSTER_NAME} cluster"
        log_error "Please verify kubeconfig path: ${KUBECONFIG}"
        exit 1
    fi
}

# Check ArgoCD Application status
check_application_status() {
    log_info "Checking ArgoCD Application: ${APP_NAME}..."

    # Get application status
    local app_output
    app_output=$(kubectl --kubeconfig="${KUBECONFIG}" get application "${APP_NAME}" -n "${APP_NAMESPACE}" -o json 2>&1) || {
        log_error "Failed to get application ${APP_NAME}"
        log_error "Error: ${app_output}"
        return 1
    }

    # Parse health status
    local health_status
    health_status=$(echo "${app_output}" | jq -r '.status.health.status // "Unknown"')

    # Parse sync status
    local sync_status
    sync_status=$(echo "${app_output}" | jq -r '.status.sync.status // "Unknown"')

    # Parse operation state (if any operation is in progress)
    local operation_state
    operation_state=$(echo "${app_output}" | jq -r '.status.operationState.phase // "Succeeded"')

    # Display results
    echo ""
    log_info "Application Status:"
    echo "  Health Status: ${health_status}"
    echo "  Sync Status: ${sync_status}"
    echo "  Operation State: ${operation_state}"

    # Check for errors
    local sync_errors
    sync_errors=$(echo "${app_output}" | jq -r '.status.sync.result[]? | select(.status == "Failed") | .syncAttempts | length')

    if [[ "${sync_errors}" -gt 0 ]]; then
        log_warning "Sync errors detected: ${sync_errors}"
        echo "${app_output}" | jq -r '.status.sync.result[]? | select(.status == "Failed")'
    else
        log_success "No sync errors detected"
    fi

    # Overall health check
    if [[ "${health_status}" == "Healthy" ]] && [[ "${sync_status}" == "Synced" ]]; then
        log_success "Application is healthy and synced"
        return 0
    else
        log_warning "Application status needs attention"
        return 1
    fi
}

# Check namespace creation
check_namespace() {
    log_info "Checking namespace: ${TARGET_NAMESPACE}..."

    if kubectl --kubeconfig="${KUBECONFIG}" get namespace "${TARGET_NAMESPACE}" &> /dev/null; then
        log_success "Namespace ${TARGET_NAMESPACE} exists"

        # Check namespace labels
        local labels
        labels=$(kubectl --kubeconfig="${KUBECONFIG}" get namespace "${TARGET_NAMESPACE}" -o json | jq -r '.metadata.labels')

        echo "  Namespace Labels: ${labels}"
        return 0
    else
        log_warning "Namespace ${TARGET_NAMESPACE} does not exist yet"
        return 1
    fi
}

# Check CloudNativePG operator deployment
check_operator_deployment() {
    log_info "Checking CloudNativePG operator deployment..."

    local deployments
    deployments=$(kubectl --kubeconfig="${KUBECONFIG}" get deployment -n "${TARGET_NAMESPACE}" -o json 2>&1) || {
        log_warning "No deployments found in ${TARGET_NAMESPACE}"
        return 1
    }

    local deployment_count
    deployment_count=$(echo "${deployments}" | jq -r '.items | length')

    if [[ "${deployment_count}" -gt 0 ]]; then
        log_success "Found ${deployment_count} deployment(s) in ${TARGET_NAMESPACE}"

        echo "${deployments}" | jq -r '.items[] | "  - \(.metadata.name) (\(.status.readyReplicas // 0)/\(.status.replicas)) replicas ready"'

        # Check if all deployments are ready
        local ready_count
        ready_count=$(echo "${deployments}" | jq -r '[.items[] | select(.status.readyReplicas == .status.replicas)] | length')

        if [[ "${ready_count}" -eq "${deployment_count}" ]]; then
            log_success "All deployments are ready"
            return 0
        else
            log_warning "Some deployments are not ready yet"
            return 1
        fi
    else
        log_warning "No CloudNativePG operator deployment found"
        return 1
    fi
}

# Check CloudNativePG CRDs
check_crds() {
    log_info "Checking CloudNativePG CRDs..."

    local expected_crds=(
        "clusters.postgres.cnpg.io"
        "poolers.postgres.cnpg.io"
        "imagecatalogs.postgres.cnpg.io"
        "backups.postgres.cnpg.io"
        "scheduledbackups.postgres.cnpg.io"
        "connections.postgres.cnpg.io"
    )

    local found_count=0
    local total_count=${#expected_crds[@]}

    for crd in "${expected_crds[@]}"; do
        if kubectl --kubeconfig="${KUBECONFIG}" get crd "${crd}" &> /dev/null; then
            ((found_count++))
            echo "  ✅ ${crd}"
        else
            echo "  ❌ ${crd} (not found)"
        fi
    done

    if [[ "${found_count}" -eq "${total_count}" ]]; then
        log_success "All ${total_count} CloudNativePG CRDs are installed"
        return 0
    else
        log_warning "Found ${found_count}/${total_count} CloudNativePG CRDs"
        return 1
    fi
}

# Get ArgoCD application events
get_app_events() {
    log_info "Recent ArgoCD Application events:"

    kubectl --kubeconfig="${KUBECONFIG}" get application "${APP_NAME}" -n "${APP_NAMESPACE}" -o json | \
        jq -r '.status.operationState | if . then "  Operation: \(.operation)\n  Started: \(.startedAt)\n  Finished: \(.finishedAt)\n  Phase: \(.phase)\n  Message: \(.message)" else "  No recent operations" end'
}

# Main monitoring function
main() {
    echo "=================================="
    echo "CloudNativePG ArgoCD Sync Monitor"
    echo "Cluster: ${CLUSTER_NAME}"
    echo "Application: ${APP_NAME}"
    echo "=================================="
    echo ""

    # Pre-flight checks
    check_kubectl
    check_cluster_connectivity

    echo ""

    # Main checks
    local app_healthy=0
    local namespace_exists=0
    local operator_deployed=0
    local crds_installed=0

    if check_application_status; then
        app_healthy=1
    fi

    echo ""

    if check_namespace; then
        namespace_exists=1
    fi

    echo ""

    if [[ "${namespace_exists}" -eq 1 ]]; then
        if check_operator_deployment; then
            operator_deployed=1
        fi

        echo ""

        if check_crds; then
            crds_installed=1
        fi
    fi

    echo ""
    get_app_events
    echo ""

    # Final summary
    echo "=================================="
    echo "Summary:"
    echo "=================================="

    local all_success=1

    if [[ "${app_healthy}" -eq 1 ]]; then
        log_success "ArgoCD Application: Healthy"
    else
        log_error "ArgoCD Application: Needs attention"
        all_success=0
    fi

    if [[ "${namespace_exists}" -eq 1 ]]; then
        log_success "Namespace: Created"
    else
        log_warning "Namespace: Not found (will be created by ArgoCD)"
    fi

    if [[ "${operator_deployed}" -eq 1 ]]; then
        log_success "Operator Deployment: Ready"
    else
        log_warning "Operator Deployment: Not ready"
    fi

    if [[ "${crds_installed}" -eq 1 ]]; then
        log_success "CloudNativePG CRDs: All installed"
    else
        log_warning "CloudNativePG CRDs: Missing some CRDs"
    fi

    echo "=================================="

    if [[ "${all_success}" -eq 1 ]]; then
        log_success "CloudNativePG operator is fully operational"
        exit 0
    else
        log_warning "CloudNativePG operator deployment has issues that need attention"
        exit 1
    fi
}

# Run main function
main "$@"