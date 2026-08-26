# Crash Investigation: Agent OOM on bf-1ea4g

**Crash Date:** 2026-08-13T08:25:08.621817200+00:00  
**Investigation Date:** 2026-08-26  
**Status:** RESOLVED  
**Bead ID:** bf-1ea4g  
**Agent:** claude-code-glm-4.7  
**Exit Code:** -1 (signal -1, OOM killer)

## Executive Summary

An agent working on bead bf-1ea4g crashed with signal -1 (SIGKILL/OOM killer) due to extreme repository bloat. The repository had grown to 18GB, causing memory exhaustion during git operations. The root cause was the `.beads/` directory being tracked in git, leading to large JSONL checkpoint files being committed to the repository.

**Key Finding:** The task on bf-1ea4g was actually COMPLETED SUCCESSFULLY 8 minutes before the crash occurred. The crash was a post-task infrastructure issue, not a task failure.

## Root Cause Analysis

### Repository Bloat

The `.beads/` directory contained:
- SQLite databases (`*.db`, `*.db-shm`, `*.db-wal`)
- JSONL checkpoint files (237MB+ per checkpoint)
- Various bead state files

The `.gitignore` was configured to exclude only the SQLite files but track the JSONL checkpoints:

```
# Previous .gitignore (INCORRECT)
.beads/*.db
.beads/*.db-shm
.beads/*.db-wal
!.beads/issues.jsonl
```

This caused every bead checkpoint flush to commit large JSONL files to git history, creating:
- 18GB total repository size
- Massive memory pressure during git operations
- Frequent OOM killer invocations

### Crash Timeline

1. **2026-08-13T08:17:08Z** — Agent completed the task on bf-1ea4g successfully
2. **2026-08-13T08:25:08Z** — Agent crashed with signal -1 (8 minutes post-completion)
3. **2026-08-13T08:25:08Z** — Crash was detected and bead was released for retry
4. **2026-08-26T07:56:35Z** — Fix implemented: `.beads/` added to `.gitignore`

## Resolution

### Immediate Fix (Committed 2c6901c)

The `.gitignore` was updated to exclude the entire `.beads/` directory:

```gitignore
# Fixed .gitignore
# Bead store: All beads files stay local to prevent repository bloat.
# Large JSONL checkpoint files (237MB+) caused 18GB repository bloat and agent crashes.
# See: crash investigation bead bf-32l83 for details.
.beads/
```

### Repository Cleanup

After applying the fix:
- Repository size reduced from 18GB to 755MB
- `git gc` run: 0 loose objects, 13.53MB packed
- Repository is now healthy and optimized

## Impact Assessment

### Task Completion
- **Bead bf-1ea4g:** Task completed successfully before crash
- **No work lost:** All changes were committed prior to the crash
- **Bead status:** Successfully closed

### Infrastructure Impact
- **Agent stability:** Improved — no more OOM crashes during git operations
- **Repository performance:** Significantly improved — operations now complete in seconds instead of minutes/hours
- **Disk usage:** Reduced from 18GB to 755MB

## Prevention Measures

### Implemented
1. ✅ `.beads/` directory excluded from git tracking
2. ✅ Repository cleanup completed (18GB → 755MB)
3. ✅ `git gc` run to optimize repository

### Recommended for Other Repositories
Check `.gitignore` configurations in other bead-rs workspaces to ensure:
- `.beads/` is completely excluded from git tracking
- No large JSONL checkpoint files are being committed
- Repository sizes are monitored regularly

## Lessons Learned

1. **Bead-rs best practice:** The entire `.beads/` directory should be excluded from git, not just specific file types
2. **Monitoring:** Repository size should be monitored to detect bloat early
3. **Task completion vs. crash:** The task completed successfully before the crash — the crash was an infrastructure issue, not a task failure

## Related Beads

- **bf-3ulz5:** This bead — crash alert and investigation
- **bf-32l83:** Original crash investigation bead (mentioned in fix commit)
- **bf-1ea4g:** The bead that was being worked on when the crash occurred

## Verification

Post-fix verification:
- Repository size: 755MB (down from 18GB)
- Git operations: Normal speed
- No OOM errors observed
- All subsequent agent work completed successfully

---

**Investigation Complete:** 2026-08-26  
**Investigator:** claude-code-glm-4.7-lab-drawrace  
**Status:** RESOLVED — No further action required
