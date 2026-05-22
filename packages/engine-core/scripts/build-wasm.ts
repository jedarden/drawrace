#!/usr/bin/env tsx

/**
 * Build script for compiling engine-core to WebAssembly.
 *
 * This script:
 * 1. Compiles the WASM entry point to JavaScript (if needed)
 * 2. Uses Javy to compile JS to WASM
 * 3. Generates content hash for the WASM artifact
 * 4. Outputs engine-core.{hash}.wasm with metadata
 */

import { execSync } from "child_process";
import { readFileSync, renameSync, writeFileSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, "../..");
const DIST_DIR = join(ROOT_DIR, "dist");

interface BuildResult {
  wasmFile: string;
  contentHash: string;
  physicsVersion: number;
}

function log(step: string, message: string): void {
  console.log(`[build-wasm] ${step}: ${message}`);
}

function ensureDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    // Directory exists
  }
}

function getContentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 16);
}

/**
 * Build the TypeScript WASM entry point to JavaScript.
 */
function buildTypeScript(): void {
  log("build", "Compiling TypeScript to JavaScript...");
  execSync("tsc -p tsconfig.build.json", {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });
  log("done", "TypeScript compilation complete");
}

/**
 * Bundle the WASM entry point for Javy compilation.
 * Javy expects a single JS file with the code to compile.
 */
function bundleWasmEntry(): string {
  log("bundle", "Creating WASM bundle...");

  // For now, we'll create a simple bundle that just exports physics_version
  // In a full implementation, we'd use a bundler like esbuild or rollup
  const versionContent = readFileSync(join(ROOT_DIR, "src/version.ts"), "utf-8");
  const versionMatch = versionContent.match(/PHYSICS_VERSION\s*=\s*(\d+)/);
  const physicsVersion = versionMatch ? parseInt(versionMatch[1], 10) : 0;

  const bundledCode = `
// Auto-generated WASM bundle for engine-core
const PHYSICS_VERSION = ${physicsVersion};

function physics_version() {
  return PHYSICS_VERSION;
}

function wasm_validate() {
  return physics_version() > 0;
}
`;

  const bundlePath = join(DIST_DIR, "wasm-bundle.js");
  writeFileSync(bundlePath, bundledCode, "utf-8");
  log("done", `Bundle created at ${bundlePath}`);
  return bundlePath;
}

/**
 * Compile JavaScript to WASM using Javy.
 * For Phase 2, we create a stub WASM module with the required exports.
 */
function compileToWasm(bundlePath: string): { wasmPath: string; physicsVersion: number } {
  log("compile", "Compiling to WebAssembly...");

  // Extract physics version from bundle
  const bundleContent = readFileSync(bundlePath, "utf-8");
  const versionMatch = bundleContent.match(/PHYSICS_VERSION\s*=\s*(\d+)/);
  const physicsVersion = versionMatch ? parseInt(versionMatch[1], 10) : 0;

  // For Phase 2, create a minimal WASM module using Wat (WebAssembly Text format)
  // This is a stub that exports the required functions
  // In a full implementation, we'd use Javy or a similar JS-to-WASM compiler

  const watCode = `
(module
  ;; Physics version constant (stored in global)
  (global $PHYSICS_VERSION i32 (i32.const ${physicsVersion}))

  ;; Export: physics_version() -> i32
  (func $physics_version (result i32)
    global.get $PHYSICS_VERSION
  )
  (export "physics_version" (func $physics_version))

  ;; Export: wasm_validate() -> i32 (returns 1 for true)
  (func $wasm_validate (result i32)
    global.get $PHYSICS_VERSION
    i32.const 0
    i32.gt_s
  )
  (export "wasm_validate" (func $wasm_validate))

  ;; Memory export (required for some WASM runtimes)
  (memory (export "memory") 16)
)
`;

  // Use wat2wasm from wabt if available, otherwise create a binary WASM directly
  // For now, we'll create a minimal valid WASM binary manually
  const wasmPath = join(DIST_DIR, "engine-core.wasm");

  // Create a minimal WASM binary with the required exports
  // This is a simplified WASM module structure
  const wasmBytes = createMinimalWasm(physicsVersion);
  writeFileSync(wasmPath, Buffer.from(wasmBytes));

  log("done", `WASM compiled to ${wasmPath}`);
  return { wasmPath, physicsVersion };
}

/**
 * Create a minimal valid WASM binary with physics_version export.
 * This creates the raw binary format manually to avoid external dependencies.
 */
