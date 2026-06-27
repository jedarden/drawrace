# Setup for drawrace-build rotate-client-key Cross-Cluster Access

This document describes how to set up the kubeconfig secret that allows the `drawrace-build` workflow on iad-ci to update ConfigMaps on iad-acb.

## Problem

The `rotate-client-key` step in drawrace-build runs on iad-ci but needs to update the `drawrace-client-key` ConfigMap in the drawrace namespace on iad-acb.

## Solution

Create a kubeconfig secret in iad-ci's argo-workflows namespace that points to iad-acb, using a ServiceAccount token with limited RBAC.

## Prerequisites

- Access to both iad-ci and iad-acb clusters via kubectl
- The RBAC manifests from `iad-acb-drawrace-rotate-key-rbac.yaml` already applied to iad-acb

## Step-by-Step Setup

### 1. Apply RBAC manifests to iad-acb

```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig \
  apply -f k8s/iad-acb-drawrace-rotate-key-rbac.yaml
```

This creates:
- ServiceAccount `drawrace-rotate-key` in drawrace namespace
- Role `drawrace-rotate-key` with get/update/create on configmaps
- RoleBinding binding the SA to the Role

### 2. Get the iad-acb cluster endpoint

```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig config view \
  -o jsonpath='{.clusters[0].cluster.server}'
```

Example output: `https://10.0.0.1:443`

### 3. Get the ServiceAccount token

```bash
SA_SECRET_NAME=$(kubectl --kubeconfig=/path/to/iad-acb.kubeconfig \
  -n drawrace get serviceaccount drawrace-rotate-key \
  -o jsonpath='{.secrets[0].name}')

kubectl --kubeconfig=/path/to/iad-acb.kubeconfig \
  -n drawrace get secret "$SA_SECRET_NAME" \
  -o jsonpath='{.data.token}' | base64 -d
```

Copy the output token.

### 4. Get the iad-acb CA certificate

```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig config view \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d
```

Save the output to a file (e.g., `iad-acb-ca.crt`).

### 5. Create the kubeconfig file

Create a file named `drawrace-iad-acb-kubeconfig.yaml`:

```yaml
apiVersion: v1
kind: Config
clusters:
  - cluster:
      certificate-authority-data: <base64-encoded-ca-from-step-4>
      server: <cluster-endpoint-from-step-2>
    name: iad-acb
users:
  - user:
      token: <token-from-step-3>
    name: drawrace-rotate-key
contexts:
  - context:
      cluster: iad-acb
      user: drawrace-rotate-key
    name: drawrace-rotate-key@iad-acb
current-context: drawrace-rotate-key@iad-acb
```

### 6. Create the secret in iad-ci argo-workflows namespace

```bash
kubectl --kubeconfig=/path/to/iad-ci.kubeconfig \
  -n argo-workflows create secret generic drawrace-iad-acb-kubeconfig \
  --from-file=config.yaml=drawrace-iad-acb-kubeconfig.yaml \
  --dry-run=client -o yaml | kubectl apply -f -
```

Or directly:

```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig \
  -n argo-workflows create secret generic drawrace-iad-acb-kubeconfig \
  --from-file=config.yaml=drawrace-iad-acb-kubeconfig.yaml
```

### 7. Verify the setup

Test that the workflow can use the kubeconfig:

```bash
# From an iad-ci pod (or locally with iad-ci context)
kubectl --kubeconfig=/path/to/iad-ci.kubeconfig \
  -n argo-workflows get secret drawrace-iad-acb-kubeconfig \
  -o jsonpath='{.data.config}' | base64 -d > /tmp/test-kubeconfig

KUBECONFIG=/tmp/test-kubeconfig kubectl -n drawrace get configmap drawrace-client-key
```

This should succeed and show the ConfigMap.

## Security Notes

- The ServiceAccount has minimal RBAC: only get/update/create on configmaps in the drawrace namespace
- The token is long-lived (ServiceAccount tokens don't expire unless the SA is deleted)
- Consider using short-lived tokens via TokenRequest if you need tighter security
- The secret is in the argo-workflows namespace on iad-ci, which is managed by ArgoCD

## Troubleshooting

### "namespace drawrace not found" error

This means the kubeconfig is still pointing to iad-ci instead of iad-acb. Verify:
1. The `server` URL in the kubeconfig points to iad-acb
2. The `current-context` is set correctly
3. The secret was mounted in the workflow pod

### "permission denied" error

Check that:
1. The RBAC manifests were applied to iad-acb
2. The ServiceAccount token in the kubeconfig is valid and not expired
3. The RoleBinding references the correct ServiceAccount

### "certificate signed by unknown authority" error

Verify:
1. The CA certificate data in the kubeconfig is correct and base64-encoded
2. You used `certificate-authority-data`, not `certificate-authority`

## Alternative: Using sealed-secrets

If you prefer to store the kubeconfig as a sealed-secret:

```bash
# From a machine with kubeseal and access to iad-ci
kubeseal --format=yaml --controller-namespace=sealed-secrets \
  < drawrace-iad-acb-kubeconfig-raw-secret.yaml \
  > drawrace-iad-acb-kubeconfig-sealed-secret.yaml
```

Then commit the sealed-secret to git and apply via ArgoCD.
