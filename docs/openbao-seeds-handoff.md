# OpenBao Root Token and K8s Access Verification

## Status

**BLOCKER**: Waiting on infrastructure team to provision:
1. OpenBao root token (or permission to create one)
2. Cluster admin permissions on iad-acb cluster

## What Was Done

✅ **Created verification scripts** to test credentials once provisioned:
- `scripts/verify-openbao.sh` - Tests OpenBao token access
- `scripts/verify-k8s-auth.sh` - Tests Kubernetes permissions

These scripts are ready to run immediately once credentials are obtained.

## What Remains (Requires Human Action)

❌ **Contact infrastructure team** to request:
1. OpenBao root token (or permission to create one)
2. Cluster admin permissions on iad-acb cluster

This cannot be automated - it requires a human to make the request and receive credentials.

## What This Bead Does

This bead (`nd-1fkb`) tracks obtaining infrastructure access required for all subsequent DrawRace deployment work. Without these credentials, we cannot:
- Write secrets to OpenBao (Postgres password, S3 credentials, API keys)
- Create Kubernetes resources (GarageBucket, GarageKey, namespaces, deployments)
- Proceed with any infrastructure setup

## Verification Scripts

Two verification scripts have been created to test credentials once provisioned:

### 1. OpenBao Token Verification

```bash
# Set your token and run
OPENBAO_TOKEN=<your-token> ./scripts/verify-openbao.sh
```

This script verifies:
- Token is valid and not expired
- Token can list secrets in `/drawrace`
- Token can write secrets to `/drawrace`
- Cleanup of test secret

### 2. Kubernetes Permissions Verification

```bash
# Using iad-acb kubeconfig
KUBECONFIG=~/.kube/iad-acb.kubeconfig ./scripts/verify-k8s-auth.sh
```

This script verifies:
- Basic cluster access
- Can create namespaces
- Can create/get/delete `GarageBucket` resources in `garage-operator` namespace
- Can create/get/delete `GarageKey` resources in `garage-operator` namespace
- Can create `drawrace` namespace

## Acceptance Criteria

- [ ] OpenBao root token obtained and exported as `OPENBAO_TOKEN`
- [ ] Cluster admin permissions on iad-acb granted
- [ ] Can create `GarageBucket` and `GarageKey` resources in `garage-operator` namespace
- [ ] Both verification scripts pass

## Next Steps (After Credentials)

Once credentials are obtained and verified:

1. **Create OpenBao secrets structure**:
   ```
   /drawrace/postgres/password
   /drawrace/garage/access_key
   /drawrace/garage/secret_key
   /drawrace/cloudflare/api_token
   ```

2. **Create Kubernetes namespace**:
   ```bash
   kubectl create namespace drawrace
   ```

3. **Create Garage resources** for ghost blob storage:
   ```bash
   kubectl apply -f - <<EOF
   apiVersion: garage.deuxfleurs.fr/v1alpha1
   kind: GarageBucket
   metadata:
     name: drawrace-ghosts
     namespace: garage-operator
   spec:
     # ...
   EOF
   ```

## Contact

**Infrastructure team contact**: TBD

**Bead**: `nd-1fkb`
**Created**: 2025-01-XX
**Blocked**: Yes - waiting on infrastructure team
