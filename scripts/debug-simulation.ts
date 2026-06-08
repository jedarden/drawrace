/**
 * Debug script to understand TypeScript simulation behavior
 */

import { createHeadlessRace } from "../packages/engine-core/src/headless-race.js";

// Test fixtures
const UNIT_CIRCLE_12: [number, number][] = [];
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  UNIT_CIRCLE_12.push([Math.cos(angle), Math.sin(angle)]);
}

const TRIANGLE_R35: [number, number][] = [
  [0.35, 0],
  [-0.175, 0.303],
  [-0.175, -0.303],
];

const FLAT_TRACK_100M = {
  id: "flat-100m-roundtrip",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [[0, 5], [100, 5]],
  zones: [{ id: "A", x_start: 0, x_end: 100 }],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [95, 3.5], width: 0.2 },
};

const SEED = 42;

console.log("=== Circle Wheel Test ===");
const circleResult = createHeadlessRace({
  seed: SEED,
  track: FLAT_TRACK_100M,
  wheel: { vertices: UNIT_CIRCLE_12 },
});

console.log("Circle Result:", {
  finishTicks: circleResult.finishTicks,
  finalX: circleResult.finalX.toFixed(2),
  stuck: circleResult.stuck,
  physicsVersion: circleResult.physicsVersion,
});

console.log("\n=== Triangle Wheel Test ===");
const triangleResult = createHeadlessRace({
  seed: SEED,
  track: FLAT_TRACK_100M,
  wheel: { vertices: TRIANGLE_R35 },
});

console.log("Triangle Result:", {
  finishTicks: triangleResult.finishTicks,
  finalX: triangleResult.finalX.toFixed(2),
  stuck: triangleResult.stuck,
  physicsVersion: triangleResult.physicsVersion,
});

// Track details
console.log("\n=== Track Details ===");
console.log("Start position:", FLAT_TRACK_100M.start.pos);
console.log("Finish position:", FLAT_TRACK_100M.finish.pos);
console.log("Distance to finish:", FLAT_TRACK_100M.finish.pos[0] - FLAT_TRACK_100M.start.pos[0]);
console.log("Terrain:", FLAT_TRACK_100M.terrain);

// Calculate expected finish time for circle wheel at 6.35 m/s
const distance = FLAT_TRACK_100M.finish.pos[0] - FLAT_TRACK_100M.start.pos[0];
const expectedSeconds = distance / 6.35;
const expectedTicks = expectedSeconds * 60;
console.log("\n=== Expected vs Actual ===");
console.log(`Distance: ${distance.toFixed(2)}m`);
console.log(`Expected speed (circle): 6.35 m/s`);
console.log(`Expected time: ${expectedSeconds.toFixed(2)}s (${expectedTicks.toFixed(0)} ticks)`);
console.log(`Actual time (circle): ${(circleResult.finishTicks / 60).toFixed(2)}s (${circleResult.finishTicks} ticks)`);
