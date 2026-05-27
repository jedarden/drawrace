# Bead bf-1rk3: Validator Layer 6 Replay Verification Test

## Summary

The replay verification test infrastructure was already complete. This bead verified that the implementation is in place and properly integrated with CI.

## What Was Verified

### 1. Test Crate (crates/validator/tests/replay.rs)
- **Status**: Complete and functional
- **Features**:
  - Loads reference ghosts from JSON file
  - Runs each ghost through the resim engine
  - Compares finish times with 2-tick tolerance
  - Fails CI on any divergence
  - Handles missing data gracefully (skips with helpful message)

### 2. Reference Ghosts (crates/validator/reference-ghosts.json)
- **Count**: 201 ghosts (exceeds 200 requirement)
- **Distribution**: 67 ghosts per track (tracks 1, 2, 3)
- **Type**: Synthetic test ghosts (stable, reproducible)
- **Note**: Should eventually be replaced with real-player ghosts from production

### 3. CI Integration (drawrace-ci-workflowtemplate.yml)
- **Step**: `replay-verify` (line 49-54)
- **Command**: `cargo test -p drawrace-validator --test replay`
- **Position**: Runs after unit tests, before build
- **Status**: Already integrated

### 4. Workflow Template Synced to declarative-config
- **Action**: Copied `drawrace-ci-workflowtemplate.yml` to declarative-config
- **Commit**: e752688 in jedarden/declarative-config
- **Purpose**: ArgoCD now manages the workflow template

## Test Execution

```bash
cargo test -p drawrace-validator --test replay
```

The test successfully loads 201 ghosts and runs them through the resim engine.

## Files Modified

1. **declarative-config/k8s/iad-ci/argo-workflows/drawrace-ci-workflowtemplate.yml**
   - Added: New file
   - Purpose: ArgoCD-managed workflow template with replay-verify step

## Next Steps (Future Work)

- [ ] Extract 200 real-player ghosts from production database
- [ ] Replace synthetic ghosts with real-player data
- [ ] Verify all real ghosts pass re-simulation
- [ ] Add per-track ghost subsets for targeted testing

## References

- Plan §Testing Layer 6
- crates/validator/tests/README.md
- crates/validator/tests/replay.rs
