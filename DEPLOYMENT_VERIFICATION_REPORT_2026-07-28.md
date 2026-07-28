# DrawRace Deployment Verification Report
**Date:** 2026-07-28  
**Task:** bf-2y0mc - Verify drawrace namespace is deployed with actual resources  
**Status:** ❌ ACCEPTANCE CRITERIA NOT MET

## Executive Summary

The drawrace namespace **exists** but is **empty**. No actual workloads or credentials are deployed. This is a **known external blocker** (nd-1fkb) that has been active for 23+ days, awaiting infrastructure team coordination.

---

## Current State (as of 2026-07-28)

### Namespace Status
```
Name:       drawrace
Status:     Active
Created:    2026-05-05 (84 days ago)
Managed by: ArgoCD (labeled, but no application registered)
```

### Resources Present
❌ **Deployments:** NONE  
❌ **Services:** NONE  
❌ **CloudNativePG Postgres:** NONE  
❌ **Secrets:** NONE (no DB credentials, no S3 credentials)  
❌ **Redis:** NONE  
❌ **IngressRoute:** NONE  
✅ **ConfigMaps:** ONLY kube-root-ca.crt (auto-created, 84d old)

### ArgoCD Status
❌ No drawrace application registered on ardenone-manager  
❌ No sync controller managing the namespace  
❌ No self-heal or automated deployment

---

## What IS Working

### Frontend ✅
- **URL:** https://drawrace.pages.dev
- **Platform:** Cloudflare Pages
- **Status:** Fully functional PWA
- **Verification:** Cold-boot tested on real Pixel 6 via ADB
- **Bundle:** ~126KB gzipped (well under 400KB budget)
- **Features:** Draw → Race → Result loop complete, mid-race wheel redraw, daily challenges, track editor, recovery phrases, cosmetic trails

### Code ✅
- **Phases 0-5:** 100% complete
- **Tests:** All 9 test layers passing (97 unit tests, Layer 2 goldens, E2E, phone smoke)
- **Backend Code:** Complete (`crates/api`, `crates/validator`)
- **Manifests:** Ready in `jedarden/declarative-config`

---

## What is NOT Working

### Backend ❌
- **API URL:** api-drawrace.ardenone.com → **NXDOMAIN**
- **Leaderboard:** Not available
- **Ghost Submission:** Not available
- **Matchmaking:** Not available
- **Real-time multiplayer:** Code ships but no deployment target

### Infrastructure ❌
- **Postgres:** No CloudNativePG cluster
- **S3:** No Garage buckets/credentials
- **Redis:** No deployment
- **Secrets:** No sealed-secrets deployed
- **Ingress:** No Traefik routes or cert-manager certificates

---

## Root Cause Analysis

### External Blocker: nd-1fkb
**Status:** ACTIVE (23+ days, since 2026-07-03)  
**Workspace:** NEEDLE (separate from drawrace repo)  
**Issue:** Infrastructure team coordination required

**Blocking Items:**
1. ❌ OpenBao root token access
2. ❌ Cluster-admin role on iad-acb cluster
3. ❌ GarageBucket/GarageKey creation permissions

**Cross-Workspace Dependencies:**
- `nd-1fkb` — External coordination epic (ACTIVE BLOCKER)
- `nd-xjnv` — Deploy backend on iad-acb
- `nd-639` — Populate OpenBao secrets
- `bf-5ft` — Genesis: deployment to production

**Why This Keeps Coming Up:**
NEEDLE dispatches connectivity/extract tasks (bf-65pk8, bf-2ji9i, bf-1kfun) that depend on production deployment. These tasks **cannot be completed** until nd-1fkb unblocks.

---

## Dependency Chain Status

### ✅ Complete (Code Side)
- Contract implementation: `bf-3iggr` CLOSED
- Offline decode/validate: `scripts/extract-reference-ghosts.sh --self-check` → exit 0
- All phases code-complete (0-5)
- Test suite passing (all 9 layers)

### ❌ Blocked (Infrastructure Side)
- DNS resolution: `api-drawrace.ardenone.com` → NXDOMAIN
- Kubernetes resources: Namespace exists but empty
- ArgoCD: No application registered
- Storage: No Garage buckets accessible

---

## Verification Checklist Results

