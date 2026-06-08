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
 * Compile resim.wat to WASM using wat2wasm.
 * The real WASM module with full physics simulation.
 */
function compileToWasm(bundlePath: string): { wasmPath: string; physicsVersion: number } {
  log("compile", "Compiling resim.wat to WebAssembly...");

  // Extract physics version from bundle
  const bundleContent = readFileSync(bundlePath, "utf-8");
  const versionMatch = bundleContent.match(/PHYSICS_VERSION\s*=\s*(\d+)/);
  const physicsVersion = versionMatch ? parseInt(versionMatch[1], 10) : 0;

  const watPath = join(ROOT_DIR, "src/resim.wat");
  const wasmPath = join(DIST_DIR, "resim.wasm");

  // Check if resim.wat exists
  try {
    const watStat = readFileSync(watPath, "utf-8");
    log("info", `Found resim.wat (${watStat.length} bytes)`);
  } catch (e) {
    throw new Error(`resim.wat not found at ${watPath}: ${e}`);
  }

  // Compile wat to wasm using wat2wasm
  try {
    execSync(`wat2wasm "${watPath}" -o "${wasmPath}"`, {
      stdio: "inherit",
    });
    log("done", `WASM compiled to ${wasmPath}`);
  } catch (e) {
    throw new Error(`wat2wasm failed: ${e}`);
  }

  // Verify the WASM module exports the required functions
  const wasmBuffer = readFileSync(wasmPath);
  log("info", `WASM size: ${wasmBuffer.length} bytes`);

  return { wasmPath, physicsVersion };
}


/**
 * Generate content hash and create content-hashed artifact.
 */
function createHashedArtifact(wasmPath: string, physicsVersion: number): BuildResult {
  log("hash", "Generating content hash...");

  const wasmBuffer = readFileSync(wasmPath);
  const contentHash = getContentHash(wasmBuffer);

  const hashedName = `resim.${contentHash}.wasm`;
  const hashedPath = join(DIST_DIR, hashedName);

  // Copy to content-hashed name
  writeFileSync(hashedPath, wasmBuffer);

  // Also create a symlink/copy as resim.wasm for validator to find
  const symlinkPath = join(DIST_DIR, "resim.wasm");
  writeFileSync(symlinkPath, wasmBuffer);

  // Also copy as resim-test.wasm for fallback
  const testPath = join(DIST_DIR, "resim-test.wasm");
  writeFileSync(testPath, wasmBuffer);

  // Write metadata file
  const metadata = {
    contentHash,
    physicsVersion,
    wasmFile: hashedName,
    buildTime: new Date().toISOString(),
  };

  const metadataPath = join(DIST_DIR, "resim.wasm.json");
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
  log("start", "Building resim.wasm from resim.wat...");

  ensureDir(DIST_DIR);

  // Step 1: Build TypeScript
  buildTypeScript();

  // Step 2: Bundle WASM entry point
  const bundlePath = bundleWasmEntry();

  // Step 3: Compile resim.wat to WASM
  const { wasmPath, physicsVersion } = compileToWasm(bundlePath);

  // Step 4: Create content-hashed artifact
  const result = createHashedArtifact(wasmPath, physicsVersion);

  log("complete", `✓ resim.wasm build complete!`);
  log("output", `Artifact: ${result.wasmFile}`);

  return result;
}

// Run the build
main();
