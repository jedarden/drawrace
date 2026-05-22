/**
 * WASM entry point for engine-core.
 *
 * This module exports functions that will be compiled to WebAssembly
 * and shared between client (browser) and validator (Rust + wasmtime).
 */

import { PHYSICS_VERSION } from "./version.js";

/**
 * Returns the physics version constant.
 * This function is exported from the WASM module and verified at boot.
 */
export function physics_version(): number {
  return PHYSICS_VERSION;
}

/**
 * Minimal validation function to ensure WASM module is correctly loaded.
 * Returns true if the module is functioning.
 */
export function wasm_validate(): boolean {
  return physics_version() > 0;
}
