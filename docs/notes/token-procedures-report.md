# Token Procedures - Comprehensive Report

**Report Date:** 2026-09-01  
**Purpose:** Compile all extracted token procedure information with file paths, expiration timelines, rotation schedules, and regeneration runbooks  
**Scope:** Authentication tokens, ServiceAccount tokens, HMAC keys, and credential management across DrawRace infrastructure

---

## Executive Summary

This report synthesizes all token-related documentation found in `docs/notes/` and related memory files. **Key Finding:** The codebase contains comprehensive procedures for **token setup and initial configuration**, but **lacks systematic documentation for token rotation schedules, expiration monitoring, and proactive regeneration runbooks**. Token management is primarily **incident-driven** rather than following a documented preventive maintenance schedule.

### Critical Action Items

1. **URGENT:** Regenerate expired `argocd-manager` ServiceAccount token (expired 2024-06-07)
2. **HIGH:** Document OpenBao root token rotation procedure (mentioned but not documented)
3. **HIGH:** Establish ServiceAccount token rotation schedule (currently long-lived with no expiration)
4. **MEDIUM:** Implement automated token expiration monitoring and alerting

---

## 1. Token Types and File Locations

### 1.1 OpenBao Tokens

**Primary Sources:**
- `docs/notes/access-setup-guide.md` (lines 1-50)
- `docs/notes/infrastructure-access-request.md` (lines 18-37, 157)

**What's Documented:**
- ✅ Initial token export and configuration
- ✅ Token verification procedure (`./scripts/verify-openbao-access.sh`)
- ✅ Secret creation procedures (Postgres, Garage S3, Cloudflare, HMAC)
- ✅ Token permissions requirements
- ✅ Security practices (SealedSecrets, environment injection)

**What's Missing:**
- ❌ Token rotation procedure (mentioned at line 157 but not provided)
- ❌ Expiration timeline (not specified)
- ❌ Rotation schedule (not defined)
- ❌ Regeneration runbook

**Content Excerpt (from `infrastructure-access-request.md` line 157):**
```markdown
- Document token rotation procedure
```
*This is listed as a next step, but no actual procedure is documented.*

---

### 1.2 Kubernetes ServiceAccount Tokens

**Primary Sources:**
- `memory/iad-ci-kubeconfig-expired.md` (full file)
- `docs/connectivity/iad-ci-kubeconfig-test.md` (verification procedures)
- `k8s/iad-acb-kubeconfig-setup.md` (cross-cluster token setup)

**Documented Tokens:**

| Token Name | Cluster | Purpose | Status | Source |
|------------|---------|---------|--------|--------|
| `argocd-manager` | iad-ci | ArgoCD manager authentication | **EXPIRED** 2024-06-07 | `memory/iad-ci-kubeconfig-expired.md` |
| `drawrace-rotate-key` | iad-acb | ConfigMap rotation from iad-ci | Active (long-lived) | `k8s/iad-acb-kubeconfig-setup.md` |

**What's Documented:**
- ✅ Token creation procedure (RBAC + ServiceAccount + secret)
- ✅ Cross-cluster kubeconfig setup (5-step process)
- ✅ Token verification test (`kubectl version --request-timeout=10s`)
- ✅ Minimal RBAC scope definition

**What's Missing:**
- ❌ Scheduled rotation procedure (not documented)
- ❌ Expiration monitoring (incident-driven only)
- ❌ Token lifetime policy (described as "long-lived" but no duration specified)

**Content Excerpt (from `iad-ci-kubeconfig-expired.md`):**
```markdown
iad-ci kubeconfig expired (2024-06-07) — argocd-manager ServiceAccount token expired (2024-06-07); 
blocks workflow log verification and Cloudflare Pages deployment checks.
```

---

### 1.3 HMAC/Client Signing Keys

**Primary Sources:**
- `docs/plan/plan.md` (Section: Multiplayer & Backend 8, Layer 1)
- `docs/notes/access-setup-guide.md` (OpenBao storage procedure)

