/**
 * Forward motion verification test (bf-55wdy).
 *
 * Pure-physics headless test that verifies a standard circle wheel can move
 * forward at least 100m before the 3-minute DNF ceiling. This is the
 * infrastructure-free complement to the ADB full playthrough test.
 *
 * Uses the standard unit circle wheel (12 vertices, radius 1.0) that apps/web
 * sends after a circular draw gesture.
 */
import { describe, it, expect } from "vitest";
import { createHeadlessRace, type TrackDef } from "./headless-race.js";

// Standard unit circle wheel (12 vertices, radius 1.0)
// Matches what apps/web sends after a circular draw gesture
const UNIT_CIRCLE_12: [number, number][] = [];
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  UNIT_CIRCLE_12.push([Math.cos(angle), Math.sin(angle)]);
}

// Long flat track for 100m+ forward motion testing
const FLAT_TRACK_120M: TrackDef = {
  id: "flat-120m",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 5], [120, 5],
  ],
  zones: [
    { id: "A", x_start: 0, x_end: 120 }
  ],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [115, 3.5], width: 0.2 }, // Finish line before track end
};

const MAX_TICKS = 60 * 180; // 3 minute DNF ceiling

describe("forward-motion verification (bf-55wdy)", () => {
  it("circle wheel car crosses 100m before DNF", { timeout: 30_000 }, () => {
    const result = createHeadlessRace({
      seed: 1,
      track: FLAT_TRACK_120M,
      wheel: { vertices: UNIT_CIRCLE_12 },
    });

    console.log(
      `forward-motion: finalX=${result.finalX.toFixed(1)}m, ` +
      `ticks=${result.finishTicks}, ` +
      `time=${(result.finishTicks / 60).toFixed(1)}s, ` +
      `dnf=${result.finishTicks >= MAX_TICKS ? "YES" : "NO"}, ` +
      `stuck=${result.stuck ? "YES" : "NO"}`
    );

    // Car must travel at least 100 meters forward
    expect(result.finalX, "Car must cross 100m mark").toBeGreaterThan(100);

    // Car must not DNF (finish before 3-minute ceiling)
    expect(result.finishTicks, "Car must finish before DNF").toBeLessThan(MAX_TICKS);

    // Car should not be stuck (spinning wheels without forward progress)
    expect(result.stuck, "Car must not get stuck").toBe(false);
  });
});
