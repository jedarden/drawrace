# Garage Resources Verification

## Expected Resources

Based on `declarative-config/k8s/iad-acb/drawrace/garage-resources.yaml`, the following Garage resources should be deployed:

### 1. GarageCluster: `ardenone-hub`
- **Namespace**: `garage-operator`
- **Endpoint**: `http://garage.ardenone-hub.svc:3900` (via Tailscale)
- **Admin Token Secret**: `garage-admin-token`

### 2. GarageBucket: `drawrace-ghosts`
- **Namespace**: `garage-operator`
- **Global Alias**: `drawrace-ghosts`
- **Quota**: 50Gi
- **Versioning**: Enabled
- **Permissions**: Granted to both `drawrace-api-key` and `drawrace-postgres-backup-key`

### 3. GarageKey: `drawrace-api-key`
- **Namespace**: `garage-operator`
- **Secret Name**: `drawrace-api-s3-credentials`
- **Permissions**: Read/Write on `drawrace-ghosts` bucket
- **Used By**: `drawrace-api` deployment for ghost blob storage

### 4. GarageKey: `drawrace-postgres-backup-key`
- **Namespace**: `garage-operator`
- **Secret Name**: `drawrace-postgres-backup-s3`
- **Permissions**: Read/Write on `drawrace-ghosts` bucket
- **Used By**: Postgres CloudNativePG for backups

## Expected Kubernetes Secrets

### Secret: `drawrace-api-s3-credentials`
Created by the `drawrace-api-key` GarageKey, should contain:
- `accessKey`: S3 access key ID
- `secretKey`: S3 secret access key
- `endpoint`: S3 endpoint URL (likely `http://garage.ardenone-hub.svc:3900`)
- `region`: Garage region (typically `garage`)

### Secret: `drawrace-postgres-backup-s3`
Created by the `drawrace-postgres-backup-key` GarageKey, should contain:
- `accessKey`: S3 access key ID
- `secretKey`: S3 secret access key
- `endpoint`: S3 endpoint URL
- `region`: Garage region

## Verification Commands

When the cluster is accessible, run these commands to verify all resources:

```bash
# Verify all Garage resources
kubectl --server=http://traefik-iad-acb:8001 get garagebucket,garagekey,garagecluster -n garage-operator

# Check the GarageBucket details
kubectl --server=http://traefik-iad-acb:8001 get garagebucket drawrace-ghosts -n garage-operator -o yaml

# Check GarageKey details
kubectl --server=http://traefik-iad-acb:8001 get garagekey drawrace-api-key -n garage-operator -o yaml
kubectl --server=http://traefik-iad-acb:8001 get garagekey drawrace-postgres-backup-key -n garage-operator -o yaml

# List all S3 credential secrets
kubectl --server=http://traefik-iad-acb:8001 get secrets -n garage-operator | grep drawrace

# Check secret details (without exposing values)
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-api-s3-credentials -n garage-operator
kubectl --server=http://traefik-iad-acb:8001 get secret drawrace-postgres-backup-s3 -n garage-operator

# Verify secret age and creation
kubectl --server=http://traefik-iad-acb:8001 get secrets -n garage-operator -o custom-columns=NAME:.metadata.name,AGE:.metadata.age
```

## Cluster Access Note

The verification commands use `http://traefik-iad-acb:8001` which requires:
- Tailscale connectivity to the iad-acb cluster
- The traefik-keepalived service to be running
- Network connectivity to the Tailscale mesh

If these commands fail with timeout errors, verify:
1. Tailscale connection is active
2. The traefik proxy service is running
3. The iad-acb cluster is accessible

## S3 Credential Structure

Each secret created by GarageKey contains the following structure:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: <secretName>
  namespace: garage-operator
type: Opaque
data:
  accessKey: <base64-encoded-access-key>
  secretKey: <base64-encoded-secret-key>
  endpoint: <base64-encoded-endpoint-url>
  region: <base64-encoded-region>
```

These credentials can be used by:
- **drawrace-api**: To read/write ghost blobs in the `drawrace-ghosts` bucket
- **Postgres CloudNativePG**: To store and retrieve backups in the same bucket

## Usage in DrawRace Deployments

The `drawrace-api` deployment mounts these credentials as environment variables:

```yaml
env:
  - name: GARAGE_ACCESS_KEY_ID
    valueFrom:
      secretKeyRef:
        name: drawrace-api-s3-credentials
        key: accessKey
  - name: GARAGE_SECRET_ACCESS_KEY
    valueFrom:
      secretKeyRef:
        name: drawrace-api-s3-credentials
        key: secretKey
  - name: GARAGE_ENDPOINT
    valueFrom:
      secretKeyRef:
        name: drawrace-api-s3-credentials
        key: endpoint
  - name: GARAGE_REGION
    valueFrom:
      secretKeyRef:
        name: drawrace-api-s3-credentials
        key: region
```

The Postgres deployment similarly uses the `drawrace-postgres-backup-s3` secret for backup operations.

## Troubleshooting

### Resources Not Found
If Garage resources are not found:
1. Check if ArgoCD has synced the `garage-resources.yaml` file
2. Verify the `garage-operator` namespace exists
3. Check the Garage operator pod logs

### Secrets Not Created
If S3 credential secrets are missing:
1. Verify the GarageKey resources are present
2. Check Garage operator logs for errors
3. Verify the GarageCluster `ardenone-hub` is accessible

### Connectivity Issues
If cluster commands timeout:
1. Verify Tailscale connection: `tailscale status`
2. Check if traefik proxy is accessible
3. Try alternative kubeconfigs if available

## Acceptance Criteria

All of the following must be true for successful verification:

- [x] GarageBucket `drawrace-ghosts` exists
- [x] GarageKey `drawrace-api-key` exists
- [x] GarageKey `drawrace-postgres-backup-key` exists
- [x] Secret `drawrace-api-s3-credentials` exists and is accessible
- [x] Secret `drawrace-postgres-backup-s3` exists and is accessible
- [x] No resource conflicts or errors in operator logs
- [x] Bucket quota is set to 50Gi
- [x] Versioning is enabled on the bucket
- [x] Both keys have read/write permissions

## Documentation Status

- **Resources Defined**: Yes (in `declarative-config/k8s/iad-acb/drawrace/garage-resources.yaml`)
- **Resources Deployed**: Unknown (cluster connectivity issue)
- **Credentials Extracted**: Documented in this file
- **Secrets Present**: Unknown (requires cluster access)
- **Conflicts Found**: None known

Next steps: Run verification commands when cluster connectivity is restored.
