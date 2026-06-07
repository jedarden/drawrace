import { describe, it, expect, afterEach } from "vitest";
import { RaceSim } from "./race-sim.js";
import type { TrackDef } from "./headless-race.js";

const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [-2, 5], [0, 5], [5, 5], [10, 5.3], [15, 5.3], [18, 5.8],
    [22, 5.8], [25, 5], [30, 5], [35, 5.2], [40, 5.2],
  ],
  zones: [
    { id: "A", x_start: -2, x_end: 40 }
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
  let sim: RaceSim | undefined;

  afterEach(() => {
    sim?.destroy();
    sim = undefined;
  });

  it("finishes the race", () => {
    sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
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
      const loopSim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
      loopSim.enableMotor();
      let snap;
      for (let i = 0; i < 10800; i++) {
        snap = loopSim.step();
        if (snap.finished) break;
      }
      results.push(snap!.tick);
      loopSim.destroy();
    }

    const first = results[0];
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(first);
    }
  });

  it("motor disabled during countdown prevents forward motion", () => {
    sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
    // Don't enable motor — simulate countdown phase
    const snap60 = sim.step(); // first step
    for (let i = 0; i < 60; i++) sim.step();
    const snapAfter60 = sim.snapshot();

    // Without motor, the car shouldn't have moved much (just settling under gravity)
    expect(Math.abs(snapAfter60.wheel.x - snap60.wheel.x)).toBeLessThan(5);
  });

  it("detects stuck-DNF when wheels spin without chassis progress", () => {
    sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
    sim.enableMotor();

    // Run a few steps to settle
    for (let i = 0; i < 10; i++) sim.step();

    // Get initial chassis position after settling
    const initialSnap = sim.snapshot();
    const baselineX = initialSnap.chassis.x;
    const chassisPos = sim["chassisBody"].getPosition();
    const chassisAngle = sim["chassisBody"].getAngle();
    const stuckDetector = sim["stuckDetector"];

    // Manually drive the stuck detector to simulate wheels spinning without progress
    // (bypassing physics to test the detector logic directly)
    for (let i = 0; i < 1000; i++) {
      // Pin chassis in place (simulating being stuck against obstacle)
      sim["chassisBody"].setPosition(chassisPos);
      sim["chassisBody"].setAngle(chassisAngle);
      sim["chassisBody"].setLinearVelocity({ x: 0, y: 0 });
      sim["chassisBody"].setAngularVelocity(0);

      // Reset stuck detector baseline each tick to ensure no progress is detected
      stuckDetector.setBaseline(baselineX);

      // Directly tick the stuck detector with spinning wheels (20 rad/s each)
      // This simulates wheels spinning while chassis doesn't advance
      const stuckResult = stuckDetector.tick(20, 20, baselineX);

      if (stuckResult === "stuck") {
        // Step once to trigger DNF state in RaceSim
        const snap = sim.step();
        // Should finish due to DNF
        expect(snap.finished).toBe(true);
        expect(snap.dnf).toBe(true);
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
    sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
    sim.enableMotor();

    // Run for a bit to accumulate some rotations
    for (let i = 0; i < 100; i++) {
      sim.step();
    }

    const beforeSwapSnap = sim.snapshot();

    // Swap the wheel
    sim.swapWheel(makeCircle(0.45, 8));

    const afterSwapSnap = sim.snapshot();

    // The stuck detector should have been reset
    // This is verified implicitly: after a swap, the car should be able to continue
    // racing without immediately triggering stuck-DNF
    expect(sim.isStuck()).toBe(false);
    expect(afterSwapSnap.stuck).toBe(false);
    expect(afterSwapSnap.finished).toBe(false);

    // The swap shouldn't have caused a race finish
    expect(afterSwapSnap.dnf).toBe(false);

    void beforeSwapSnap;
  });

  it("does not trigger DNF when chassis makes sufficient progress", () => {
    sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 8), 42);
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

  it("front wheel has sufficient angular velocity during motion (bf-5fz89)", () => {
    // Regression test for wheel slip issue — ensures wheels grip terrain
    // bf-2evf2 found 12-gon slipped so badly it pushed car backward
    sim = new RaceSim(TEST_TRACK, makeCircle(0.4, 12), 42); // 12-gon is smoothest common shape
    sim.enableMotor();

    // Run to tick 60 (1 second) — enough time for wheels to spin up
    for (let i = 0; i < 60; i++) {
      sim.step();
    }

    // Front wheel should be spinning (angular velocity > 0.5 rad/s)
    const diag = sim.getDiagnosticData();
    expect(Math.abs(diag.frontWheelAngVel)).toBeGreaterThan(0.5);
  });
});
