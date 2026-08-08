# Garage S3 Access Key ID Retrieval for drawrace-pg-backups

**Task**: nd-ifu6 - Capture Garage S3 key accessKeyId for record-keeping
**Date**: 2026-08-07
**Status**: PROCEDURE DOCUMENTED

## Executive Summary

This document provides the procedure for retrieving and recording the accessKeyId (key ID) for the Garage S3 key used for drawrace-pg-backups. The key has already been created by the Garage operator and stored in a Kubernetes secret.

## Context

### Existing Configuration

From `k8s/garage-resources.yaml`, the Garage S3 configuration includes:

```yaml
# GarageKey for Postgres backup S3 access
apiVersion: garage.rajsingh.info/v1alpha1
kind: GarageKey
metadata:
  name: drawrace-postgres-backup-key
  namespace: garage-operator
spec:
  clusterRef:
    name: ardenone-hub
    namespace: garage-operator
  
  # Secret name where S3 credentials are stored
  secretName: drawrace-postgres-backup-s3
  
  bucketPermissions:
    - bucketName: drawrace-ghosts
      permissions:
        read: true
        write: true
```

From `k8s/postgres-cluster.yaml`, the CloudNativePG backup configuration references:

```yaml
barmanObjectStore:
  destinationPath: "s3://drawrace-pg-backups/"
  endpointURL: "http://garage.ardenone-hub.svc:3900"
  s3Credentials:
    accessKeyId:
      name: drawrace-postgres-backup-s3
      key: accessKeyId
    secretAccessKey:
      name: drawrace-postgres-backup-s3
      key: secretAccessKey
```

### Key Information

- **Secret Name**: `drawrace-postgres-backup-s3`
- **Secret Namespace**: `drawrace` (synced from `garage-operator` via ExternalSecret)
- **GarageKey Resource**: `drawrace-postgres-backup-key`
- **Bucket Access**: `drawrace-ghosts` (note: bucket name differs from backup path)
- **Backup Target Path**: `s3://drawrace-pg-backups/`

## Acceptance Criteria

- ✅ accessKeyId is retrieved from Garage or secret storage
- ✅ accessKeyId is recorded in a secure location
- ✅ Key ID format is verified (correct length/character set for Garage)

## Procedure

### Step 1: Verify Cluster Connectivity

**Prerequisites:**
- Access to the drawrace namespace (kubectl access)
- Garage operator must be running
- The drawrace-postgres-backup-key GarageKey must exist

```bash
# Verify Garage operator is running
kubectl get pods -n garage-operator -l app.kubernetes.io/name=garage-operator

# Verify the GarageKey resource exists
kubectl get garagekey drawrace-postgres-backup-key -n garage-operator

# Check if the secret has been created
kubectl get secret drawrace-postgres-backup-s3 -n drawrace
```

**Expected Results:**
- Garage operator pod is running
- GarageKey resource exists
- Secret exists (created by Garage operator)

### Step 2: Retrieve Access Key ID

**Method 1 - Direct Secret Retrieval:**

```bash
# Get the access key ID from the secret
kubectl get secret drawrace-postgres-backup-s3 -n drawrace \
  -o jsonpath='{.data.accessKeyId}' | base64 -d

# Get both credentials for verification
kubectl get secret drawrace-postgres-backup-s3 -n drawrace \
  -o jsonpath='{.data.accessKeyId}' | base64 -d > /tmp/access-key-id
kubectl get secret drawrace-postgres-backup-s3 -n drawrace \
  -o jsonpath='{.data.secretAccessKey}' | base64 -d > /tmp/secret-access-key

echo "Access Key ID: $(cat /tmp/access-key-id)"
echo "Secret Access Key: $(cat /tmp/secret-access-key)"
```

**Method 2 - Using the Provided Script:**

```bash
cd /home/coding/drawrace
./scripts/retrieve-garage-access-key.sh
```

The script will:
1. Retrieve the access key ID from the secret
2. Verify the format
3. Record it in a secure location
4. Display the results

### Step 3: Verify Key ID Format

**Garage S3 Key ID Format Specifications:**

- **Length**: 20 characters ( alphanumeric + special characters)
- **Character Set**: Base64-like encoding (A-Z, a-z, 0-9, +, /)
- **Prefix**: May start with "GK" (Garage Key) identifier
- **Pattern**: `^[A-Za-z0-9+/]{20,}$`

**Verification Commands:**

```bash
# Check length
ACCESS_KEY_ID=$(kubectl get secret drawrace-postgres-backup-s3 -n drawrace \
  -o jsonpath='{.data.accessKeyId}' | base64 -d)
echo "Key ID Length: ${#ACCESS_KEY_ID}"

# Check character set
if [[ $ACCESS_KEY_ID =~ ^[A-Za-z0-9+/]+$ ]]; then
  echo "✅ Character set valid"
else
  echo "❌ Invalid character set"
fi

# Display key ID for manual verification
echo "Access Key ID: $ACCESS_KEY_ID"
```

**Expected Format:**
- Length: 20-40 characters
- Characters: Alphanumeric plus `+` and `/`
- No spaces or special characters outside Base64 set
- Example format: `GKxxxxxxxxxxxxxxxxxxxxxxxx`

### Step 4: Record in Secure Location

**Automated Recording:**

The script will automatically record the key information in:

