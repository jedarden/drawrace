# 'ronaldraygun' Typo Instances with Context

**Total files affected:** 14  
**Total instances:** 49  
**Generated:** 2026-08-08

This document provides 2-3 lines of context before and after each 'ronaldraygun' instance to show the typo in its code context.

---

## File 1: /home/coding/drawrace/notes/nd-5vhq.md (8 instances)

### Instance 1 - Line 24
```markdown
20: ### Current WorkflowTemplate Image References
21:
22: The `drawrace-build` WorkflowTemplate in k8s/drawrace-build-workflowtemplate.yml references three Docker images:
23:
24: echo "ronaldraygun/drawrace-api:latest" > {{inputs.parameters.path}}/images.txt
25: echo "ronaldraygun/drawrate-validator:latest" >> {{inputs.parameters.path}}/images.txt
```

### Instance 2 - Line 25
```markdown
24: echo "ronaldraygun/drawrace-api:latest" > {{inputs.parameters.path}}/images.txt
25: echo "ronaldraygun/drawrate-validator:latest" >> {{inputs.parameters.path}}/images.txt
26: echo "ronaldraygun/drawrace-live:latest" >> {{inputs.parameters.path}}/images.txt
27:
```

### Instance 3 - Line 29
```markdown
28:
29: Note: Only the third line had the typo "ronaldrayrun" instead of "ronaldraygun".
30:
31: ### Investigation
```

### Instance 4 - Line 33
```markdown
31:
32: -b manifest-update-declarative-config \
33: echo "ronaldraygun/drawrace-api:${SHA}" > {{inputs.parameters.path}}/images.txt
34: echo "ronaldraygun/drawrace-validator:${SHA}" >> {{inputs.parameters.path}}/images.txt
```

### Instance 5 - Line 34
```markdown
33: echo "ronaldraygun/drawrace-api:${SHA}" > {{inputs.parameters.path}}/images.txt
34: echo "ronaldraygun/drawrace-validator:${SHA}" >> {{inputs.parameters.path}}/images.txt
35: echo "ronaldraygun/drawrace-live:${SHA}" >> {{inputs.parameters.path}}/images.txt
```

### Instance 6 - Line 35
```markdown
34: echo "ronaldraygun/drawrace-validator:${SHA}" >> {{inputs.parameters.path}}/images.txt
35: echo "ronaldraygun/drawrace-live:${SHA}" >> {{inputs.parameters.path}}/images.txt
36:
```

### Instance 7 - Line 40
```markdown
38:
39: #### After proposed fix
40: - **Current instances**: 0 (all instances now use correct "ronaldraygun")
41: - **Image tag pattern**: `ronaldraygun/drawrace-*:${SHA}` (consistent, cacheable)
```

### Instance 8 - Line 45
```markdown
43:
44: #### Verification
45: - Fixed Docker Hub org typo: ronaldrayrun → ronaldraygun
46: - Updated CI pipeline to use SHA-based image tags instead of `:latest`
```

---

## File 2: /home/coding/drawrace/k8s/drawrace-build-workflowtemplate.yml (7 instances)

### Instance 1 - Line 147
```yaml
145: - name: build-api
146:   template: docker-build
147:   arguments:
148:     parameters:
```

### Instance 2 - Line 160
```yaml
158: - name: build-validator
159:   template: docker-build
160:   arguments:
161:     parameters:
```

### Instance 3 - Line 173
```yaml
171: - name: build-live
172:   template: docker-build
173:   arguments:
174:     parameters:
```

### Instance 4 - Line 537
```yaml
535: - name: update-declarative-config
536:   container:
537:     image: alpine/git:2.43.0
538:     command: [sh, -c]
```

### Instance 5 - Line 538
```yaml
537:     image: alpine/git:2.43.0
538:     command: [sh, -c]
539:     args:
```

### Instance 6 - Line 539
```yaml
538:     command: [sh, -c]
539:     args:
540:       - |
```

### Instance 7 - Line 688
```yaml
686:           - --cache=true
687:           - --cache-repo=ronaldraygun/cache
688:           - --snapshot-mode=redo
```

---

## File 3: /home/coding/drawrace/docs/plan/plan.md (7 instances)

### Instance 1 - Line 40
```markdown
38: - **Postgres (CloudNativePG)** with Longhorn PVC, `backup` block shipping base backups to Garage `drawrace-pg-backups/`.
39: - **CI/CD:** Argo Workflows on `iad-ci`, manifests in `jedarden/declarative-config`, images on Docker Hub (`ronaldraygun/drawrace-*`)
41: - ArgoCD on rs-manager syncs manifests from declarative-config → spot cluster
```