**What's Documented:**
- ✅ Key generation procedure (`openssl rand -hex 16`)
- ✅ Rotation trigger logic (main branch, non-republish builds)
- ✅ 24-hour grace period with previous key acceptance
- ✅ ConfigMap structure (current/previous/rotated_at)
- ✅ Atomic rotation procedure

**What's Missing:**
- ❌ Rotation schedule documentation (frequency not specified beyond "per release")
- ❌ Key lifetime policy (32-byte hex key properties not documented)

**Content Excerpt (from `docs/plan/plan.md`):**
```yaml
# drawrace-client-key ConfigMap:
data:
  current: <hex32>
  previous: <hex32>
  rotated_at: <RFC3339 timestamp>

# Rotation procedure:
OLD=$(kubectl get configmap drawrace-client-key -o jsonpath='{.data.current}')
NEW=$(openssl rand -hex 16)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

---

## 2. Expiration Timelines

### 2.1 Documented Expirations

| Token Type | Token Name | Expiration Date | Current Status | Impact |
|------------|------------|-----------------|----------------|--------|
| ServiceAccount | `argocd-manager` | 2024-06-07 | **EXPIRED** | Blocks workflow log verification, CI deployment checks, Argo UI access (error 1033) |
| HMAC Previous Key | `previous` in ConfigMap | 24 hours after rotation | Per-release cycle | Grace period for client key rotation |

### 2.2 No Expiration Documentation

- **OpenBao Root Token:** No expiration timeline documented
- **ServiceAccount Tokens:** Described as "long-lived" but no specific duration defined
- **HMAC Current Key:** No expiration (rotated per release)

### 2.3 Expiration Detection Procedures

**Detection Test (from `docs/connectivity/iad-ci-kubeconfig-test.md`):**
```bash
kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig version --request-timeout=10s
```

**Expected Error on Expiration:**
```
error: You must be logged in to the server (the server has asked the client to provide credentials)
```

**Detection Status:** Manual/incident-driven (no automated monitoring documented)

---

## 3. Rotation Schedules

### 3.1 Documented Rotation Schedules

| Token Type | Rotation Trigger | Schedule | Automation |
|------------|-----------------|----------|-------------|
| HMAC Client Key | Main branch build + non-republish | Per release | Automated (via `rotate-client-key` job in `drawrace-build` WorkflowTemplate) |

### 3.2 Missing Rotation Schedules

| Token Type | Current Schedule | Should Be | Priority |
|------------|------------------|------------|----------|
| OpenBao Root Token | **NOT DOCUMENTED** | Quarterly (recommended) | HIGH |
| ServiceAccount Tokens | Long-lived (no rotation) | Quarterly (recommended) | HIGH |
| HMAC Previous Key | 24-hour grace window | 24-hour grace window | ✅ Documented |

---

## 4. Regeneration Runbooks

### 4.1 Documented Regeneration Procedures

#### HMAC Client Key Rotation (Fully Documented)
**Location:** `docs/plan/plan.md` §Multiplayer & Backend 8, Layer 1  
**Status:** ✅ COMPLETE with automated implementation

**Procedure:**
```bash
# Atomic rotation (single kubectl apply)
OLD=$(kubectl -n drawrace get configmap drawrace-client-key -o jsonpath='{.data.current}')
NEW=$(openssl rand -hex 16)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
kubectl -n drawrace apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: drawrace-client-key
  namespace: drawrace
data:
  current: "$NEW"
  previous: "$OLD"
  rotated_at: "$NOW"
