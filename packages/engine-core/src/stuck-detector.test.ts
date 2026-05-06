import { describe, it, expect } from "vitest";
import { StuckDetector } from "./stuck-detector.js";

describe("StuckDetector", () => {
  it("10 rotations with 0.1m progress → stuck", () => {
    const detector = new StuckDetector();
    detector.setBaseline(0);

    // Simulate 10 rotations with minimal chassis progress
    // Each rotation: ω = 2π rad/s → rotationIncrement = (2π + 2π) * (1/60) / (2π * 2) = 1/60
    // 10 rotations = 600 ticks
    const angVel = 2 * Math.PI; // 1 rotation per second per wheel
    for (let i = 0; i < 600; i++) {
      const result = detector.tick(angVel, angVel, 0.1); // 0.1m progress
      if (result === "stuck") {
        expect(result).toBe("stuck");
        expect(detector.getRotations()).toBeGreaterThanOrEqual(10);
        return;
      }
    }

    // If we get here, stuck should have triggered
    expect(detector.getRotations()).toBeGreaterThanOrEqual(10);
  });

  it("10 rotations with 0.6m progress → continues with reset", () => {
    const detector = new StuckDetector();
    detector.setBaseline(0);

    const angVel = 2 * Math.PI; // 1 rotation per second per wheel
    let stuckTriggered = false;

    // Simulate 10 rotations with 0.6m progress
    // Progress threshold is 0.5m, so at 0.6m the counter should reset
    for (let i = 0; i < 600; i++) {
      const result = detector.tick(angVel, angVel, 0.6);
      if (result === "stuck") {
        stuckTriggered = true;
        break;
      }
    }

    // Should NOT trigger stuck because progress exceeded threshold
    expect(stuckTriggered).toBe(false);
    // Rotations should have been reset after hitting progress threshold
    expect(detector.getRotations()).toBeLessThan(10);
    // Baseline should have been updated to the progressed position
    expect(detector.getBaselineX()).toBe(0.6);
  });

  it("swap during countup resets and grants fresh 10 rotations", () => {
    const detector = new StuckDetector();
    detector.setBaseline(0);

    const angVel = 2 * Math.PI; // 1 rotation per second per wheel

    // Accumulate 5 rotations (300 ticks)
    for (let i = 0; i < 300; i++) {
      detector.tick(angVel, angVel, 0);
    }
    const rotationsBeforeSwap = detector.getRotations();
    expect(rotationsBeforeSwap).toBeGreaterThanOrEqual(4.9);
    expect(rotationsBeforeSwap).toBeLessThan(5.1);

    // Perform wheel swap - should reset counter and baseline
    detector.reset();
    detector.setBaseline(5.0); // Simulate chassis moved to new position

    expect(detector.getRotations()).toBe(0);
    expect(detector.getBaselineX()).toBe(5.0);

    // Accumulate another 10 rotations from the swap point
    let stuckTriggered = false;
    for (let i = 0; i < 600; i++) {
      const result = detector.tick(angVel, angVel, 5.0); // No progress from new baseline
      if (result === "stuck") {
        stuckTriggered = true;
        break;
      }
    }

    // Should trigger stuck after 10 more rotations from swap
    expect(stuckTriggered).toBe(true);
    expect(detector.getRotations()).toBeGreaterThanOrEqual(10);
  });

  it("progress threshold resets counter multiple times", () => {
    const detector = new StuckDetector();
    detector.setBaseline(0);

    const angVel = 2 * Math.PI;

    // First 0.5m progress → reset
    for (let i = 0; i < 300; i++) {
      detector.tick(angVel, angVel, 0.5);
    }
    expect(detector.getBaselineX()).toBe(0.5);
    expect(detector.getRotations()).toBeLessThan(10);

    // Second 0.5m progress → another reset
    for (let i = 0; i < 300; i++) {
      detector.tick(angVel, angVel, 1.0);
    }
    expect(detector.getBaselineX()).toBe(1.0);
    expect(detector.getRotations()).toBeLessThan(10);

    // No more progress → should eventually stick
    let stuckTriggered = false;
    for (let i = 0; i < 700; i++) {
      const result = detector.tick(angVel, angVel, 1.0);
      if (result === "stuck") {
        stuckTriggered = true;
        break;
      }
    }
    expect(stuckTriggered).toBe(true);
  });

  it("zero angular velocity does not accumulate rotations", () => {
    const detector = new StuckDetector();
    detector.setBaseline(0);

    // Run with zero angular velocity for 1000 ticks
    for (let i = 0; i < 1000; i++) {
      const result = detector.tick(0, 0, 0);
      expect(result).toBe("running");
    }

    expect(detector.getRotations()).toBe(0);
  });

  it("returns running when below rotation threshold", () => {
    const detector = new StuckDetector();
    detector.setBaseline(0);

    const angVel = 2 * Math.PI;

    // Only 5 rotations (300 ticks) - below threshold
    for (let i = 0; i < 300; i++) {
      const result = detector.tick(angVel, angVel, 0);
      expect(result).toBe("running");
    }

    expect(detector.getRotations()).toBeGreaterThan(4.9);
    expect(detector.getRotations()).toBeLessThan(5.1);
  });

  it("handles negative chassis positions correctly", () => {
    const detector = new StuckDetector();
    detector.setBaseline(-5.0);

    const angVel = 2 * Math.PI;

    // 10 rotations with minimal progress from negative baseline
    let stuckTriggered = false;
    for (let i = 0; i < 600; i++) {
      const result = detector.tick(angVel, angVel, -4.9); // Only 0.1m progress
      if (result === "stuck") {
        stuckTriggered = true;
        break;
      }
    }

    expect(stuckTriggered).toBe(true);
  });

  it("reset clears rotations and keeps baseline at 0 until setBaseline called", () => {
    const detector = new StuckDetector();
    detector.setBaseline(10.0);

    const angVel = 2 * Math.PI;
    for (let i = 0; i < 300; i++) {
      detector.tick(angVel, angVel, 10.0);
    }

    expect(detector.getRotations()).toBeGreaterThan(4.9);
    expect(detector.getBaselineX()).toBe(10.0);

    detector.reset();

    expect(detector.getRotations()).toBe(0);
    expect(detector.getBaselineX()).toBe(0); // reset() sets baselineX to 0

    // Set new baseline
    detector.setBaseline(15.0);
    expect(detector.getBaselineX()).toBe(15.0);
  });
});
