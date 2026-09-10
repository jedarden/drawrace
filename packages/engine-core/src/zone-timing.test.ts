/**
 * Unit tests for the per-zone segment-timing harness's pure logic
 * (drawrace-b379c377). The simulation-backed end-to-end use lives in
 * hills01-sim.test.ts; these pin the trace→zone math and the surface-spec
 * builder without running physics.
 */
import { describe, it, expect } from "vitest";
import {
  circle,
  gear,
  zoneTimes,
  zoneWinners,
  trackWithSurfaces,
  CANDIDATE_WHEELS,
  type ZoneTiming,
  type Verts,
} from "./zone-timing.js";
import type { TrackDef } from "./headless-race.js";

const TRACK: TrackDef = {
  id: "synthetic",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [[0, 0], [12, 0]],
  zones: [
    { id: "A", x_start: 0, x_end: 4 },
    { id: "B", x_start: 4, x_end: 8 },
    { id: "C", x_start: 8, x_end: 12 },
  ],
  start: { pos: [1, 0], facing: 1 },
  finish: { pos: [12, 0], width: 0.2 },
};

/** 20-tick trace crossing x=4 on tick 5 and x=8 on tick 9, finishing at x=12. */
function boundaryTrace(): number[] {
  return Array.from({ length: 20 }, (_v, i) =>
    i < 4 ? i * 0.5 : i < 8 ? 4 + i * 0.1 : 12);
}

describe("zone-timing shape helpers", () => {
  it("builds closed n-gons at the requested radius", () => {
    const c = circle(0.5, 18) as Verts;
    expect(c).toHaveLength(18);
    for (const [x, y] of c) {
      expect(Math.hypot(x, y)).toBeCloseTo(0.5, 9);
    }
    const g = gear(16, 0.38, 0.25) as Verts;
    expect(g).toHaveLength(48);
    const radii = g.map(([x, y]) => Math.hypot(x, y));
    expect(Math.max(...radii)).toBeCloseTo(0.38, 9);
    expect(Math.min(...radii)).toBeCloseTo(0.25, 9);
  });

  it("declares a candidate library of circles and gears", () => {
    const names = Object.keys(CANDIDATE_WHEELS);
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(names.some((n) => n.startsWith("gear-"))).toBe(true);
    for (const verts of Object.values(CANDIDATE_WHEELS)) {
      expect(verts.length).toBeGreaterThanOrEqual(18);
      expect(verts.length).toBeLessThanOrEqual(48);
    }
  });
});

describe("zoneTimes", () => {
  it("splits a finishing trace at each zone boundary tick", () => {
    const xs = boundaryTrace();
    const { zoneIds, ticks, finished } = zoneTimes(TRACK, xs, 20);
    expect(zoneIds).toEqual(["A", "B", "C"]);
    expect(ticks).toEqual([5, 4, 11]);
    expect(ticks.reduce((a, b) => a + b, 0)).toBe(20);
    expect(finished).toBe(true);
  });

  it("credits elapsed ticks to the zone a DNF stalls in and zeroes the rest", () => {
    // Crosses x=4 on tick 5 then never reaches x=8; run ends at tick 20.
    const xs = Array.from({ length: 20 }, (_v, i) => (i < 4 ? i * 0.5 : 4 + i * 0.05));
    const { ticks, finished } = zoneTimes(TRACK, xs, 20);
    expect(ticks).toEqual([5, 15, 0]);
    expect(ticks.reduce((a, b) => a + b, 0)).toBe(20);
    expect(finished).toBe(false);
  });

  it("handles a wheel that never leaves zone A", () => {
    const xs = Array.from({ length: 7 }, (_v, i) => i * 0.5);
    const { ticks, finished } = zoneTimes(TRACK, xs, 7);
    expect(ticks).toEqual([7, 0, 0]);
    expect(finished).toBe(false);
  });

  it("treats an unzoned track as one segment", () => {
    const unzoned: TrackDef = { ...TRACK, zones: undefined };
    const xs = boundaryTrace();
    const { zoneIds, ticks, finished } = zoneTimes(unzoned, xs, 20);
    expect(zoneIds).toEqual([]);
    expect(ticks).toEqual([20]);
    expect(finished).toBe(true);
  });

  it("sorts zones by x_start regardless of JSON order", () => {
    const shuffled: TrackDef = {
      ...TRACK,
      zones: [TRACK.zones![2], TRACK.zones![0], TRACK.zones![1]],
    };
    const xs = boundaryTrace();
    const { zoneIds, ticks } = zoneTimes(shuffled, xs, 20);
    expect(zoneIds).toEqual(["A", "B", "C"]);
    expect(ticks).toEqual([5, 4, 11]);
  });
});

