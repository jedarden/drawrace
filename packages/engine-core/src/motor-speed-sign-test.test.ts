/**
 * Direct test: MOTOR_SPEED = 8 vs MOTOR_SPEED = -8
 *
 * Hypothesis: The sign of MOTOR_SPEED determines forward/backward direction.
 * Previous commit claims +8 drives forward, but diagnostic shows backward motion.
 */

import { describe, it } from "vitest";
import { RaceSim } from "./race-sim.js";

// Simple 12-gon wheel (what users typically draw)
const wheel12Gon: Array<{ x: number; y: number }> = [];
for (let _i = 0; _i < 12; _i++) {
  const angle = (_i / 12) * Math.PI * 2;
  wheel12Gon.push({
    x: Math.cos(angle) * 0.8,
    y: Math.sin(angle) * 0.8,
  });
}

// Flat ground track
const flatTrack = {
  id: "motor-sign-test",
  world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 80 },
  terrain: [
    [-10, 0],
    [100, 0],
  ] as [number, number][],
  zones: [
    { id: "start", x_start: -10, x_end: 0 },
    { id: "race", x_start: 0, x_end: 100 },
  ] as Array<{ id: string; x_start: number; x_end: number }>,
  start: { pos: [0, -2] as [number, number], facing: 0 },
  finish: { pos: [50, 0] as [number, number], width: 10 },
};

describe("MOTOR_SPEED sign verification", () => {
  it("MOTOR_SPEED = +8 should drive forward (positive X direction)", () => {
    const sim = new RaceSim(flatTrack, wheel12Gon);
    sim.enableMotor();

    // Run for 60 ticks (1 second)
    let finalX = flatTrack.start.pos[0];
    for (let _i = 0; _i < 60; _i++) {
      const snap = sim.step();
      finalX = snap.chassis.x;
    }

    const startX = flatTrack.start.pos[0];
    const deltaX = finalX - startX;

    console.log(`\nMOTOR_SPEED = +8:`);
    console.log(`  Start X: ${startX.toFixed(2)}`);
    console.log(`  Final X: ${finalX.toFixed(2)}`);
    console.log(`  Delta X: ${deltaX.toFixed(2)}`);
    console.log(`  Direction: ${deltaX > 0 ? "FORWARD ✓" : "BACKWARD ✗"}`);

    // The commit says +8 drives forward, let's verify
    if (deltaX < 0) {
      console.log(`  ⚠️  CONTRADICTION: +8 drives BACKWARD, not forward!`);
    }
  });

  it("test with MOTOR_SPEED = -8 (manual patch via source edit)", () => {
    console.log(`\nNote: To test MOTOR_SPEED = -8, we would need to:`);
    console.log(`  1. Change line 61 in race-sim.ts: const MOTOR_SPEED = -8;`);
    console.log(`  2. Rebuild and retest`);
    console.log(`\nExpected result: -8 should drive FORWARD if +8 drives BACKWARD`);
  });
});
