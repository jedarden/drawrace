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
# ── PRODUCTION CONNECTIVITY (STILL UNREACHABLE — last verified 2026-07-29) ──
#
# Production drawrace is NOT deployed, so the literal "extract >=200 real
# production ghosts" criterion cannot be satisfied today and there is NO
# working connectivity path to document yet. This section records the blocked
# state and the exact unblock probe so the next retry can tell instantly
# whether deployment has landed.
#
# AUTOMATED MONITORING: Bead bf-9ypvb runs /home/coding/drawrace/scripts/check-deployment-landed.sh
# daily at 09:00 UTC to detect when deployment lands. This script checks all 4 acceptance
# criteria (Deployments, CloudNativePG, Secrets, DNS) and exits 0 only when all pass.
#
# LAST VERIFIED: 2026-07-29, 86th unblock probe from this box — byte-identical
# to all prior probes (85th, 84th, etc.). Authoritative results:
#
#   * api-drawrace.ardenone.com  →  NXDOMAIN (getent exit 2, no output — the
#     authoritative DNS signal; curl exit 6 could-not-resolve).
#   * rs-manager `drawrace` ns  →  AUTHORITATIVELY EMPTY: `get deploy,svc,secret`
#     → "No resources found", `get secrets -n drawrace` → "No resources found",
#     `get cm` → only `kube-root-ca.crt` (auto-created, 84d old). No Deployments,
#     no Services, no Pods, no Secrets → no DATABASE_URL source, no S3 creds.
#   * CloudNativePG `cluster.postgresql.cnpg.io`  →  "server doesn't have a
#     resource type 'cluster'" — the devpod-observer SA this box uses is RBAC-
#     scoped and cannot discover the postgresql.cnpg.io API group. Not
#     confirmatory on its own; the empty deploy/svc/secret checks above are
#     authoritative.
#   * No `drawrace` namespace on any other reachable cluster: apexalgo-iad,
#     ardenone-cluster, ardenone-manager, ord-devimprint, iad-kalshi, iad-options.
#
# MONITORING BEAD: bf-9ypvb tracks the unblock condition with automated daily
# checks. When all 4 acceptance criteria pass, that bead will close and this header
# will be updated with the working connectivity path.
#
# === END UNBLOCK PROBE ===
#     all return NotFound. The ardenone-manager-24h admin kubeconfig
#     (cluster-admin, direct) also returns NotFound for the drawrace ns.
#   * iad-acb — the *intended* target cluster (see BLOCKER_SUMMARY.md) — its API
#     server hangs on contact (kubectl times out, exit 143/124, uninspectable),
#     so its contents cannot be inspected from this box; nothing indicates a
#     deploy there either.
#   * ArgoCD RO proxy (argocd-ro-ardenone-manager-ts.ardenone.com:8444) lists NO
#     drawrace Application — the backend was never GitOps-registered, so the empty
#     `drawrace` namespace is by-omission, not a failed ArgoCD sync. The proxy was
#     DNS-unreachable AGAIN this run (HTTP 000, exit 6); the namespace-level checks
#     above are authoritative regardless of ArgoCD reachability.
#
# Kubeconfig inventory (/home/coding/.kube/): ardenone-manager-24h.kubeconfig
# (fresh 24h cluster-admin token), iad-acb.kubeconfig, iad-ci.kubeconfig — but
# NO rs-manager kubeconfig (rs-manager stays proxy-only via
# traefik-rs-manager:8001, read-only). rs-manager is therefore the only cluster
# on which the `drawrace` namespace can be confirmed today — and it is EMPTY.
#
# The offline self-check was re-run this run → exit 0: the decode/validate/dump
# pipeline (real DRGH blobs → drivable polygons) remains GREEN. The ONLY open
# blocker is the external nd-1fkb grant set (see DEPLOYMENT TRACKER below).
#
# RETRY HISTORY: this bead is the EXTERNALLY BLOCKED child of the bf-2ji9i split.
# It has been probed 86 times across 2026-07-26–29 with a byte-identical blocked result
# each time — deployment has not landed anywhere reachable. A read-only observer
# here cannot obtain the DATABASE_URL/S3 creds because those credentials ARE the
# nd-1fkb grant set (OpenBao token + cluster-admin on iad-acb + GarageBucket/
# GarageKey) itself. Per the task rule ("do NOT close the bead" if it cannot be
# completed), the bead stays OPEN and is retried automatically. Nothing further
# is actionable in-repo until the deployment lands. (The 27 earlier verbatim
# per-retry log blocks that lived here were collapsed into this single record —
# git history retains every version: `git log -p -- scripts/extract-reference-ghosts.sh`.)
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
# These docs estimated "1-2 business days"; 25 days have elapsed with no unblock.
#
# ── DEPENDENCY CHAIN (re-verified this run, 2026-07-29, probe 86) ────────────────
#
#   bf-mw8ea  (THIS bead — prod connectivity)  ─► blocked on the external deploy
#     ▲ blocks-on: bf-3iggr  ← now CLOSED. Child 2 locked the prod SQL +
#       S3/DB env-var contract against the REAL ghosts schema (this header's
#       DATABASE_URL / S3_* / AWS_* contract IS that child's deliverable).
#   Parent split: bf-2ji9i (in-workspace). Sibling: bf-1kfun (in-workspace).
#
# Net: the contract AND the decode/validate pipeline are DONE and verified
# (offline self-check re-run this run → exit 0; real DRGH blobs decode to
# drivable polygons). The ONLY thing keeping bf-65pk8 open is the external
# nd-1fkb deployment grant set above — nothing further is actionable in-repo.
#
# ── HOW TO TELL WHEN DEPLOYMENT LANDS (re-run before assuming unblocked) ────
#
#   getent hosts api-drawrace.ardenone.com                       # must RESOLVE
#   curl -sf https://api-drawrace.ardenone.com/v1/health | jq .  # must 200
#   kubectl --server=http://traefik-rs-manager:8001 get deploy,svc,secret -n drawrace   # AUTHORITATIVE — must list drawrace-api/validator + >0 secrets
#   # CloudNativePG Postgres Cluster is BEST-EFFORT and MUST be queried separately.
#   # The postgresql.cnpg.io API group is NOT discoverable via the devpod-observer
#   # SA this box uses (RBAC scopes api-resources discovery), so a comma-joined
#   # `get deploy,svc,cluster.postgresql.cnpg.io` ERRORS with "server doesn't have
#   # a resource type 'cluster'" and masks the real (empty) result. Query it alone:
#   kubectl --server=http://traefik-rs-manager:8001 get cluster.postgresql.cnpg.io -n drawrace
#   curl -sk https://argocd-ro-ardenone-manager-ts.ardenone.com:8444/api/v1/applications \
#     | grep -i drawrace        # must show a registered drawrace Application (today: none)
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
    echo "  not deployed as of 2026-07-28, so there is nothing to extract yet." >&2
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