describe("zoneWinners", () => {
  const single = (name: string, ticks: number[], finished: boolean): ZoneTiming => ({
    name,
    zoneIds: ["A", "B"],
    ticks,
    totalTicks: ticks.reduce((a, b) => a + b, 0),
    finished,
    finalX: finished ? 12 : 5,
    stuck: false,
  });

  it("awards each zone to the lowest simulated segment time", () => {
    const winners = zoneWinners([
      single("slow-a", [10, 10], true),
      single("fast-a", [6, 12], true),
      single("fast-b", [11, 7], true),
    ]);
    expect(winners).toEqual([
      { zoneId: "A", wheel: "fast-a", ticks: 6 },
      { zoneId: "B", wheel: "fast-b", ticks: 7 },
    ]);
  });

  it("excludes DNF wheels while finishers exist", () => {
    // dnf posts the lowest raw zone-A count but never finished the segment.
    const winners = zoneWinners([
      single("finisher", [10, 10], true),
      single("dnf", [3, 4], false),
    ]);
    expect(winners.map((w) => w.wheel)).toEqual(["finisher", "finisher"]);
  });

  it("falls back to ranking all wheels when nothing finishes", () => {
    const winners = zoneWinners([
      single("a", [10, 5], false),
      single("b", [4, 9], false),
    ]);
    expect(winners).toEqual([
      { zoneId: "A", wheel: "b", ticks: 4 },
      { zoneId: "B", wheel: "a", ticks: 5 },
    ]);
  });

  it("returns no winners for an empty result set", () => {
    expect(zoneWinners([])).toEqual([]);
  });
});

describe("trackWithSurfaces", () => {
  it("tiles one surface segment per zone out to the terrain end", () => {
    const t = trackWithSurfaces(TRACK, ["normal", "ice", "snow"]);
    expect(t.surfaces).toEqual([
      { x_range: [0, 4], type: "normal" },
      { x_range: [4, 8], type: "ice" },
      { x_range: [8, 12], type: "snow" },
    ]);
  });

  it("splits a zone at its midpoint with a:b and at explicit x with a:x:b", () => {
    const t = trackWithSurfaces(TRACK, ["water:normal", "snow", "mud:10:rock"]);
    expect(t.surfaces).toEqual([
      { x_range: [0, 2], type: "water" },
      { x_range: [2, 4], type: "normal" },
      { x_range: [4, 8], type: "snow" },
      { x_range: [8, 10], type: "mud" },
      { x_range: [10, 12], type: "rock" },
    ]);
  });

  it("does not mutate the input track", () => {
    const before = JSON.stringify(TRACK.surfaces);
    trackWithSurfaces(TRACK, ["ice", "ice", "ice"]);
    expect(JSON.stringify(TRACK.surfaces)).toBe(before);
  });

  it("rejects unzoned tracks and mismatched spec counts", () => {
    expect(() => trackWithSurfaces({ ...TRACK, zones: undefined }, ["ice"])).toThrow();
    expect(() => trackWithSurfaces(TRACK, ["ice", "ice"])).toThrow();
  });
});
