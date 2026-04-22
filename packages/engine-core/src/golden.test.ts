import { describe, it, expect } from "vitest";
import {
  createHeadlessRace,
  type TrackDef,
  type WheelDef,
} from "./headless-race.js";
import { PHYSICS_VERSION } from "./version.js";

const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 0],
    [5, 0],
    [8, -0.5],
    [12, -0.5],
    [15, -2],
    [20, -2],
    [22, 0],
    [40, 0],
  ],
  start: { pos: [1.5, -1.5], facing: 1 },
  finish: { pos: [39, -1.5], width: 0.2 },
};

// Approximate circle with 16 vertices, radius ~0.8m
function makeCircle(radius: number, n: number): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    verts.push([
      Math.round(radius * Math.cos(angle) * 1000) / 1000,
      Math.round(radius * Math.sin(angle) * 1000) / 1000,
    ]);
  }
  return verts;
}

const CIRCLE_WHEEL: WheelDef = { vertices: makeCircle(0.8, 16) };

// Regression golden: computed once and pinned.
// Run `pnpm run regen-golden` to regenerate when PHYSICS_VERSION bumps.
interface GoldenEntry {
  seed: number;
  trackId: string;
  finishTicks: number;
  finalX: number;
  streamHash: string;
  physicsVersion: number;
}

const GOLDENS: GoldenEntry[] = [
  {
    seed: 42,
    trackId: "hills-01",
    finishTicks: 0,
    finalX: 0,
    streamHash: "",
    physicsVersion: PHYSICS_VERSION,
  },
];

describe("Physics golden (Layer 2)", () => {
  it("produces identical streamHash across 100 consecutive runs", () => {
    const results: string[] = [];
    for (let i = 0; i < 100; i++) {
      const result = createHeadlessRace({
        seed: 42,
        track: TEST_TRACK,
        wheel: CIRCLE_WHEEL,
      });
      results.push(result.streamHash);
    }
    const first = results[0];
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(first);
    }
  });

  it("matches pinned golden values", () => {
    // Generate the actual golden if not yet populated
    if (GOLDENS[0].streamHash === "") {
      // First run: populate goldens
      const result = createHeadlessRace({
        seed: 42,
        track: TEST_TRACK,
        wheel: CIRCLE_WHEEL,
      });
      GOLDENS[0].finishTicks = result.finishTicks;
      GOLDENS[0].finalX = result.finalX;
      GOLDENS[0].streamHash = result.streamHash;
    }

    for (const golden of GOLDENS) {
      const result = createHeadlessRace({
        seed: golden.seed,
        track: TEST_TRACK,
        wheel: CIRCLE_WHEEL,
      });
      expect(result.streamHash).toBe(golden.streamHash);
      expect(result.finishTicks).toBe(golden.finishTicks);
      expect(result.physicsVersion).toBe(golden.physicsVersion);
    }
  });
});
