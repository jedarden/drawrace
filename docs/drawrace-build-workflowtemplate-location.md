# drawrace-build WorkflowTemplate Location

## Finding

The `drawrace-build` WorkflowTemplate is located in the drawrace repo at:

**Full path:** `/home/coding/drawrace/k8s/drawrace-build-workflowtemplate.yml`

## Confirmation

This file is confirmed to be the `drawrace-build` WorkflowTemplate:
- **Kind:** `WorkflowTemplate` 
- **Name:** `drawrace-build`
- **Namespace:** `argo-workflows`

## File Contents

The file contains the complete Argo Workflows CI/CD pipeline for DrawRace with the following DAG tasks:

1. **checkout** - Git checkout from git.ardenone.com
2. **get-git-sha** - Extract git short SHA for Docker image tagging
3. **rotate-client-key** - Update drawrace-client-key ConfigMap in declarative-config
4. **lint** - Rust lint (clippy/fmt) for api, validator, and live crates
5. **test** - Rust tests for all three crates
6. **lint-js/test-js** - pnpm lint and vitest
7. **size-limit** - Bundle size enforcement
8. **build-client-wasm** - Build engine-core.wasm for physics parity
9. **read-expected-wasm-sha** - Extract WASM content hash
10. **read-expected-physics-version** - Extract PHYSICS_VERSION constant
11. **build-api/validator/live** - Kaniko Docker builds with git SHA tags
12. **bump-manifest** - Update declarative-config images.txt
13. **wait-validator-live** - Poll validator health endpoint for version and WASM SHA parity
14. **wrangler-pages** - Deploy to Cloudflare Pages
15. **submit-drawrace-ci** - Trigger downstream CI workflow

## Related Files

- `k8s/drawrace-ci-workflowtemplate.yml` - The downstream CI workflow triggered by build

## Reference

Documented as per bead nd-ywla (2025-01-02)
