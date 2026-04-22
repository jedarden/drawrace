import { describe, it, expect } from "vitest";
import { RaceSim } from "./race-sim.js";
import type { TrackDef } from "./headless-race.js";

const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 5], [5, 5], [10, 5.3], [15, 5.3], [18, 5.8],
    [22, 5.8], [25, 5], [30, 5], [35, 5.2], [40, 5.2],
  ],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [39, 3.5], width: 0.2 },
};

function makeCircle(radius: number, n: number): Array<{ x: number; y: number }> {
  const verts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    verts.push({
      x: Math.round(radius * Math.cos(angle) * 1000) / 1000,
      y: Math.round(radius * Math.sin(angle) * 1000) / 1000,
    });
  }
  return verts;
}

describe("RaceSim", () => {
  it("finishes the race", () => {
    const sim = new RaceSim(TEST_TRACK, makeCircle(0.8, 16), 42);
    sim.enableMotor();

    let snap = sim.snapshot();
    for (let i = 0; i < 10800; i++) {
      snap = sim.step();
      if (snap.finished) break;
    }

    expect(snap.finished).toBe(true);
    expect(snap.elapsedMs).toBeGreaterThan(0);
    expect(snap.wheel.x).toBeGreaterThan(TEST_TRACK.finish.pos[0] - 1);
  });

  it("produces deterministic results", () => {
    const results: number[] = [];
    for (let run = 0; run < 5; run++) {
      const sim = new RaceSim(TEST_TRACK, makeCircle(0.8, 16), 42);
      sim.enableMotor();
      let snap;
      for (let i = 0; i < 10800; i++) {
        snap = sim.step();
        if (snap.finished) break;
      }
      results.push(snap!.tick);
    }

    const first = results[0];
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(first);
    }
  });

  it("motor disabled during countdown prevents forward motion", () => {
    const sim = new RaceSim(TEST_TRACK, makeCircle(0.8, 16), 42);
    // Don't enable motor — simulate countdown phase
    const snap60 = sim.step(); // first step
    for (let i = 0; i < 60; i++) sim.step();
    const snapAfter60 = sim.snapshot();

    // Without motor, the car shouldn't have moved much (just settling under gravity)
    expect(Math.abs(snapAfter60.wheel.x - snap60.wheel.x)).toBeLessThan(5);
  });
});
