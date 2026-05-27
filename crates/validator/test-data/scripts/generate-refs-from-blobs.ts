#!/usr/bin/env -S node
/**
 * Generate reference-ghosts.json from existing ghost blobs.
 *
 * This script reads the binary ghost blobs from test-data/ghosts/
 * and converts them to the reference-ghosts.json format used by
 * the replay verification tests.
 *
 * Usage:
 *   node crates/validator/test-data/scripts/generate-refs-from-blobs.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface ExpectedJson {
  version: number;
  description: string;
  note: string;
  ghosts: Array<{
    file: string;
    track_id: number;
    seed: number;
    expected_finish_ticks: number;
    description: string;
  }>;
}

interface WheelData {
  swap_tick: number;
  vertex_count: number;
  polygon_vertices: Array<[number, number]>;
}

interface ReferenceGhost {
  ghost_id: string;
  track_id: number;
  finish_time_ms: number;
  wheels: WheelData[];
  physics_version: number;
  notes: string;
}

interface ReferenceGhosts {
  version: number;
  updated_at: string;
  ghosts: Record<string, ReferenceGhost>;
}

/**
 * Parse a binary ghost blob.
 */
function parseGhostBlob(buffer: Buffer): {
  version: number;
  track_id: number;
  finish_time_ms: number;
  wheels: WheelData[];
} {
  let offset = 0;

  // Magic "DRGH"
  const magic = buffer.subarray(offset, offset + 4).toString('ascii');
  if (magic !== 'DRGH') {
    throw new Error(`Invalid magic: ${magic}`);
  }
  offset += 4;

  // version
  const version = buffer.readUInt8(offset);
  offset += 1;

  // track_id (uint16 LE)
  const track_id = buffer.readUInt16LE(offset);
  offset += 2;

  // flags (uint8)
  offset += 1;

  // finish_time_ms (uint32 LE)
  const finish_time_ms = buffer.readUInt32LE(offset);
  offset += 4;

  // submitted_at (int64 LE) - skip
  offset += 8;

  // player_uuid (16 bytes) - skip
  offset += 16;

  // wheel_count (uint8)
  const wheel_count = buffer.readUInt8(offset);
  offset += 1;

  // wheels[]
  const wheels: WheelData[] = [];
  for (let i = 0; i < wheel_count; i++) {
    const swap_tick = buffer.readUInt32LE(offset);
    offset += 4;

    const vertex_count = buffer.readUInt8(offset);
    offset += 1;

    const polygon_vertices: Array<[number, number]> = [];
    for (let j = 0; j < vertex_count; j++) {
      const x = buffer.readInt16LE(offset);
      offset += 2;
      const y = buffer.readInt16LE(offset);
      offset += 2;
      polygon_vertices.push([x, y]);
    }

    wheels.push({ swap_tick, vertex_count, polygon_vertices });
  }

  return { version, track_id, finish_time_ms, wheels };
}

/**
 * Main function.
 */
function main() {
  const workspaceRoot = process.cwd();
  const ghostsDir = join(workspaceRoot, 'crates', 'validator', 'test-data', 'ghosts');
  const expectedPath = join(ghostsDir, 'expected.json');
  const outputPath = join(workspaceRoot, 'crates', 'validator', 'reference-ghosts.json');

  // Read expected.json
  const expectedJson: ExpectedJson = JSON.parse(
    readFileSync(expectedPath, 'utf-8')
  );

  // Generate reference ghosts
  const ghosts: Record<string, ReferenceGhost> = {};

  for (const expectedGhost of expectedJson.ghosts) {
    const blobPath = join(ghostsDir, expectedGhost.file);
    const buffer = readFileSync(blobPath);

    const parsed = parseGhostBlob(buffer);

    // Calculate finish_time_ms from expected_finish_ticks
    // ticks * 1000 / 60 = ms
    const finish_time_ms = Math.round((expectedGhost.expected_finish_ticks * 1000) / 60);

    const ghostId = expectedGhost.file.replace('.blob', '');

    ghosts[ghostId] = {
      ghost_id: ghostId,
      track_id: expectedGhost.track_id,
      finish_time_ms: finish_time_ms,
      wheels: parsed.wheels,
      physics_version: parsed.version,
      notes: expectedGhost.description,
    };
  }

  const referenceGhosts: ReferenceGhosts = {
    version: 1,
    updated_at: new Date().toISOString(),
    ghosts,
  };

  writeFileSync(outputPath, JSON.stringify(referenceGhosts, null, 2));

  console.log(`Generated ${Object.keys(ghosts).length} reference ghosts`);
  console.log(`Wrote to: ${outputPath}`);
}

main();
