# OpenBao Secrets for DrawRace

This document maps all ExternalSecret resources to their required OpenBao secret paths and keys.

## Overview

DrawRace requires 4 ExternalSecrets synced from OpenBao. These secrets are managed by the `openbao` ClusterSecretStore and refreshed every 1 hour.

**Current Sync Status (2026-07-02):**
- ✅ 1 synced: `docker-hub-registry`
- ❌ 3 failing: `drawrace-api-s3-credentials`, `drawrace-postgres-backup-s3`, `drawrace-postgres-credentials`

All failing secrets show: `could not get secret data from provider`

---

## ExternalSecret → OpenBao Path Mapping

### 1. Docker Hub Registry (✅ SYNCED)

**ExternalSecret:** `docker-hub-registry`  
**OpenBao Path:** `ardenone-hub/docker/hub-registry`  
**Target Secret:** `docker-hub-registry` (type: `kubernetes.io/dockerconfigjson`)

#### Required OpenBao Secret Keys

| Property | Description | Format |
|----------|-------------|--------|
| `.dockerconfigjson` | Complete Docker config JSON for registry auth | JSON string |

#### Example OpenBao Secret Structure

```json
{
  ".dockerconfigjson": "{\"auths\":{\"docker.io\":{\"username\":\"...\",\"password\":\"...\",\"auth\":\"...\"}}}"
}
```

#### Kubernetes Secret Usage

- Used by: Argo Workflows (`drawrace-build` template) for Kaniko Docker builds
- Referenced in: `k8s/iad-ci/argo-workflows/drawrace-build.yaml` (volume mount: `docker-config`)

---

### 2. API S3 Credentials (❌ SYNC FAILED)

**ExternalSecret:** `drawrace-api-s3-credentials`  
**OpenBao Path:** `rs-manager/drawrace/s3`  
**Target Secret:** `drawrace-api-s3-credentials`

#### Required OpenBao Secret Keys

| Property | Kubernetes Key | Description | Format |
|----------|----------------|-------------|--------|
| `AWS_ACCESS_KEY_ID` | `AWS_ACCESS_KEY_ID` | Garage S3 access key ID | String |
| `AWS_SECRET_ACCESS_KEY` | `AWS_SECRET_ACCESS_KEY` | Garage S3 secret access key | String |
| `AWS_ENDPOINT_URL` | `AWS_ENDPOINT_URL` | Garage S3 endpoint URL | URL (e.g., `https://s3.ardenone.com`) |
| `AWS_REGION` | `AWS_REGION` | Garage S3 region | String (e.g., `us-east-1`) |

#### Example OpenBao Secret Structure

```json
{
  "AWS_ACCESS_KEY_ID": "...",
  "AWS_SECRET_ACCESS_KEY": "...",
  "AWS_ENDPOINT_URL": "https://s3.ardenone.com",
  "AWS_REGION": "us-east-1"
}
```

#### Kubernetes Secret Usage

- Used by: `drawrace-api` Deployment (S3 client for ghost blob storage)
- Environment variables: `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT`, `S3_REGION`

---

### 3. Postgres Backup S3 Credentials (❌ SYNC FAILED)

**ExternalSecret:** `drawrace-postgres-backup-s3`  
**OpenBao Path:** `rs-manager/drawrace/postgres-backup`  
**Target Secret:** `drawrace-postgres-backup-s3`

#### Required OpenBao Secret Keys

| Property | Kubernetes Key | Description | Format |
|----------|----------------|-------------|--------|
| `accessKeyId` | `accessKeyId` | S3 access key for Postgres backups | String |
| `secretAccessKey` | `secretAccessKey` | S3 secret key for Postgres backups | String |

#### Example OpenBao Secret Structure

```json
{
  "accessKeyId": "...",
  "secretAccessKey": "..."
}
```

#### Kubernetes Secret Usage

- Used by: CloudNativePG `Cluster` backup configuration
- Referenced in: `postgres-cluster.yaml` (backup block shipping to Garage)

---

### 4. Postgres Database Credentials (❌ SYNC FAILED)

**ExternalSecret:** `drawrace-postgres-credentials`  
**OpenBao Path:** `rs-manager/drawrace/postgres`  
**Target Secret:** `drawrace-postgres-credentials`

#### Required OpenBao Secret Keys

| Property | Kubernetes Key | Description | Format |
|----------|----------------|-------------|--------|
| `username` | `username` | Postgres superuser username | String |
| `password` | `password` | Postgres superuser password | String |

#### Example OpenBao Secret Structure

```json
{
  "username": "postgres",
  "password": "..."
}
```

#### Kubernetes Secret Usage

- Used by: `drawrace-api` and `drawrace-validator` Deployments
- Referenced in: `postgres-cluster.yaml` (bootstrap superuser credentials)
- Environment variables: `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`

---

## Secret Store Configuration

All ExternalSecrets use the **same** ClusterSecretStore:

```yaml
secretStoreRef:
  kind: ClusterSecretStore
  name: openbao
```

The `openbao` ClusterSecretStore is defined cluster-wide and provides authentication to the OpenBao server via Tailscale.

---

## Verification Commands

### Check ExternalSecret Sync Status

```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecret -n drawrace
```

### Get Detailed Status

```bash
kubectl --server=http://traefik-iad-acb:8001 get externalsecret -n drawrace -o yaml
```

### Check Synced Kubernetes Secrets

```bash
kubectl --server=http://traefik-iad-acb:8001 get secrets -n drawrace
```

---

## OpenBao Secret Creation Checklist

To create the required secrets in OpenBao:

1. **Docker Hub Registry** (`ardenone-hub/docker/hub-registry`):
   - [ ] Create `.dockerconfigjson` property with valid Docker Hub auth

2. **API S3 Credentials** (`rs-manager/drawrace/s3`):
   - [ ] Create `AWS_ACCESS_KEY_ID` property
   - [ ] Create `AWS_SECRET_ACCESS_KEY` property
   - [ ] Create `AWS_ENDPOINT_URL` property
   - [ ] Create `AWS_REGION` property

3. **Postgres Backup S3** (`rs-manager/drawrace/postgres-backup`):
   - [ ] Create `accessKeyId` property
   - [ ] Create `secretAccessKey` property

4. **Postgres Credentials** (`rs-manager/drawrace/postgres`):
   - [ ] Create `username` property
   - [ ] Create `password` property

---

## Notes

- All secrets refresh every 1 hour (`refreshInterval: 1h`)
- Target secrets use `deletionPolicy: Retain` to prevent accidental deletion
- ExternalSecret operator logs will show detailed error messages for sync failures
- Check ExternalSecret conditions for the specific error message:
  ```bash
  kubectl --server=http://traefik-iad-acb:8001 get externalsecret -n drawrace -o jsonpath='{.items[*].status.conditions}'
  ```
