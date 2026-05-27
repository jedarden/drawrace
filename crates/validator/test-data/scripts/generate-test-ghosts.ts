#!/usr/bin/env -S pnpm tsx
/**
 * Generate binary ghost blobs for Layer 6 replay verification tests.
 *
 * This script reads JSON ghost files from apps/web/public/ghosts/
 * and converts them to the binary blob format expected by the validator.
 *
 * Usage:
 *   pnpm tsx crates/validator/test-data/scripts/generate-test-ghosts.ts
 *
 * The binary blobs are written to crates/validator/test-data/ghosts/
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

interface JsonWheel {
  swap_tick: number;
  polygon: Array<[number, number]>;  // [x, y] in normalized coordinates (-0.5 to 0.5)
}

interface JsonGhost {
  id: string;
  name: string;
  trackId: string;
  seed: number;
  finishTimeMs: number;
  finishTicks: number;
  wheelVertices: Array<{ x: number; y: number }>;
  wheels: JsonWheel[];
}

/**
 * Convert a JSON ghost to a binary ghost blob.
 */
function encodeGhostBlob(ghost: JsonGhost): ArrayBuffer {
  const {
    trackId,
    finishTimeMs,
    seed,
    wheels,
  } = ghost;

  // Extract track ID from trackId string (e.g., "hills-01" -> 1)
  const trackMatch = trackId.match(/\d+/);
  const trackIdNum = trackMatch ? parseInt(trackMatch[0], 10) : 1;

  const wheelCount = wheels.length;

  // Calculate total size
  const headerSize = 36;
  const wheelCountSize = 1;
  let wheelsSize = 0;
  for (const w of wheels) {
    wheelsSize += 4 + 1 + w.polygon.length * 4; // swap_tick + vertex_count + vertices
  }
  const strokeSize = 1 + 0; // point_count = 0 (no stroke data in JSON ghosts)
  const checkpointSize = 1; // checkpoint_count = 0
  const totalSize = headerSize + wheelCountSize + wheelsSize + strokeSize + checkpointSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  // Magic "DRGH"
  bytes[0] = 0x44; // D
  bytes[1] = 0x52; // R
  bytes[2] = 0x47; // G
  bytes[3] = 0x48; // H
  offset = 4;

  // version (PHYSICS_VERSION = 4)
  view.setUint8(offset, 4);
  offset += 1;

  // track_id (uint16 LE)
  view.setUint16(offset, trackIdNum, true);
  offset += 2;

  // flags (uint8) — 0x00 for normal (non-ephemeral)
  view.setUint8(offset, 0x00);
  offset += 1;

  // finish_time_ms (uint32 LE)
  view.setUint32(offset, finishTimeMs, true);
  offset += 4;

  // submitted_at (int64 LE) — use a fixed timestamp for reproducibility
  view.setBigInt64(offset, BigInt(1745299200000), true);
  offset += 8;

  // player_uuid (16 raw bytes) — use a fixed UUID for reproducibility
  const testUuid = '550e8400-e29b-41d4-a716-446655440000';
  const uuidBytes = parseUuidBytes(testUuid);
  for (let i = 0; i < 16; i++) {
    bytes[offset + i] = uuidBytes[i];
  }
  offset += 16;

  // wheel_count (uint8)
  view.setUint8(offset, wheelCount);
  offset += 1;

  // wheels[] — per wheel: swap_tick uint32, vertex_count uint8, int16 x,y × vertex_count
  for (const w of wheels) {
    view.setUint32(offset, w.swap_tick, true);
    offset += 4;

    view.setUint8(offset, w.polygon.length);
    offset += 1;

    for (const v of w.polygon) {
      // Convert from normalized (-0.5 to 0.5) to 1/100 px units
      view.setInt16(offset, Math.round(v[0] * 100), true);
      offset += 2;
      view.setInt16(offset, Math.round(v[1] * 100), true);
      offset += 2;
    }
  }

  // point_count = 0 (no stroke data in JSON ghosts)
  view.setUint8(offset, 0);
  offset += 1;

  // checkpoint_count = 0
  view.setUint8(offset, 0);

  return buf;
}

function parseUuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert ArrayBuffer to base64 for debugging.
 */
function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/**
 * Main function.
 */
function main() {
  const workspaceRoot = process.cwd();
  const ghostsDir = join(workspaceRoot, 'apps', 'web', 'public', 'ghosts');
  const outputDir = join(workspaceRoot, 'crates', 'validator', 'test-data', 'ghosts');

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  // Read all JSON ghost files
  const files = readdirSync(ghostsDir).filter(f => f.endsWith('.json'));

  console.log(`Found ${files.length} ghost files in ${ghostsDir}`);

  for (const file of files) {
    const jsonPath = join(ghostsDir, file);
    const jsonContent = readFileSync(jsonPath, 'utf-8');
    const ghost: JsonGhost = JSON.parse(jsonContent);

    console.log(`Processing ${file}:`);
    console.log(`  ID: ${ghost.id}`);
    console.log(`  Track: ${ghost.trackId}`);
    console.log(`  Seed: ${ghost.seed}`);
    console.log(`  Finish: ${ghost.finishTimeMs}ms (${ghost.finishTicks} ticks)`);
    console.log(`  Wheels: ${ghost.wheels.length}`);

    // Encode to binary blob
    const blob = encodeGhostBlob(ghost);

    // Generate output filename
    const outputFilename = file.replace('.json', '.blob');
    const outputPath = join(outputDir, outputFilename);

    // Write binary blob
    writeFileSync(outputPath, Buffer.from(blob));

    console.log(`  -> ${outputFilename} (${blob.byteLength} bytes)`);
    console.log();
  }

  console.log(`Done! Generated ${files.length} binary ghost blobs in ${outputDir}`);
}

main();
