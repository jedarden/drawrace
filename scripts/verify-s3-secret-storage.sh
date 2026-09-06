#!/bin/bash
set -euo pipefail

# Verify the Garage S3 secretAccessKey storage chain end-to-end (bead nd-9gi8).
#
# 1. OpenBao holds the credential (populated by scripts/populate-openbao-s3.sh)
# 2. The ExternalSecrets in k8s/external-secrets-s3.yaml report SecretSynced
# 3. The synced Secrets carry the required keys, non-empty
# 4. RBAC in k8s/s3-credentials-rbac.yaml restricts reads to the two workload
#    ServiceAccounts
#
# Secret values are never printed — only presence and length.
#
# Usage:   bash scripts/verify-s3-secret-storage.sh
# Exit:    0 all checks pass, 1 any check fails

KUBECTL="${KUBECTL:-kubectl --server=http://traefik-rs-manager:8001}"
NAMESPACE="drawrace"
API_SECRET="drawrace-api-s3-credentials"
BACKUP_SECRET="drawrace-postgres-backup-s3"

PASS=0
FAIL=0

check() {
    local label="$1" ok="$2"
    if [ "$ok" = "true" ]; then
        echo "✅ PASS: $label"
        PASS=$((PASS + 1))
    else
        echo "❌ FAIL: $label"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== Garage S3 secretAccessKey storage verification ==="
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "Cluster: rs-manager (read-only proxy)"
echo ""

# --- 1. ExternalSecret Ready conditions -------------------------------------
for ES in "$API_SECRET" "$BACKUP_SECRET"; do
    ready=$($KUBECTL get externalsecret "$ES" -n "$NAMESPACE" \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "")
    reason=$($KUBECTL get externalsecret "$ES" -n "$NAMESPACE" \
        -o jsonpath='{.status.conditions[?(@.type=="Ready")].reason}' 2>/dev/null || echo "")
    check "ExternalSecret $ES is Ready (got status='$ready' reason='$reason')" \
        "$([ "$ready" = "True" ] && [ "$reason" = "SecretSynced" ] && echo true || echo false)"
done
echo ""

# --- 2. Synced Secrets carry the required keys -------------------------------
# Keys are checked for presence and non-emptiness only; values are not read
# into a printable variable. The kubectl stage is `|| true`-guarded so
# pipefail doesn't double-emit a zero when the Secret is absent.
key_len() {
    local secret="$1" key="$2" raw
    raw=$( { $KUBECTL get secret "$secret" -n "$NAMESPACE" \
        -o "jsonpath={.data.$key}" 2>/dev/null || true; } \
        | base64 -d 2>/dev/null | wc -c | tr -d '[:space:]')
    echo "${raw:-0}"
}
for KEY in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT_URL AWS_REGION; do
    len=$(key_len "$API_SECRET" "$KEY")
    check "Secret $API_SECRET has non-empty $KEY ($len bytes)" \
        "$([ "$len" -gt 0 ] 2>/dev/null && echo true || echo false)"
done
for KEY in accessKeyId secretAccessKey; do
    len=$(key_len "$BACKUP_SECRET" "$KEY")
    check "Secret $BACKUP_SECRET has non-empty $KEY ($len bytes)" \
        "$([ "$len" -gt 0 ] 2>/dev/null && echo true || echo false)"
done
echo ""

# --- 3. RBAC restriction ------------------------------------------------------
# The reader Role must name exactly the two credential secrets and grant get only.
rules=$($KUBECTL get role drawrace-s3-credentials-reader -n "$NAMESPACE" \
    -o jsonpath='{.rules[0].resourceNames}' 2>/dev/null || echo "")
verbs=$($KUBECTL get role drawrace-s3-credentials-reader -n "$NAMESPACE" \
    -o jsonpath='{.rules[0].verbs}' 2>/dev/null || echo "")
check "Role restricts reads to the two S3 credential secrets (resourceNames: $rules)" \
    "$(echo "$rules" | grep -q "$API_SECRET" && echo "$rules" | grep -q "$BACKUP_SECRET" && echo true || echo false)"
check "Role grants get only (verbs: $verbs)" \
    "$([ "$verbs" = '["get"]' ] && echo true || echo false)"

for BINDING in drawrace-api-s3-credentials-reader drawrace-validator-s3-credentials-reader; do
    subjects=$($KUBECTL get rolebinding "$BINDING" -n "$NAMESPACE" \
        -o jsonpath='{.subjects[0].name}' 2>/dev/null || echo "")
    check "RoleBinding $BINDING bound (subject: $subjects)" \
        "$([ -n "$subjects" ] && echo true || echo false)"
done

# The workloads must actually run as the restricted identities.
for DEP in drawrace-api drawrace-validator; do
    sa=$($KUBECTL get deployment "$DEP" -n "$NAMESPACE" \
        -o jsonpath='{.spec.template.spec.serviceAccountName}' 2>/dev/null || echo "")
    check "Deployment $DEP runs as dedicated ServiceAccount (got '$sa')" \
        "$([ "$sa" = "$DEP" ] && echo true || echo false)"
done

echo ""
echo "=== Summary: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
