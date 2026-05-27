# Bead bf-5md1: Physics Version Mismatch 409 Rejection

## Status: ALREADY IMPLEMENTED

This feature was already implemented in commit `c7b60fb feat(api): reject submissions with 409 PHYSICS_VERSION_MISMATCH`.

## Implementation Details

### Location
- `crates/api/src/handlers/submissions.rs` lines 97-108

### Code
```rust
// Physics version check: reject submissions from stale clients
let validator = state.validator_cache.read().await;
if header.version as u16 != validator.physics_version {
    return Ok((
        StatusCode::CONFLICT,
        Json(serde_json::json!({
            "error": "PHYSICS_VERSION_MISMATCH",
            "expected": validator.physics_version
        })),
    ).into_response());
}
drop(validator);
```

### Verification
1. Blob header parsing reads version byte at offset 4: `blob.rs:76`
2. Validator cache stores `physics_version: u16` from `/health` polling
3. Contract test `golden_submission_rejects_physics_version_mismatch` verifies behavior

### Test Results
All 26 contract tests pass, including the physics version mismatch test.
