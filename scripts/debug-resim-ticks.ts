#!/usr/bin/env tsx
/**
 * Debug script to understand what the WASM resim produces
 * for the test configuration in main.rs tests.
 */

import { ResimWasm } from '../packages/engine-core/src/resim-wasm.ts';
import { readFileSync } from 'fs';

async function main() {
  const wasmPath = 'packages/engine-core/dist/resim.wasm';
  console.log('Loading WASM from:', wasmPath);

  const wasm = new ResimWasm(wasmPath);
  await wasm.load();

  const physicsVersion = wasm.exports.physics_version();
  console.log('Physics version:', physicsVersion);

  // Test configuration from main.rs tests
  // - finish_x: 40.0
  // - start_x: 1.5
  // - start_y: 498.5
  // - 12-vertex unit circle wheel
  // - finish_time_ms: 5850

  // Generate 12-vertex unit circle vertices (hundredths of meter)
  const wheelVerts: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    wheelVerts.push([
      Math.round(angle.cos() * 100),  // x in hundredths
      Math.round(angle.sin() * 100),  // y in hundredths
    ]);
  }

  // Terrain: flat at y=500, from x=0 to x=40
  const terrain: [number, number][] = [
    [0, 500],
    [10, 500],
    [20, 500],
    [30, 500],
    [40, 500],
  ];

  const obstacles: [number, number, number, number, number][] = [];

  // Calculate expected values
  // Distance = 40 - 1.5 = 38.5 meters
  // Unit circle radius ~1.0m
  // velocity = 8.0 * 1.0 * 0.795 = 6.36 m/s
  // time = 38.5 / 6.36 = 6.05 seconds
  // ticks = 6.05 * 60 = 363 ticks

  const finish_x = 40.0;
  const start_x = 1.5;
  const start_y = 498.5;
  const claimed_finish = 351; // What the test expects (5850ms)

  console.log('\n=== Test Configuration ===');
  console.log('finish_x:', finish_x);
  console.log('start_x:', start_x);
  console.log('distance:', finish_x - start_x, 'meters');
  console.log('claimed_finish:', claimed_finish, 'ticks (', claimed_finish * 1000 / 60, 'ms)');

  // Run resim
  const result = wasm.exports.resim(
    [[0, ...wheelVerts.flat()]], // wheel at swap_tick 0
    terrain,
    obstacles,
    finish_x,
    start_x,
    start_y,
    claimed_finish,
    42, // seed
  );

  const finish_ticks = result[0];
  const stuck = result[1];

  console.log('\n=== Resim Result ===');
  console.log('finish_ticks:', finish_ticks, '(as u32)');
  console.log('finish_ticks (interpreted):', finish_ticks === 0xFFFFFFFF ? 'DNF/timeout' : finish_ticks);
  console.log('stuck:', stuck);

  const actual_ticks = finish_ticks === 0xFFFFFFFF ? null : finish_ticks;
  if (actual_ticks !== null) {
    const actual_ms = Math.round(actual_ticks * 1000 / 60);
    const diff = actual_ticks - claimed_finish;
    console.log('actual time:', actual_ms, 'ms');
    console.log('difference:', diff, 'ticks (', Math.round(diff * 1000 / 60), 'ms)');
  }
}

main().catch(console.error);
