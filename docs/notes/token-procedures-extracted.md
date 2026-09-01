# Token Procedures - Extracted Documentation

**Extracted:** 2026-09-01  
**Source:** Analysis of docs/notes/ and memory/ files related to authentication, tokens, and credential management

---

## Executive Summary

This document consolidates all token-related procedures, expiration timelines, rotation schedules, and regeneration runbooks extracted from the DrawRace documentation and memory files. The primary focus is on three token types:

1. **OpenBao Tokens** - Secret management for DrawRace backend services
2. **Kubernetes ServiceAccount Tokens** - Cluster authentication (iad-ci, iad-acb, rs-manager)
3. **HMAC/Client Keys** - API signing and authentication

---

## 1. OpenBao Token Procedures

### 1.1 Initial Setup

**Source:** `docs/notes/access-setup-guide.md`

#### Token Export and Configuration
```bash
# Add to ~/.bashrc or ~/.zshrc for persistence
export OPENBAO_TOKEN="<your-root-token>"
export OPENBAO_ADDR="http://openbao.<namespace>.svc.cluster.local:8200"
```

#### Verification Procedure
```bash
cd /home/coding/drawrace
./scripts/verify-openbao-access.sh
```

Expected output:
- ✅ Successfully connected to OpenBao
- ✅ Token is valid with policies
- ✅ Successfully wrote test secret
- ✅ Successfully read back test secret

### 1.2 Secret Creation Procedures

#### Postgres Credentials
```bash
vault kv put drawrace/postgres \
  host=postgres.drawrace.svc.cluster.local \
  user=drawrace \
  password=<secure-password> \
  database=drawrace
```

#### Garage S3 Credentials
```bash
vault kv put drawrace/garage \
  endpoint=garage.ardenone-hub.tail1b1987.ts.net \
  access_key=<access-key> \
  secret_key=<secret-key> \
  bucket=drawrace-ghosts
```

#### Cloudflare API Token
```bash
vault kv put drawrace/cloudflare \
  api_token=<cf-api-token> \
  account_id=<cf-account-id>
```

#### HMAC Signing Key
```bash
vault kv put drawrace/hmac \
  client_shared_key=<32-byte-hex-key>
```

### 1.3 Token Permissions Required

**Source:** `docs/notes/infrastructure-access-request.md`

- Root token or token with ability to create child tokens
- Write access to KV secrets engine
- Create/update secrets at `drawrace/*` path

### 1.4 Security Procedures

**Source:** `docs/notes/infrastructure-access-request.md`

OpenBao tokens follow these security practices:
1. Stored as Kubernetes SealedSecrets in the declarative-config repo
2. Never committed in plaintext to git
3. Injected into pods via environment variables or volume mounts

---

## 2. Kubernetes ServiceAccount Token Procedures

### 2.1 Token Expiration Issues

**Source:** `memory/iad-ci-kubeconfig-expired.md` and `docs/connectivity/iad-ci-kubeconfig-test.md`

#### Known Expiration Event
- **Token:** argocd-manager ServiceAccount token
- **Expiration Date:** 2024-06-07
- **Current Status:** EXPIRED (as of 2026-08-12)
- **Impact:** 
  - Cannot verify drawrace-build workflow status
  - Cannot check pages-publish step logs
  - Blocks Cloudflare Pages deployment verification
  - Argo UI returns error code 1033 (access denied)

#### Test Command
```bash
kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig version --request-timeout=10s
```

**Expected Error:**
```
error: You must be logged in to the server (the server has asked the client to provide credentials)
```

### 2.2 Token Regeneration Procedure

**Source:** `docs/connectivity/iad-ci-kubeconfig-test.md`

The documented resolution requires:
1. Generating a new ServiceAccount token in the iad-ci cluster
2. Updating the kubeconfig file with the new token
3. Ensuring the token has the necessary RBAC permissions

**Note:** No specific timeline or rotation schedule is documented. This appears to be an incident-driven procedure rather than a scheduled rotation.

### 2.3 Cross-Cluster Token Setup

**Source:** `k8s/iad-acb-kubeconfig-setup.md`

#### Purpose
Allows `drawrace-build` workflow on iad-ci to update ConfigMaps on iad-acb.

#### Setup Procedure

**Step 1: Apply RBAC manifests**
```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig \
  apply -f k8s/iad-acb-drawrace-rotate-key-rbac.yaml
```

