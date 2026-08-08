# Line Numbers for 'ronaldraygun' Typo Instances

**Total files affected:** 14  
**Total instances:** 49  
**Generated:** 2026-08-08

## Summary by File Type
- **Markdown files (.md):** 39 instances
- **YAML files (.yml, .yaml):** 10 instances

---

## Detailed Line Numbers by File

### 1. /home/coding/drawrace/notes/nd-5vhq.md (8 instances)
- Line 24: `echo "ronaldraygun/drawrace-api:latest" > {{inputs.parameters.path}}/images.txt`
- Line 25: `echo "ronaldraygun/drawrate-validator:latest" >> {{inputs.parameters.path}}/images.txt`
- Line 29: Note: Only the third line had the typo "ronaldrayrun" instead of "ronaldraygun".
- Line 33: `echo "ronaldraygun/drawrace-api:${SHA}" > {{inputs.parameters.path}}/images.txt`
- Line 34: `echo "ronaldraygun/drawrace-validator:${SHA}" >> {{inputs.parameters.path}}/images.txt`
- Line 35: `echo "ronaldraygun/drawrace-live:${SHA}" >> {{inputs.parameters.path}}/images.txt`
- Line 40: - **Current instances**: 0 (all instances now use correct "ronaldraygun")
- Line 45: - Fixed Docker Hub org typo: ronaldrayrun → ronaldraygun

### 2. /home/coding/drawrace/k8s/drawrace-build-workflowtemplate.yml (7 instances)
- Line 147: value: ronaldraygun/drawrace-api
- Line 160: value: ronaldraygun/drawrace-validator
- Line 173: value: ronaldraygun/drawrace-live
- Line 537: `echo "ronaldraygun/drawrace-api:${SHA}" > {{inputs.parameters.path}}/images.txt`
- Line 538: `echo "ronaldraygun/drawrace-validator:${SHA}" >> {{inputs.parameters.path}}/images.txt`
- Line 539: `echo "ronaldraygun/drawrace-live:${SHA}" >> {{inputs.parameters.path}}/images.txt`
- Line 688: - --cache-repo=ronaldraygun/cache

### 3. /home/coding/drawrace/docs/plan/plan.md (7 instances)
- Line 40: - **CI/CD:** Argo Workflows on `iad-ci`, manifests in `jedarden/declarative-config`, images on Docker Hub (`ronaldraygun/drawrace-*`)
- Line 650: - **Sunk cost.** `rs-manager`, `iad-ci`, ArgoCD, cert-manager, sealed-secrets, Argo Workflows, Docker Hub `ronaldraygun/*`
- Line 1210: value: ronaldraygun/drawrace-api
- Line 1221: value: ronaldraygun/drawrace-validator
- Line 1481: `echo "ronaldraygun/drawrace-api:latest" > {{inputs.parameters.path}}/images.txt`
- Line 1482: `echo "ronaldraygun/drawrace-validator:latest" >> {{inputs.parameters.path}}/images.txt`
- Line 1595: - --cache-repo=ronaldraygun/cache

### 4. /home/coding/drawrace/notes/bf-3w4x5-summary.md (6 instances)
- Line 35: - `drawrace-api`: ImagePullBackOff (0/2 ready) - image `ronaldraygun/drawrace-api:latest` doesn't exist
- Line 36: - `drawrace-live`: Pending (0/2 ready) - image `ronaldraygun/drawrace-live:latest` doesn't exist
- Line 37: - `drawrace-validator`: Pending (0/1 ready) - image `ronaldraygun/drawrace-validator:latest` doesn't exist
- Line 51: - `ronaldraygun/drawrace-api:latest`
- Line 52: - `ronaldraygun/drawrace-validator:latest`
- Line 53: - `ronaldraygun/drawrace-live:latest`

### 5. /home/coding/drawrace/notes/bf-57o9-status.md (4 instances)
- Line 33: - Docker image `ronaldraygun/drawrace-live:latest` cannot be built
- Line 124: - Image: `ronaldraygun/drawrace-live:latest`
- Line 186: docker pull ronaldraygun/drawrace-live:latest
- Line 207: - Requires Docker Hub credentials for `ronaldraygun`

### 6. /home/coding/drawrace/notes/bf-3w4x5-final.md (4 instances)
- Line 46: - ronaldraygun/drawrace-api:latest (not found on Docker Hub)
- Line 47: - ronaldraygun/drawrace-validator:latest
- Line 48: - ronaldraygun/drawrace-live:latest
- Line 50: **Note:** The ronaldraygun Docker Hub org only has `devpod-base` repository.

### 7. /home/coding/drawrace/notes/bf-57o9-summary.md (3 instances)
- Line 102: - Docker image `ronaldraygun/drawrace-live:latest` cannot be built
- Line 166: 2. **Image pushed** → `ronaldraygun/drawrace-live:latest` on Docker Hub
- Line 192: 2. Verify image pushed: `docker pull ronaldraygun/drawrace-live:latest`

### 8. /home/coding/drawrace/docs/garage-ronaldraygun-typo-search.md (3 instances)
- Line 1: # 'ronaldraygun' Typo Search Results
- Line 4: **Task:** Find all files containing the 'ronaldraygun' typo
- Line 9: The typo 'ronaldraygun' (appears as `ronaldraygun/` in image references) was found in **56 files** across the codebase.

### 9. /home/coding/drawrace/notes/bf-57o9-completion.md (2 instances)
- Line 71: - **Repository:** `ronaldraygun/drawrace-live:latest`
- Line 101: $ docker pull ronaldraygun/drawrace-live:latest

### 10. /home/coding/drawrace/notes/bf-57o9.md (1 instance)
- Line 70: 2. **Image pushed** → `ronaldraygun/drawrace-live:latest` on Docker Hub

### 11. /home/coding/drawrace/notes/bf-3w4x5-cluster-migration-status.md (1 instance)
- Line 37: Drawrace images `ronaldraygun/drawrace-{api,validator,live}:latest` don't exist on Docker Hub.

### 12. /home/coding/drawrace/k8s/validator-deployment.yaml (1 instance)
- Line 33: image: ronaldraygun/drawrace-validator:latest

### 13. /home/coding/drawrace/k8s/live-deployment.yaml (1 instance)
- Line 31: image: ronaldraygun/drawrace-live:latest

### 14. /home/coding/drawrace/k8s/api-deployment.yaml (1 instance)
- Line 39: image: ronaldraygun/drawrace-api:latest

---

## Verification
✅ All 49 instances have been recorded with exact line numbers  
✅ No missing line numbers  
✅ Counts per file verified
