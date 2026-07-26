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

def patch_wat_physics_version(wat_path: Path, physics_version: int) -> Path:
    """Patch the physics version in the WAT file.

    Uses a regex so the patch matches whatever version constant is currently in
    the WAT — not just the literal ``i32.const 4``. This keeps the build honest
    across future PHYSICS_VERSION bumps: previously a fixed-string replace
    silently no-op'd once the committed WAT value moved off 4, shipping a WASM
    whose reported version lagged version.ts.
    """
    content = wat_path.read_text()
    pattern = re.compile(r'\(global \$PHYSICS_VERSION i32 \(i32\.const \d+\)\)')
    new_decl = f'(global $PHYSICS_VERSION i32 (i32.const {physics_version}))'
    updated, n = pattern.subn(new_decl, content)
    if n == 0:
        raise ValueError(
            f"could not find '(global $PHYSICS_VERSION i32 (i32.const N))' in {wat_path}"
        )
    # Write to a temporary file (committed WAT is left as the source of truth)
    patched_path = wat_path.parent / f"{wat_path.name}.patched"
    patched_path.write_text(updated)
    log("patch", f"Patched physics_version to {physics_version} in {patched_path}")
    return patched_path

def compile_resim_wat(physics_version: int) -> bytes:
    """Compile resim.wat to WASM using wat2wasm."""
    import subprocess
    import shutil
    import sys
    import platform
    import tempfile
    import urllib.request
    import zipfile
    import tarfile

    wat_path = ROOT_DIR / "src" / "resim.wat"
    wasm_path = DIST_DIR / "resim.wasm"

    if not wat_path.exists():
        raise FileNotFoundError(f"resim.wat not found at {wat_path}")

    # Patch physics version before compiling
    patched_wat_path = patch_wat_physics_version(wat_path, physics_version)

    log("info", f"Compiling {patched_wat_path} to {wasm_path}")

    # Check if wat2wasm is available
    wat2wasm_path = shutil.which("wat2wasm")
    if not wat2wasm_path:
        log("install", "wat2wasm not found, attempting to install wabt...")
        installed = False

        # Try to install via apk (Alpine) or apt-get (Debian/Ubuntu)
        for pkg_mgr, install_cmd in [("apk", ["apk", "add", "--no-cache", "wabt"]),
                                      ("apt-get", ["apt-get", "install", "-y", "wabt"])]:
            if shutil.which(pkg_mgr):
                try:
                    log("install", f"Running: {' '.join(install_cmd)}")
                    result = subprocess.run(
                        install_cmd,
                        capture_output=True,
                        text=True,
                        check=True,
                    )
                    log("done", f"wabt package installed via {pkg_mgr}")
                    installed = True
                    # Check again if wat2wasm is now available
                    wat2wasm_path = shutil.which("wat2wasm")
                    if not wat2wasm_path:
                        log("error", "wabt installed but wat2wasm still not found in PATH")
                    break
                except subprocess.CalledProcessError as e:
                    log("error", f"Failed to install via {pkg_mgr}: {e.stderr}")
                    # Try next package manager
                    continue

        # Fallback: download from GitHub releases
        if not installed or not wat2wasm_path:
            log("install", "Package manager install failed, downloading from GitHub releases...")
            try:
                # Detect platform and architecture
                system = platform.system().lower()
                machine = platform.machine().lower()

                # Map machine names to wabt naming convention
                if machine in ["x86_64", "amd64"]:
                    arch = "x64"
                elif machine in ["aarch64", "arm64"]:
                    arch = "arm64"
                elif machine in ["armv7l", "armv6l"]:
                    arch = "arm"
                else:
                    raise RuntimeError(f"Unsupported architecture: {machine}")

                # Determine filename based on platform (wabt uses platform-arch format)
                if system == "linux":
                    filename = f"wabt-1.0.41-linux-{arch}.tar.gz"
                elif system == "darwin":
                    filename = f"wabt-1.0.41-macos-{arch}.tar.gz"
                else:
                    raise RuntimeError(f"Unsupported platform: {system}")

                download_url = f"https://github.com/WebAssembly/wabt/releases/download/1.0.41/{filename}"
                log("download", f"Downloading {download_url}")

                # Download to temp file
                with tempfile.NamedTemporaryFile(delete=False, suffix=".tar.gz") as f:
                    temp_path = f.name
                    urllib.request.urlretrieve(download_url, temp_path)

                # Extract and install to local directory
                temp_dir = ROOT_DIR / ".wabt"
                temp_dir.mkdir(exist_ok=True)

                log("install", f"Extracting to {temp_dir}")
                with tarfile.open(temp_path, "r:gz") as tar:
                    tar.extractall(temp_dir)

                # Find the extracted wat2wasm binary
                # Try multiple possible directory names
                possible_dirs = [
                    temp_dir / f"wabt-1.0.41-{system}-{arch}",  # e.g., wabt-1.0.41-linux-x64
                    temp_dir / f"wabt-1.0.41",  # generic fallback
                ]

                extracted_dir = None
                for possible_dir in possible_dirs:
                    if possible_dir.exists():
                        extracted_dir = possible_dir
                        break

                if not extracted_dir:
                    # List what we actually got
                    dirs_found = list(temp_dir.iterdir())
                    raise RuntimeError(f"Could not find wabt directory. Tried: {possible_dirs}. Found: {dirs_found}")

                wat2wasm_bin = extracted_dir / "bin" / "wat2wasm"
                if not wat2wasm_bin.exists():
                    raise RuntimeError(f"Could not find wat2wasm in extracted directory: {extracted_dir}")

                # Make executable
                wat2wasm_bin.chmod(0o755)
                wat2wasm_path = str(wat2wasm_bin)
                log("done", f"wat2wasm installed to {wat2wasm_path}")

            except Exception as e:
                raise RuntimeError(
                    f"wat2wasm not found and could not auto-install wabt: {e}\n"
                    "Please install wabt manually:\n"
                    "  - Alpine/Linux: apk add wabt\n"
                    "  - Debian/Ubuntu: apt-get install wabt\n"
                    "  - macOS: brew install wabt\n"
                    "  - Or download from: https://github.com/WebAssembly/wabt/releases"
                ) from e

    # Run wat2wasm
    log("info", f"Using wat2wasm at: {wat2wasm_path}")
    result = subprocess.run(
        [wat2wasm_path, str(patched_wat_path), "-o", str(wasm_path)],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        log("error", f"wat2wasm compilation failed")
        log("error", f"stderr: {result.stderr}")
        log("error", f"stdout: {result.stdout}")
        raise RuntimeError(f"wat2wasm failed with exit code {result.returncode}")

    # Clean up temporary patched file
    patched_wat_path.unlink()

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

    # Step 2: Compile resim.wat to WASM (with patched physics version)
    wasm_bytes = compile_resim_wat(physics_version)

    # Step 3: Create content-hashed artifacts
    result = create_hashed_artifact(wasm_bytes, physics_version)

    log("complete", "✓ resim.wasm build complete!")
    log("output", f"Artifact: {result['wasmFile']}")

    return result

if __name__ == "__main__":
    main()
