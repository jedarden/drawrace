# kubeconfig Authentication Error Diagnosis

**Date:** 2026-09-01
**Bead:** drawrace-a7e90a04
**Related Bead:** drawrace-7278eb41 (connectivity test)

## Error Type

**Classification:** Authentication Error - Expired/Invalid Credentials
**Severity:** P2 (blocks workflow verification and deployment checks)
**Category:** kubeconfig authentication failure

## Error Message

```
Client Version: v1.33.3
Kustomize Version: v5.6.0
error: You must be logged in to the server (the server has asked the client to provide credentials)
```

## Analysis

### What the error tells us

1. **Network connectivity is OK** - The kubectl client successfully connected to the iad-ci cluster and retrieved client version information. This proves:
   - The cluster endpoint is reachable
   - DNS resolution works
   - Network routing is functional
   - The kubeconfig file exists and is readable

2. **Server is responding** - The cluster API server is running and accepting connections.

3. **Authentication failed** - The server explicitly rejected the credentials with "You must be logged in to the server (the server has asked the client to provide credentials, credentials have been rejected)". This is the classic Kubernetes authentication failure message.

### Distinguishing from other failure modes

| Failure Mode | How to distinguish | This case |
|-------------|-------------------|-----------|
| **Expired token** | "credentials have been rejected" or "must be logged in" | ✅ **Matches** |
| **Invalid certificate** | TLS handshake errors, x509 certificate errors | ❌ Not present |
| **Cluster unreachable** | Connection timeouts, "no route to host", DNS failures | ❌ Not present (server responded) |
| **RBAC authorization** | "User ... is not authorized" after successful auth | ❌ Not present (auth failed before RBAC check) |
| **Wrong context/cluster** | Would fail to find cluster endpoint or reach wrong server | ❌ Not present (reached correct iad-ci cluster) |

## Root Cause

**Expired ServiceAccount token**

The `/home/coding/.kube/iad-ci.kubeconfig` file contains a ServiceAccount token for the `argocd-manager` account that expired on **2024-06-07** (per `memory/iad-ci-kubeconfig-expired.md`).

Kubernetes ServiceAccount tokens have a limited lifespan. When they expire, the API server will reject any authentication attempts using the old token with the exact error message we see here.

### Evidence chain

1. **Memory file** (`memory/iad-ci-kubeconfig-expired.md`) explicitly states: "argocd-manager ServiceAccount token expired (2024-06-07)"
2. **Error pattern** matches expired token behavior: server reachable → credentials rejected
3. **Timeline consistency**: Token expired 2024-06-07, current date is 2026-09-01 (over 2 years expired)

## Resolution Path

### Required actions

1. **Generate new ServiceAccount token** in the iad-ci cluster for the `argocd-manager` ServiceAccount
2. **Update kubeconfig** - Replace the expired token in `/home/coding/.kube/iad-ci.kubeconfig` with the fresh token
3. **Verify permissions** - Ensure the new token has the necessary RBAC permissions (should match previous argocd-manager role)

### Verification steps

After applying the fix, run:
```bash
kubectl --kubeconfig=/home/coding/.kube/iad-ci.kubeconfig version --request-timeout=10s
```

Expected result:
```
Client Version: v1.33.3
Kustomize Version: v5.6.0
Server Version: v1.XX.X
```

Both client and server versions should be displayed without authentication errors.

## Impact

### What's blocked
- ✅ **Workflow log verification** - Cannot access Argo Workflow logs on iad-ci
- ✅ **Cloudflare Pages deployment checks** - Cannot verify deployment status
- ✅ **Any authenticated kubectl operations** - All admin operations on iad-ci cluster

### What's NOT blocked
- ~~Network connectivity~~ - Cluster is reachable
- ~~Basic cluster operations~~ - Read-only access via proxy may still work (if using different auth path)

## Related documentation

- `memory/iad-ci-kubeconfig-expired.md` - Original token expiration record
- `docs/connectivity/iad-ci-kubeconfig-test.md` - Full connectivity test results
- `CLAUDE.md` section "Kubernetes Access" - kubeconfig paths and usage

## Conclusion

**Error Type:** Authentication failure due to expired ServiceAccount token
**Resolution:** Token renewal required
**Priority:** P2 (blocks multiple operational tasks but no production outage)
