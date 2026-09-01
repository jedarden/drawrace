# Authentication-Related Files Filter

**Generated:** 2026-09-01
**Purpose:** Filter docs/notes/ for files related to tokens, authentication, kubeconfigs, iad-ci, ServiceAccount, rotation, or expiration

---

## High-Relevance Files (Primary Authentication Content)

### 1. access-setup-guide.md
- **Path:** docs/notes/access-setup-guide.md
- **Relevance:** HIGH
- **Key Topics:**
  - OpenBao token setup and export (`export OPENBAO_TOKEN`)
  - OpenBao address configuration
  - Credential verification procedures
  - Kubernetes context setup (`kubectl config use-context`)
  - Secret creation procedures (Postgres, Garage S3, Cloudflare, HMAC keys)
  - SealedSecrets for CI/CD
- **Specific Authentication Elements:**
  - OpenBao root token management
  - OpenBao KV secret operations
  - Kubeconfig context switching
  - Service account/credential verification

### 2. infrastructure-access-request.md
- **Path:** docs/notes/infrastructure-access-request.md
- **Relevance:** HIGH
- **Key Topics:**
  - OpenBao Root Token requirements (lines 18-37)
  - Kubernetes Cluster Admin access (lines 40-55)
  - Token security procedures and SealedSecrets
  - RBAC/ClusterRole for garage access
  - Token rotation procedures (mentioned line 157)
  - Kubeconfig context requirements (line 166)
- **Specific Authentication Elements:**
  - OpenBao token permissions and policies
  - K8s ClusterRole/ClusterRoleBinding templates
  - Token rotation documentation
  - Verification procedures for both OpenBao and K8s access

---

## Moderate-Relevance Files (Authentication Context)

### 3. iad-acb-node-2-cni-investigation.md
- **Path:** docs/notes/iad-acb-node-2-cni-investigation.md
- **Relevance:** MODERATE
- **Key Topics:**
  - Kubeconfig access limitations (line 71)
  - Calico CNI pod authentication issues
  - Image pull authentication (Docker Hub rate limiting)
  - Read-only kubeconfig troubleshooting constraints
- **Specific Authentication Elements:**
  - Read-only kubeconfig limiting troubleshooting
  - Container registry authentication issues

---

## Low/Minimal-Relevance Files (Passing Mentions)

### 4. nd-4mf5.md, nd-4p8p.md, nd-53wv.md
- **Relevance:** MINIMAL
- **Content:** These files contain "deploy authority" headers mentioning k8s/iad-ci/argo-workflows/ but are primarily about GitOps deployment procedures, not authentication

### 5. features.md
- **Relevance:** MINIMAL
- **Content:** Only mentions that "Account creation / authentication" is "Out of Scope for v1" - indicates what's NOT implemented, not authentication procedures

### 6. track-json-schema.md
- **Relevance:** NONE
- **Content:** False positive on "friction coefficient" - not related to authentication

### 7. workflowtemplate-deduplication-analysis.md
- **Relevance:** MINIMAL
- **Content:** Mentions secret wiring in passing context of WorkflowTemplate deduplication

---

## Summary

**Total Files Scanned:** 17 markdown files in docs/notes/
**Files with Authentication Content:** 7
**High-Relevance Files:** 2 (access-setup-guide.md, infrastructure-access-request.md)
**Moderate-Relevance Files:** 1 (iad-acb-node-2-cni-investigation.md)
**Low/Minimal-Relevance Files:** 4

### Recommended Next Steps

For analysis of authentication/tokens/kubeconfigs/iad-ci/ServiceAccount issues:

**Primary Focus:**
1. `access-setup-guide.md` - OpenBao tokens and credential setup
2. `infrastructure-access-request.md` - Token requirements, RBAC, rotation procedures

**Secondary Focus:**
3. `iad-acb-node-2-cni-investigation.md` - Kubeconfig access limitations

**Excluded from Analysis:**
- Files with only passing mentions of deploy authority headers
- Files with friction coefficient false positives
- Files noting authentication as out-of-scope
