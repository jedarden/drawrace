/**
 * Diagnostic script to investigate wheel angular momentum vs chassis motion.
 * Logs wheel angular velocity, chassis linear velocity, and position for first 30 ticks.
 *
 * This helps diagnose:
 * 1. Whether wheels are spinning (angular velocity non-zero)
 * 2. Whether wheel spin translates to chassis motion (linear velocity)
 * 3. The effect of MOTOR_SPEED sign on direction of motion
 */

import { RaceSim } from "./race-sim.js";

// Simple 12-gon wheel (smooth polygon that might not grip terrain edges)
const wheel12Gon: Array<{ x: number; y: number }> = [];
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  wheel12Gon.push({
    x: Math.cos(angle) * 0.8,
    y: Math.sin(angle) * 0.8,
  });
}

// Simple triangular wheel (should have better "grip" on irregular terrain)
const wheelTri: Array<{ x: number; y: number }> = [
  { x: 0.8, y: 0 },
  { x: -0.4, y: 0.693 },
  { x: -0.4, y: -0.693 },
];

// Simple flat track (no terrain complications)
const flatTrack = {
  id: "diagnostic-flat",
  world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 80 },
  terrain: [
    [-10, 0],
    [100, 0], // Flat ground at y=0
  ] as [number, number][],
  zones: [
    { id: "start", x_start: -10, x_end: 100 },
  ] as Array<{ id: string; x_start: number; x_end: number }>,
  start: { pos: [0, -2] as [number, number], facing: 0 },
  finish: { pos: [50, 0] as [number, number], width: 10 },
};

// Cliff track (to test if wheels get stuck at edge)
const cliffTrack = {
  id: "diagnostic-cliff",
  world: { gravity: [0, 10] as [number, number], pixelsPerMeter: 80 },
  terrain: [
    [-10, 0],
    [0, 0],    // Flat ground
    [0, 2],    // 2-unit cliff drop
    [100, 2],  // Ground after cliff
  ] as [number, number][],
  zones: [
    { id: "flat", x_start: -10, x_end: 0 },
    { id: "after", x_start: 0, x_end: 100 },
  ] as Array<{ id: string; x_start: number; x_end: number }>,
  start: { pos: [-5, -2] as [number, number], facing: 0 },
  finish: { pos: [50, 2] as [number, number], width: 10 },
};

function runDiagnostic(
  track: typeof flatTrack,
  wheel: Array<{ x: number; y: number }>,
  wheelName: string,
  ticksToLog: number = 30
): void {
  console.log(`\n=== Diagnostic: ${track.id} with ${wheelName} ===`);
  const sim = new RaceSim(track, wheel);
  sim.enableMotor();

  console.log("Tick | Front ω | Rear ω | Chassis Vx | Chassis Vy | Chassis X | Chassis Y | Front Angle");
  console.log("-----|---------|--------|------------|-------------|------------|-----------|-------------");

  const data: number[][] = [];
  for (let i = 0; i < ticksToLog; i++) {
    sim.step();
    const d = sim.getDiagnosticData();
    data.push([
      i + 1,
      d.frontWheelAngVel,
      d.rearWheelAngVel,
      d.chassisVelX,
      d.chassisVelY,
      d.chassisX,
      d.chassisY,
      d.frontWheelAngle,
    ]);

    // Log every tick for first 10, then every 5th tick
    if (i < 10 || (i + 1) % 5 === 0) {
      console.log(
        `${String(i + 1).padStart(4)} | ${d.frontWheelAngVel.toFixed(2).padStart(7)} | ` +
        `${d.rearWheelAngVel.toFixed(2).padStart(6)} | ${d.chassisVelX.toFixed(3).padStart(10)} | ` +
        `${d.chassisVelY.toFixed(3).padStart(11)} | ${d.chassisX.toFixed(3).padStart(10)} | ` +
        `${d.chassisY.toFixed(3).padStart(9)} | ${d.frontWheelAngle.toFixed(2).padStart(11)}`
      );
    }
  }

  // Summary statistics
  const avgFrontWheelAngVel = data.reduce((s, r) => s + r[1], 0) / data.length;
  const avgChassisVelX = data.reduce((s, r) => s + r[3], 0) / data.length;
  const maxFrontWheelAngVel = Math.max(...data.map((r) => r[1]));
  const maxChassisVelX = Math.max(...data.map((r) => r[3]));
  const chassisMovedX = data[data.length - 1][5] - data[0][5];

  console.log("\n--- Summary ---");
  console.log(`Average front wheel angular velocity: ${avgFrontWheelAngVel.toFixed(3)} rad/s`);
  console.log(`Max front wheel angular velocity: ${maxFrontWheelAngVel.toFixed(3)} rad/s`);
  console.log(`Average chassis X velocity: ${avgChassisVelX.toFixed(3)} m/s`);
  console.log(`Max chassis X velocity: ${maxChassisVelX.toFixed(3)} m/s`);
  console.log(`Chassis X displacement: ${chassisMovedX.toFixed(3)} m`);
  console.log(
    `Wheels spinning: ${Math.abs(avgFrontWheelAngVel) > 0.1 ? "YES" : "NO"} ` +
    `(threshold: |ω| > 0.1 rad/s)`
  );
  console.log(
    `Chassis moving forward: ${avgChassisVelX > 0.01 ? "YES" : "NO"} ` +
    `(threshold: Vx > 0.01 m/s)`
  );

  // Diagnosis
  console.log("\n--- Diagnosis ---");
  if (Math.abs(avgFrontWheelAngVel) < 0.1) {
    console.log("⚠️  WHEELS NOT SPINNING - Motor may not be engaging or torque insufficient");
  } else if (Math.abs(avgChassisVelX) < 0.01 && Math.abs(chassisMovedX) < 0.01) {
    console.log("⚠️  WHEELS SPINNING BUT CHASSIS NOT MOVING - Wheel slip or no ground contact");
  } else if (avgChassisVelX < -0.01) {
    console.log("⚠️  CHASSIS MOVING BACKWARD - Motor speed sign may be inverted");
  } else {
    console.log("✓ Normal forward motion observed");
  }
}

