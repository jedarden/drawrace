import { describe, it, expect } from "vitest";
import { RaceSim } from "./race-sim.js";
import type { TrackDef } from "./headless-race.js";

const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [-2, 5], [0, 5], [5, 5], [10, 5.3], [15, 5.3], [18, 5.8],
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
    const sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
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
      const sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
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
    const sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
    // Don't enable motor — simulate countdown phase
    const snap60 = sim.step(); // first step
    for (let i = 0; i < 60; i++) sim.step();
    const snapAfter60 = sim.snapshot();

    // Without motor, the car shouldn't have moved much (just settling under gravity)
    expect(Math.abs(snapAfter60.wheel.x - snap60.wheel.x)).toBeLessThan(5);
  });

  it("detects stuck-DNF when wheels spin without chassis progress", () => {
    const sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
    sim.enableMotor();

    // Run a few steps to settle
    for (let i = 0; i < 10; i++) sim.step();

    // Get initial chassis position after settling
    const initialSnap = sim.snapshot();
    const baselineX = initialSnap.chassis.x;

    // Pin the chassis in place to simulate being stuck
    const chassisPos = sim["chassisBody"].getPosition();
    const chassisAngle = sim["chassisBody"].getAngle();

    for (let i = 0; i < 1000; i++) {
      // Pin chassis in place (simulating being stuck against obstacle)
      sim["chassisBody"].setPosition(chassisPos);
      sim["chassisBody"].setAngle(chassisAngle);
      sim["chassisBody"].setLinearVelocity({ x: 0, y: 0 });
      sim["chassisBody"].setAngularVelocity(0);

      // Set wheel angular velocities to simulate spinning
      sim["wheelBody"].setAngularVelocity(20);
      sim["rearWheelBody"].setAngularVelocity(20);

      const snap = sim.step();
      if (snap.finished) {
        // Should finish due to DNF
        expect(snap.dnf).toBe(true);
        // Chassis shouldn't have advanced more than 0.5m from baseline
        expect(snap.chassis.x).toBeLessThan(baselineX + 0.5);
        return;
      }
    }

    // If we get here, DNF should have triggered
    const finalSnap = sim.snapshot();
    expect(finalSnap.finished).toBe(true);
    expect(finalSnap.dnf).toBe(true);
    expect(finalSnap.chassis.x).toBeLessThan(baselineX + 0.5);
  });

  it("resets stuck detection on wheel swap", () => {
    const sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
    sim.enableMotor();

    // Run for a bit to accumulate some rotations
    for (let i = 0; i < 100; i++) {
      sim.step();
    }

    // Swap the wheel
    sim.swapWheel(makeCircle(0.45, 8));

    // The rotation counter should have been reset
    expect(sim["accumulatedRotations"]).toBe(0);
    // Baseline should be updated to current chassis position
    const currentX = sim["chassisBody"].getPosition().x;
    expect(sim["progressBaselineX"]).toBeCloseTo(currentX, 5);
  });

  it("does not trigger DNF when chassis makes sufficient progress", () => {
    const sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
    sim.enableMotor();

    let snap;
    for (let i = 0; i < 10800; i++) {
      snap = sim.step();
      if (snap.finished) break;
    }

    // Should finish normally (not DNF) if it reaches the finish line
    expect(snap!.finished).toBe(true);
    if (snap!.wheel.x >= TEST_TRACK.finish.pos[0]) {
      expect(snap!.dnf).toBe(false);
    }
  });
});
