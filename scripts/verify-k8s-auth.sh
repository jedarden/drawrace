#!/usr/bin/env bash
# Verify Kubernetes cluster admin permissions for DrawRace
# Usage: KUBECONFIG=<path> ./scripts/verify-k8s-auth.sh

set -euo pipefail

# Default to iad-acb cluster config if KUBECONFIG not set
KUBECONFIG="${KUBECONFIG:-${HOME}/.kube/iad-acb.kubeconfig}"

if [ ! -f "${KUBECONFIG}" ]; then
  echo "❌ Kubeconfig not found at ${KUBECONFIG}"
  echo "   Usage: KUBECONFIG=<path> $0"
  exit 1
fi

echo "Testing Kubernetes access for DrawRace..."
echo "Using kubeconfig: ${KUBECONFIG}"
echo ""

# Test basic cluster access
echo "1. Testing basic cluster access..."
if ! kubectl --kubeconfig="${KUBECONFIG}" cluster-info >/dev/null 2>&1; then
  echo "❌ Cannot connect to cluster"
  exit 1
fi

CLUSTER_NAME=$(kubectl --kubeconfig="${KUBECONFIG}" config view --minify -o jsonpath='{.clusters[0].name}')
echo "✅ Connected to cluster: ${CLUSTER_NAME}"

# Test current namespace access
echo ""
echo "2. Testing namespace access..."
CURRENT_NS=$(kubectl --kubeconfig="${KUBECONFIG}" config view --minify -o jsonpath='{.contexts[0].context.namespace}' || echo "default")
echo "   Current namespace: ${CURRENT_NS}"

# Test if we can create namespace (admin check)
echo ""
echo "3. Testing namespace creation (admin capability)..."
if kubectl --kubeconfig="${KUBECONFIG}" auth can-i create namespace >/dev/null 2>&1; then
  echo "✅ Can create namespaces (cluster-admin capability)"
else
  echo "⚠️  Cannot create namespaces (may not have full cluster-admin)"
fi

# Test GarageBucket creation in garage-operator namespace
echo ""
echo "4. Testing GarageBucket creation in garage-operator namespace..."
if ! kubectl --kubeconfig="${KUBECONFIG}" get namespace garage-operator >/dev/null 2>&1; then
  echo "⚠️  Namespace 'garage-operator' does not exist - will test in default namespace"
  TEST_NS="default"
else
  TEST_NS="garage-operator"
  echo "   Namespace 'garage-operator' exists"
fi

echo ""
echo "5. Checking GarageBucket resource permissions..."
if kubectl --kubeconfig="${KUBECONFIG}" auth can-i create garagebucket -n "${TEST_NS}" >/dev/null 2>&1; then
  echo "✅ Can create GarageBucket in ${TEST_NS}"
  CAN_CREATE_BUCKET=true
else
  echo "❌ Cannot create GarageBucket in ${TEST_NS}"
  echo "   Required for: Creating S3 buckets via garage-operator"
  CAN_CREATE_BUCKET=false
fi

if kubectl --kubeconfig="${KUBECONFIG}" auth can-i get garagebucket -n "${TEST_NS}" >/dev/null 2>&1; then
  echo "✅ Can get GarageBucket in ${TEST_NS}"
  CAN_GET_BUCKET=true
else
  echo "❌ Cannot get GarageBucket in ${TEST_NS}"
  CAN_GET_BUCKET=false
fi

if kubectl --kubeconfig="${KUBECONFIG}" auth can-i delete garagebucket -n "${TEST_NS}" >/dev/null 2>&1; then
  echo "✅ Can delete GarageBucket in ${TEST_NS}"
  CAN_DELETE_BUCKET=true
else
  echo "❌ Cannot delete GarageBucket in ${TEST_NS}"
  CAN_DELETE_BUCKET=false
fi

echo ""
echo "6. Checking GarageKey resource permissions..."
if kubectl --kubeconfig="${KUBECONFIG}" auth can-i create garagekey -n "${TEST_NS}" >/dev/null 2>&1; then
  echo "✅ Can create GarageKey in ${TEST_NS}"
  CAN_CREATE_KEY=true
else
  echo "❌ Cannot create GarageKey in ${TEST_NS}"
  echo "   Required for: Managing S3 access keys via garage-operator"
  CAN_CREATE_KEY=false
fi

if kubectl --kubeconfig="${KUBECONFIG}" auth can-i get garagekey -n "${TEST_NS}" >/dev/null 2>&1; then
  echo "✅ Can get GarageKey in ${TEST_NS}"
  CAN_GET_KEY=true
else
  echo "❌ Cannot get GarageKey in ${TEST_NS}"
  CAN_GET_KEY=false
fi

if kubectl --kubeconfig="${KUBECONFIG}" auth can-i delete garagekey -n "${TEST_NS}" >/dev/null 2>&1; then
  echo "✅ Can delete GarageKey in ${TEST_NS}"
  CAN_DELETE_KEY=true
else
  echo "❌ Cannot delete GarageKey in ${TEST_NS}"
  CAN_DELETE_KEY=false
fi

# Test creating a DrawRace namespace
echo ""
echo "7. Testing DrawRace namespace creation..."
if kubectl --kubeconfig="${KUBECONFIG}" auth can-i create namespace -n drawrace >/dev/null 2>&1; then
  echo "✅ Can create drawrace namespace"
  CAN_CREATE_NS=true
else
  echo "❌ Cannot create drawrace namespace"
  CAN_CREATE_NS=false
fi

# Summary
echo ""
echo "════════════════════════════════════════════════════════════"
if ${CAN_CREATE_BUCKET} && ${CAN_GET_BUCKET} && ${CAN_DELETE_BUCKET} && \
   ${CAN_CREATE_KEY} && ${CAN_GET_KEY} && ${CAN_DELETE_KEY} && \
   ${CAN_CREATE_NS}; then
  echo "🎉 All Kubernetes permission checks passed!"
  echo ""
  echo "Cluster access verified for:"
  echo "  ✓ Create/get/delete GarageBucket in ${TEST_NS}"
  echo "  ✓ Create/get/delete GarageKey in ${TEST_NS}"
  echo "  ✓ Create drawrace namespace"
  echo ""
  echo "Ready to deploy DrawRace infrastructure."
  exit 0
else
  echo "❌ Some permission checks failed"
  echo ""
  echo "Missing permissions:"
  ${CAN_CREATE_BUCKET} || echo "  ✗ Cannot create GarageBucket"
  ${CAN_GET_BUCKET} || echo "  ✗ Cannot get GarageBucket"
  ${CAN_DELETE_BUCKET} || echo "  ✗ Cannot delete GarageBucket"
  ${CAN_CREATE_KEY} || echo "  ✗ Cannot create GarageKey"
  ${CAN_GET_KEY} || echo "  ✗ Cannot get GarageKey"
  ${CAN_DELETE_KEY} || echo "  ✗ Cannot delete GarageKey"
  ${CAN_CREATE_NS} || echo "  ✗ Cannot create drawrace namespace"
  echo ""
  echo "Contact infrastructure team to grant missing permissions."
  exit 1
fi