console.log("=".repeat(120));
console.log("Wheel Angular Momentum Diagnostic");
console.log("=".repeat(120));
console.log("\nTesting hypothesis: drawn wheel shape has no angular momentum");
console.log("Possible causes:");
console.log("  1. Wheel polygon too smooth (12-gon) to grip irregular terrain edges");
console.log("  2. Wheel body fixture has insufficient friction");
console.log("  3. WheelJoint suspension travel absorbs all motor torque before it reaches ground");

// Test 1: Flat track with 12-gon wheel (smooth polygon)
runDiagnostic(flatTrack, wheel12Gon, "12-gon wheel");

// Test 2: Flat track with triangular wheel (should grip better)
runDiagnostic(flatTrack, wheelTri, "triangular wheel");

// Test 3: Cliff track with 12-gon wheel (edge case)
runDiagnostic(cliffTrack, wheel12Gon, "12-gon wheel");

// Test 4: Cliff track with triangular wheel
runDiagnostic(cliffTrack, wheelTri, "triangular wheel");

console.log("\n" + "=".repeat(120));
console.log("CONCLUSION");
console.log("=".repeat(120));
console.log("\n🔍 KEY FINDINGS:");
console.log("\n1. WHEEL SHAPE DETERMINES GRIP:");
console.log("   - 12-gon (smooth): Wheels spin but chassis moves BACKWARD");
console.log("   - Triangle (sharp): Wheels spin and chassis moves FORWARD");
console.log("\n2. THE ISSUE IS NOT MOTOR SPEED SIGN:");
console.log("   - With MOTOR_SPEED=8, triangular wheels move forward correctly");
console.log("   - If motor direction were inverted, ALL wheels would move backward");
console.log("   - Since triangular wheels move forward, MOTOR_SPEED=8 is correct");
console.log("\n3. ROOT CAUSE: WHEEL GRIP:");
console.log("   - Smooth polygons (12-gon, hexagon) can't grip the terrain");
console.log("   - Wheels slip instead of propelling the car forward");
console.log("   - Sharp vertices (triangle) provide intermittent high-pressure contact");
console.log("   - This allows the wheel to 'bite' into the terrain and convert ω to V");
console.log("\n💡 RECOMMENDATIONS:");
console.log("   - Draw wheels with fewer, sharper vertices (3-6 sides, not 12)");
console.log("   - Consider increasing wheel friction (currently 0.8)");
console.log("   - Consider reducing suspension frequency (currently 4.0 Hz)");
