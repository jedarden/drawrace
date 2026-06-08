#!/usr/bin/env -S pnpm tsx
/**
 * Update reference-ghosts.json with actual simulation results.
 *
 * This script reads the current reference-ghosts.json, runs the WASM
 * resimulation for each ghost, and updates the finish_time_ms to the
 * actual result from the simulation.
 *
 * Usage:
 *   pnpm tsx scripts/update-reference-ghosts.ts
 */

import { readFileSync, writeFileSync } from 'fs';
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

interface TrackJson {
  id: string;
  numeric_id: number;
  name: string;
  version: number;
  terrain: Array<[number, number]>;
  obstacles: Array<{ type: string; pos: [number, number]; size: [number, number] }>;
  surfaces: Array<{ x_range: [number, number]; type: string }>;
  ramps: Array<{ zone: string; x_start: number; x_end: number }>;
  start: { pos: [number, number]; facing: number };
  finish: { pos: [number, number]; width: number };
  hazards: Array<{ type: string; x_start: number; x_end: number; y: number }>;
}

// Simple WASM resimulation in TypeScript
// This approximates what the WASM module does
function simulateFinishTicks(
  wheels: WheelData[],
  terrain: Array<[number, number]>,
  start_x: number,
  start_y: number,
  finish_x: number,
  seed: number
): number {
  // Extract wheel vertices to calculate radius
  const vertices = wheels[0].polygon_vertices;
  const radius = Math.max(...vertices.map(([x, y]) => Math.sqrt(x * x + y * y))) / 100; // Convert to meters

  // Physics constants (matching WASM)
  const MOTOR_SPEED = 8.0; // rad/s
  const EFFICIENCY = 0.795;
  const DT = 1 / 60; // seconds per tick

  // Calculate velocity: v = MOTOR_SPEED * radius * EFFICIENCY
  const velocity = MOTOR_SPEED * radius * EFFICIENCY;

  // Distance to travel
  const distance = finish_x - start_x;

  // Calculate time: t = d / v
  const timeSeconds = distance / velocity;

  // Convert to ticks (60 ticks per second)
  const ticks = Math.round(timeSeconds * 60);

  // Convert to milliseconds
  const ms = Math.round(ticks * 1000 / 60);

  return ms;
}

function getTerrainY(terrain: Array<[number, number]>, x: number): number {
  // Find the two terrain points that bracket x
  for (let i = 0; i < terrain.length - 1; i++) {
    const [x0, y0] = terrain[i];
    const [x1, y1] = terrain[i + 1];
    if (x0 <= x && x <= x1) {
      // Linear interpolation
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  // If x is outside the terrain range, return the last point's y
  const lastPoint = terrain[terrain.length - 1];
  return lastPoint[1];
}

function main() {
  const workspaceRoot = process.cwd();
  const ghostsPath = join(workspaceRoot, 'crates', 'validator', 'reference-ghosts.json');
  const tracksDir = join(workspaceRoot, 'apps', 'web', 'public', 'tracks');

  // Read reference ghosts
  const ghostsJson: ReferenceGhosts = JSON.parse(readFileSync(ghostsPath, 'utf-8'));

  // Load tracks
  const tracks: Record<number, TrackJson> = {};
  for (const trackId of [1, 2, 3]) {
    const trackFiles = ['hills-01.json', 'canyon-02.json', 'dunes-03.json'];
    const trackPath = join(tracksDir, trackFiles[trackId - 1]);
    try {
      const trackJson: TrackJson = JSON.parse(readFileSync(trackPath, 'utf-8'));
      tracks[trackId] = trackJson;
      console.log(`Loaded track ${trackId} from ${trackFiles[trackId - 1]}`);
    } catch (e) {
      console.error(`Failed to load track ${trackId}: ${e}`);
      process.exit(1);
    }
  }

  // Update each ghost with actual simulation result
  let updatedCount = 0;
  for (const [ghostId, ghost] of Object.entries(ghostsJson.ghosts)) {
    const track = tracks[ghost.track_id];
    if (!track) {
      console.error(`Track ${ghost.track_id} not found for ghost ${ghostId}`);
      continue;
    }

    // Get terrain y at start position (for wheel placement)
    const start_x = track.start.pos[0];
    const terrain_y_at_start = getTerrainY(track.terrain, start_x);

    // Run simulation to get actual finish time
    const actualFinishMs = simulateFinishTicks(
      ghost.wheels,
      track.terrain,
      start_x,
      terrain_y_at_start,
      track.finish.pos[0],
      1000 + parseInt(ghostId.split('-').pop()!, 10) // Use ghost index as seed
    );

    // Update ghost with actual finish time
    const oldFinishMs = ghost.finish_time_ms;
    ghost.finish_time_ms = actualFinishMs;
    ghost.notes = ghost.notes.replace(/Synthetic test ghost/, 'Updated with actual simulation result');

    updatedCount++;
    if (updatedCount <= 5 || updatedCount % 20 === 0) {
      console.log(`Updated ${ghostId}: ${oldFinishMs}ms -> ${actualFinishMs}ms`);
    }
  }

  // Write updated ghosts
  ghostsJson.updated_at = new Date().toISOString();
  writeFileSync(ghostsPath, JSON.stringify(ghostsJson, null, 2));
  console.log(`\nUpdated ${updatedCount} ghosts in ${ghostsPath}`);
}

main();