EOF
```

#### Cross-Cluster ServiceAccount Token Creation (Fully Documented)
**Location:** `k8s/iad-acb-kubeconfig-setup.md`  
**Status:** ✅ COMPLETE (5-step procedure)

**Procedure Summary:**
1. Apply RBAC manifests (ServiceAccount + Role + RoleBinding)
2. Extract ServiceAccount token from secret
3. Extract CA certificate from cluster config
4. Create kubeconfig file with token and CA
5. Create secret in iad-ci cluster

### 4.2 Partially Documented Regeneration Procedures

#### Expired ServiceAccount Token Regeneration
**Location:** `docs/connectivity/iad-ci-kubeconfig-test.md`  
**Status:** ⚠️ PARTIAL (high-level steps only)

**Documented Steps:**
1. Generate new ServiceAccount token in iad-ci cluster
2. Update kubeconfig file with new token
3. Verify token has necessary RBAC permissions
4. Test connectivity with `kubectl version` command

**Missing Details:**
- ❌ Specific commands for each step
- ❌ RBAC requirements verification
- ❌ Rollback procedure if regeneration fails
- ❌ Prerequisites (cluster admin access requirements)

**Current Blocker:** Requires cluster administrator access (not currently available)

#### OpenBao Token Rotation
**Location:** `docs/notes/infrastructure-access-request.md` line 157  
**Status:** ❌ NOT DOCUMENTED (mentioned as next step only)

**Documented Reference:**
```markdown
- Document token rotation procedure
```

**Missing:**
- ❌ Rotation procedure (not provided)
- ❌ Expiration timeline (not specified)
- ❌ Rotation schedule (not defined)

---

## 5. Verification Procedures

### 5.1 OpenBao Token Verification
**Location:** `docs/notes/access-setup-guide.md`

```bash
export OPENBAO_TOKEN="<token>"
export OPENBAO_ADDR="http://openbao.<namespace>.svc.cluster.local:8200"
./scripts/verify-openbao-access.sh
```

**Expected Output:**
- ✅ Successfully connected to OpenBao
- ✅ Token is valid with policies
- ✅ Successfully wrote test secret
- ✅ Successfully read back test secret

### 5.2 Kubernetes Token Verification
**Location:** `docs/connectivity/iad-ci-kubeconfig-test.md`

```bash
kubectl --kubeconfig=<path-to-kubeconfig> version --request-timeout=10s
```

**Success Criteria:** Returns server version without authentication error

### 5.3 Cross-Cluster Token Verification
**Location:** `k8s/iad-acb-kubeconfig-setup.md`

```bash
KUBECONFIG=/tmp/test-kubeconfig kubectl -n drawrace get configmap drawrace-client-key
```

**Purpose:** Verify cross-cluster access from iad-ci to iad-acb

---

## 6. Incident History

### 6.1 iad-ci Kubeconfig Expiration (2024-06-07)

**Incident Record:** `memory/iad-ci-kubeconfig-expired.md`  
**Token:** argocd-manager ServiceAccount token  
**Expiration Date:** 2024-06-07  
**Discovery Date:** 2026-08-12 (via connectivity test failure)  
**Resolution Status:** UNRESOLVED (as of 2026-09-01)

**Impact:**
- Cannot verify drawrace-build workflow status
- Cannot check pages-publish step logs
- Blocks Cloudflare Pages deployment verification
- Argo UI returns error code 1033 (access denied)

**Detection Method:**
```bash
kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig get workflows
# Error: You must be logged in to the server
```

**Root Cause:** Token expiration with no rotation schedule in place

**Resolution Blocker:** Requires cluster administrator access to generate new token

---

## 7. Security Practices

### 7.1 Documented Security Measures

**From `docs/notes/infrastructure-access-request.md`:**
- ✅ OpenBao tokens stored as Kubernetes SealedSecrets
- ✅ Never committed in plaintext to git
- ✅ Injected into pods via environment variables or volume mounts
- ✅ Minimal RBAC: ServiceAccount tokens scoped to specific resources

**From `k8s/iad-acb-kubeconfig-setup.md`:**
- ✅ ServiceAccount tokens use minimal RBAC (get/update/create on configmaps only)
- ✅ Security note: "Consider using short-lived tokens via TokenRequest for tighter security"

### 7.2 Security Gaps

- ❌ No scheduled rotation for OpenBao root token
- ❌ ServiceAccount tokens are long-lived (no expiration mechanism)
- ❌ No automated expiration monitoring
- ❌ No alerting before token expiration
- ❌ Token regeneration is incident-driven (manual detection only)

---

## 8. Next Steps and Recommendations

### 8.1 Immediate Actions Required (URGENT)

1. **Regenerate argocd-manager ServiceAccount token**
   - Current token expired 2024-06-07
   - Blocks CI workflow verification and deployment checks
   - Requires: Cluster administrator access
   - Procedure reference: `docs/connectivity/iad-ci-kubeconfig-test.md`

2. **Document OpenBao token rotation procedure**
   - Currently mentioned but not documented (`infrastructure-access-request.md` line 157)
   - Critical for production security management
   - Should include: rotation steps, timeline, rollback procedure

### 8.2 High-Priority Improvements (HIGH)

1. **Establish ServiceAccount token rotation schedule**
   - Current tokens are long-lived with no expiration
   - Recommended: Quarterly rotation
   - Should implement: Automated rotation via Kubernetes TokenRequest API

2. **Implement token expiration monitoring**
   - Current detection is manual/incident-driven
   - Should implement: Automated alerts 30 days before expiration
   - Monitoring targets: OpenBao tokens, ServiceAccount tokens

### 8.3 Long-Term Enhancements (MEDIUM)

1. **Implement TokenRequest API for short-lived tokens**
   - Mentioned in `k8s/iad-acb-kubeconfig-setup.md` as security enhancement
   - Provides tighter security than long-lived tokens
   - Should replace long-lived ServiceAccount tokens

2. **Document all token lifecycle procedures**
   - Creation, rotation, expiration, and regeneration
   - Include timelines, schedules, and runbooks
   - Centralize in `docs/notes/token-procedures.md`

3. **Automate token rotation where possible**
   - HMAC keys: Already automated ✅
   - ServiceAccount tokens: Should be automated (via CronJob or external operator)
   - OpenBao tokens: Should be automated (via OpenBao's native rotation features)

---

## 9. Acceptance Criteria Status

✅ **Compiled findings from all analyzed files** - Complete (7 files analyzed)  
✅ **Reported findings with file paths and relevant content** - Complete (all sections cite sources)  
✅ **Listed token expiration timelines** - Found 2 documented expirations (1 active, 1 expired)  
✅ **Listed rotation schedules** - Found 1 documented schedule (HMAC keys), 2 missing  
✅ **Listed runbooks for token regeneration** - Found 2 complete, 2 partial/missing  
✅ **Noted if NO token procedures found** - Procedures exist but gaps identified  
✅ **Report is complete and actionable** - Includes prioritized next steps  

---

## 10. Related Documentation Index

### High-Relevance Files (Primary Token Procedures)
- `docs/notes/access-setup-guide.md` - OpenBao token setup and verification
- `docs/notes/infrastructure-access-request.md` - Token requirements, RBAC, rotation gaps
- `k8s/iad-acb-kubeconfig-setup.md` - Cross-cluster token creation procedure
- `docs/plan/plan.md` (§Multiplayer & Backend 8) - HMAC key rotation procedure

### Moderate-Relevance Files (Context and Troubleshooting)
- `docs/notes/iad-acb-node-2-cni-investigation.md` - Kubeconfig access limitations
- `docs/connectivity/iad-ci-kubeconfig-test.md` - Token expiration testing
- `memory/iad-ci-kubeconfig-expired.md` - Expired token incident record

### Supporting Files
- `authentication-related-filter.md` - Filter for identifying auth-related content
- `token-procedures-extracted.md` - Detailed extraction of all token procedures

---

## Conclusion

The DrawRace codebase has **strong documentation for token setup and initial configuration**, with **well-defined procedures for HMAC key rotation** and **comprehensive cross-cluster authentication setup**. However, critical gaps exist in **preventive token maintenance**:

1. **No scheduled rotation** for OpenBao root tokens or ServiceAccount tokens
2. **No automated monitoring** for token expiration
3. **Incident-driven regeneration** rather than proactive maintenance
4. **One expired token** (argocd-manager) blocking CI operations since 2024-06-07

**Recommendation:** Prioritize documenting and automating token rotation procedures to prevent future incidents, and regenerate the expired argocd-manager token to restore CI verification capabilities.
