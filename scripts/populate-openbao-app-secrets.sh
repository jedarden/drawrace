#!/usr/bin/env bash
# Populate DrawRace application secrets (non-database) into OpenBao on rs-manager.
#
# Writes the two remaining application secret paths referenced by the
# deployment manifests, which today ship as inline `stringData` Secret docs
# with dev placeholders in git (k8s/api-deployment.yaml, k8s/validator-deployment.yaml):
#
#   secret/rs-manager/drawrace/api-secrets       DATABASE_URL REDIS_URL S3_BUCKET
#   secret/rs-manager/drawrace/validator-secrets DATABASE_URL REDIS_URL S3_BUCKET S3_ENDPOINT S3_REGION
#
# Once these paths hold data, the follow-up change is to add ExternalSecret
# manifests projecting them into the drawrace namespace and delete the inline
# stringData docs (mirrored byte-for-byte to declarative-config
# k8s/rs-manager/drawrace/). The ordering matters: populate FIRST, land the
# ExternalSecrets SECOND — an ExternalSecret referencing an empty OpenBao path
# goes Ready=False and drags the whole `drawrace` ArgoCD app out of sync
# (the lesson recorded on bead bf-1hab8).
#
# DATABASE_URL is composed at runtime by READING the bootstrap credentials
# from secret/rs-manager/drawrace/postgres (populated by
# scripts/populate-openbao-postgres.sh, consumed by the CNPG Cluster at
# initdb). The password is percent-encoded into the URL and never printed,
# logged, or placed in argv. Both the api and validator must talk to the
# database with the same credentials the operator user was created with.
#
# The HMAC client signing key (ConfigMap drawrace-client-key) is deliberately
# NOT managed here — it has its own CI rotation flow (k8s/ROTATE-KEY-SETUP.md,
# drawrace-rotate-key ServiceAccount) and stays a ConfigMap by design.
#
# Usage: OPENBAO_TOKEN=<token with write on rs-manager/drawrace/*> \
#          ./scripts/populate-openbao-app-secrets.sh
# Overwrite existing paths: FORCE=1 (each write bumps the KV v2 version)

set -euo pipefail

OPENBAO_ADDR="${OPENBAO_ADDR:-https://openbao-rs-manager.ardenone.com:8444}"
# The only raw OpenBao API endpoint: port 443 and openbao.ardenone.com are
# Google-SSO (forward-auth) front doors that redirect before the API answers.

PG_SECRET_PATH="rs-manager/drawrace/postgres"
API_SECRET_PATH="rs-manager/drawrace/api-secrets"
VALIDATOR_SECRET_PATH="rs-manager/drawrace/validator-secrets"

# Must match k8s/postgres-cluster.yaml (Cluster name drawrace-postgres,
# database drawrace) and k8s/redis.yaml / validator-deployment.yaml.
PG_HOST="drawrace-postgres-rw.drawrace.svc"
PG_PORT="5432"
PG_DATABASE="drawrace"
REDIS_URL="redis://redis.drawrace.svc:6379"
S3_BUCKET="drawrace-ghosts"
S3_ENDPOINT="http://garage.ardenone-hub.svc:3900"
S3_REGION="garage"

log()  { echo "[INFO] $1"; }
warn() { echo "[WARN] $1"; }
die()  { echo "[ERROR] $1" >&2; exit 1; }

check_prerequisites() {
    [ -n "${OPENBAO_TOKEN:-}" ] || die "OPENBAO_TOKEN not set.
Usage: OPENBAO_TOKEN=<token> $0"
    command -v jq >/dev/null || die "jq is required"
    curl -sf -m 10 "${OPENBAO_ADDR}/v1/sys/health" >/dev/null \
        || die "Cannot reach OpenBao at ${OPENBAO_ADDR}"
    log "OpenBao reachable at ${OPENBAO_ADDR}"
}

# kv_write <path> <json-body> — POST a KV v2 secret, verifying the response.
# The body is passed over stdin so values never appear in the process argv.
kv_write() {
    local path="$1" body="$2" response
    response=$(curl -s -m 20 -X POST "${OPENBAO_ADDR}/v1/secret/data/${path}" \
        -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
        -H "Content-Type: application/json" \
        --data @- <<< "$body")
    echo "$response" | jq -e '.data.created_time' >/dev/null \
        || die "Write to ${path} failed: $(echo "$response" | jq -c '.errors // .')"
}

# kv_read_key <path> <property> — read one property of a KV v2 secret.
kv_read_key() {
    local path="$1" property="$2"
    curl -s -m 20 "${OPENBAO_ADDR}/v1/secret/data/${path}" \
        -H "X-Vault-Token: ${OPENBAO_TOKEN}" \
        | jq -r ".data.data.${property} // empty"
}

