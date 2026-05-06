/**
 * Test playground for hills-01 terrain tuning.
 *
 * Tests different wheel shapes and terrain configurations to find a playable
 * combination that meets the spec while allowing wheels to finish.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createHeadlessRace, type TrackDef } from "./headless-race.js";
import { runHeadless } from "./headless.js";

const TRACK_PATH = join(
  __dirname, "..", "..", "..", "apps", "web", "public", "tracks", "hills-01.json"
);

function loadRealTrack(): TrackDef {
  return JSON.parse(readFileSync(TRACK_PATH, "utf-8"));
}

// Near-circle wheel (Zone A optimal)
const CIRCLE_R40: [number, number][] = [
  [0.4,0],[0.392,0.078],[0.37,0.153],[0.333,0.222],[0.283,0.283],
  [0.222,0.333],[0.153,0.37],[0.078,0.392],[0,0.4],[-0.078,0.392],
  [-0.153,0.37],[-0.222,0.333],[-0.283,0.283],[-0.333,0.222],
  [-0.37,0.153],[-0.392,0.078],[-0.4,0],[-0.392,-0.078],[-0.37,-0.153],
  [-0.333,-0.222],[-0.283,-0.283],[-0.222,-0.333],[-0.153,-0.37],
  [-0.078,-0.392],[0,-0.4],[0.078,-0.392],[0.153,-0.37],[0.222,-0.333],
  [0.283,-0.283],[0.333,-0.222],[0.37,-0.153],[0.392,-0.078],
];

// Angular/gear wheel (Zone B optimal) - rounded gear teeth for ice grip
const GEAR_6: [number, number][] = [];
for (let i = 0; i < 6; i++) {
  const baseAngle = (i / 6) * Math.PI * 2;
  // Tooth profile: 3 points per tooth for smoother grip
  for (let j = 0; j < 3; j++) {
    const toothAngle = baseAngle + (j / 3) * (Math.PI * 2 / 6);
    let radius: number;
    if (j === 1) {
      radius = 0.45; // Tooth tip
    } else {
      radius = 0.32; // Tooth base
    }
    GEAR_6.push([radius * Math.cos(toothAngle), radius * Math.sin(toothAngle)]);
  }
}

// Original sharp teeth (for comparison)
const TEETH_8: [number, number][] = [];
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const nextAngle = ((i + 1) / 8) * Math.PI * 2;
  TEETH_8.push([0.42 * Math.cos(angle), 0.42 * Math.sin(angle)]);
  const midAngle = (angle + nextAngle) / 2;
  TEETH_8.push([0.28 * Math.cos(midAngle), 0.28 * Math.sin(midAngle)]);
}

// Large smooth wheel (Zone C optimal) - large circle for rocky terrain
const CIRCLE_R70: [number, number][] = [];
for (let i = 0; i < 32; i++) {
  const angle = (i / 32) * Math.PI * 2;
  CIRCLE_R70.push([0.7 * Math.cos(angle), 0.7 * Math.sin(angle)]);
}

// Medium compact wheel (Zone D optimal) - medium circle for water/jump
const CIRCLE_R50: [number, number][] = [];
for (let i = 0; i < 24; i++) {
  const angle = (i / 24) * Math.PI * 2;
  CIRCLE_R50.push([0.5 * Math.cos(angle), 0.5 * Math.sin(angle)]);
}

const STAR_5: [number, number][] = [
  [0,-0.45],[0.088,-0.121],[0.428,-0.139],[0.143,0.046],
  [0.265,0.364],[0,0.15],[-0.265,0.364],[-0.143,0.046],
  [-0.428,-0.139],[-0.088,-0.121],
];

const SEED = 42;

describe("hills-01 terrain tuning", () => {
  it("tests teeth wheel on icy incline", { timeout: 120_000 }, () => {
    const track = loadRealTrack();

    console.log("\n=== Testing teeth wheel on current track ===");

    // Test gear wheel start
    const gearResult = createHeadlessRace({ seed: SEED, track, wheel: { vertices: GEAR_6 } });
    console.log(`GEAR_6: ticks=${gearResult.finishTicks}, finalX=${gearResult.finalX.toFixed(1)}, finish=${gearResult.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    // Test teeth wheel for comparison
    const teethResult = createHeadlessRace({ seed: SEED, track, wheel: { vertices: TEETH_8 } });
    console.log(`TEETH_8: ticks=${teethResult.finishTicks}, finalX=${teethResult.finalX.toFixed(1)}, finish=${teethResult.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    // Test circle wheel for comparison
    const circleResult = createHeadlessRace({ seed: SEED, track, wheel: { vertices: CIRCLE_R40 } });
    console.log(`CIRCLE_R40: ticks=${circleResult.finishTicks}, finalX=${circleResult.finalX.toFixed(1)}, finish=${circleResult.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    // Test star wheel for comparison
    const starResult = createHeadlessRace({ seed: SEED, track, wheel: { vertices: STAR_5 } });
    console.log(`STAR_5: ticks=${starResult.finishTicks}, finalX=${starResult.finalX.toFixed(1)}, finish=${starResult.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    expect(gearResult.finalX).toBeGreaterThan(12); // Gear should get into Zone B
  });

  it("tests 3-swap run with proper zone wheels", { timeout: 120_000 }, () => {
    const track = loadRealTrack();

    console.log("\n=== Testing swap strategies ===");

    // Strategy 1: Start with circle, swap to gear at Zone B start
    console.log("\n--- Strategy 1: circle → gear (at Zone B) → large → medium ---");
    const strat1 = runHeadless({
      seed: SEED, track,
      wheels: [
        { swap_tick: 0, polygon: CIRCLE_R40 },
        { swap_tick: 480, polygon: GEAR_6 },
        { swap_tick: 1080, polygon: CIRCLE_R70 },
        { swap_tick: 1680, polygon: CIRCLE_R50 },
      ],
    });
    console.log(`Strategy 1: finalX=${strat1.finalX.toFixed(1)}, finish=${strat1.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    // Strategy 2: Start with gear immediately
    console.log("\n--- Strategy 2: gear (from start) → large → medium ---");
    const strat2 = runHeadless({
      seed: SEED, track,
      wheels: [
        { swap_tick: 0, polygon: GEAR_6 },
        { swap_tick: 1080, polygon: CIRCLE_R70 },
        { swap_tick: 1680, polygon: CIRCLE_R50 },
      ],
    });
    console.log(`Strategy 2: finalX=${strat2.finalX.toFixed(1)}, finish=${strat2.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    // Strategy 3: Just large circle (no swaps)
    console.log("\n--- Strategy 3: large circle only (no swaps) ---");
    const strat3 = createHeadlessRace({ seed: SEED, track, wheel: { vertices: CIRCLE_R70 } });
    console.log(`Strategy 3: finalX=${strat3.finalX.toFixed(1)}, finish=${strat3.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    // Strategy 4: Medium circle only
    console.log("\n--- Strategy 4: medium circle only ---");
    const strat4 = createHeadlessRace({ seed: SEED, track, wheel: { vertices: CIRCLE_R50 } });
    console.log(`Strategy 4: finalX=${strat4.finalX.toFixed(1)}, finish=${strat4.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    // Use the best strategy
    const results = [
      { name: "strat1", result: strat1 },
      { name: "strat2", result: strat2 },
    ];
    results.sort((a, b) => b.result.finalX - a.result.finalX);
    const result = results[0].result;
    console.log(`\nBest strategy: ${results[0].name}`);

    console.log(`3-swap: ticks=${result.finishTicks}, finalX=${result.finalX.toFixed(1)}, finish=${result.finalX >= track.finish.pos[0] ? "YES" : "NO"}`);

    // Should finish the track
    expect(result.finalX).toBeGreaterThanOrEqual(track.finish.pos[0]);
  });
});