function createMinimalWasm(physicsVersion: number): Uint8Array {
  // WASM magic number and version
  const magic = [0x00, 0x61, 0x73, 0x6d]; // \0asm
  const version = [0x01, 0x00, 0x00, 0x00]; // version 1

  // Type section: function types
  const typeSection = [
    0x01, // section id (type)
    0x06, // section length
    0x02, // num types
    0x60, 0x00, 0x7f, // [func] -> i32 (physics_version)
    0x60, 0x00, 0x7f, // [func] -> i32 (wasm_validate)
  ];

  // Function section: function declarations
  const functionSection = [
    0x03, // section id (function)
    0x03, // section length
    0x02, // num functions
    0x00, // physics_version uses type 0
    0x01, // wasm_validate uses type 1
  ];

  // Global section: physics version constant
  const globalSection = [
    0x06, // section id (global)
    0x07, // section length
    0x01, // num globals
    0x7f, // i32
    0x00, // immutable
    0x41, // i32.const
    ...encodeI32(physicsVersion),
    0x0b, // end
  ];

  // Export section
  const exportSection = [
    0x07, // section id (export)
    0x1e, // section length
    0x03, // num exports
    // physics_version
    ...stringBytes("physics_version"),
    0x00, // export kind (function)
    0x00, // function index
    // wasm_validate
    ...stringBytes("wasm_validate"),
    0x00, // export kind (function)
    0x01, // function index
    // memory
    ...stringBytes("memory"),
    0x02, // export kind (memory)
    0x00, // memory index
  ];

  // Code section: function bodies
  const codeSection = [
    0x0a, // section id (code)
    0x0d, // section length
    0x02, // num functions
    // physics_version body
    0x06, // function size
    0x00, // num locals
    0x23, 0x00, // global.get 0
    0x0b, // end
    // wasm_validate body
    0x09, // function size
    0x00, // num locals
    0x23, 0x00, // global.get 0
    0x41, 0x00, // i32.const 0
    0x48, // i32.gt_s
    0x0b, // end
  ];

  // Memory section: 1 page (64KB)
  const memorySection = [
    0x05, // section id (memory)
    0x03, // section length
    0x01, // num memories
    0x00, // limits type (no maximum)
    0x01, // initial pages (64KB)
  ];

  const allSections = [
    ...typeSection,
    ...functionSection,
    ...globalSection,
    ...exportSection,
    ...codeSection,
    ...memorySection,
  ];

  return new Uint8Array([...magic, ...version, ...allSections]);
}

function encodeI32(n: number): number[] {
  const bytes: number[] = [];
  let value = n >>> 0; // treat as unsigned

  // Handle 0 specially
  if (value === 0) return [0x00];

  while (value > 0) {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  }

  return bytes;
}

function stringBytes(s: string): number[] {
  const utf8 = Buffer.from(s, "utf-8");
  return [utf8.length, ...utf8];
}

/**
 * Generate content hash and create content-hashed artifact.
 */
function createHashedArtifact(wasmPath: string, physicsVersion: number): BuildResult {
  log("hash", "Generating content hash...");

  const wasmBuffer = readFileSync(wasmPath);
  const contentHash = getContentHash(wasmBuffer);

  const hashedName = `engine-core.${contentHash}.wasm`;
  const hashedPath = join(DIST_DIR, hashedName);

  renameSync(wasmPath, hashedPath);

  // Write metadata file
  const metadata = {
    contentHash,
    physicsVersion,
    wasmFile: hashedName,
    buildTime: new Date().toISOString(),
  };

  const metadataPath = join(DIST_DIR, "engine-core.wasm.json");
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");

  log("done", `Created ${hashedName}`);
  log("info", `Physics version: ${physicsVersion}, Content hash: ${contentHash}`);

  return {
    wasmFile: hashedName,
    contentHash,
    physicsVersion,
  };
}

/**
 * Main build process.
 */
function main(): BuildResult {
  log("start", "Building engine-core WASM...");

  ensureDir(DIST_DIR);

  // Step 1: Build TypeScript
  buildTypeScript();

  // Step 2: Bundle WASM entry point
  const bundlePath = bundleWasmEntry();

  // Step 3: Compile to WASM
  const { wasmPath, physicsVersion } = compileToWasm(bundlePath);

  // Step 4: Create content-hashed artifact
  const result = createHashedArtifact(wasmPath, physicsVersion);

  log("complete", `✓ engine-core.wasm build complete!`);
  log("output", `Artifact: ${result.wasmFile}`);

  return result;
}

// Run the build
main();
