# Bead bf-5pf2: Re-sim ABI 2/4 - Marshal Inputs into WASM Linear Memory

## Summary

Implemented WASM ABI input marshaling for re-simulation. The Rust code in `crates/validator` now properly allocates and writes inputs (WheelEntry list, track data, claimed inputs) into WASM linear memory per the documented ABI specification.

## What Was Implemented

### Core Functions (in `crates/validator/src/wasm_abi.rs`)

1. **`init_memory()`** - Main orchestrator that writes all input regions to WASM linear memory
2. **`write_header()`** - Writes ABI header with magic 'RSIM', version, counts, positions
3. **`write_wheels()`** - Writes wheel descriptors and shared vertex buffer with i16 coordinates
4. **`write_terrain()`** - Writes terrain point arrays as f32 pairs
5. **`write_obstacles()`** - Writes obstacle descriptors (Box/Circle types with proper field handling)

### Unit Test

**`test_byte_layout_known_fixture()`** - Comprehensive unit test validating exact byte layout for all memory regions:
- Header: magic "RSIM", version, counts, finish/start positions, seed
- Wheel Array: swap_tick, vertex_count, vertex_offset per wheel
- Vertex Buffer: i16 pairs for polygon vertices
- Track Data: f32 pairs for terrain, obstacle descriptors
- State/Result: initialized to zero

## What Worked

- The marshaling implementation was already complete in the codebase
- Unit tests pass: `test_byte_layout_known_fixture` validates all memory regions
- Fixed obstacle type handling (SIZE_X and RADIUS share offset 12, so Box and Circle need conditional writes)
- Proper endianness handling (little-endian for all multi-byte values)

## What Didn't

- Integration tests requiring actual resim.wasm fail because the WASM module needs to be built separately (outside scope of this input-side task)
- The `br close` command has a bug ("Invalid claimed_at format: premature end of input") - worked around by setting status to completed via `br update`

## Surprise

- The implementation was already in place; this task was about verifying and committing the existing work
- The obstacle type bug (SIZE_X/RADIUS offset sharing) was subtle and only caught by careful review of the test expectations

## Reusable Patterns

1. **For ABI marshaling**: Separate write functions per region, single orchestrator (`init_memory`)
2. **For testing**: Create a fixture with specific values and validate each byte offset directly
3. **Use wasmtime MemoryType** for testing without loading actual WASM modules
4. **For shared-offset fields**: Use match statements to write conditionally based on type

## Commit

- Commit: `150c44e` feat(validator): implement WASM ABI input marshaling (bf-5pf2)
- Pushed to origin/main