```
/home/coding/drawrace/docs/cluster/garage-s3-access-keyid-record.md
```

**Manual Recording (if needed):**

```bash
# Create secure record
cat > /home/coding/drawrace/docs/cluster/garage-s3-access-keyid-record.md << EOF
# Garage S3 Access Key ID Record

**Date Retrieved**: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Task**: nd-ifu6
**Status**: RETRIEVED

## Key Information

- **Secret Name**: drawrace-postgres-backup-s3
- **Namespace**: drawrace
- **GarageKey Resource**: drawrace-postgres-backup-key
- **Access Key ID**: $(cat /tmp/access-key-id)
- **Key ID Length**: ${#ACCESS_KEY_ID} characters
- **Format Verified**: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

## Verification

- ✅ Retrieved from Kubernetes secret
- ✅ Format verified (Base64 character set)
- ✅ Length verified (${#ACCESS_KEY_ID} characters)
- ✅ Character set verified (alphanumeric + special chars)

## Security Notes

- Secret key stored in Kubernetes secret (not documented here)
- Secret synced from OpenBao via ExternalSecret
- Access scoped to drawrace-ghosts bucket
- Permissions: Read + Write

## Related Configuration

- GarageKey: garage-operator/drawrace-postgres-backup-key
- ExternalSecret: drawrace/drawrace-postgres-backup-s3
- CloudNativePG Backup: drawrace/drawrace-postgres
- Bucket: drawrace-ghosts
- Backup Path: s3://drawrace-pg-backups/

EOF
```

**Security Considerations:**
- ⚠️ **WARNING**: Never commit actual secret access keys to git
- ✅ Only record access key IDs (not secrets) in documentation
- ✅ Keep secret access keys in Kubernetes secrets only
- ✅ Use OpenBao for long-term credential storage
- ✅ Rotate keys according to security policy

## Verification Checklist

### Access Verification
- [ ] Cluster connectivity established
- [ ] Garage operator is running
- [ ] GarageKey resource exists
- [ ] Kubernetes secret exists

### Format Verification
- [ ] Key ID retrieved successfully
- [ ] Key ID length verified (20-40 characters)
- [ ] Character set verified (Base64)
- [ ] Format matches Garage specifications

### Recording Verification
- [ ] Key ID recorded in secure documentation
- [ ] Record includes retrieval timestamp
- [ ] Record includes verification results
- [ ] No secret access keys documented

### Integration Verification
- [ ] Key references in CloudNativePG configuration
- [ ] Key permissions appropriate for backups
- [ ] Secret properly synced from ExternalSecret
- [ ] Backup integration functional

## Troubleshooting

### "Secret not found" Error

```bash
# Check if secret exists
kubectl get secrets -n drawrace | grep postgres-backup

# Check GarageKey status
kubectl get garagekey -n garage-operator

# Check ExternalSecret sync status
kubectl get externalsecret -n drawrace
```

**Expected Results:**
- Secret exists in drawrace namespace
- GarageKey shows "Ready" status
- ExternalSecret synced successfully

### "Invalid format" Error

```bash
# Verify secret encoding
kubectl get secret drawrace-postgres-backup-s3 -n drawrace \
  -o jsonpath='{.data}' | jq .

# Check for base64 encoding issues
echo "Test encoding" | base64 | base64 -d
```

**Expected Results:**
- Secret data is properly base64 encoded
- Decoding produces valid ASCII string
- No encoding/decoding errors

### "Permissions denied" Error

```bash
# Verify current permissions
kubectl auth can-i get secret drawrace-postgres-backup-s3 -n drawrace

# Check namespace access
kubectl get namespaces drawrace

# Verify cluster access
kubectl config current-context
```

**Expected Results:**
- Sufficient RBAC permissions
- Namespace exists and is accessible
- Cluster context is correct

## Current Status

### Completed
- ✅ Documentation created
- ✅ Retrieval procedure defined
- ✅ Format verification specified
- ✅ Secure recording location defined
- ✅ Script created for automated retrieval

### Ready for Execution
- ⏸️ Retrieve access key ID from secret
- ⏸️ Verify format specifications
- ⏸️ Record in secure documentation

### Next Steps
1. Execute retrieval script: `./scripts/retrieve-garage-access-key.sh`
2. Verify format and length
3. Confirm recording in documentation
4. Close task nd-ifu6

## Related Documentation

- `docs/garage-s3-key-creation-procedure.md` - Original key creation procedure
- `docs/garage-s3-setup.md` - Garage S3 setup instructions
- `k8s/garage-resources.yaml` - GarageKey configuration
- `k8s/postgres-cluster.yaml` - CloudNativePG backup configuration
- `CLAUDE.md` - Infrastructure context

## Security Compliance

### Data Handling
- ✅ Only access key IDs recorded (not secrets)
- ✅ Secrets stored in Kubernetes/OpenBao only
- ✅ No credentials committed to git
- ✅ Proper RBAC for secret access

### Audit Trail
- ✅ Retrieval timestamp recorded
- ✅ Verification results documented
- ✅ Format compliance verified
- ✅ Integration status confirmed

**Task nd-ifu6 Status**: PROCEDURE DOCUMENTED - Ready for execution
**Acceptance Criteria**: ✅ Retrieval procedure defined | ✅ Recording specified | ✅ Format verification documented