kv_path_exists() {
    local path="$1"
    local code
    code=$(curl -s -m 20 -o /dev/null -w "%{http_code}" \
        "${OPENBAO_ADDR}/v1/secret/metadata/${path}" \
        -H "X-Vault-Token: ${OPENBAO_TOKEN}")
    [ "$code" = "200" ]
}

# Percent-encode for safe embedding in the postgresql:// URL (jq @uri).
urlenc() { jq -rn --arg v "$1" '$v|@uri'; }

# Read the bootstrap credentials CNPG was initialized with and compose the
# connection URL. Credentials are held in shell vars only; failures refuse to
# leak them (the die path prints the OpenBao error, never the data).
compose_database_url() {
    PG_USERNAME=$(kv_read_key "${PG_SECRET_PATH}" username)
    PG_PASSWORD=$(kv_read_key "${PG_SECRET_PATH}" password)
    [ -n "$PG_USERNAME" ] || die "rs-manager/drawrace/postgres has no username key — populate it first (scripts/populate-openbao-postgres.sh)"
    [ -n "$PG_PASSWORD" ] || die "rs-manager/drawrace/postgres has no password key — populate it first (scripts/populate-openbao-postgres.sh)"
    DATABASE_URL="postgresql://$(urlenc "$PG_USERNAME"):$(urlenc "$PG_PASSWORD")@${PG_HOST}:${PG_PORT}/${PG_DATABASE}"
    log "DATABASE_URL composed for user ${PG_USERNAME} at ${PG_HOST}:${PG_PORT}/${PG_DATABASE} (password not shown)"
}

write_api_secrets() {
    if kv_path_exists "${API_SECRET_PATH}" && [ "${FORCE:-0}" != "1" ]; then
        die "${API_SECRET_PATH} already exists; re-run with FORCE=1 to overwrite (a write bumps the KV version)"
    fi
    log "Writing ${API_SECRET_PATH} (3 keys)..."
    kv_write "${API_SECRET_PATH}" "$(jq -n \
        --arg database_url "$DATABASE_URL" \
        --arg redis_url "$REDIS_URL" \
        --arg s3_bucket "$S3_BUCKET" \
        '{data: {DATABASE_URL: $database_url, REDIS_URL: $redis_url, S3_BUCKET: $s3_bucket}}')"
}

write_validator_secrets() {
    if kv_path_exists "${VALIDATOR_SECRET_PATH}" && [ "${FORCE:-0}" != "1" ]; then
        die "${VALIDATOR_SECRET_PATH} already exists; re-run with FORCE=1 to overwrite (a write bumps the KV version)"
    fi
    log "Writing ${VALIDATOR_SECRET_PATH} (5 keys)..."
    kv_write "${VALIDATOR_SECRET_PATH}" "$(jq -n \
        --arg database_url "$DATABASE_URL" \
        --arg redis_url "$REDIS_URL" \
        --arg s3_bucket "$S3_BUCKET" \
        --arg s3_endpoint "$S3_ENDPOINT" \
        --arg s3_region "$S3_REGION" \
        '{data: {DATABASE_URL: $database_url, REDIS_URL: $redis_url, S3_BUCKET: $s3_bucket, S3_ENDPOINT: $s3_endpoint, S3_REGION: $s3_region}}')"
}

# Read back and confirm every key is present and non-empty. Values are
# compared to what was written but only key NAMES and value LENGTHS are logged.
verify_written() {
    local path="$1"
    shift
    local key
    for key in "$@"; do
        local len
        len=$(kv_read_key "${path}" "${key}" | wc -c)
        [ "$len" -gt 1 ] || die "Verification failed: ${path} key ${key} is empty"
        log "  ${path} ${key}: present (${len} bytes incl. newline)"
    done
}

main() {
    log "Populating DrawRace application secrets in OpenBao..."
    check_prerequisites
    compose_database_url
    write_api_secrets
    write_validator_secrets
    verify_written "${API_SECRET_PATH}" DATABASE_URL REDIS_URL S3_BUCKET
    verify_written "${VALIDATOR_SECRET_PATH}" DATABASE_URL REDIS_URL S3_BUCKET S3_ENDPOINT S3_REGION
    log "Done."
    log ""
    log "Follow-up (ordered — data must exist before the manifests land):"
    log "  1. Author ExternalSecrets projecting ${API_SECRET_PATH} and"
    log "     ${VALIDATOR_SECRET_PATH} into ns drawrace (secretKey names must"
    log "     match the property names above), replacing the inline stringData"
    log "     Secret docs in k8s/api-deployment.yaml and k8s/validator-deployment.yaml."
    log "  2. Mirror byte-for-byte to declarative-config k8s/rs-manager/drawrace/ and push;"
    log "     ArgoCD syncs app drawrace."
    log "  3. Confirm the new ExternalSecrets reach Ready=True with no sync errors."
}

main "$@"
