#!/usr/bin/env npx tsx
/**
 * Test script to find wheel shapes that trigger stuck-DNF detection.
 */
import { createHeadlessRace, type TrackDef } from "../src/headless-race.js";

const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 5],
    [5, 5],
    [10, 5.3],
    [15, 5.3],
    [18, 5.8],
    [22, 5.8],
    [25, 5],
    [30, 5],
    [35, 5.2],
    [40, 5.2],
  ],
  zones: [
    { id: "zone-a", x_start: 0, x_end: 40 },
  ],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [39, 3.5], width: 0.2 },
};

// Test various wheel shapes that might get stuck
const testWheels = [
  {
    id: "backward-triangle",
    vertices: [
      [0, -0.5],
      [-0.4, 0.3],
      [0.4, 0.3],
    ] as [number, number][],
  },
  {
    id: "flat-bottom-triangle",
    vertices: [
      [-0.4, 0.4],
      [0.4, 0.4],
      [0, -0.3],
    ] as [number, number][],
  },
  {
    id: "tiny-circle",
    vertices: Array.from({ length: 12 }, (_, i) => {
      const angle = (2 * Math.PI * i) / 12;
      return [0.15 * Math.cos(angle), 0.15 * Math.sin(angle)] as [number, number];
    }),
  },
  {
    id: "line-wheel",
    vertices: [
      [-0.5, 0],
      [0.5, 0],
      [0.4, 0.01],
      [-0.4, 0.01],
    ] as [number, number][],
  },
];

const SEED = 42;

console.log("Testing wheels for stuck-DNF detection...\n");

for (const wheel of testWheels) {
  const result = createHeadlessRace({
    seed: SEED,
    track: TEST_TRACK,
    wheel: { vertices: wheel.vertices },
  });

  console.log(`${wheel.id}:`);
  console.log(`  finishTicks: ${result.finishTicks}`);
  console.log(`  finalX: ${result.finalX.toFixed(2)}`);
  console.log(`  stuck: ${result.stuck}`);
  console.log(`  streamHash: ${result.streamHash}`);
  console.log();
}
