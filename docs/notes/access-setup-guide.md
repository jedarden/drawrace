# Quick Setup Guide - Once Access is Granted

This guide provides the exact commands to run once you receive OpenBao and K8s access credentials.

## 1. OpenBao Setup

### Export Credentials
```bash
# Add to ~/.bashrc or ~/.zshrc for persistence
export OPENBAO_TOKEN="<your-root-token>"
export OPENBAO_ADDR="http://openbao.<namespace>.svc.cluster.local:8200"
```

### Verify Access
```bash
cd /home/coding/drawrace
./scripts/verify-openbao-access.sh
```

### Create DrawRace Secrets
```bash
# Postgres credentials
vault kv put drawrace/postgres \
  host=postgres.drawrace.svc.cluster.local \
  user=drawrace \
  password=<secure-password> \
  database=drawrace

# Garage S3 credentials
vault kv put drawrace/garage \
  endpoint=garage.ardenone-hub.tail1b1987.ts.net \
  access_key=<access-key> \
  secret_key=<secret-key> \
  bucket=drawrace-ghosts

# Cloudflare API token
vault kv put drawrace/cloudflare \
  api_token=<cf-api-token> \
  account_id=<cf-account-id>

# HMAC signing key (for client submissions)
vault kv put drawrace/hmac \
  client_shared_key=<32-byte-hex-key>
```

## 2. Kubernetes Setup

### Set Context
```bash
# List available contexts
kubectl config get-contexts

# Use iad-acb context
kubectl config use-context <iad-acb-context>
```

### Verify Access
```bash
cd /home/coding/drawrace
./scripts/verify-k8s-garage-access.sh
```

### Create Garage Resources
```bash
# Apply garage-operator manifests
kubectl apply -f - <<EOF
apiVersion: garage-operator.dowel.ai/v1alpha1
kind: GarageBucket
metadata:
  name: drawrace-ghosts
  namespace: garage-operator
spec:
  region: default
  quota: 10737418240  # 10GB
---
apiVersion: garage-operator.dowel.ai/v1alpha1
kind: GarageKey
metadata:
  name: drawrace-ghosts-key
  namespace: garage-operator
spec:
  bucketName: drawrace-ghosts
  permissions:
    read: true
    write: true
EOF

# Get the credentials (output contains accessKeyId and secretAccessKey)
kubectl get garagekey drawrace-ghosts-key -n garage-operator -o yaml
```

## 3. Deploy DrawRace

```bash
# Apply all manifests
kubectl apply -f k8s/iad-acb/drawrace/

# Wait for pods
kubectl wait --for=condition=ready pod -l app=drawrace-api -n drawrace --timeout=5m

# Check status
kubectl get pods -n drawrace
kubectl get svc -n drawrace
kubectl get ingress -n drawrace
```

## 4. Verify Endpoints

```bash
# Check health endpoint
curl https://api-drawrace.ardenone.com/v1/health

# Expected response:
# {
#   "api": {"ok": true, "version": "..."},
#   "validator": {"physics_version": N, "ok": true, "age_seconds": N}
# }
```

## 5. Update CI/CD Secrets

Once everything is working, update the declarative-config repo:

```bash
cd /path/to/declarative-config

# SealedSecrets will be created from the above secrets
# These are committed to git and synced by ArgoCD
```

## Troubleshooting

### OpenBao connection issues
```bash
# Check if OpenBao is running
kubectl get pods -n <openbao-namespace>

# Check service endpoint
kubectl get svc -n <openbao-namespace>
```

### K8s permission denied
```bash
# Check current user
kubectl auth whoami

# Test specific permissions
kubectl auth can-i create garagebucket -n garage-operator
kubectl auth can-i create deployment -n drawrace
```

### Garage resources not created
```bash
# Check garage-operator pods
kubectl get pods -n garage-operator

# Check CRD is installed
kubectl get crd | grep garage

# Check events
kubectl get events -n garage-operator --sort-by='.lastTimestamp'
```
