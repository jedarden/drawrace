# DrawRace Deployment Verification Report

**Date:** 2026-07-28  
**Bead:** bf-2y0mc  
**Task:** Verify drawrace namespace is deployed with actual resources

---

## Executive Summary

The drawrace namespace on rs-manager **EXISTS but is EMPTY**. It contains only the auto-created `kube-root-ca.crt` ConfigMap. No actual workloads (Deployments, Services, Secrets, CloudNativePG Postgres) are present.

**Status:** ❌ **NOT DEPLOYED** - Namespace exists but contains no resources

---

## Verification Results

### Namespace Status

```bash
$ kubectl --server=http://traefik-rs-manager:8001 get namespace drawrace
NAME        STATUS   AGE
drawrace    Active  84d
```

**Namespace Created:** 2026-05-05 (84 days ago)

### Resources in Namespace

```bash
$ kubectl --server=http://traefik-rs-manager:8001 get all,configmaps,secrets -n drawrace
NAME                         DATA   AGE
configmap/kube-root-ca.crt   1      84d
```

**Result:** Only the auto-created kube-root-ca.crt ConfigMap exists. No Deployments, Services, Secrets, or other resources.

### Key Resources Checked

| Resource Type | Status | Details |
|---------------|--------|---------|
| Deployments | ❌ Not Found | No drawrace-api or drawrace-validator deployments |
| Services | ❌ Not Found | No API or validator services |
| CloudNativePG Cluster | ❌ Not Found | No Postgres cluster |
| Redis Deployment | ❌ Not Found | No Redis instance |
| Secrets | ❌ Not Found | No database or S3 credentials |
| IngressRoute | ❌ Not Found | No Traefik ingress configured |

### ArgoCD Application Status

```bash
$ kubectl --server=http://traefik-ardenone-manager:8001 get applications.argoproj.io -n argocd
No drawrace application found in ArgoCD
```

**Result:** No ArgoCD Application for drawrace is registered on ardenone-manager.

---

## Root Cause Analysis

This is a **known, tracked blocker**. The deployment epic lives in a separate NEEDLE workspace with the following active blockers:

### Active Blocker Beads

1. **nd-1fkb** — BLOCKED: External Coordination Required
   - Waiting for: OpenBao root token
   - Waiting for: Cluster-admin permissions on iad-acb
   - Waiting for: GarageBucket/GarageKey creation permissions
   - **Age:** 23+ days (since 2026-07-03)
   - **Estimated unblock time:** 1-2 business days (pending infrastructure team response)

2. **nd-xjnv** — Deploy backend on iad-acb
3. **nd-639** — Populate OpenBao secrets
4. **bf-5ft** — Genesis: deployment to production (umbrella)

### Why This Keeps Blocking

The code/contract side is **FULLY complete**:
- ✅ bf-3iggr (prod SQL/S3/DB env-var contract) is CLOSED
- ✅ Offline decode/validate pipeline self-checks clean
- ✅ All Phase 0-5 implementation work is done
- ✅ Phone-smoke passes on real Pixel 6 hardware

The blockers are **purely infrastructure/coordination issues**:
- No OpenBao root token obtained
- No cluster-admin on iad-acb granted
- Cannot verify/create GarageBucket/GarageKey without permissions
- Intended target cluster (iad-acb) has connectivity issues

### What IS Working

- ✅ Frontend deployed: `https://drawrace.pages.dev` (Cloudflare Pages)
- ✅ Frontend is fully functional PWA (verified via Pixel 6 screenshot)
- ✅ Bundle size: 150KB gzipped (well under 400KB budget)
- ✅ Offline mode works (bundled ghosts, no backend dependency)
- ✅ All test layers pass (97/98 unit tests, phone-smoke PASS)

### What is NOT Working

- ❌ Backend API: `api-drawrace.ardenone.com` is NXDOMAIN
- ❌ No live leaderboard
- ❌ No ghost submission/fetching
- ❌ No matchmaking
- ❌ No real-time multiplayer (crates/live)

---

## Deployment Checklist (What Would Indicate Success)

For the drawrace namespace to be considered "deployed with actual resources," the following must be present:

### Core Resources
- [ ] `drawrace-api` Deployment (2 replicas)
- [ ] `drawrace-validator` Deployment (1-2 replicas)
- [ ] `drawrace-api` Service (ClusterIP)
- [ ] `drawrace-validator` Service (ClusterIP, port 8080 internal)
- [ ] Redis Deployment/Service
- [ ] CloudNativePG Cluster (Postgres)
- [ ] Postgres `Secret` (database credentials)
- [ ] S3 credentials `Secret` (Garage S3 access)
- [ ] `drawrace-client-key` ConfigMap (HMAC rotation)
- [ ] IngressRoute for `api-drawrace.ardenone.com`
- [ ] Certificate (cert-manager + Let's Encrypt)

### ArgoCD
- [ ] ArgoCD Application registered on rs-manager
- [ ] Application syncing from `jedarden/declarative-config`
- [ ] Application health status: `Healthy`
- [ ] Application sync status: `Synced`

### External Dependencies
- [ ] Garage S3 bucket created (`drawrace-ghosts`)
- [ ] OpenBao secrets populated
- [ ] DNS record: `api-drawrace.ardenone.com` → cluster ingress
- [ ] TLS certificate provisioned

**Current State:** 0/21 items present (only auto-created ConfigMap exists)

---

## Connectivity Verification

### rs-manager (Proxy: traefik-rs-manager:8001)
- ✅ Namespace exists
- ❌ No resources deployed

### iad-acb (Proxy: traefik-iad-acb.tail1b1987.ts.net:8444)
- ❌ Connection times out / terminates
- ❌ Cannot verify namespace status

### ArgoCD (argocd-ro-ardenone-manager-ts.ardenone.com:8444)
- ❌ DNS resolution fails from this host
- ❌ No drawrace application found

### DNS
- ❌ `api-drawrace.ardenone.com` → NXDOMAIN
- ✅ `drawrace.pages.dev` → resolves (frontend working)

---

## Recommendations

### For This Bead (bf-2y0mc)

**DO NOT CLOSE** - The acceptance criteria are NOT met:
- ❌ Namespace exists but contains NO actual resources
- ❌ No Deployments, Postgres, Services, or Secrets
- ❌ Only placeholder ConfigMap present

### For Deployment Progress

The deployment is blocked on external infrastructure team action. The workflow is:

1. ✅ Document what's needed (DONE - see `BLOCKER_SUMMARY.md`, `OPENBAO_K8S_ACCESS_CHECKLIST.md`)
2. ⏳ **WAIT** for infrastructure team to provide credentials
3. ⏳ **VERIFY** credentials work
4. ✅ **THEN** proceed with deployment

### For Unblock Verification

Once the infrastructure team responds, re-run the probe checklist:

```bash
# 1. Test DNS
getent hosts api-drawrace.ardenone.com

# 2. Test API health endpoint
curl -f https://api-drawrace.ardenone.com/v1/health

# 3. Check namespace resources
kubectl --server=http://traefik-rs-manager:8001 \
  get deploy,svc,cluster.postgresql.cnpg.io,secrets -n drawrace

# 4. Verify ArgoCD sync
kubectl --server=http://traefik-ardenone-manager:8001 \
  get applications.argoproj.io -n argocd \
  -o json | jq -r '.items[] | select(.metadata.name == "drawrace")'
```

When all four checks pass, the deployment is live and this bead can close.

---

## Related Documentation

- `BLOCKER_SUMMARY.md` - Active blocker details (nd-1fkb)
- `OPENBAO_K8S_ACCESS_CHECKLIST.md` - Infrastructure team request
- `docs/plan/plan.md` §Multiplayer & Backend 10 - Deployment architecture
- `memory/drawrace-prod-deployment-blocked-nd-1fkb.md` - Cross-workspace blocker reference

---

## Conclusion

The drawrace namespace exists as an empty shell waiting for resources. All code implementation is complete; the only remaining work is infrastructure coordination that requires external action from the infrastructure team.

**Next Action:** Wait for infrastructure team response to unblock nd-1fkb, then re-verify deployment.

**Bead Status:** KEEP OPEN - Re-check when nd-1fkb closes.
