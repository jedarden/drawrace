#!/usr/bin/env bash
# Verification script for Kubernetes cluster admin permissions on rs-manager
# Tests ability to create GarageBucket and GarageKey resources in garage-operator namespace

set -euo pipefail

# Configuration
CLUSTER_NAME="rs-manager"
NAMESPACE="garage-operator"

echo "🔍 Testing Kubernetes cluster access..."
echo "   Cluster: $CLUSTER_NAME"
echo "   Namespace: $NAMESPACE"
echo ""

# Check kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found in PATH"
    exit 1
fi

# Test 1: Check current context
echo "Test 1: Checking kubectl context..."
CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "")
if [ -z "$CURRENT_CONTEXT" ]; then
    echo "❌ No kubectl context is currently set"
    echo "   Please select a context for $CLUSTER_NAME cluster:"
    echo "   kubectl config use-context <context-name>"
    echo ""
    echo "   Available contexts:"
    kubectl config get-contexts -o name
    exit 1
else
    echo "✅ Current context: $CURRENT_CONTEXT"
fi

# Test 2: Check cluster connectivity
echo ""
echo "Test 2: Testing cluster connectivity..."
if kubectl cluster-info >/dev/null 2>&1; then
    echo "✅ Successfully connected to cluster"
    kubectl cluster-info | head -1
else
    echo "❌ Cannot connect to cluster"
    exit 1
fi

# Test 3: Check namespace exists
echo ""
echo "Test 3: Checking namespace $NAMESPACE exists..."
if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "✅ Namespace $NAMESPACE exists"
else
    echo "⚠️  Namespace $NAMESPACE does not exist"
    echo "   Attempting to create it..."
    if kubectl create namespace "$NAMESPACE" 2>/dev/null; then
        echo "✅ Created namespace $NAMESPACE"
    else
        echo "❌ Failed to create namespace - check permissions"
        exit 1
    fi
fi

# Test 4: Check auth for GarageBucket (can-i create)
echo ""
echo "Test 4: Checking GarageBucket creation permissions..."
if kubectl auth can-i create garagebucket -n "$NAMESPACE" >/dev/null 2>&1; then
    echo "✅ Can create GarageBucket resources"
    CAN_CREATE_BUCKET=true
else
    echo "❌ Cannot create GarageBucket resources"
    CAN_CREATE_BUCKET=false
fi

# Test 5: Check auth for GarageKey (can-i create)
echo ""
echo "Test 5: Checking GarageKey creation permissions..."
if kubectl auth can-i create garagekey -n "$NAMESPACE" >/dev/null 2>&1; then
    echo "✅ Can create GarageKey resources"
    CAN_CREATE_KEY=true
else
    echo "❌ Cannot create GarageKey resources"
    CAN_CREATE_KEY=false
fi

# Test 6: Check admin-level permissions (list all namespaces, etc.)
echo ""
echo "Test 6: Checking cluster admin permissions..."
if kubectl auth can-i list namespaces --all-namespaces >/dev/null 2>&1; then
    echo "✅ Has cluster-level list permissions"
    HAS_CLUSTER_ADMIN=true
else
    echo "⚠️  Limited to namespace-scoped permissions"
    HAS_CLUSTER_ADMIN=false
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Cluster:           $CLUSTER_NAME"
echo "Namespace:         $NAMESPACE"
echo "Create GarageBucket:  $CAN_CREATE_BUCKET"
echo "Create GarageKey:     $CAN_CREATE_KEY"
echo "Cluster Admin:        $HAS_CLUSTER_ADMIN"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$CAN_CREATE_BUCKET" = true ] && [ "$CAN_CREATE_KEY" = true ]; then
    echo ""
    echo "🎉 All required permissions verified!"
    echo ""
    echo "Next steps:"
    echo "1. Apply k8s manifests: kubectl apply -f k8s/rs-manager/drawrace/"
    echo "2. Check pod status: kubectl get pods -n drawrace"
    exit 0
else
    echo ""
    echo "❌ Required permissions missing!"
    echo ""
    echo "Missing permissions:"
    [ "$CAN_CREATE_BUCKET" = false ] && echo "  - create garagebucket"
    [ "$CAN_CREATE_KEY" = false ] && echo "  - create garagekey"
    echo ""
    echo "To grant permissions, the infrastructure team should:"
    echo "1. Create a ClusterRole with garagebucket/garagekey create permissions"
    echo "2. Create a ClusterRoleBinding to bind it to your user"
    echo ""
    echo "Example ClusterRole:"
    cat <<'EOF'
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: drawrace-garage-admin
rules:
- apiGroups: ["garage-operator.dowel.ai"]
  resources: ["garagebuckets", "garagekeys"]
  verbs: ["get", "list", "create", "update", "delete"]
EOF
    exit 1
fi
