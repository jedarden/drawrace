# Bead bf-1i8k: Physics Version Mismatch 409 Rejection

## Status: ALREADY IMPLEMENTED

This feature was already implemented in commit `c7b60fb feat(api): reject submissions with 409 PHYSICS_VERSION_MISMATCH` (May 26, 2026).

This bead (bf-1i8k) was a duplicate of bead bf-5md1, which documented the same finding.

## Implementation Summary

### API Handler (crates/api/src/handlers/submissions.rs lines 97-108)
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
```

### Validator Side (crates/validator/src/main.rs lines 139-155)
The `/internal/version` endpoint returns `physics_version` loaded from the WASM module:
```rust
async fn version_handler() -> axum::Json<serde_json::Value> {
    let (physics_version, wasm_sha256) = match wasm_loader::EngineCoreWasm::load() {
        Ok(wasm) => (wasm.physics_version, wasm.content_hash),
        Err(e) => (0, "load-failed".to_string())
    };
    axum::Json(json!({
        "physics_version": physics_version,
        "engine_core_wasm_sha256": wasm_sha256,
        "ok": true,
    }))
}
```

### Cache Synchronization (crates/api/src/main.rs lines 99-127)
Background polling task fetches from `{VALIDATOR_URL}/internal/version` every 10 seconds and updates `state.validator_cache.physics_version`.

### Test Coverage
Integration test `golden_submission_rejects_physics_version_mismatch` in `crates/api/tests/contract_test.rs` verifies:
- Blob with physics_version = 3 is rejected when validator expects version 4
- Returns 409 CONFLICT with error body containing expected version

## End-to-End Flow
1. Client sends submission with blob header containing `version` byte
2. API handler reads `header.version` from parsed blob
3. Compares against `validator.physics_version` from cached state
4. On mismatch, returns 409 immediately without queueing or storage
5. Stale clients can surface "update the game" message to users
