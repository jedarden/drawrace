# Rotate Client Key Setup

The `rotate-client-key` step in the DrawRace CI workflow needs a kubeconfig secret to access the `rs-manager` cluster and update the `drawrace-client-key` ConfigMap.

## Prerequisites

1. The RBAC resources must be applied to the `rs-manager` cluster:
   ```bash
   kubectl --kubeconfig=/path/to/rs-manager.kubeconfig apply -f k8s/rs-manager-drawrace-rotate-key-rbac.yaml
   ```

   Note: once the ArgoCD `drawrace` Application is syncing this repo's `k8s/` path on rs-manager, these RBAC resources are GitOps-managed and no manual apply is needed.

2. You need kubeconfig access to both `iad-ci` (where the workflow runs) and `rs-manager` (where the ConfigMap lives).

## Automated Setup

`./k8s/setup-rs-manager-kubeconfig-secret.sh <rs-manager-kubeconfig-path> [iad-ci-kubeconfig-path]` performs all the steps below (RBAC apply, token extraction, kubeconfig assembly, secret creation, and verification). Use the manual steps only to debug it.

## Creating the Kubeconfig Secret

### Step 1: Get the rs-manager cluster endpoint

```bash
kubectl --kubeconfig=/path/to/rs-manager.kubeconfig config view --minify -o jsonpath='{.clusters[0].cluster.server}'
```

### Step 2: Get the drawrace-rotate-key ServiceAccount token

```bash
kubectl --kubeconfig=/path/to/rs-manager.kubeconfig -n drawrace get serviceaccount drawrace-rotate-key \
  -o jsonpath='{.secrets[0].name}' \
  | xargs kubectl --kubeconfig=/path/to/rs-manager.kubeconfig -n drawrace get secret \
  -o jsonpath='{.data.token}' | base64 -d > /tmp/sa-token.txt
```

### Step 3: Get the cluster CA certificate

```bash
kubectl --kubeconfig=/path/to/rs-manager.kubeconfig config view --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > /tmp/ca.crt
```

### Step 4: Create the kubeconfig file

```bash
cat > /tmp/drawrace-rs-manager-kubeconfig.yaml <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: rs-manager
    cluster:
      certificate-authority: /tmp/ca.crt
      server: $(kubectl --kubeconfig=/path/to/rs-manager.kubeconfig config view --minify -o jsonpath='{.clusters[0].cluster.server}')
users:
  - name: drawrace-rotate-key
    user:
      token: $(cat /tmp/sa-token.txt)
contexts:
  - name: drawrace-rotate-key-context
    context:
      cluster: rs-manager
      user: drawrace-rotate-key
current-context: drawrace-rotate-key-context
EOF
```

Or use this simpler one-liner (includes CA inline):

```bash
kubectl --kubeconfig=/path/to/rs-manager.kubeconfig config view --minify --flatten > /tmp/drawrace-rs-manager-kubeconfig.yaml
# Then replace the user token with the SA token
SA_TOKEN=$(kubectl --kubeconfig=/path/to/rs-manager.kubeconfig -n drawrace get serviceaccount drawrace-rotate-key -o jsonpath='{.secrets[0].name}' | xargs kubectl --kubeconfig=/path/to/rs-manager.kubeconfig -n drawrace get secret -o jsonpath='{.data.token}' | base64 -d)
yq eval '.users[0].user.token = strenv(SA_TOKEN)' --inplace /tmp/drawrace-rs-manager-kubeconfig.yaml
```

### Step 5: Create the secret in iad-ci argo-workflows namespace

```bash
kubectl --kubeconfig=/path/to/iad-ci.kubeconfig -n argo-workflows create secret generic drawrace-rs-manager-kubeconfig \
  --from-file=config.yaml=/tmp/drawrace-rs-manager-kubeconfig.yaml
```

## Verification

Test that the secret works:

```bash
kubectl --kubeconfig=/tmp/drawrace-rs-manager-kubeconfig.yaml -n drawrace get configmap drawrace-client-key
```

You should see the ConfigMap (if it exists) or a "not found" error (which is fine - it means authentication worked).

## Troubleshooting

### Secret is marked optional in the WorkflowTemplate

The `rotate-client-key` step will be skipped if the secret doesn't exist (see `optional: true` in the volume definition). This allows the workflow to run in environments where cross-cluster access isn't set up yet.

### Permission errors

If you see permission errors, verify:
1. The RBAC resources were applied to `rs-manager`
2. The ServiceAccount token is valid (tokens expire after 1 year in some clusters)
3. The token has the correct permissions (`get`, `update`, `create` on `configmaps` in the `drawrace` namespace)

### Cluster not reachable from iad-ci

Ensure network connectivity between `iad-ci` and `rs-manager`. They are reachable via Tailscale (the rs-manager kubectl-proxy is exposed through the `traefik-rs-manager:8001` `kubectl-tcp` entrypoint).
