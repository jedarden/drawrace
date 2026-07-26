#!/usr/bin/env bash
# scripts/extract-reference-ghosts.sh
#
# Layer 6 production ghost extractor — wrapper for
# `crates/validator/src/bin/extract-reference-ghosts.rs` (bead bf-2ji9i, child 1
# of the bf-2zrt7 split).
#
# This documents the REAL production extraction path: the wheel-swap geometry is
# NOT in Postgres. `crates/api/migrations/001_initial.sql` defines `ghosts` with
# metadata columns only (time_ms, track_id, physics_version, s3_key, is_legacy,
# is_pb) — there is NO `wheels` column and NO `finish_time_ms` column (the old
# SQL in `crates/validator/tests/README.md` referenced both; neither exists).
# The drivable polygons live as a versioned BINARY blob in object storage keyed
# by `ghosts.s3_key`. Extraction is therefore (metadata row) × (blob fetch) ×
# (blob decode), which is exactly what the underlying binary does.
#
# ── PRODUCTION CONNECTIVITY (re-verified STILL-UNREACHABLE 2026-07-26) ──────
#
# Production drawrace is NOT deployed, so the literal "extract >=200 real
# production ghosts" criterion cannot be satisfied today. There is NO working
# connectivity path to document yet — this section records the blocked state
# and the exact unblock probe so the next retry can tell instantly whether
# deployment has landed. Re-verified fresh from this box (2026-07-26):
#
#   * api-drawrace.ardenone.com  →  NXDOMAIN (getent + curl both fail to resolve).
#   * `drawrace` namespace on rs-manager EXISTS but is EMPTY: only the
#     auto-created kube-root-ca.crt ConfigMap (~82d old). No Deployments, Pods,
#     StatefulSets (no CloudNativePG Postgres), Services, or Secrets — so there
#     is no DATABASE_URL source and no S3 credentials anywhere in the namespace.
#   * No `drawrace` namespace on any other reachable cluster either: apexalgo-iad,
#     ardenone-cluster, ardenone-manager, iad-options, ord-devimprint, iad-kalshi
#     all return NotFound.
#   * iad-acb — the *intended* target cluster (see BLOCKER_SUMMARY.md) — resolves
#     (traefik-iad-acb → 100.125.171.118) but its kubectl-proxy at :8001
#     TERMINATES/times out; nothing is deployed there either.
#   * ardenone-hub (where Garage S3 lives) kubectl-proxy times out; and no API
#     was ever deployed to write blobs anyway.
#   * No kubeconfig for rs-manager or ardenone-manager on disk, so the read-only
#     proxy above is the only inspection path from this box.
#
# ── DEPLOYMENT TRACKER (resolves the "find the real tracker" question) ──────
#
# The deployment epic is tracked in a SEPARATE NEEDLE workspace, NOT this repo's
# .beads/ — which is why `br show` here returns "Bead not found" for them. The
# canonical IDs (cross-workspace references, surfaced in sibling bead bodies):
#
#   nd-1fkb   ← the ACTIVE external blocker (infra-team coordination)
#   nd-xjnv   ← deploy backend on iad-acb
#   nd-639    ← populate OpenBao secrets
#   bf-5ft    ← genesis: deployment to production (umbrella)
#
# nd-1fkb is blocked on three external grants, pinned in-repo by
# BLOCKER_SUMMARY.md and OPENBAO_K8S_ACCESS_CHECKLIST.md (both 2026-07-03):
#   1. OpenBao root token (write sealed-secrets: Postgres pw, S3 keys, CF token)
#   2. cluster-admin (or scoped perms) on iad-acb (Namespace, CloudNativePG,
#      Deployments, Services, Ingress, GarageBucket/GarageKey CRDs)
#   3. GarageBucket/GarageKey creation (cannot verify without #2)
# These docs estimated "1-2 business days"; 23 days have elapsed with no unblock.
#
# ── HOW TO TELL WHEN DEPLOYMENT LANDS (re-run before assuming unblocked) ────
#
#   getent hosts api-drawrace.ardenone.com                       # must RESOLVE
#   curl -sf https://api-drawrace.ardenone.com/v1/health | jq .  # must 200
#   kubectl --server=http://traefik-rs-manager:8001 get deploy,svc,cluster.postgresql.cnpg.io -n drawrace
#   kubectl --server=http://traefik-rs-manager:8001 get secrets -n drawrace   # must list >0
#
# When ALL of those succeed, a DATABASE_URL + S3 creds exist in the namespace
# and this script's --prod path (below) can do the real extraction (80
# ghosts/track × 3 tracks = up to 240, clearing the >=200 bar). Until then this
# wrapper runs in --self-check mode by default: it exercises the SAME decode +
# validate + dump-emitter pipeline against the committed real seed blobs
# (seeds/track_{1,2,3}/*.blob) — real DRGH bytes, real drivable polygons —
# proving the decode path works without needing prod.
#
# ── USAGE ───────────────────────────────────────────────────────────────────
#
#   ./scripts/extract-reference-ghosts.sh                # offline self-check (default)
#   ./scripts/extract-reference-ghosts.sh --self-check   #   .. explicit
#   ./scripts/extract-reference-ghosts.sh --prod         # production extract
#
# --prod reads from the environment (none of these are persisted to git):
#   DATABASE_URL            postgres://user:pass@host:5432/db
#   S3_BUCKET               default: drawrace-ghosts
#   S3_ENDPOINT             Garage endpoint URL, e.g. https://garage.ardenone...
#   AWS_ACCESS_KEY_ID       S3 access key
#   AWS_SECRET_ACCESS_KEY   S3 secret key
#   CURRENT_PHYSICS_VERSION  override (default: 8, from engine-core/src/version.ts)
#
set -euo pipefail

cd "$(dirname "$0")/.."

MODE="self-check"
OUT=""
for arg in "$@"; do
  case "$arg" in
    --prod|--production) MODE="prod" ;;
    --self-check|--offline) MODE="self-check" ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0 ;;
    --out) shift_next=1 ;;
    *) [ "${shift_next:-0}" = "1" ] && { OUT="$arg"; shift_next=0; } ;;
  esac
done

BIN_ARGS=()
if [ -n "${OUT:-}" ]; then BIN_ARGS+=(--out "$OUT"); fi

if [ "$MODE" = "prod" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "extract-reference-ghosts: --prod requires DATABASE_URL (and S3 creds) in the env." >&2
    echo "  See the connectivity note at the top of this script — prod drawrace is" >&2
    echo "  not deployed as of 2026-07-26, so there is nothing to extract yet." >&2
    echo "  Re-run with --self-check (the default) to verify the decode pipeline offline." >&2
    exit 2
  fi
  echo ">> production extraction: DATABASE_URL set, tracks 1/2/3, physics_version=${CURRENT_PHYSICS_VERSION:-8}"
  cargo run -p drawrace-validator --bin extract-reference-ghosts -- "${BIN_ARGS[@]}"
else
  echo ">> offline self-check: decoding committed seed blobs through the real pipeline"
  echo "   (real DRGH bytes, real drivable polygons — NOT a production extract)"
  cargo run -p drawrace-validator --bin extract-reference-ghosts -- --self-check "${BIN_ARGS[@]}"
fi