Creates:
- ServiceAccount `drawrace-rotate-key` in drawrace namespace
- Role `drawrace-rotate-key` with get/update/create on configmaps
- RoleBinding binding the SA to the Role

**Step 2: Get ServiceAccount Token**
```bash
SA_SECRET_NAME=$(kubectl --kubeconfig=/path/to/iad-acb.kubeconfig \
  -n drawrace get serviceaccount drawrace-rotate-key \
  -o jsonpath='{.secrets[0].name}')

kubectl --kubeconfig=/path/to/iad-acb.kubeconfig \
  -n drawrace get secret "$SA_SECRET_NAME" \
  -o jsonpath='{.data.token}' | base64 -d
```

**Step 3: Get CA Certificate**
```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig config view \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d
```

**Step 4: Create Kubeconfig**
```yaml
apiVersion: v1
kind: Config
clusters:
  - cluster:
      certificate-authority-data: <base64-encoded-ca-from-step-4>
      server: <cluster-endpoint-from-step-2>
    name: iad-acb
users:
  - user:
      token: <token-from-step-3>
    name: drawrace-rotate-key
contexts:
  - context:
      cluster: iad-acb
      user: drawrace-rotate-key
    name: drawrace-rotate-key@iad-acb
current-context: drawrace-rotate-key@iad-acb
```

**Step 5: Create Secret in iad-ci**
```bash
kubectl --kubeconfig=/path/to/iad-ci.kubeconfig \
  -n argo-workflows create secret generic drawrace-iad-acb-kubeconfig \
  --from-file=config.yaml=drawrace-iad-acb-kubeconfig.yaml \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 2.4 Token Lifecycle Properties

**Source:** `k8s/iad-acb-kubeconfig-setup.md`

**Security Notes:**
- ServiceAccount tokens are long-lived (don't expire unless SA is deleted)
- Minimal RBAC: only get/update/create on configmaps in the drawrace namespace
- Consider using short-lived tokens via TokenRequest for tighter security

---

## 3. HMAC/Client Key Procedures

### 3.1 HMAC Key Setup

**Source:** `docs/notes/access-setup-guide.md`

```bash
vault kv put drawrace/hmac \
  client_shared_key=<32-byte-hex-key>
```

**Purpose:** Client submission signing for anti-forgery

### 3.2 Client Key Rotation

**Source:** `docs/plan/plan.md` (Section: Multiplayer & Backend 8, Layer 1)

The `drawrace-client-key` ConfigMap contains:
- `current`: Active 32-byte hex key
- `previous`: Previous key (for 24h grace period)
- `rotated_at`: RFC3339 timestamp

**Rotation Trigger:**
- Runs on `branch == main` AND `republish_only != true`
- PR preview builds do NOT rotate
- Rollback republish builds do NOT rotate

**Rotation Procedure:**
```bash
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

**Grace Period:** 24 hours - server accepts both current and previous keys during this window

**Acceptance Window:**
- Server accepts `previous` key when `now() - rotated_at < 24h`
- After 24h, only `current` is accepted

---

## 4. Token Rotation and Expiration Summary

### 4.1 Documented Rotation Procedures

| Token Type | Rotation Schedule | Procedure Location | Last Known Rotation |
|------------|------------------|-------------------|---------------------|
| OpenBao Root Token | **NOT DOCUMENTED** | `infrastructure-access-request.md` line 157 mentions "Document token rotation procedure" but procedure itself is not documented | Unknown |
| ServiceAccount (argocd-manager) | **NOT DOCUMENTED** | No scheduled rotation found | Expired 2024-06-07 |
| ServiceAccount (drawrace-rotate-key) | Long-lived (no expiration) | `k8s/iad-acb-kubeconfig-setup.md` | Not applicable |
| HMAC Client Key | Per release (main branch) | `docs/plan/plan.md` §Multiplayer 8 | Per release |

### 4.2 Expiration Timelines

| Token Type | Expiration Behavior | Known Expiration |
|------------|-------------------|------------------|
| OpenBao Root Token | **NOT DOCUMENTED** | Unknown |
| ServiceAccount Token | Long-lived (unless SA deleted) | argocd-manager expired 2024-06-07 |
| HMAC Previous Key | 24 hours after rotation | Per release cycle |

---

## 5. Incident Response Procedures

### 5.1 Expired Token Detection

**Source:** `memory/iad-ci-kubeconfig-expired.md`

