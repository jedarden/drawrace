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
# [bf-65pk8 retry, 2026-07-26: full unblock-probe checklist re-run from this
#  box — api-drawrace.ardenone.com NXDOMAIN (getent+curl), rs-manager `drawrace`
#  ns still `No resources found` for deploy/svc/secret, all 6 other reachable
#  clusters NotFound, iad-acb proxy times out, ArgoCD RO proxy still shows no
#  drawrace Application. Byte-identical to every prior run; deployment still not
#  landed. Bead stays OPEN — externally blocked on nd-1fkb; nothing actionable
#  in-repo. Read-only observer here cannot obtain DATABASE_URL/S3 creds, which
#  ARE the nd-1fkb grant set themselves.]
#
# [bf-65pk8 retry #2, 2026-07-26: full unblock-probe checklist re-run AGAIN from
#  this box — byte-identical to acc18de. api-drawrace.ardenone.com NXDOMAIN
#  (getent+curl), rs-manager `drawrace` ns still `No resources found` for
#  deploy/svc/secret (only kube-root-ca.crt, now 82d), CloudNativePG `cluster`
#  still RBAC-discovery-limited, all 6 other reachable clusters NotFound, ArgoCD
#  RO proxy still empty body (no drawrace Application), ardenone-manager-24h
#  admin kubeconfig exercised — still no drawrace ns, iad-acb proxy still
#  times out. Kubeconfig inventory unchanged (ardenone-manager-24h + iad-acb +
#  iad-ci; no rs-manager kc). Offline self-check re-run AGAIN → exit 0. Nothing
#  changed since the prior run today; deployment STILL not landed. Bead stays
#  OPEN — externally blocked on nd-1fkb; the grant set (OpenBao token +
#  cluster-admin on iad-acb + GarageBucket/Key) is itself the missing
#  DATABASE_URL/S3 source, which a read-only observer cannot create.]
#
# [bf-65pk8 retry #3, 2026-07-26: full unblock-probe checklist re-run AGAIN from
#  this box — third pass today, byte-identical to retry #2. Confirmed this run:
#  api-drawrace.ardenone.com NXDOMAIN (getent NXDOMAIN; curl exit 6 could-not-
#  resolve; dig +short empty); rs-manager `drawrace` ns `No resources found`
#  for deploy/svc/secret and only `kube-root-ca.crt` cm (still 82d old);
#  CloudNativePG `cluster` still "server doesn't have a resource type" (observer
#  SA RBAC-discovery-limited); `drawrace` ns NotFound on all 6 other reachable
#  clusters (apexalgo-iad/ardenone-cluster/ardenone-manager/ord-devimprint/
#  iad-kalshi/iad-options); ArgoCD RO proxy still no drawrace Application
#  (empty body); offline self-check re-run → exit 0. The decode/validate
#  pipeline stays green; the ONLY open blocker is still the external nd-1fkb
#  grant set. Nothing actionable in-repo; acceptance criteria (Deployments +
#  CloudNativePG Postgres + Secrets present, or a reachable DATABASE_URL/S3
#  cred) remain unmet, so the bead stays OPEN — per task rule, NOT closed.]
#
# [bf-65pk8 retry #4, 2026-07-26: full unblock-probe checklist re-run AGAIN from
#  this box — byte-identical to retry #3. Confirmed this run:
#  api-drawrace.ardenone.com still NXDOMAIN (curl exit 6 could-not-resolve);
#  rs-manager `drawrace` ns still `No resources found` for deploy/svc/secret with
#  only `kube-root-ca.crt` (still 82d old); cnpg `cluster` still "server doesn't
#  have a resource type"; `drawrace` ns NotFound on all 6 other reachable clusters
#  (apexalgo-iad/ardenone-cluster/ardenone-manager/ord-devimprint/iad-kalshi/
#  iad-options); iad-acb proxy still times out (>12s); ArgoCD RO proxy still
#  shows no drawrace Application; ardenone-manager-24h admin kc still returns
#  NotFound for the drawrace ns; kubeconfig inventory unchanged
#  (ardenone-manager-24h + iad-acb + iad-ci; still no rs-manager kc); offline
#  self-check re-run → exit 0. Deployment STILL not landed anywhere reachable;
#  ALL acceptance criteria still unmet. Bead stays OPEN — externally blocked on
#  nd-1fkb (the grant set IS the missing DATABASE_URL/S3 source, which a
#  read-only observer here cannot create); per task rule, NOT closed.]
#
# [bf-65pk8 retry #5, 2026-07-26: full unblock-probe checklist re-run AGAIN from
#  this box — byte-identical to retry #4. Confirmed this run:
#  api-drawrace.ardenone.com NXDOMAIN (getent exit 2; curl exit 6
#  could-not-resolve); rs-manager `drawrace` ns `No resources found` for
#  deploy/svc/secret and only `kube-root-ca.crt` cm (still 82d old); cnpg
#  `cluster` still "server doesn't have a resource type" (observer SA
#  RBAC-discovery-limited); ArgoCD RO proxy still no drawrace Application
#  (empty body / no match); offline self-check re-run → exit 0. Deployment
#  STILL not landed anywhere reachable; ALL acceptance criteria still unmet
#  (no Deployments + CloudNativePG Postgres + Secrets; no reachable
#  DATABASE_URL/S3 cred; --prod path cannot connect). Bead stays OPEN —
#  externally blocked on nd-1fkb (the grant set IS the missing DATABASE_URL/S3
#  source, which a read-only observer here cannot create); per task rule, NOT
#  closed.]
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
#   * ArgoCD RO proxy (argocd-ro-ardenone-manager-ts.ardenone.com:8444) lists NO
#     drawrace Application — the backend was never GitOps-registered, so the empty
#     `drawrace` namespace is by-omission, not a failed ArgoCD sync. (This run the
#     proxy returned an empty body, so it is not independently confirmatory; the
#     namespace-level checks above — empty on rs-manager, NotFound on
#     ardenone-manager, iad-acb API timeout — are authoritative.)
#   * Kubeconfig inventory (corrected this run, 2026-07-26): /home/coding/.kube/
#     now holds ardenone-manager-24h.kubeconfig (fresh 24h cluster-admin token),
#     iad-acb.kubeconfig, and iad-ci.kubeconfig — but still NO rs-manager
#     kubeconfig (rs-manager stays proxy-only via traefik-rs-manager:8001). The
#     ardenone-manager admin kubeconfig was exercised this run: it connects, but
#     there is NO `drawrace` namespace on ardenone-manager either. iad-acb's API
#     server still hangs on `kubectl get ns` (>10s, times out), so its contents
#     remain uninspectable from this box. The read-only rs-manager proxy is
#     therefore still the only cluster on which the `drawrace` namespace can be
#     confirmed today — and it is still EMPTY (no deploy/svc/secret, only
#     kube-root-ca.crt, age 82d). Net: the full unblock-probe checklist below
#     was re-run this retry with the SAME blocked result as the prior runs —
#     deployment has still not landed anywhere reachable. (This retry also
#     caught that the documented cnpg probe below ERRORS via the observer SA
#     and split it out — see "HOW TO TELL WHEN DEPLOYMENT LANDS".) The offline
#     self-check was re-run this retry too → exit 0, so the decode pipeline is
#     still green; the ONLY open blocker remains the external nd-1fkb grant set.
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
# ── DEPENDENCY CHAIN (re-resolved this run, 2026-07-26) ─────────────────────
#
#   bf-65pk8  (THIS bead — prod connectivity)  ─► blocked on the external deploy
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
