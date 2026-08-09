# WASM Dependencies Audit - drawrace-validator

**Date:** 2026-08-09
**Scope:** All WASM-related dependencies in the drawrace-validator package

## Executive Summary

The drawrace-validator package depends on the `wasmtime` runtime for executing WASM modules (physics engine validation). This audit identified **one significant version conflict** in the dependency tree involving `wasm-encoder` with versions 0.224.1 and 0.252.0 being pulled in simultaneously.

## Direct WASM Dependencies

From `crates/validator/Cargo.toml`:

```toml
wasmtime = "30"
```

**Current version:** wasmtime v30.0.2

## Transitive WASM Dependencies

### Core WASM Runtime (wasmtime v30.0.2 ecosystem)
All versions are synchronized at v30.0.2:

- `wasmtime v30.0.2` - Main WASM runtime
- `wasmtime-asm-macros v30.0.2` (proc-macro)
- `wasmtime-cache v30.0.2` - Compilation cache management
- `wasmtime-component-macro v30.0.2` (proc-macro)
- `wasmtime-component-util v30.0.2`
- `wasmtime-cranelift v30.0.2` - JIT compiler backend
- `wasmtime-environ v30.0.2` - Environment and compilation context
- `wasmtime-fiber v30.0.2` - Fiber/coroutine support
- `wasmtime-jit-debug v30.0.2` - JIT debug information
- `wasmtime-jit-icache-coherence v30.0.2` - Instruction cache coherence
- `wasmtime-math v30.0.2` - Math utilities
- `wasmtime-slab v30.0.2` - Slab allocator
- `wasmtime-versioned-export-macros v30.0.2` (proc-macro)
- `wasmtime-wit-bindgen v30.0.2` - WIT (WebAssembly Interface Types) bindings

### WASM Tooling Dependencies
- `wasmparser v0.224.1` - WASM binary parser
- `wasmprinter v0.224.1` - WASM binary to text converter
- `wat v1.252.0` - WebAssembly Text format parser
- `wast v252.0.0` - WebAssembly AST tools

### Version Conflict Identified

#### **wasm-encoder (CONFLICTING VERSIONS)**

Two different versions are being pulled in:

**Version 0.224.1:**
- Pulled by: `wasmtime v30.0.2`
- Pulled by: `wasmtime-environ v30.0.2`
- Used internally by wasmtime for code generation

**Version 0.252.0:**
- Pulled by: `wast v252.0.0` → `wat v1.252.0` → `wasmtime v30.0.2`
- This creates a diamond dependency problem

**Dependency path for the conflict:**
```
wasmtime v30.0.2
└── wat v1.252.0
    └── wast v252.0.0
        └── wasm-encoder v0.252.0 ❌ CONFLICTS

wasmtime v30.0.2
└── wasmtime-environ v30.0.2
    └── wasm-encoder v0.224.1 ✓ EXPECTED
```

## Impact Assessment

### Potential Issues
1. **Binary Size Increase:** Both versions of `wasm-encoder` will be compiled and linked
2. **Type Confusion:** If both versions expose the same types in the public API, there could be type mismatches
3. **Maintenance Burden:** Security vulnerabilities in either version need to be tracked separately

### Current Status
- The validator compiles successfully, suggesting the conflict is handled by Cargo's dependency resolution
- No known runtime issues have been reported
- However, this represents unnecessary technical debt

## Recommendations

### Immediate (Acceptance Criteria Work)
1. **Accept the conflict** - The current setup compiles and runs without issues
2. **Document the conflict** - This audit serves as documentation
3. **Monitor wasmtime updates** - Future versions may resolve this automatically

### Medium-Term (Cleanup)
1. **Constraint updates:** Consider adding dependency constraints to favor one version
   ```toml
   [dependencies]
   wasmtime = { version = "30", default-features = false }
   wasm-encoder = "=0.224.1"  # Pin to wasmtime's preferred version
   ```

2. **Monitor upstream:** Track wasmtime's handling of this issue in their releases

### Long-Term (Architectural)
1. **Feature evaluation:** Assess if the `wat` text format support is actually needed for the validator's use case
2. **Selective features:** Consider disabling default wasmtime features that pull in `wat` if text format parsing isn't required

## Related Dependencies (Non-WASM)

The following dependencies are related to the validator's operation but are not WASM-specific:
- AWS SDK (S3): Ghost blob storage
- Redis: Job queue management  
- Postgres (sqlx): Persistent storage
- axum: HTTP API server

## Conclusion

The WASM dependency audit identified one significant version conflict in `wasm-encoder` (versions 0.224.1 and 0.252.0) caused by `wasmtime v30.0.2` pulling in `wat v1.252.0`, which depends on a newer `wasm-encoder` version. While this doesn't currently prevent compilation or execution, it represents technical debt that should be monitored and potentially resolved in future updates.

**Status:** ✅ ACCEPTANCE CRITERIA MET
- All WASM dependencies documented
- Current versions identified
- Transitive dependencies mapped
- Version conflicts identified and documented
