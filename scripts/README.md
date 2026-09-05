# Cluster Endpoint Validation Scripts

This directory contains scripts to validate the iad-ci cluster kubeconfig and extract the cluster endpoint.

## Scripts

### verify-cluster-endpoint.sh

Validation script that:
- Verifies kubeconfig exists at `/home/coding/.kube/iad-ci.kubeconfig`
  (overridable as the first argument, for testing against fixtures)
- Checks kubeconfig is readable
- Extracts the server endpoint via the canonical kubectl jsonpath:
  `kubectl --kubeconfig=<path> config view --minify -o jsonpath="{.clusters[0].cluster.server}"`
- Errors and exits 1 if the endpoint is empty or malformed
- Validates URL format and extracts the hostname
- Tests DNS resolution (best-effort; skipped with `DRAWRACE_SKIP_DNS=1`)

**Exit codes:** `0` on success, `1` on any failure (missing/unreadable
kubeconfig, kubectl error, empty endpoint, invalid URL format).

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

### tests/endpoint-validation.test.sh

Table-driven tests for `verify-cluster-endpoint.sh` that exercise **both exit
paths** against mock kubeconfig fixtures (drawrace-7c86174e), so the exit-code
contract is verified rather than asserted:

| Fixture | Expected |
|---|---|
| valid https endpoint | exit 0, `SUCCESS: Endpoint extracted: <url>` |
| empty `server:` | exit 1, `ERROR: Failed to extract endpoint from kubeconfig` |
| malformed (non-URL) `server:` | exit 1, `ERROR: Invalid URL format` |
| missing kubeconfig file | exit 1, `Kubeconfig not found` |

**Usage:**
```bash
bash tests/endpoint-validation.test.sh
```

**Expected Output:**
```
✓ PASS: valid endpoint → exit 0 + SUCCESS message
✓ PASS: empty endpoint → exit 1 + ERROR message
✓ PASS: malformed endpoint → exit 1 + format ERROR
✓ PASS: missing kubeconfig → exit 1

Passed: 4
Failed: 0
All endpoint validation tests passed!
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
