#!/usr/bin/env -S pnpm tsx
/**
 * Generate 200 synthetic test ghosts for reference-ghosts.json.
 *
 * This script creates varied synthetic ghost data to serve as a regression
 * test baseline until real-player ghosts are available from production.
 *
 * Usage:
 *   pnpm tsx crates/validator/test-data/scripts/generate-reference-ghosts.ts
 *
 * The output is written to crates/validator/reference-ghosts.json.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

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
 * Generate a regular polygon vertices for a wheel.
 */
function generatePolygonVertices(vertexCount: number, radius: number = 50): Array<[number, number]> {
  const vertices: Array<[number, number]> = [];
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount;
    const x = Math.round(radius * Math.cos(angle));
    const y = Math.round(radius * Math.sin(angle));
    vertices.push([x, y]);
  }
  return vertices;
}

/**
 * Generate a varied wheel configuration.
 */
function generateWheel(swapTick: number, seed: number): WheelData {
  // Vary vertex count between 8 and 16 (valid range is 8-32)
  const vertexCount = 8 + (seed % 9);
  // Vary radius slightly for diversity
  const radius = 40 + (seed % 20);

  return {
    swap_tick: swapTick,
    vertex_count: vertexCount,
    polygon_vertices: generatePolygonVertices(vertexCount, radius),
  };
}

/**
 * Generate a complete ghost with varied parameters.
 */
function generateGhost(id: string, trackId: number, seed: number): ReferenceGhost {
  // Generate varied finish times between 10s and 90s
  const baseFinishTime = 10000 + (seed % 80000);
  const finishTimeMs = baseFinishTime;

  // Generate 1-6 wheels with increasing swap ticks
  const wheelCount = 1 + (seed % 6);
  const wheels: WheelData[] = [];

  for (let i = 0; i < wheelCount; i++) {
    // Swap ticks should be at least 30 apart (MIN_SWAP_TICK_GAP)
    const swapTick = i * 30;
    wheels.push(generateWheel(swapTick, seed + i * 1000));
  }

  return {
    ghost_id: id,
    track_id: trackId,
    finish_time_ms: finishTimeMs,
    wheels: wheels,
    physics_version: 4,
    notes: `Synthetic test ghost - track ${trackId}, seed ${seed}, wheel_count ${wheelCount}. Replace with real-player ghosts from production.`,
  };
}

/**
 * Generate 200 reference ghosts covering varied scenarios.
 */
function generateReferenceGhosts(): ReferenceGhosts {
  const ghosts: Record<string, ReferenceGhost> = {};

  // Track IDs 1-5 (hills-01 through hills-05)
  const trackIds = [1, 2, 3, 4, 5];

  // Generate 40 ghosts per track = 200 total
  let ghostIndex = 0;
  for (const trackId of trackIds) {
    for (let i = 0; i < 40; i++) {
      const seed = 1000 + ghostIndex * 97; // Prime multiplier for variety
      const ghostId = `synth-track-${trackId}-${String(i).padStart(3, '0')}`;
      ghosts[ghostId] = generateGhost(ghostId, trackId, seed);
      ghostIndex++;
    }
  }

  return {
    version: 1,
    updated_at: new Date().toISOString(),
    ghosts: ghosts,
  };
}

/**
 * Main function.
 */
function main() {
  const workspaceRoot = process.cwd();
  const outputPath = join(workspaceRoot, 'crates', 'validator', 'reference-ghosts.json');

  const ghosts = generateReferenceGhosts();

  const ghostCount = Object.keys(ghosts.ghosts).length;
  console.log(`Generating ${ghostCount} reference ghosts...`);

  // Breakdown by track
  const trackCounts: Record<number, number> = {};
  for (const ghost of Object.values(ghosts.ghosts)) {
    trackCounts[ghost.track_id] = (trackCounts[ghost.track_id] || 0) + 1;
  }
  console.log('Breakdown by track:');
  for (const [trackId, count] of Object.entries(trackCounts).sort()) {
    console.log(`  Track ${trackId}: ${count} ghosts`);
  }

  // Write output
  writeFileSync(outputPath, JSON.stringify(ghosts, null, 2));
  console.log(`\nWrote reference ghosts to: ${outputPath}`);

  // Note about production ghosts
  console.log('\nNOTE: These are synthetic test ghosts for regression testing.');
  console.log('They should be replaced with 200 real-player ghosts from production');
  console.log('to serve as the full determinism regression suite.');
}

main();
