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

def encode_i32(n: int) -> bytes:
    """Encode an integer as WASM signed LEB128."""
    if n == 0:
        return b'\x00'

    bytes_list = []
    value = n & 0xffffffff  # Treat as unsigned

    while value > 0:
        byte = value & 0x7f
        value >>= 7
        if value > 0:
            byte |= 0x80
        bytes_list.append(byte)

    return bytes(bytes_list)

def string_bytes(s: str) -> bytes:
    """Encode a string for WASM (length prefix + UTF-8)."""
    utf8 = s.encode('utf-8')
    return bytes([len(utf8)]) + utf8

def extract_physics_version() -> int:
    """Extract PHYSICS_VERSION from version.ts"""
    version_file = ROOT_DIR / "src" / "version.ts"
    content = version_file.read_text()
    match = re.search(r'PHYSICS_VERSION\s*=\s*(\d+)', content)
    if not match:
        raise ValueError("Could not find PHYSICS_VERSION in version.ts")
    return int(match.group(1))

def create_minimal_wasm(physics_version: int) -> bytes:
    """Create a minimal valid WASM binary with physics_version export."""

    # WASM magic number and version
    magic = b'\x00\x61\x73\x6d'  # \0asm
    version = b'\x01\x00\x00\x00'  # version 1

    # Type section: function types
    type_section = bytes([
        0x01,  # section id (type)
        0x06,  # section length
        0x02,  # num types
        # Type 0: [] -> i32 (physics_version)
        0x60, 0x00, 0x7f,
        # Type 1: [] -> i32 (wasm_validate)
        0x60, 0x00, 0x7f,
    ])

    # Function section: function declarations
    function_section = bytes([
        0x03,  # section id (function)
        0x03,  # section length
        0x02,  # num functions
        0x00,  # physics_version uses type 0
        0x01,  # wasm_validate uses type 1
    ])

    # Global section: physics version constant
    global_section = bytes([0x06])  # section id (global)
    global_section += encode_i32(7)  # section length
    global_section += bytes([
        0x01,  # num globals
        0x7f,  # i32
        0x00,  # immutable
        0x41,  # i32.const
    ])
    global_section += encode_i32(physics_version)
    global_section += bytes([0x0b])  # end

    # Export section
    export_section = bytes([0x07])  # section id (export)
    export_section += encode_i32(30)  # section length
    export_section += bytes([0x03])  # num exports

    # physics_version export
    export_section += string_bytes("physics_version")
    export_section += bytes([0x00, 0x00])  # export kind (function), function index

    # wasm_validate export
    export_section += string_bytes("wasm_validate")
    export_section += bytes([0x00, 0x01])  # export kind (function), function index

    # memory export
    export_section += string_bytes("memory")
    export_section += bytes([0x02, 0x00])  # export kind (memory), memory index

    # Code section: function bodies
    code_section = bytes([0x0a])  # section id (code)
    code_section += encode_i32(13)  # section length
    code_section += bytes([0x02])  # num functions

    # physics_version body
    code_section += bytes([
        0x06,  # function size
        0x00,  # num locals
        0x23, 0x00,  # global.get 0
        0x0b,  # end
    ])

    # wasm_validate body
    code_section += bytes([
        0x09,  # function size
        0x00,  # num locals
        0x23, 0x00,  # global.get 0
        0x41, 0x00,  # i32.const 0
        0x48,  # i32.gt_s
        0x0b,  # end
    ])

    # Memory section: 1 page (64KB)
    memory_section = bytes([
        0x05,  # section id (memory)
        0x03,  # section length
        0x01,  # num memories
        0x00,  # limits type (no maximum)
        0x01,  # initial pages (64KB)
    ])

    return magic + version + type_section + function_section + global_section + export_section + code_section + memory_section

def create_hashed_artifact(wasm_path: Path, physics_version: int) -> dict:
    """Generate content hash and create content-hashed artifact."""
    log("hash", "Generating content hash...")

    wasm_buffer = wasm_path.read_bytes()
    content_hash = get_content_hash(wasm_buffer)

    hashed_name = f"engine-core.{content_hash}.wasm"
    hashed_path = DIST_DIR / hashed_name

    wasm_path.rename(hashed_path)

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
    log("start", "Building engine-core WASM...")

    ensure_dir(DIST_DIR)

    # Step 1: Extract physics version
    physics_version = extract_physics_version()
    log("version", f"PHYSICS_VERSION = {physics_version}")

    # Step 2: Create WASM binary
    log("compile", "Creating WebAssembly binary...")
    wasm_bytes = create_minimal_wasm(physics_version)

    # Step 3: Write WASM file
    wasm_path = DIST_DIR / "engine-core.wasm"
    wasm_path.write_bytes(wasm_bytes)
    log("done", f"WASM written to {wasm_path}")

    # Step 4: Create content-hashed artifact
    result = create_hashed_artifact(wasm_path, physics_version)

    log("complete", "✓ engine-core.wasm build complete!")
    log("output", f"Artifact: {result['wasmFile']}")

    return result

if __name__ == "__main__":
    main()
