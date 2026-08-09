# ronaldrayrun Typo Instances - Complete Line Number and Context Report

**Generated:** 2026-08-09  
**Task:** Extract line numbers and surrounding context for each 'ronaldrayrun' instance  
**Total Files:** 4  
**Total Instances:** 12

---

## Summary

All instances of 'ronaldrayrun' are found in documentation files that describe the historical typo itself. No active code files contain the typo - it has already been fixed in the workflow templates.

---

## File 1: `/home/coding/drawrace/docs/ronaldraygun-typo-context.md`

### Instance 1 - Line 34
```markdown
32:```markdown
33:28:
34:29: Note: Only the third line had the typo "ronaldrayrun" instead of "ronaldraygun".
35:30:
36:31: ### Investigation
```
**Context:** Descriptive note documenting the typo location in a historical diff.

### Instance 2 - Line 73
```markdown
71:43:
72:44: #### Verification
73:45: - Fixed Docker Hub org typo: ronaldrayrun → ronaldraygun
74:46: - Updated CI pipeline to use SHA-based image tags instead of `:latest`
75:```
```
**Context:** Changelog entry documenting the typo fix.

---

## File 2: `/home/coding/drawrace/docs/ronaldraygun-typo-complete-report.md`

### Instance 3 - Line 294
```markdown
292:```markdown
293:28:
294:29: Note: Only the third line had the typo "ronaldrayrun" instead of "ronaldraygun".
295:30:
296:31: ### Investigation
```
**Context:** Descriptive note documenting the typo location in a historical diff.

### Instance 4 - Line 319
```markdown
317:43:
318:44: #### Verification
319:45: - Fixed Docker Hub org typo: ronaldrayrun → ronaldraygun
320:46: - Updated CI pipeline to use SHA-based image tags instead of `:latest`
321:```
```
**Context:** Changelog entry documenting the typo fix.

---

## File 3: `/home/coding/drawrace/notes/nd-5vhq.md`

### Instance 5 - Line 1
```markdown
1:# Search Results: ronaldrayrun Typo Investigation
2:
3:## Task Summary
4:Search for ALL instances of the typo 'ronaldrayrun' in the drawrace workflowtemplate files.
```
**Context:** Title and task summary of the investigation.

### Instance 6 - Line 4
```markdown
2:
3:## Task Summary
4:Search for ALL instances of the typo 'ronaldrayrun' in the drawrace workflowtemplate files.
5:
6:## Findings
```
**Context:** Task summary describing the search scope.

### Instance 7 - Line 9
```markdown
8:### Current Status
9:**No instances of the typo "ronaldrayrun" exist in the current workflowtemplate files.**
10:
11:### Historical Instance Found
```
**Context:** Finding statement documenting current status.

### Instance 8 - Line 19
```markdown
17:- **Line with typo**: 
18-  ```yaml
19:  echo "ronaldrayrun/drawrace-live:latest" >> {{inputs.parameters.path}}/images.txt
20-  ```
21-
```
**Context:** Code snippet showing the historical typo in a YAML workflow.

### Instance 9 - Line 26
```markdown
24:            echo "ronaldraygun/drawrace-api:latest" > {{inputs.parameters.path}}/images.txt
25:            echo "ronaldraygun/drawrate-validator:latest" >> {{inputs.parameters.path}}/images.txt
26:            echo "ronaldrayrun/drawrace-live:latest" >> {{inputs.parameters.path}}/images.txt
27:```
28:
```
**Context:** Multi-line YAML snippet showing the typo in context with other lines.

### Instance 10 - Line 45
```markdown
43:### Additional Notes
44:The commit that fixed this typo (3417b95) also addressed several other issues:
45:- Fixed Docker Hub org typo: ronaldrayrun → ronaldraygun
46:- Replaced :latest tags with immutable git-SHA tags
47-- Fixed git identity to use jedarden/github@jedarden.com
```
**Context:** Changelog entry documenting the typo fix in commit 3417b95.

---

## File 4: `/home/coding/drawrace/docs/ronaldraygun-line-numbers.md`

### Instance 11 - Line 18
```markdown
16:- Line 24: `echo "ronaldraygun/drawrace-api:latest" > {{inputs.parameters.path}}/images.txt`
17:- Line 25: `echo "ronaldraygun/drawrate-validator:latest" >> {{inputs.parameters.path}}/images.txt`
18:- Line 29: Note: Only the third line had the typo "ronaldrayrun" instead of "ronaldraygun".
19:- Line 33: `echo "ronaldraygun/drawrace-api:${SHA}" > {{inputs.parameters.path}}/images.txt`
```
**Context:** Line-by-line documentation of the typo in a workflow diff.

### Instance 12 - Line 23
```markdown
22:- Line 40: - **Current instances**: 0 (all instances now use correct "ronaldraygun")
23:- Line 45: - Fixed Docker Hub org typo: ronaldrayrun → ronaldraygun
24:
25-### 2. /home/coding/drawrace/k8s/drawrace-build-workflowtemplate.yml (7 instances)
```
**Context:** Summary line documenting the typo fix.

---

## Analysis

**All 12 instances are in documentation/reference files only**, not in active code:

- **4 instances** in `/home/coding/drawrace/docs/ronaldraygun-typo-context.md` (2) and `/home/coding/drawrace/docs/ronaldraygun-typo-complete-report.md` (2)
- **6 instances** in `/home/coding/drawrace/notes/nd-5vhq.md`
- **2 instances** in `/home/coding/drawrace/docs/ronaldraygun-line-numbers.md`

These files document the historical 'ronaldrayrun' typo that was already fixed in commit 3417b95, where the Docker Hub organization name was corrected from 'ronaldrayrun' to 'ronaldraygun' in the workflow templates.

**No action required** - all instances are descriptive text about the typo, not the typo itself in production code.
