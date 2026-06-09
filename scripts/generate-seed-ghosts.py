#!/usr/bin/env python3
"""Generate seed ghost blob files for the seed pool.

This script creates 25 ghost blob files covering all 5 buckets (elite, advanced,
skilled, mid, novice) and saves them to seeds/track_1/ directory for bundling
into the Docker image.
"""

import os
import struct
import uuid
from datetime import datetime
from pathlib import Path

PHYSICS_VERSION = 2
TRACK_ID = 1
HEADER_SIZE = 36
SEED_PLAYER_UUID = uuid.UUID("00000000-0000-4000-8000-000000000001")

SEEDS = [
    # elite
    {"name": "Blaze", "time_ms": 25_400, "vertices": [
        (0.48, 0.0), (0.44, 0.19), (0.34, 0.34), (0.19, 0.44), (0.0, 0.48),
        (-0.19, 0.44), (-0.34, 0.34), (-0.44, 0.19), (-0.48, 0.0), (-0.44, -0.19),
        (-0.34, -0.34), (-0.19, -0.44), (0.0, -0.48), (0.19, -0.44), (0.34, -0.34),
        (0.44, -0.19),
    ]},
    # advanced
    {"name": "Swift", "time_ms": 29_800, "vertices": [
        (0.55, 0.0), (0.51, 0.21), (0.39, 0.39), (0.21, 0.51), (0.0, 0.55),
        (-0.21, 0.51), (-0.39, 0.39), (-0.51, 0.21), (-0.55, 0.0), (-0.51, -0.21),
        (-0.39, -0.39), (-0.21, -0.51), (0.0, -0.55), (0.21, -0.51), (0.39, -0.39),
        (0.51, -0.21),
    ]},
    # skilled
    {"name": "Quick", "time_ms": 32_100, "vertices": [
        (0.50, 0.0), (0.46, 0.19), (0.35, 0.35), (0.19, 0.46), (0.0, 0.50),
        (-0.19, 0.46), (-0.35, 0.35), (-0.46, 0.19), (-0.50, 0.0), (-0.46, -0.19),
        (-0.35, -0.35), (-0.19, -0.46), (0.0, -0.50), (0.19, -0.46), (0.35, -0.35),
        (0.46, -0.19),
    ]},
    {"name": "Dash", "time_ms": 33_500, "vertices": [
        (0.60, 0.0), (0.55, 0.25), (0.42, 0.42), (0.25, 0.55), (0.0, 0.60),
        (-0.25, 0.55), (-0.42, 0.42), (-0.55, 0.25), (-0.60, 0.0), (-0.55, -0.25),
        (-0.42, -0.42), (-0.25, -0.55), (0.0, -0.60), (0.25, -0.55), (0.42, -0.42),
        (0.55, -0.25),
    ]},
    {"name": "Bolt", "time_ms": 35_200, "vertices": [
        (0.65, 0.0), (0.55, 0.35), (0.30, 0.56), (0.0, 0.65), (-0.30, 0.56),
        (-0.55, 0.35), (-0.65, 0.0), (-0.55, -0.35), (-0.30, -0.56), (0.0, -0.65),
    ]},
    {"name": "Sprint", "time_ms": 37_800, "vertices": [
        (0.52, 0.0), (0.49, 0.15), (0.42, 0.30), (0.30, 0.42), (0.15, 0.49),
        (0.0, 0.52), (-0.15, 0.49), (-0.30, 0.42), (-0.42, 0.30), (-0.49, 0.15),
        (-0.52, 0.0), (-0.49, -0.15), (-0.42, -0.30), (-0.30, -0.42), (-0.15, -0.49),
        (0.0, -0.52), (0.15, -0.49), (0.30, -0.42),
    ]},
    # mid
    {"name": "Pacer", "time_ms": 40_100, "vertices": [
        (0.45, 0.0), (0.42, 0.17), (0.32, 0.32), (0.17, 0.42), (0.0, 0.45),
        (-0.17, 0.42), (-0.32, 0.32), (-0.42, 0.17), (-0.45, 0.0), (-0.42, -0.17),
        (-0.32, -0.32), (-0.17, -0.42), (0.0, -0.45), (0.17, -0.42), (0.32, -0.32),
        (0.42, -0.17),
    ]},
    {"name": "Steady", "time_ms": 42_600, "vertices": [
        (0.70, 0.0), (0.65, 0.27), (0.49, 0.49), (0.27, 0.65), (0.0, 0.70),
        (-0.27, 0.65), (-0.49, 0.49), (-0.65, 0.27), (-0.70, 0.0), (-0.65, -0.27),
        (-0.49, -0.49), (-0.27, -0.65), (0.0, -0.70), (0.27, -0.65), (0.49, -0.49),
        (0.65, -0.27),
    ]},
    {"name": "Cruise", "time_ms": 44_300, "vertices": [
        (0.55, 0.0), (0.48, 0.28), (0.28, 0.48), (0.0, 0.55), (-0.28, 0.48),
        (-0.48, 0.28), (-0.55, 0.0), (-0.48, -0.28), (-0.28, -0.48), (0.0, -0.55),
        (0.28, -0.48), (0.48, -0.28),
    ]},
    {"name": "Ramble", "time_ms": 46_900, "vertices": [
        (0.58, 0.0), (0.50, 0.30), (0.30, 0.50), (0.0, 0.58), (-0.30, 0.50),
        (-0.50, 0.30), (-0.58, 0.0), (-0.50, -0.30), (-0.30, -0.50), (0.0, -0.58),
        (0.30, -0.50), (0.50, -0.30),
    ]},
    {"name": "Drift", "time_ms": 49_200, "vertices": [
        (0.40, 0.0), (0.35, 0.20), (0.20, 0.35), (0.0, 0.40), (-0.20, 0.35),
        (-0.35, 0.20), (-0.40, 0.0), (-0.35, -0.20), (-0.20, -0.35), (0.0, -0.40),
        (0.20, -0.35), (0.35, -0.20),
    ]},
    {"name": "Mosey", "time_ms": 51_700, "vertices": [
        (0.62, 0.0), (0.57, 0.24), (0.44, 0.44), (0.24, 0.57), (0.0, 0.62),
        (-0.24, 0.57), (-0.44, 0.44), (-0.57, 0.24), (-0.62, 0.0), (-0.57, -0.24),
        (-0.44, -0.44), (-0.24, -0.57), (0.0, -0.62), (0.24, -0.57), (0.44, -0.44),
        (0.57, -0.24),
    ]},
    {"name": "Jog", "time_ms": 53_400, "vertices": [
        (0.48, 0.0), (0.43, 0.18), (0.34, 0.34), (0.18, 0.43), (0.0, 0.48),
        (-0.18, 0.43), (-0.34, 0.34), (-0.43, 0.18), (-0.48, 0.0), (-0.43, -0.18),
        (-0.34, -0.34), (-0.18, -0.43), (0.0, -0.48), (0.18, -0.43), (0.34, -0.34),
        (0.43, -0.18),
    ]},
    # novice
    {"name": "Stroll", "time_ms": 56_100, "vertices": [
        (0.50, 0.0), (0.46, 0.19), (0.35, 0.35), (0.19, 0.46), (0.0, 0.50),
        (-0.19, 0.46), (-0.35, 0.35), (-0.46, 0.19), (-0.50, 0.0), (-0.46, -0.19),
        (-0.35, -0.35), (-0.19, -0.46), (0.0, -0.50), (0.19, -0.46), (0.35, -0.35),
        (0.46, -0.19),
    ]},
    {"name": "Wobble", "time_ms": 59_800, "vertices": [
        (0.80, 0.0), (0.62, 0.48), (0.22, 0.76), (-0.22, 0.76), (-0.62, 0.48),
        (-0.80, 0.0), (-0.62, -0.48), (-0.22, -0.76), (0.22, -0.76), (0.62, -0.48),
    ]},
    {"name": "Trundle", "time_ms": 63_200, "vertices": [
        (0.42, 0.0), (0.38, 0.16), (0.28, 0.28), (0.16, 0.38), (0.0, 0.42),
        (-0.16, 0.38), (-0.28, 0.28), (-0.38, 0.16), (-0.42, 0.0), (-0.38, -0.16),
        (-0.28, -0.28), (-0.16, -0.38), (0.0, -0.42), (0.16, -0.38), (0.28, -0.28),
        (0.38, -0.16),
    ]},
    {"name": "Amble", "time_ms": 67_500, "vertices": [
        (0.66, 0.0), (0.58, 0.32), (0.38, 0.55), (0.12, 0.65), (-0.12, 0.65),
        (-0.38, 0.55), (-0.58, 0.32), (-0.66, 0.0), (-0.58, -0.32), (-0.38, -0.55),
        (-0.12, -0.65), (0.12, -0.65), (0.38, -0.55), (0.58, -0.32),
    ]},
    {"name": "Slog", "time_ms": 72_300, "vertices": [
        (0.36, 0.0), (0.33, 0.14), (0.25, 0.25), (0.14, 0.33), (0.0, 0.36),
        (-0.14, 0.33), (-0.25, 0.25), (-0.33, 0.14), (-0.36, 0.0), (-0.33, -0.14),
        (-0.25, -0.25), (-0.14, -0.33), (0.0, -0.36), (0.14, -0.33), (0.25, -0.25),
        (0.33, -0.14),
    ]},
    {"name": "Putter", "time_ms": 78_600, "vertices": [
        (0.75, 0.0), (0.68, 0.32), (0.48, 0.55), (0.22, 0.72), (0.0, 0.75),
        (-0.22, 0.72), (-0.48, 0.55), (-0.68, 0.32), (-0.75, 0.0), (-0.68, -0.32),
        (-0.48, -0.55), (-0.22, -0.72), (0.0, -0.75), (0.22, -0.72), (0.48, -0.55),
        (0.68, -0.32),
    ]},
    {"name": "Crawl", "time_ms": 85_400, "vertices": [
        (0.38, 0.0), (0.35, 0.15), (0.27, 0.27), (0.15, 0.35), (0.0, 0.38),
        (-0.15, 0.35), (-0.27, 0.27), (-0.35, 0.15), (-0.38, 0.0), (-0.35, -0.15),
        (-0.27, -0.27), (-0.15, -0.35),
    ]},
    {"name": "Plod", "time_ms": 92_700, "vertices": [
        (0.55, 0.0), (0.52, 0.17), (0.44, 0.32), (0.32, 0.44), (0.17, 0.52),
        (0.0, 0.55), (-0.17, 0.52), (-0.32, 0.44), (-0.44, 0.32), (-0.52, 0.17),
        (-0.55, 0.0), (-0.52, -0.17), (-0.44, -0.32), (-0.32, -0.44), (-0.17, -0.52),
        (0.0, -0.55),
    ]},
    {"name": "Wade", "time_ms": 101_600, "vertices": [
        (0.80, 0.0), (0.74, 0.15), (0.57, 0.28), (0.31, 0.37), (0.0, 0.40),
        (-0.31, 0.37), (-0.57, 0.28), (-0.74, 0.15), (-0.80, 0.0), (-0.74, -0.15),
        (-0.57, -0.28), (-0.31, -0.37), (0.0, -0.40), (0.31, -0.37), (0.57, -0.28),
        (0.74, -0.15),
    ]},
    {"name": "Lumber", "time_ms": 112_000, "vertices": [
        (0.44, 0.0), (0.38, 0.22), (0.22, 0.38), (0.0, 0.44), (-0.22, 0.38),
        (-0.38, 0.22), (-0.44, 0.0), (-0.38, -0.22), (-0.22, -0.38), (0.0, -0.44),
    ]},
    {"name": "Dawdle", "time_ms": 124_500, "vertices": [
        (0.60, 0.0), (0.52, 0.31), (0.31, 0.52), (0.0, 0.60), (-0.31, 0.52),
        (-0.52, 0.31), (-0.60, 0.0), (-0.52, -0.31), (-0.31, -0.52), (0.0, -0.60),
        (0.31, -0.52), (0.52, -0.31),
    ]},
]

