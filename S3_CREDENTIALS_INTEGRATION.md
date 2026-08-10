# S3 Credentials Integration Guide

**Purpose:** Document how to integrate Garage-generated S3 credentials into drawrace deployments

---

## Auto-Generated S3 Credentials

When the Garage resources are deployed, the garage-operator automatically creates Kubernetes secrets containing S3 credentials:

### drawrace-api-s3-credentials (garage-operator namespace)
Contains:
- `accessKeyId`: S3 access key for API service
- `secretAccessKey`: S3 secret key for API service  
- `endpoint`: S3 endpoint URL (`http://garage.ardenone-hub.svc:3900`)

### drawrace-postgres-backup-s3 (garage-operator namespace)
Contains:
- `accessKeyId`: S3 access key for Postgres backups
- `secretAccessKey`: S3 secret key for Postgres backups
- `endpoint`: S3 endpoint URL

---

## Integration Requirements

### For drawrace-api Deployment

The `k8s/api-deployment.yaml` needs to be updated to reference the S3 credentials from the garage-generated secret. Current configuration shows:

```yaml
env:
  - name: S3_BUCKET
    valueFrom:
      secretKeyRef:
        name: drawrace-api-secrets
        key: S3_BUCKET
```

**Required additions:**
```yaml
  - name: S3_ACCESS_KEY_ID
    valueFrom:
      secretKeyRef:
        name: drawrace-api-s3-credentials
        key: accessKeyId
        namespace: garage-operator  # Cross-namespace reference
  - name: S3_SECRET_ACCESS_KEY  
    valueFrom:
      secretKeyRef:
        name: drawrace-api-s3-credentials
        key: secretAccessKey
        namespace: garage-operator  # Cross-namespace reference
  - name: S3_ENDPOINT
    value: "http://garage.ardenone-hub.svc:3900"
```

**Note:** Cross-namespace secret references require the service account to have appropriate RBAC permissions, or the secrets should be copied to the drawrace namespace.

### For postgres-cluster Configuration

The `k8s/postgres-cluster.yaml` already correctly references the garage-generated secret:

```yaml
barmanObjectStore:
  s3Credentials:
    accessKeyId:
      name: drawrace-postgres-backup-s3
      key: accessKeyId
    secretAccessKey:
      name: drawrace-postgres-backup-s3  
      key: secretAccessKey
```

✅ **Postgres backup configuration is complete and correct.**

---

## Alternative Approach: Secret Copy

If cross-namespace references cause issues, copy the secrets to the drawrace namespace:

```bash
# Copy API S3 credentials to drawrace namespace
kubectl get secret drawrace-api-s3-credentials -n garage-operator -o yaml | \
  sed 's/namespace: garage-operator/namespace: drawrace/' | \
  kubectl apply -n drawrace -f -

# Copy Postgres backup S3 credentials to drawrace namespace  
kubectl get secret drawrace-postgres-backup-s3 -n garage-operator -o yaml | \
  sed 's/namespace: garage-operator/namespace: drawrace/' | \
  kubectl apply -n drawrace -f -
```

Then update the API deployment to reference the local secrets.

---

## Environment Variable Mapping

### Rust API Environment Variables
The `drawrace-api` Rust service expects these environment variables for S3 access:

| Env Var | Source | Purpose |
|---------|--------|---------|
| `S3_BUCKET` | `drawrace-api-secrets.S3_BUCKET` | Bucket name (`drawrace-ghosts`) |
| `S3_ACCESS_KEY_ID` | `drawrace-api-s3-credentials.accessKeyId` | S3 access key |
| `S3_SECRET_ACCESS_KEY` | `drawrace-api-s3-credentials.secretAccessKey` | S3 secret key |
| `S3_ENDPOINT` | Static value | Garage S3 endpoint |

### Postgres Backup Configuration
The CloudNativePG `barmanObjectStore` configuration handles S3 credentials automatically via the secret reference.

---

## Verification Steps

After deployment, verify S3 access:

```bash
# Check if secrets exist
kubectl get secret drawrace-api-s3-credentials -n garage-operator
kubectl get secret drawrace-postgres-backup-s3 -n garage-operator

# Check if API pods can access S3 (if deployed)
kubectl exec -n drawrace deployment/drawrace-api -- env | grep S3

# Test Postgres backup S3 connectivity  
kubectl exec -n drawrace statefulset/drawrace-postgres -- \
  wget --spider http://garage.ardenone-hub.svc:3900
```

---

## Security Considerations

1. **Secret Access Control:** The garage-generated secrets contain sensitive S3 credentials and should only be accessible to the services that need them.
2. **Service Account RBAC:** Ensure proper RBAC rules prevent unauthorized pod access to S3 credentials.
3. **Encryption in Transit:** The Garage endpoint uses HTTP within the Tailscale mesh, which is already encrypted.
4. **Bucket Permissions:** The GarageKeys grant minimal required permissions (read/write for specific buckets only).

---

## Troubleshooting

### Issue: Cross-namespace secret references fail
**Solution:** Copy secrets to the target namespace or enable cross-namespace reference RBAC.

### Issue: API pods can't connect to S3 endpoint  
**Solution:** Verify network policies allow traffic from drawrace namespace to garage-operator namespace.

### Issue: Postgres backups fail with S3 errors
**Solution:** Check that `drawrace-postgres-backup-s3` secret exists and contains valid keys.

---

## Related Documentation

- `GARAGE_RESOURCES_VERIFICATION.md` - Garage resources configuration verification
- `k8s/garage-resources.yaml` - Garage resources definition
- `k8s/api-deployment.yaml` - API deployment configuration  
- `k8s/postgres-cluster.yaml` - Postgres cluster with backup configuration

---

**Status:** ⏸️ Awaiting infrastructure blocker resolution before deployment and S3 credential extraction can be performed.