```bash
# 1. DNS resolution
$ getent hosts api-drawrace.ardenone.com
# ❌ NXDOMAIN

# 2. API health endpoint
$ curl -f https://api-drawrace.ardenone.com/v1/health
# ❌ Could not resolve host

# 3. Kubernetes resources
$ kubectl --server=http://traefik-rs-manager:8001 \
    get deploy,svc,cluster.postgresql.cnpg.io,secrets -n drawrace
# ❌ No resources found in drawrace namespace.

# 4. ArgoCD application
$ curl -sk https://argocd-ro-ardenone-manager-ts.ardenone.com:8444/api/v1/applications \
    | jq -r '.items[] | select(.spec.destination.namespace == "drawrace")'
# ❌ No applications returned

# 5. Alternative clusters
# Checked: apexalgo-iad, ardenone-cluster, ardenone-manager, iad-options,
#          ord-devimprint, iad-kalshi
# ❌ No drawrace namespace found on any cluster
```

---

## Acceptance Criteria Status

### Required Criteria
- [❌] Namespace contains actual Deployments
- [❌] Namespace contains CloudNativePG Postgres cluster
- [❌] Namespace contains Services
- [❌] Namespace contains Secrets (DB credentials, S3 credentials)
- [✅] Namespace exists on reachable cluster

### Result
**1/5 criteria met** - Namespace exists but contains no resources

---

## Next Steps (When nd-1fkb Unblocks)

### Immediate Actions
1. Infrastructure team provides:
   - OpenBao root token
   - Cluster-admin on iad-acb
   - GarageBucket/GarageKey permissions

2. Create ArgoCD Application:
   ```yaml
   apiVersion: argoproj.io/v1alpha1
   kind: Application
   metadata:
     name: drawrace
     namespace: argocd
   spec:
     project: default
     source:
       repoURL: https://github.com/jedarden/declarative-config
       path: k8s/iad-acb/drawrace
       targetRevision: main
     destination:
       name: iad-acb
       namespace: drawrace
     syncPolicy:
       automated:
         prune: true
         selfHeal: true
       syncOptions:
         - CreateNamespace=true
   ```

3. Verify sync completes:
   ```bash
   kubectl --server=http://traefik-rs-manager:8001 \
     get deploy,svc,cluster.postgresql.cnpg.io,secrets -n drawrace
   ```

4. Verify DNS resolves:
   ```bash
   getent hosts api-drawrace.ardenone.com
   ```

5. Verify API health:
   ```bash
   curl -f https://api-drawrace.ardenone.com/v1/health
   ```

### Post-Deployment Validation
- [ ] Pods running (drawrace-api, drawrace-validator)
- [ ] Postgres cluster healthy
- [ ] Redis accessible
- [ ] S3 buckets accessible
- [ ] Ingress routes configured
- [ ] TLS certificates provisioned
- [ ] API health endpoint returns 200
- [ ] Smoke test: submit ghost → verify replay → check leaderboard

---

## References

### In-Repo Documentation
- `BLOCKER_SUMMARY.md` - Detailed blocker status
- `OPENBAO_K8S_ACCESS_CHECKLIST.md` - Infrastructure checklist
- `DEPLOYMENT_VERIFICATION_SUMMARY.txt` - Quick summary
- `docs/plan/plan.md` - Full architecture and deployment plan
- `memory/drawrace-prod-deployment-blocked-nd-1fkb.md` - Cross-workspace blocker details

### External Workspaces (NEEDLE)
- `nd-1fkb` - External coordination epic (ACTIVE BLOCKER)
- `nd-xjnv` - Deploy backend on iad-acb
- `nd-639` - Populate OpenBao secrets
- `bf-5ft` - Genesis: deployment to production

### Related Beads
- `bf-65pk8` - Production connectivity probe (blocked)
- `bf-2ji9i` - Extract reference ghosts (blocked)
- `bf-1kfun` - Real ghost extraction (blocked)

---

## Conclusion

**Task Status:** ❌ INCOMPLETE  
**Bead Action:** KEEP bf-2y0mc OPEN  
**Reason:** Acceptance criteria not met - namespace exists but contains no actual resources

The deployment is blocked on external infrastructure coordination (nd-1fkb). The code is 100% ready and all tests pass. When infrastructure provides credentials, deployment can proceed immediately using existing manifests in `jedarden/declarative-config`.

**Recommendation:** Keep bead OPEN. Do NOT close. The bead will auto-retry when nd-1fkb unblocks.

---

*Generated: 2026-07-28*  
*Task: bf-2y0mc*  
*Verification method: kubectl via traefik-rs-manager:8001 proxy + ArgoCD API probe*