def generate_stroke(vertices):
    """Generate synthetic delta-encoded stroke points tracing the polygon outline."""
    points = []
    prev_x = 0.0
    prev_y = 0.0
    t = 0

    for vx, vy in vertices:
        px = vx * 100.0
        py = vy * 100.0
        dx = int(round(px - prev_x))
        dy = int(round(py - prev_y))
        dt = 16  # 16ms between points
        t += dt
        # Pack as signed i16 for dx/dy, u16 for dt
        points.append((dx & 0xFFFF, dy & 0xFFFF, dt & 0xFFFF))
        prev_x = px
        prev_y = py

    return points

def encode_seed_blob(seed, submitted_at_ms):
    """Encode a seed ghost into the DRGH binary format (v2 with wheels[])."""
    vertex_count = len(seed["vertices"])
    assert 8 <= vertex_count <= 32, f"seed ghost must have 8-32 vertices, got {vertex_count}"

    stroke_points = generate_stroke(seed["vertices"])
    checkpoint_count = 0

    # Calculate total size
    total_size = (HEADER_SIZE +
                  1 +  # wheel_count
                  4 +  # swap_tick
                  1 +  # vertex_count
                  vertex_count * 4 +  # vertices (i16 x, i16 y per vertex)
                  1 +  # stroke_point_count
                  len(stroke_points) * 6 +  # stroke_points (i16 dx, i16 dy, u16 dt each)
                  1 +  # checkpoint_count
                  checkpoint_count * 4)  # checkpoints (u32 each)

    buf = bytearray(total_size)

    # Magic "DRGH"
    buf[0:4] = b"DRGH"
    buf[4] = PHYSICS_VERSION
    buf[5:7] = struct.pack("<H", TRACK_ID)
    buf[7] = 0  # flags
    buf[8:12] = struct.pack("<I", seed["time_ms"])
    buf[12:20] = struct.pack("<Q", submitted_at_ms)
    buf[20:36] = SEED_PLAYER_UUID.bytes

    offset = HEADER_SIZE

    # wheel_count = 1
    buf[offset] = 1
    offset += 1

    # Wheel 0: swap_tick = 0
    buf[offset:offset + 4] = struct.pack("<I", 0)
    offset += 4

    # vertex_count
    buf[offset] = vertex_count
    offset += 1

    # vertices
    for vx, vy in seed["vertices"]:
        ix = int(round(vx * 100.0))
        iy = int(round(vy * 100.0))
        buf[offset:offset + 2] = struct.pack("<h", ix)
        buf[offset + 2:offset + 4] = struct.pack("<h", iy)
        offset += 4

    # Stroke points
    buf[offset] = len(stroke_points)
    offset += 1

    for dx, dy, dt in stroke_points:
        buf[offset:offset + 2] = struct.pack("<h", dx if dx < 0x8000 else dx - 0x10000)
        buf[offset + 2:offset + 4] = struct.pack("<h", dy if dy < 0x8000 else dy - 0x10000)
        buf[offset + 4:offset + 6] = struct.pack("<H", dt)
        offset += 6

    # Checkpoints
    buf[offset] = checkpoint_count

    return bytes(buf)

def main():
    print("Generating seed ghost blob files...")

    workspace_root = Path.cwd()
    seeds_dir = workspace_root / "seeds" / "track_1"

    # Create output directory
    seeds_dir.mkdir(parents=True, exist_ok=True)

    now_ms = int(datetime.now().timestamp() * 1000)

    for i, seed in enumerate(SEEDS):
        # Stagger submitted_at by 1 second each
        submitted_at = now_ms - (len(SEEDS) - i) * 1000
        blob = encode_seed_blob(seed, submitted_at)
        filename = f"seed-{i:03d}.blob"
        filepath = seeds_dir / filename

        filepath.write_bytes(blob)
        print(f"  Wrote {filename}: {seed['name']} ({seed['time_ms']}ms)")

    print(f"\nGenerated {len(SEEDS)} seed ghost blob files in {seeds_dir}")
    print("\nBucket distribution:")
    print("  - elite    (pr ≤ 0.01):  1 ghost")
    print("  - advanced (pr ≤ 0.05):  1 ghost")
    print("  - skilled  (pr ≤ 0.20):  4 ghosts")
    print("  - mid      (pr ≤ 0.50):  7 ghosts")
    print("  - novice   (pr >  0.50): 12 ghosts")

if __name__ == "__main__":
    main()