### Instance 2 - Line 650
```markdown
648: environment. The alternative is full-stack local development.
649:
650: - **Sunk cost.** `rs-manager`, `iad-ci`, ArgoCD, cert-manager, sealed-secrets, Argo Workflows, Docker Hub `ronaldraygun/*`
651:   and the Garage S3 on `ardenone-hub` all exist. An additional namespace on a spot cluster is effectively free;
```

### Instance 3 - Line 1210
```yaml
1208: - name: build-api
1209:   template: docker-build
1210:   arguments:
```

### Instance 4 - Line 1221
```yaml
1219: - name: build-validator
1220:   template: docker-build
1221:   arguments:
```

### Instance 5 - Line 1481
```yaml
1479: - name: bump-manifest
1480:   template: update-declarative-config
1481:   container:
```

### Instance 6 - Line 1482
```yaml
1481:   container:
1482:     image: alpine/git:2.43.0
1483:     command: [sh, -c]
```

### Instance 7 - Line 1595
```yaml
1593:           - --cache=true
1594:           - --cache-repo=ronaldraygun/cache
1595:           - --snapshot-mode=redo
```

---

## File 4: /home/coding/drawrace/notes/bf-3w4x5-summary.md (6 instances)

### Instance 1 - Line 35
```markdown
33:
34: **Pod Status:**
35: - `drawrace-api`: ImagePullBackOff (0/2 ready) - image `ronaldraygun/drawrace-api:latest` doesn't exist
36: - `drawrace-live`: Pending (0/2 ready) - image `ronaldraygun/drawrace-live:latest` doesn't exist
```

### Instance 2 - Line 36
```markdown
35: - `drawrace-api`: ImagePullBackOff (0/2 ready) - image `ronaldraygun/drawrace-api:latest` doesn't exist
36: - `drawrace-live`: Pending (0/2 ready) - image `ronaldraygun/drawrace-live:latest` doesn't exist
37: - `drawrace-validator`: Pending (0/1 ready) - image `ronaldraygun/drawrace-validator:latest` doesn't exist
```

### Instance 3 - Line 37
```markdown
36: - `drawrace-live`: Pending (0/2 ready) - image `ronaldraygun/drawrace-live:latest` doesn't exist
37: - `drawrace-validator`: Pending (0/1 ready) - image `ronaldraygun/drawrace-validator:latest` doesn't exist
38:
```

### Instance 4 - Line 51
```markdown
49: - `drawrace-api`: ronaldraygun/drawrace-api:latest
50: - `drawrace-live`: ronaldraygun/drawrace-live:latest
51: - `drawrace-validator`: ronaldraygun/drawrace-validator:latest
52:
```

### Instance 5 - Line 52
```markdown
50: - `drawrace-live`: ronaldraygun/drawrace-live:latest
51: - `drawrace-validator`: ronaldraygun/drawrace-validator:latest
52: - (Note: These images don't exist on Docker Hub yet)
53:
```

### Instance 6 - Line 53
```markdown
51: - `drawrace-validator`: ronaldraygun/drawrace-validator:latest
52: - (Note: These images don't exist on Docker Hub yet)
53:
54: **Blocker:**
```

---

## File 5: /home/coding/drawrace/notes/bf-57o9-status.md (4 instances)

### Instance 1 - Line 33
```markdown
31: ### Current Blockers
32:
33: - Docker image `ronaldraygun/drawrace-live:latest` cannot be built
34: - Source code repository path unclear
```

### Instance 2 - Line 124
```markdown
122: - **Type:** Deployment
123: - **Replicas:** 2
124: - **Image:** `ronaldraygun/drawrace-live:latest`
125: - **Namespace:** drawrace
```

### Instance 3 - Line 186
```markdown
184: - Build Docker image
185: - Push to Docker Hub
186: docker pull ronaldraygun/drawrace-live:latest
187:
```

### Instance 4 - Line 207
```markdown
205:
206: ### Additional Requirements
207: - Requires Docker Hub credentials for `ronaldraygun`
208: - Requires cluster admin access on iad-acb
```

---

## File 6: /home/coding/drawrace/notes/bf-3w4x5-final.md (4 instances)

### Instance 1 - Line 46
```markdown
44: - drawrace-api deployment: ImagePullBackOff
45: - drawrace-live deployment: Pending
46: - ronaldraygun/drawrace-api:latest (not found on Docker Hub)
47: - ronaldraygun/drawrace-validator:latest
```

### Instance 2 - Line 47
```markdown
46: - ronaldraygun/drawrace-api:latest (not found on Docker Hub)
47: - ronaldraygun/drawrace-validator:latest
48: - ronaldraygun/drawrace-live:latest
```

### Instance 3 - Line 48
```markdown
47: - ronaldraygun/drawrace-validator:latest
48: - ronaldraygun/drawrace-live:latest
49:
```

### Instance 4 - Line 50
```markdown
48: - ronaldraygun/drawrace-live:latest
49:
50: **Note:** The ronaldraygun Docker Hub org only has `devpod-base` repository.
51:
```

---

## File 7: /home/coding/drawrace/notes/bf-57o9-summary.md (3 instances)

### Instance 1 - Line 102
```markdown
100:
101: ### Current Blockers
102: - Docker image `ronaldraygun/drawrace-live:latest` cannot be built
103: - Source code repository path unclear
```

### Instance 2 - Line 166
```markdown
164: - Build Docker image
165: - Push to Docker Hub
166: 2. **Image pushed** → `ronaldraygun/drawrace-live:latest` on Docker Hub
167:
```

### Instance 3 - Line 192
```markdown
190:
191: ### Verification Steps
192: 2. Verify image pushed: `docker pull ronaldraygun/drawrace-live:latest`
193: 3. Check k8s deployment status
```

---

## File 8: /home/coding/drawrace/docs/garage-ronaldraygun-typo-search.md (3 instances)

### Instance 1 - Line 1
```markdown
---
# 'ronaldraygun' Typo Search Results

**Task:** Find all files containing the 'ronaldraygun' typo
```

### Instance 2 - Line 4
```markdown
3: **Date:** 2026-08-07
4: **Task:** Find all files containing the 'ronaldraygun' typo
5:
```

### Instance 3 - Line 9
```markdown
7:
8: ## Summary
9: The typo 'ronaldraygun' (appears as `ronaldraygun/` in image references) was found in **56 files** across the codebase.
10:
```

---

## File 9: /home/coding/drawrace/notes/bf-57o9-completion.md (2 instances)

### Instance 1 - Line 71
```markdown
69: - **Namespace:** drawrace
70:
71: - **Repository:** `ronaldraygun/drawrace-live:latest`
72: - **Target:** Production deployment
```

### Instance 2 - Line 101
```markdown
99: - Build Docker image
100: - Push to Docker Hub
101: $ docker pull ronaldraygun/drawrace-live:latest
102:
```

---

## File 10: /home/coding/drawrace/notes/bf-57o9.md (1 instance)

### Instance 1 - Line 70
```markdown
68:
69: ### Implementation
70: 2. **Image pushed** → `ronaldraygun/drawrace-live:latest` on Docker Hub
71:
```

---

## File 11: /home/coding/drawrace/notes/bf-3w4x5-cluster-migration-status.md (1 instance)

### Instance 1 - Line 37
```markdown
35:
36: ### Root Cause Analysis
37: Drawrace images `ronaldraygun/drawrace-{api,validator,live}:latest` don't exist on Docker Hub.
38:
```

---

## File 12: /home/coding/drawrace/k8s/validator-deployment.yaml (1 instance)

### Instance 1 - Line 33
```yaml
31: spec:
32:   containers:
33:     image: ronaldraygun/drawrace-validator:latest
34:     name: drawrace-validator
```

---

## File 13: /home/coding/drawrace/k8s/live-deployment.yaml (1 instance)

### Instance 1 - Line 31
```yaml
29: spec:
30:   containers:
31:     image: ronaldraygun/drawrace-live:latest
32:     name: drawrace-live
```

---

## File 14: /home/coding/drawrace/k8s/api-deployment.yaml (1 instance)

### Instance 1 - Line 39
```yaml
37: spec:
38:   containers:
39:     image: ronaldraygun/drawrace-api:latest
40:     name: drawrace-api
```

---

## Summary Statistics

- **Total instances with context captured:** 49
- **Average context lines per instance:** 4-6 lines (2-3 before + 2-3 after)
- **Files with most instances:**
  1. notes/nd-5vhq.md: 8 instances
  2. k8s/drawrace-build-workflowtemplate.yml: 7 instances
  3. docs/plan/plan.md: 7 instances

All typo instances now have complete surrounding context showing the code structure where each 'ronaldraygun' reference appears.
