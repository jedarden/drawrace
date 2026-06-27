# Rotate Client Key Setup

The `rotate-client-key` step in the DrawRace CI workflow needs a kubeconfig secret to access the `iad-acb` cluster and update the `drawrace-client-key` ConfigMap.

## Prerequisites

1. The RBAC resources must be applied to the `iad-acb` cluster:
   ```bash
   kubectl --kubeconfig=/path/to/iad-acb.kubeconfig apply -f k8s/iad-acb-drawrace-rotate-key-rbac.yaml
   ```

2. You need kubeconfig access to both `iad-ci` (where the workflow runs) and `iad-acb` (where the ConfigMap lives).

## Creating the Kubeconfig Secret

### Step 1: Get the iad-acb cluster endpoint

```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig config view --minify -o jsonpath='{.clusters[0].cluster.server}'
```

### Step 2: Get the drawrace-rotate-key ServiceAccount token

```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig -n drawrace get serviceaccount drawrace-rotate-key \
  -o jsonpath='{.secrets[0].name}' \
  | xargs kubectl --kubeconfig=/path/to/iad-acb.kubeconfig -n drawrace get secret \
  -o jsonpath='{.data.token}' | base64 -d > /tmp/sa-token.txt
```

### Step 3: Get the cluster CA certificate

```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig config view --minify -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d > /tmp/ca.crt
```

### Step 4: Create the kubeconfig file

```bash
cat > /tmp/drawrace-iad-acb-kubeconfig.yaml <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: iad-acb
    cluster:
      certificate-authority: /tmp/ca.crt
      server: $(kubectl --kubeconfig=/path/to/iad-acb.kubeconfig config view --minify -o jsonpath='{.clusters[0].cluster.server}')
users:
  - name: drawrace-rotate-key
    user:
      token: $(cat /tmp/sa-token.txt)
contexts:
  - name: drawrace-rotate-key-context
    context:
      cluster: iad-acb
      user: drawrace-rotate-key
current-context: drawrace-rotate-key-context
EOF
```

Or use this simpler one-liner (includes CA inline):

```bash
kubectl --kubeconfig=/path/to/iad-acb.kubeconfig config view --minify --flatten > /tmp/drawrace-iad-acb-kubeconfig.yaml
# Then replace the user token with the SA token
SA_TOKEN=$(kubectl --kubeconfig=/path/to/iad-acb.kubeconfig -n drawrace get serviceaccount drawrace-rotate-key -o jsonpath='{.secrets[0].name}' | xargs kubectl --kubeconfig=/path/to/iad-acb.kubeconfig -n drawrace get secret -o jsonpath='{.data.token}' | base64 -d)
yq eval '.users[0].user.token = strenv(SA_TOKEN)' --inplace /tmp/drawrace-iad-acb-kubeconfig.yaml
```

### Step 5: Create the secret in iad-ci argo-workflows namespace

```bash
kubectl --kubeconfig=/path/to/iad-ci.kubeconfig -n argo-workflows create secret generic drawrace-iad-acb-kubeconfig \
  --from-file=config.yaml=/tmp/drawrace-iad-acb-kubeconfig.yaml
```

## Verification

Test that the secret works:

```bash
kubectl --kubeconfig=/tmp/drawrace-iad-acb-kubeconfig.yaml -n drawrace get configmap drawrace-client-key
```

You should see the ConfigMap (if it exists) or a "not found" error (which is fine - it means authentication worked).

## Troubleshooting

### Secret is marked optional in the WorkflowTemplate

The `rotate-client-key` step will be skipped if the secret doesn't exist (see `optional: true` in the volume definition). This allows the workflow to run in environments where cross-cluster access isn't set up yet.

### Permission errors

If you see permission errors, verify:
1. The RBAC resources were applied to `iad-acb`
2. The ServiceAccount token is valid (tokens expire after 1 year in some clusters)
3. The token has the correct permissions (`get`, `update`, `create` on `configmaps` in the `drawrace` namespace)

### Cluster not reachable from iad-ci

Ensure network connectivity between `iad-ci` and `iad-acb`. They should be reachable via Tailscale or cluster VPN.
