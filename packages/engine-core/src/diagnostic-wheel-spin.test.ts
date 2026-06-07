/**
 * Diagnostic test: investigate wheel angular momentum vs chassis motion.
 *
 * Hypothesis: drawn wheel may not have angular momentum because:
 * 1. Wheel polygon is too smooth (e.g., 12-gon) to grip irregular terrain edges
 * 2. Wheel body fixture has insufficient friction
 * 3. WheelJoint suspension travel absorbs all motor torque before it reaches ground
 *
 * This test logs wheel angular velocity and chassis linear velocity for first 30 ticks
 * to determine if wheels are spinning and if that spin translates to forward motion.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { RaceSim } from "./race-sim.js";

// Test wheel shapes
const wheel12Gon: Array<{ x: number; y: number }> = [];
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  wheel12Gon.push({
    x: Math.cos(angle) * 0.8,
    y: Math.sin(angle) * 0.8,
  });
}

const wheelTri: Array<{ x: number; y: number }> = [
  { x: 0.8, y: 0 },
  { x: -0.4, y: 0.693 },
  { x: -0.4, y: -0.693 },
];

const wheelHex: Array<{ x: number; y: number }> = [];
for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 2;
  wheelHex.push({
    x: Math.cos(angle) * 0.8,
    y: Math.sin(angle) * 0.8,
  });
}

// Test track: simple flat ground
const flatTrack = {
  id: "diagnostic-flat",
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

// Test track: single cliff edge
const cliffTrack = {
  id: "diagnostic-cliff",
  world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 80 },
  terrain: [
    [-10, 0],
    [0, 0],
    [0, 2],
    [100, 2],
  ] as [number, number][],
  zones: [
    { id: "before-cliff", x_start: -10, x_end: 0 },
    { id: "after-cliff", x_start: 0, x_end: 100 },
  ] as Array<{ id: string; x_start: number; x_end: number }>,
  start: { pos: [-5, -2] as [number, number], facing: 0 },
  finish: { pos: [50, 2] as [number, number], width: 10 },
};

interface DiagnosticTick {
  tick: number;
  frontWheelAngVel: number;
  rearWheelAngVel: number;
  chassisVelX: number;
  chassisVelY: number;
  chassisX: number;
  chassisY: number;
  frontWheelAngle: number;
  rearWheelAngle: number;
}

interface DiagnosticResult {
  trackName: string;
  wheelName: string;
  ticks: DiagnosticTick[];
  summary: {
    finalChassisX: number;
    chassisDeltaX: number;
    avgFrontWheelAngVel: number;
    maxFrontWheelAngVel: number;
    avgRearWheelAngVel: number;
    maxRearWheelAngVel: number;
    chassisMovedForward: boolean;
    wheelsSpinning: boolean;
  };
}

function runDiagnostic(
  track: typeof flatTrack,
  wheel: Array<{ x: number; y: number }>,
  wheelName: string,
  trackName: string
): DiagnosticResult {
  const sim = new RaceSim(track, wheel);
  sim.enableMotor();

  const ticks: DiagnosticTick[] = [];
  const startX = track.start.pos[0];

  for (let i = 0; i < 30; i++) {
    const snap = sim.step();
    const diag = sim.getDiagnosticData();
    ticks.push({
      tick: i,
      frontWheelAngVel: diag.frontWheelAngVel,
      rearWheelAngVel: diag.rearWheelAngVel,
      chassisVelX: diag.chassisVelX,
      chassisVelY: diag.chassisVelY,
      chassisX: diag.chassisX,
      chassisY: diag.chassisY,
      frontWheelAngle: diag.frontWheelAngle,
      rearWheelAngle: diag.rearWheelAngle,
    });
  }

  const sumAngVel = ticks.reduce((s, t) => s + Math.abs(t.frontWheelAngVel), 0);
  const maxAngVel = Math.max(...ticks.map((t) => Math.abs(t.frontWheelAngVel)));
  const sumRearAngVel = ticks.reduce((s, t) => s + Math.abs(t.rearWheelAngVel), 0);
  const maxRearAngVel = Math.max(...ticks.map((t) => Math.abs(t.rearWheelAngVel)));
  const finalX = ticks[ticks.length - 1].chassisX;

  return {
    trackName,
    wheelName,
    ticks,
    summary: {
      finalChassisX: finalX,
      chassisDeltaX: finalX - startX,
      avgFrontWheelAngVel: sumAngVel / ticks.length,
      maxFrontWheelAngVel: maxAngVel,
      avgRearWheelAngVel: sumRearAngVel / ticks.length,
      maxRearWheelAngVel: maxRearAngVel,
      chassisMovedForward: finalX > startX + 0.1,
      wheelsSpinning: maxAngVel > 0.1,
    },
  };
}

describe("wheel spin diagnostic", () => {
  it("12-gon wheel on flat ground - wheels should spin and chassis should move forward", (t) => {
    const result = runDiagnostic(flatTrack, wheel12Gon, "12-gon", "flat");

    console.log("\n=== 12-gon wheel on flat ground ===");
    console.log("Tick | Front ω | Rear ω  | Chassis Vx | Chassis X");
    console.log("-----|---------|---------|------------|-----------");
    for (const tick of result.ticks) {
      if (tick.tick % 5 === 0 || tick.tick < 5) {
        console.log(
          `${String(tick.tick).padStart(4)} | ${tick.frontWheelAngVel.toFixed(2).padStart(7)} | ` +
            `${tick.rearWheelAngVel.toFixed(2).padStart(7)} | ${tick.chassisVelX.toFixed(2).padStart(10)} | ` +
            `${tick.chassisX.toFixed(2).padStart(10)}`
        );
      }
    }
    console.log("\nSummary:");
    console.log(`  Chassis moved: ${result.summary.chassisDeltaX.toFixed(2)} units`);
    console.log(`  Avg front wheel ω: ${result.summary.avgFrontWheelAngVel.toFixed(2)} rad/s`);
    console.log(`  Max front wheel ω: ${result.summary.maxFrontWheelAngVel.toFixed(2)} rad/s`);
    console.log(`  Wheels spinning: ${result.summary.wheelsSpinning}`);
    console.log(`  Chassis moving forward: ${result.summary.chassisMovedForward}`);

    // On flat ground with proper friction, wheels should spin and chassis should move
    assert.ok(
      result.summary.wheelsSpinning,
      "Wheels should be spinning (angular velocity > 0.1 rad/s)"
    );
    assert.ok(
      result.summary.chassisMovedForward,
      "Chassis should move forward on flat ground"
    );
  });

  it("triangular wheel on flat ground - should move due to better grip", (t) => {
    const result = runDiagnostic(flatTrack, wheelTri, "triangle", "flat");

    console.log("\n=== Triangular wheel on flat ground ===");
    console.log("Tick | Front ω | Rear ω  | Chassis Vx | Chassis X");
    console.log("-----|---------|---------|------------|-----------");
    for (const tick of result.ticks) {
      if (tick.tick % 5 === 0 || tick.tick < 5) {
        console.log(
          `${String(tick.tick).padStart(4)} | ${tick.frontWheelAngVel.toFixed(2).padStart(7)} | ` +
            `${tick.rearWheelAngVel.toFixed(2).padStart(7)} | ${tick.chassisVelX.toFixed(2).padStart(10)} | ` +
            `${tick.chassisX.toFixed(2).padStart(10)}`
        );
      }
    }
    console.log("\nSummary:");
    console.log(`  Chassis moved: ${result.summary.chassisDeltaX.toFixed(2)} units`);
    console.log(`  Avg front wheel ω: ${result.summary.avgFrontWheelAngVel.toFixed(2)} rad/s`);
    console.log(`  Max front wheel ω: ${result.summary.maxFrontWheelAngVel.toFixed(2)} rad/s`);

    assert.ok(result.summary.chassisMovedForward, "Triangle wheel should move forward");
  });

  it("hexagonal wheel on flat ground - intermediate between 12-gon and triangle", (t) => {
    const result = runDiagnostic(flatTrack, wheelHex, "hexagon", "flat");

    console.log("\n=== Hexagonal wheel on flat ground ===");
    console.log("Tick | Front ω | Rear ω  | Chassis Vx | Chassis X");
    console.log("-----|---------|---------|------------|-----------");
    for (const tick of result.ticks) {
      if (tick.tick % 5 === 0 || tick.tick < 5) {
        console.log(
          `${String(tick.tick).padStart(4)} | ${tick.frontWheelAngVel.toFixed(2).padStart(7)} | ` +
            `${tick.rearWheelAngVel.toFixed(2).padStart(7)} | ${tick.chassisVelX.toFixed(2).padStart(10)} | ` +
            `${tick.chassisX.toFixed(2).padStart(10)}`
        );
      }
    }
    console.log("\nSummary:");
    console.log(`  Chassis moved: ${result.summary.chassisDeltaX.toFixed(2)} units`);
    console.log(`  Avg front wheel ω: ${result.summary.avgFrontWheelAngVel.toFixed(2)} rad/s`);
    console.log(`  Max front wheel ω: ${result.summary.maxFrontWheelAngVel.toFixed(2)} rad/s`);

    assert.ok(result.summary.chassisMovedForward, "Hexagon wheel should move forward");
  });

  it("12-gon wheel at cliff edge - diagnostic for stuck behavior", (t) => {
    const result = runDiagnostic(cliffTrack, wheel12Gon, "12-gon", "cliff");

    console.log("\n=== 12-gon wheel at cliff edge ===");
    console.log("Tick | Front ω | Rear ω  | Chassis Vx | Chassis X | Chassis Y");
    console.log("-----|---------|---------|------------|-----------|-----------");
    for (const tick of result.ticks) {
      if (tick.tick % 5 === 0 || tick.tick < 5) {
        console.log(
          `${String(tick.tick).padStart(4)} | ${tick.frontWheelAngVel.toFixed(2).padStart(7)} | ` +
            `${tick.rearWheelAngVel.toFixed(2).padStart(7)} | ${tick.chassisVelX.toFixed(2).padStart(10)} | ` +
            `${tick.chassisX.toFixed(2).padStart(10)} | ${tick.chassisY.toFixed(2).padStart(10)}`
        );
      }
    }
    console.log("\nSummary:");
    console.log(`  Chassis moved: ${result.summary.chassisDeltaX.toFixed(2)} units`);
    console.log(`  Wheels spinning: ${result.summary.wheelsSpinning}`);
    console.log(`  Chassis moving forward: ${result.summary.chassisMovedForward}`);

    // This test is informational - we're observing behavior, not asserting
    // The key question: do wheels spin while chassis stays still?
    if (result.summary.wheelsSpinning && !result.summary.chassisMovedForward) {
      console.log("\n  ⚠️  WHEELS SPINNING BUT CHASSIS NOT MOVING - SUSPENSION/GRIP ISSUE");
    } else if (!result.summary.wheelsSpinning && !result.summary.chassisMovedForward) {
      console.log("\n  ⚠️  WHEELS NOT SPINNING - MOTOR/JOINT ISSUE");
    }
  });

  it("triangular wheel at cliff edge - compare grip to 12-gon", (t) => {
    const result = runDiagnostic(cliffTrack, wheelTri, "triangle", "cliff");

    console.log("\n=== Triangular wheel at cliff edge ===");
    console.log("Tick | Front ω | Rear ω  | Chassis Vx | Chassis X | Chassis Y");
    console.log("-----|---------|---------|------------|-----------|-----------");
    for (const tick of result.ticks) {
      if (tick.tick % 5 === 0 || tick.tick < 5) {
        console.log(
          `${String(tick.tick).padStart(4)} | ${tick.frontWheelAngVel.toFixed(2).padStart(7)} | ` +
            `${tick.rearWheelAngVel.toFixed(2).padStart(7)} | ${tick.chassisVelX.toFixed(2).padStart(10)} | ` +
            `${tick.chassisX.toFixed(2).padStart(10)} | ${tick.chassisY.toFixed(2).padStart(10)}`
        );
      }
    }
    console.log("\nSummary:");
    console.log(`  Chassis moved: ${result.summary.chassisDeltaX.toFixed(2)} units`);
  });

  it("comparison: 12-gon vs triangle vs hexagon on flat ground", (t) => {
    const r12 = runDiagnostic(flatTrack, wheel12Gon, "12-gon", "flat");
    const rTri = runDiagnostic(flatTrack, wheelTri, "triangle", "flat");
    const rHex = runDiagnostic(flatTrack, wheelHex, "hexagon", "flat");

    console.log("\n=== Comparison: Wheel Shape Performance on Flat Ground ===");
    console.log("Wheel Shape | Chassis ΔX | Avg ω | Max ω | Forward?");
    console.log("-------------|------------|-------|-------|---------");
    console.log(
      `12-gon       | ${r12.summary.chassisDeltaX.toFixed(2).padStart(10)} | ` +
        `${r12.summary.avgFrontWheelAngVel.toFixed(2).padStart(5)} | ` +
        `${r12.summary.maxFrontWheelAngVel.toFixed(2).padStart(5)} | ${String(r12.summary.chassisMovedForward).padStart(7)}`
    );
    console.log(
      `Hexagon      | ${rHex.summary.chassisDeltaX.toFixed(2).padStart(10)} | ` +
        `${rHex.summary.avgFrontWheelAngVel.toFixed(2).padStart(5)} | ` +
        `${rHex.summary.maxFrontWheelAngVel.toFixed(2).padStart(5)} | ${String(rHex.summary.chassisMovedForward).padStart(7)}`
    );
    console.log(
      `Triangle     | ${rTri.summary.chassisDeltaX.toFixed(2).padStart(10)} | ` +
        `${rTri.summary.avgFrontWheelAngVel.toFixed(2).padStart(5)} | ` +
        `${rTri.summary.maxFrontWheelAngVel.toFixed(2).padStart(5)} | ${String(rTri.summary.chassisMovedForward).padStart(7)}`
    );

    // All should move forward on flat ground
    assert.ok(r12.summary.chassisMovedForward, "12-gon should move on flat ground");
    assert.ok(rTri.summary.chassisMovedForward, "Triangle should move on flat ground");
    assert.ok(rHex.summary.chassisMovedForward, "Hexagon should move on flat ground");
  });
});