**Symptoms:**
```bash
kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig get workflows
# Error: You must be logged in to the server
```

**Verification Test:**
```bash
kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig version --request-timeout=10s
```

**Expected Failure:**
```
error: You must be logged in to the server (the server has asked the client to provide credentials)
```

### 5.2 Token Regeneration Runbook

**Source:** `docs/connectivity/iad-ci-kubeconfig-test.md`

**Steps:**
1. Generate new ServiceAccount token in the iad-ci cluster
2. Update kubeconfig file with new token
3. Verify token has necessary RBAC permissions
4. Test connectivity with `kubectl version` command

**Current Status:** BLOCKED - requires cluster administrator access

---

## 6. Missing Documentation

### 6.1 OpenBao Token Rotation
**Location:** `docs/notes/infrastructure-access-request.md` line 157

**Status:** MENTIONED BUT NOT DOCUMENTED
- The document states "Document token rotation procedure" as a next step
- No actual rotation procedure is provided
- No expiration timeline is specified
- No rotation schedule is defined

### 6.2 ServiceAccount Token Rotation
**Status:** NOT DOCUMENTED
- No scheduled rotation procedure found
- Token expiration appears to be incident-driven
- The argocd-manager token expiration was unexpected (2024-06-07)

### 6.3 Token Lifetime Policies
**Status:** NOT DOCUMENTED
- No documented token lifetime policies for OpenBao tokens
- ServiceAccount tokens described as "long-lived" but no specific duration
- No renewable vs non-renewable token distinction

---

## 7. Verification Procedures Summary

### 7.1 OpenBao Token Verification
```bash
export OPENBAO_TOKEN="<token>"
export OPENBAO_ADDR="http://openbao.<namespace>.svc.cluster.local:8200"
./scripts/verify-openbao-access.sh
```

### 7.2 Kubernetes Token Verification
```bash
kubectl --kubeconfig=<path-to-kubeconfig> version --request-timeout=10s
```

### 7.3 Cross-Cluster Token Verification
```bash
KUBECONFIG=/tmp/test-kubeconfig kubectl -n drawrace get configmap drawrace-client-key
```

---

## 8. Recommendations

### 8.1 Immediate Actions Required

1. **Regenerate argocd-manager ServiceAccount token**
   - Current token expired 2024-06-07
   - Blocks workflow log verification and deployment checks
   - Requires cluster administrator access

2. **Document OpenBao token rotation procedure**
   - Currently mentioned but not documented
   - Critical for production security management

3. **Establish ServiceAccount token rotation schedule**
   - Current tokens are long-lived with no expiration
   - Implement periodic rotation (recommended: quarterly)

### 8.2 Long-Term Improvements

1. **Implement TokenRequest API for short-lived tokens**
   - Mentioned in `k8s/iad-acb-kubeconfig-setup.md` as security enhancement
   - Provides tighter security than long-lived tokens

2. **Automate token expiration monitoring**
   - Current detection is manual/incident-driven
   - Implement alerts before tokens expire

3. **Document all token lifecycle procedures**
   - Creation, rotation, expiration, and regeneration
   - Include timelines, schedules, and runbooks

---

## 9. Related Files

### High-Relevance Files
- `docs/notes/access-setup-guide.md` - OpenBao token setup
- `docs/notes/infrastructure-access-request.md` - Token requirements and RBAC
- `k8s/iad-acb-kubeconfig-setup.md` - Cross-cluster token setup

### Moderate-Relevance Files
- `docs/notes/iad-acb-node-2-cni-investigation.md` - Kubeconfig access limitations
- `docs/connectivity/iad-ci-kubeconfig-test.md` - Token expiration testing

### Memory Files
- `memory/iad-ci-kubeconfig-expired.md` - Expired ServiceAccount token incident

---

## 10. Acceptance Criteria Status

✅ **Read each relevant file in docs/notes/** - Completed  
✅ **Extracted token expiration timelines or rotation schedules** - Found limited documentation  
✅ **Identified runbooks or procedures for token regeneration** - Found partial procedures  
✅ **Noted file paths and specific content sections** - Documented throughout  
✅ **Documented what token procedures exist** - This comprehensive summary  

### Key Finding
The documentation contains **procedures for token setup and initial configuration**, but **lacks comprehensive documentation for token rotation schedules, expiration timelines, and regeneration runbooks**. Most token management appears to be incident-driven rather than following a documented schedule.
