# Cluster Endpoint Validation Scripts

This directory contains scripts to validate the iad-ci cluster kubeconfig and extract the cluster endpoint.

## Scripts

### verify-cluster-endpoint.sh

Basic validation script that:
- Verifies kubeconfig exists at `/home/coding/.kube/iad-ci.kubeconfig`
- Checks kubeconfig is readable
- Extracts server endpoint URL
- Validates URL format
- Extracts hostname
- Tests DNS resolution (best-effort)

**Usage:**
```bash
bash scripts/verify-cluster-endpoint.sh
```

### tests/cluster-endpoint.test.sh

Comprehensive test suite with 10 validation tests:
1. Kubeconfig file existence
2. Kubeconfig readability
3. Server endpoint extraction (grep method)
4. Server endpoint extraction (kubectl method)
5. Extraction method consistency
6. URL format validation
7. HTTPS protocol verification
8. Hostname extraction
9. Domain validation (spot.rackspace.com)
10. YAML structure validation

**Usage:**
```bash
bash tests/cluster-endpoint.test.sh
```

**Expected Output:**
```
=== iad-ci Cluster Endpoint Validation Tests ===

Test 1: Verify kubeconfig file exists
✓ PASS: Kubeconfig exists

Test 2: Verify kubeconfig is readable
✓ PASS: Kubeconfig readable

...

=== Test Summary ===
Passed: 10
Failed: 0
Total: 10

All tests passed!

Cluster Endpoint: https://hcp-de5bec10-ce14-4eed-a6f4-750f3fd3a89a.spot.rackspace.com
Hostname: hcp-de5bec10-ce14-4eed-a6f4-750f3fd3a89a.spot.rackspace.com
Status: ✅ Valid
```

## Cluster Endpoint Details

**Kubeconfig Path:** `/home/coding/.kube/iad-ci.kubeconfig`

**Server Endpoint:** `https://hcp-de5bec10-ce14-4eed-a6f4-750f3fd3a89a.spot.rackspace.com`

**Cluster Name:** `iad-ci`

**Context:** `iad-ci` (namespace: `argo-workflows`, user: `argocd-manager`)

**Authentication:** ServiceAccount token (argocd-manager)

## Validation Criteria

The endpoint must:
- ✅ Exist in the kubeconfig file
- ✅ Be readable by the current user
- ✅ Use HTTPS protocol
- ✅ Have valid URL format (`https://hostname[:port][/path]`)
- ✅ Extract a valid hostname
- ✅ Use Rackspace Spot domain (`*.spot.rackspace.com`)
- ✅ Be extractable via both grep and kubectl methods
- ✅ Have valid YAML kubeconfig structure

## Dependencies

- `bash` (shell interpreter)
- `kubectl` (for kubectl-based extraction tests)
- `grep`, `awk`, `sed` (standard Unix utilities)
- `nslookup` (optional, for DNS resolution test)

## Notes

- DNS resolution may fail in isolated environments but does not indicate endpoint invalidity
- The ServiceAccount token in the kubeconfig may expire and require refresh
- Both grep and kubectl extraction methods are tested to ensure consistency
