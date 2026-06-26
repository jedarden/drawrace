#!/usr/bin/env python3
"""
Build script for compiling engine-core to WebAssembly.

This script:
1. Extracts PHYSICS_VERSION from version.ts
2. Creates a minimal WASM module with physics_version() export
3. Generates content hash for the WASM artifact
4. Outputs engine-core.{hash}.wasm with metadata
"""

import os
import re
import json
import hashlib
from pathlib import Path
from datetime import datetime

ROOT_DIR = Path(__file__).parent.parent
DIST_DIR = ROOT_DIR / "dist"

def log(step: str, message: str) -> None:
    print(f"[build-wasm] {step}: {message}")

def ensure_dir(dir: Path) -> None:
    dir.mkdir(parents=True, exist_ok=True)

def get_content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]

def extract_physics_version() -> int:
    """Extract PHYSICS_VERSION from version.ts"""
    version_file = ROOT_DIR / "src" / "version.ts"
    content = version_file.read_text()
    match = re.search(r'PHYSICS_VERSION\s*=\s*(\d+)', content)
    if not match:
        raise ValueError("Could not find PHYSICS_VERSION in version.ts")
    return int(match.group(1))

def compile_resim_wat() -> bytes:
    """Compile resim.wat to WASM using wat2wasm."""
    import subprocess
    import shutil

    wat_path = ROOT_DIR / "src" / "resim.wat"
    wasm_path = DIST_DIR / "resim.wasm"

    if not wat_path.exists():
        raise FileNotFoundError(f"resim.wat not found at {wat_path}")

    log("info", f"Compiling {wat_path} to {wasm_path}")

    # Check if wat2wasm is available
    if not shutil.which("wat2wasm"):
        log("install", "wat2wasm not found, installing wabt package...")
        # Try to install via apk if on Alpine Linux (common in CI containers)
        try:
            subprocess.run(
                ["apk", "add", "--no-cache", "wabt"],
                capture_output=True,
                text=True,
                check=True,
            )
            log("done", "wabt package installed")
        except subprocess.CalledProcessError as e:
            raise RuntimeError(
                f"Failed to install wabt: {e.stderr}\n"
                "Please install wabt manually: apk add wabt (Alpine) or "
                "apt-get install wabt (Debian/Ubuntu)"
            )
        except FileNotFoundError:
            raise RuntimeError(
                "wat2wasm not found and apk is not available. "
                "Please install wabt: https://github.com/WebAssembly/wabt"
            )

    # Run wat2wasm
    result = subprocess.run(
        ["wat2wasm", str(wat_path), "-o", str(wasm_path)],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise RuntimeError(f"wat2wasm failed: {result.stderr}")

    log("done", f"WASM compiled to {wasm_path}")
    return wasm_path.read_bytes()

def create_hashed_artifact(wasm_bytes: bytes, physics_version: int) -> dict:
    """Generate content hash and create content-hashed artifacts."""
    log("hash", "Generating content hash...")

    content_hash = get_content_hash(wasm_bytes)

    # Create content-hashed artifact
    hashed_name = f"engine-core.{content_hash}.wasm"
    hashed_path = DIST_DIR / hashed_name
    hashed_path.write_bytes(wasm_bytes)

    # Also create a symlink/copy as engine-core.wasm for validator to find
    symlink_path = DIST_DIR / "engine-core.wasm"
    symlink_path.write_bytes(wasm_bytes)

    # Also copy as engine-core-test.wasm for fallback
    test_path = DIST_DIR / "engine-core-test.wasm"
    test_path.write_bytes(wasm_bytes)

    # Write metadata file
    metadata = {
        "contentHash": content_hash,
        "physicsVersion": physics_version,
        "wasmFile": hashed_name,
        "buildTime": datetime.now().isoformat(),
    }

    metadata_path = DIST_DIR / "engine-core.wasm.json"
    metadata_path.write_text(json.dumps(metadata, indent=2))

    log("done", f"Created {hashed_name}")
    log("info", f"Physics version: {physics_version}, Content hash: {content_hash}")

    return {
        "wasmFile": hashed_name,
        "contentHash": content_hash,
        "physicsVersion": physics_version,
    }

def main() -> dict:
    log("start", "Building resim.wasm from resim.wat...")

    ensure_dir(DIST_DIR)

    # Step 1: Extract physics version
    physics_version = extract_physics_version()
    log("version", f"PHYSICS_VERSION = {physics_version}")

    # Step 2: Compile resim.wat to WASM
    wasm_bytes = compile_resim_wat()

    # Step 3: Create content-hashed artifacts
    result = create_hashed_artifact(wasm_bytes, physics_version)

    log("complete", "✓ resim.wasm build complete!")
    log("output", f"Artifact: {result['wasmFile']}")

    return result

if __name__ == "__main__":
    main()
