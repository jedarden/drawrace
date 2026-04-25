/**
 * hills-01 zone validation and gameplay calibration.
 *
 * Layer 1: zone structure tests (fast, deterministic).
 * Layer 2: headless simulation to measure shape/swap performance.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createHeadlessRace, type TrackDef } from "./headless-race.js";
import { runHeadless, type WheelSwap } from "./headless.js";
import { validateZones } from "./surface.js";

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

// ── Layer 1: zone structure ──────────────────────────────────────────

describe("hills-01 zone structure", () => {
  it("loads four non-overlapping zones with ordered x_start/x_end", () => {
    const track = loadRealTrack();
    const terrainMinX = track.terrain[0][0];
    const terrainMaxX = track.terrain[track.terrain.length - 1][0];

    const zones = validateZones(track.zones, terrainMinX, terrainMaxX);

    expect(zones).toHaveLength(4);
    expect(zones.map((z) => z.id)).toEqual(["A", "B", "C", "D"]);

    // Ordered x_start < x_end
    for (const z of zones) {
      expect(z.x_start).toBeLessThan(z.x_end);
    }

    // Non-overlapping and contiguous
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].x_start).toBe(zones[i - 1].x_end);
    }

    // Aggregate length matches terrain extent
    const totalZoneLen = zones.reduce((s, z) => s + (z.x_end - z.x_start), 0);
    const terrainLen = terrainMaxX - terrainMinX;
    expect(totalZoneLen).toBeCloseTo(terrainLen, 4);
  });

  it("each zone is at least 8m long (≥8s at ~1 m/s)", () => {
    const track = loadRealTrack();
    const terrainMinX = track.terrain[0][0];
    const terrainMaxX = track.terrain[track.terrain.length - 1][0];
    const zones = validateZones(track.zones, terrainMinX, terrainMaxX);

    for (const z of zones) {
      expect(z.x_end - z.x_start).toBeGreaterThanOrEqual(8);
    }
  });
});

// ── Layer 2: gameplay calibration ────────────────────────────────────

describe("hills-01 zone-surface calibration", () => {
  it("measures single-wheel times and zone boundary ticks", { timeout: 120_000 }, () => {
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
    expect(bestSingle).toBeLessThan(Infinity);

    // Test 3-swap runs: circle → teeth → large-circle → compact
    // Swaps aligned to zone boundaries (8s, 18s, 28s) with offsets
    console.log("\n=== 3-swap runs (circle → star → big-circle → med-circle) ===");

    let bestSwapTicks = Infinity;
    let bestSwapConfig = "";

    for (const offset of [0, -60, -120, 60, 120]) {
      const baseTicks = [480, 1080, 1680];
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

      if (result.finalX >= track.finish.pos[0] && result.finishTicks < bestSwapTicks) {
        bestSwapTicks = result.finishTicks;
        bestSwapConfig = ticks.join(", ");
      }
    }

    console.log(`\nBest swap: [${bestSwapConfig}] at ${bestSwapTicks} ticks (${(bestSwapTicks/60).toFixed(2)}s)`);
    const bestImprovement = ((1 - bestSwapTicks / bestSingle) * 100).toFixed(1);
    console.log(`Best swap improvement: ${bestImprovement}% over ${bestSingleName}`);

    // Playtest assertion: 3-swap run finishes 20%+ faster than best single-wheel
    expect(bestSwapTicks).toBeLessThan(bestSingle * 0.8);
  });
});
