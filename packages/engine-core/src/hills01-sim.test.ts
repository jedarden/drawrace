/**
 * Temporary simulation to calibrate zone boundary ticks and verify swap advantage.
 * This file will be replaced by the actual playtest assertion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createHeadlessRace, type TrackDef } from "./headless-race.js";
import { runHeadless, type WheelSwap } from "./headless.js";

const TRACK_PATH = join(
  __dirname, "..", "..", "..", "apps", "web", "public", "tracks", "hills-01.json"
);

function loadRealTrack(): TrackDef {
  return JSON.parse(readFileSync(TRACK_PATH, "utf-8"));
}

const CIRCLE_R40: [number, number][] = [
  [0.4,0],[0.392,0.078],[0.37,0.153],[0.333,0.222],[0.283,0.283],
  [0.222,0.333],[0.153,0.37],[0.078,0.392],[0,0.4],[-0.078,0.392],
  [-0.153,0.37],[-0.222,0.333],[-0.283,0.283],[-0.333,0.222],
  [-0.37,0.153],[-0.392,0.078],[-0.4,0],[-0.392,-0.078],[-0.37,-0.153],
  [-0.333,-0.222],[-0.283,-0.283],[-0.222,-0.333],[-0.153,-0.37],
  [-0.078,-0.392],[0,-0.4],[0.078,-0.392],[0.153,-0.37],[0.222,-0.333],
  [0.283,-0.283],[0.333,-0.222],[0.37,-0.153],[0.392,-0.078],
];

const STAR_5: [number, number][] = [
  [0,-0.45],[0.088,-0.121],[0.428,-0.139],[0.143,0.046],
  [0.265,0.364],[0,0.15],[-0.265,0.364],[-0.143,0.046],
  [-0.428,-0.139],[-0.088,-0.121],
];

const CIRCLE_R80: [number, number][] = [
  [0.8,0],[0.785,0.156],[0.739,0.306],[0.665,0.444],[0.566,0.566],
  [0.444,0.665],[0.306,0.739],[0.156,0.785],[0,0.8],[-0.156,0.785],
  [-0.306,0.739],[-0.444,0.665],[-0.566,0.566],[-0.665,0.444],
  [-0.739,0.306],[-0.785,0.156],[-0.8,0],[-0.785,-0.156],[-0.739,-0.306],
  [-0.665,-0.444],[-0.566,-0.566],[-0.444,-0.665],[-0.306,-0.739],
  [-0.156,-0.785],[0,-0.8],[0.156,-0.785],[0.306,-0.739],[0.444,-0.665],
  [0.566,-0.566],[0.665,-0.444],[0.739,-0.306],[0.785,-0.156],
];

const CIRCLE_R60: [number, number][] = [
  [0.6,0],[0.58,0.155],[0.52,0.3],[0.424,0.424],[0.3,0.52],
  [0.155,0.58],[0,0.6],[-0.155,0.58],[-0.3,0.52],[-0.424,0.424],
  [-0.52,0.3],[-0.58,0.155],[-0.6,0],[-0.58,-0.155],[-0.52,-0.3],
  [-0.424,-0.424],[-0.3,-0.52],[-0.155,-0.58],[0,-0.6],[0.155,-0.58],
  [0.3,-0.52],[0.424,-0.424],[0.52,-0.3],[0.58,-0.155],
];

const TRI: [number, number][] = [[0,-0.4],[0.346,0.2],[-0.346,0.2]];

const SEED = 42;

describe("hills-01 zone-surface calibration", () => {
  it("measures single-wheel times and zone boundary ticks", () => {
    const track = loadRealTrack();

    const shapes = [
      { name: "circle-r40", verts: CIRCLE_R40 },
      { name: "star-5", verts: STAR_5 },
      { name: "circle-r80", verts: CIRCLE_R80 },
      { name: "circle-r60", verts: CIRCLE_R60 },
      { name: "triangle", verts: TRI },
    ];

    console.log("\n=== Single-wheel races on real hills-01 ===");
    let bestSingle = Infinity;
    let bestSingleName = "";

    for (const s of shapes) {
      const r = createHeadlessRace({ seed: SEED, track, wheel: { vertices: s.verts } });
      const time = (r.finishTicks / 60).toFixed(2);
      const finished = r.finalX >= track.finish.pos[0] ? "FINISHED" : `DNF (x=${r.finalX.toFixed(1)})`;
      console.log(`${s.name}: ticks=${r.finishTicks}, time=${time}s, ${finished}`);
      if (r.finalX >= track.finish.pos[0] && r.finishTicks < bestSingle) {
        bestSingle = r.finishTicks;
        bestSingleName = s.name;
      }
    }

    console.log(`\nBest single-wheel: ${bestSingleName} at ${bestSingle} ticks (${(bestSingle/60).toFixed(2)}s)`);

    // Now test 3-swap runs with different swap tick offsets
    console.log("\n=== 3-swap runs (circle → star → big-circle → med-circle) ===");

    // Try various swap tick offsets based on rough speed estimates
    for (const offset of [0, -60, -120, 60, 120]) {
      const baseTicks = [480, 1080, 1680]; // rough zone boundary ticks at ~1 m/s
      const ticks = baseTicks.map(t => Math.max(1, t + offset));

      const result = runHeadless({
        seed: SEED,
        track,
        wheels: [
          { swap_tick: 0, polygon: CIRCLE_R40 },
          { swap_tick: ticks[0], polygon: STAR_5 },
          { swap_tick: ticks[1], polygon: CIRCLE_R80 },
          { swap_tick: ticks[2], polygon: CIRCLE_R60 },
        ],
      });

      const time = (result.finishTicks / 60).toFixed(2);
      const improvement = ((1 - result.finishTicks / bestSingle) * 100).toFixed(1);
      console.log(`swap @ ${ticks}: ticks=${result.finishTicks}, time=${time}s, improvement=${improvement}%`);
    }

    // This test always passes - it's just for calibration output
    expect(true).toBe(true);
  });
});
