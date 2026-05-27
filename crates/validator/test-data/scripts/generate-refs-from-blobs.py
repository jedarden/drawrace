#!/usr/bin/env python3
"""
Generate reference-ghosts.json from existing ghost blobs.

This script reads the binary ghost blobs from test-data/ghosts/
and converts them to the reference-ghosts.json format used by
the replay verification tests.
"""

import json
import struct
import os
from pathlib import Path
from datetime import datetime


def parse_ghost_blob(buffer: bytes) -> dict:
    """Parse a binary ghost blob."""
    offset = 0

    # Magic "DRGH"
    magic = buffer[offset:offset+4].decode('ascii')
    if magic != 'DRGH':
        raise ValueError(f"Invalid magic: {magic}")
    offset += 4

    # version
    version = buffer[offset]
    offset += 1

    # track_id (uint16 LE)
    track_id = struct.unpack('<H', buffer[offset:offset+2])[0]
    offset += 2

    # flags (uint8)
    offset += 1

    # finish_time_ms (uint32 LE)
    finish_time_ms = struct.unpack('<I', buffer[offset:offset+4])[0]
    offset += 4

    # submitted_at (int64 LE) - skip
    offset += 8

    # player_uuid (16 bytes) - skip
    offset += 16

    # wheel_count (uint8)
    wheel_count = buffer[offset]
    offset += 1

    # wheels[]
    wheels = []
    for i in range(wheel_count):
        swap_tick = struct.unpack('<I', buffer[offset:offset+4])[0]
        offset += 4

        vertex_count = buffer[offset]
        offset += 1

        polygon_vertices = []
        for j in range(vertex_count):
            x = struct.unpack('<h', buffer[offset:offset+2])[0]
            offset += 2
            y = struct.unpack('<h', buffer[offset:offset+2])[0]
            offset += 2
            polygon_vertices.append([x, y])

        wheels.append({
            'swap_tick': swap_tick,
            'vertex_count': vertex_count,
            'polygon_vertices': polygon_vertices
        })

    return {
        'version': version,
        'track_id': track_id,
        'finish_time_ms': finish_time_ms,
        'wheels': wheels
    }


def main():
    workspace_root = Path.cwd()
    ghosts_dir = workspace_root / 'crates' / 'validator' / 'test-data' / 'ghosts'
    expected_path = ghosts_dir / 'expected.json'
    output_path = workspace_root / 'crates' / 'validator' / 'reference-ghosts.json'

    # Read expected.json
    with open(expected_path, 'r') as f:
        expected_json = json.load(f)

    # Generate reference ghosts
    ghosts = {}

    for expected_ghost in expected_json['ghosts']:
        blob_path = ghosts_dir / expected_ghost['file']

        with open(blob_path, 'rb') as f:
            buffer = f.read()

        parsed = parse_ghost_blob(buffer)

        # Calculate finish_time_ms from expected_finish_ticks
        # ticks * 1000 / 60 = ms
        finish_time_ms = round((expected_ghost['expected_finish_ticks'] * 1000) / 60)

        ghost_id = expected_ghost['file'].replace('.blob', '')

        ghosts[ghost_id] = {
            'ghost_id': ghost_id,
            'track_id': expected_ghost['track_id'],
            'finish_time_ms': finish_time_ms,
            'wheels': parsed['wheels'],
            'physics_version': parsed['version'],
            'notes': expected_ghost['description']
        }

    reference_ghosts = {
        'version': 1,
        'updated_at': datetime.now().isoformat(),
        'ghosts': ghosts
    }

    with open(output_path, 'w') as f:
        json.dump(reference_ghosts, f, indent=2)

    print(f"Generated {len(ghosts)} reference ghosts")
    print(f"Wrote to: {output_path}")


if __name__ == '__main__':
    main()
