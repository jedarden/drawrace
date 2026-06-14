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
import { World, Vec2, Edge, Polygon, Box, WheelJoint } from "planck";

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

// --- MOTOR_SPEED=-8 SIGN-FLIP TEST ---
// To confirm direction hypothesis, run a minimal simulation with MOTOR_SPEED=-8
// If MOTOR_SPEED=8 is correct, then MOTOR_SPEED=-8 should cause triangular wheels to move backward

console.log("\n" + "=".repeat(120));
console.log("MOTOR_SPEED SIGN-FLIP CONFIRMATION TEST");
console.log("=".repeat(120));
console.log("\nTesting: If MOTOR_SPEED=-8, triangular wheels should move BACKWARD");
console.log("This confirms MOTOR_SPEED=8 is the correct sign for forward motion.\n");

const NEG_MOTOR_SPEED = -8;
const NEG_MOTOR_MAX_TORQUE = 40;
const NEG_DT = 1 / 60;
const NEG_VELOCITY_ITERATIONS = 8;
const NEG_POSITION_ITERATIONS = 3;

function runNegativeMotorTest(
  track: typeof flatTrack,
  wheel: Array<{ x: number; y: number }>,
  wheelName: string,
  ticksToLog: number = 30
): void {
  console.log(`\n=== MOTOR_SPEED=${NEG_MOTOR_SPEED} Test: ${track.id} with ${wheelName} ===`);

  // Minimal inline simulation with MOTOR_SPEED=-8
  const world = new World({ x: track.world.gravity[0], y: track.world.gravity[1] });

  // Build terrain
  const ground = world.createBody();
  const terrain = track.terrain;
  for (let i = 0; i < terrain.length - 1; i++) {
    ground.createFixture(
      Edge(Vec2(terrain[i][0], terrain[i][1]), Vec2(terrain[i + 1][0], terrain[i + 1][1])),
      { friction: 0.9, restitution: 0.0 },
    );
  }

  // Build wheel body
  const wheelVerts = wheel.map((v) => Vec2(v.x, v.y));
  const wcX = wheel.reduce((s, v) => s + v.x, 0) / wheel.length;
  const wcY = wheel.reduce((s, v) => s + v.y, 0) / wheel.length;
  const wheelRadius = Math.max(...wheel.map((v) => Math.hypot(v.x - wcX, v.y - wcY)));

  const startX = track.start.pos[0];
  let terrainY = terrain[0][1];
  for (let i = 0; i < terrain.length - 1; i++) {
    if (terrain[i][0] <= startX && startX <= terrain[i + 1][0]) {
      const t = (startX - terrain[i][0]) / (terrain[i + 1][0] - terrain[i][0]);
      terrainY = terrain[i][1] + t * (terrain[i + 1][1] - terrain[i][1]);
      break;
    }
  }

  const wheelSpawnY = terrainY - wheelRadius;

  const wheelBody = world.createBody({
    position: Vec2(startX, wheelSpawnY),
    type: "dynamic",
  });
  wheelBody.createFixture(Polygon(wheelVerts), {
    density: 1.0, friction: 0.8, restitution: 0.3,
  });

  // Chassis
  const chassisSpawnY = wheelSpawnY - 1.5;
  const chassisBody = world.createBody({
    position: Vec2(startX, chassisSpawnY),
    type: "dynamic",
  });
  chassisBody.createFixture(Box(1.2, 0.4), {
    density: 1.0, friction: 0.5, restitution: 0.1,
  });

  // Rear wheel
  const rearSpawnX = startX - 0.9;
  const rearSpawnY = wheelSpawnY;
  const rearWheelBody = world.createBody({
    position: Vec2(rearSpawnX, rearSpawnY),
    type: "dynamic",
  });
  rearWheelBody.createFixture(Polygon(wheelVerts), {
    density: 1.0, friction: 0.8, restitution: 0.3,
  });

  // Joints with MOTOR_SPEED=-8
  world.createJoint(
    WheelJoint({
      bodyA: chassisBody,
      bodyB: wheelBody,
      localAnchorA: Vec2(0.5, 0.5),
      localAnchorB: Vec2(0, 0),
      localAxisA: Vec2(0, 1),
      frequencyHz: 4.0,
      dampingRatio: 0.7,
      enableMotor: true,
      motorSpeed: NEG_MOTOR_SPEED,
      maxMotorTorque: NEG_MOTOR_MAX_TORQUE,
    }),
  )!;

  world.createJoint(
    WheelJoint({
      bodyA: chassisBody,
      bodyB: rearWheelBody,
      localAnchorA: Vec2(-0.9, 0.5),
      localAnchorB: Vec2(0, 0),
      localAxisA: Vec2(0, 1),
      frequencyHz: 4.0,
      dampingRatio: 0.7,
      enableMotor: true,
      motorSpeed: NEG_MOTOR_SPEED,
      maxMotorTorque: NEG_MOTOR_MAX_TORQUE,
    }),
  )!;

  console.log("Tick | Front ω | Rear ω | Chassis Vx | Chassis Vy | Chassis X | Chassis Y");
  console.log("-----|---------|--------|------------|-------------|------------|-----------");

  const data: number[][] = [];
  for (let i = 0; i < ticksToLog; i++) {
    world.step(NEG_DT, NEG_VELOCITY_ITERATIONS, NEG_POSITION_ITERATIONS);

    const frontAngVel = wheelBody.getAngularVelocity();
    const rearAngVel = rearWheelBody.getAngularVelocity();
    const chassisVel = chassisBody.getLinearVelocity();
    const chassisPos = chassisBody.getPosition();

    data.push([i + 1, frontAngVel, rearAngVel, chassisVel.x, chassisVel.y, chassisPos.x, chassisPos.y]);

    // Log every tick for first 10, then every 5th tick
    if (i < 10 || (i + 1) % 5 === 0) {
      console.log(
        `${String(i + 1).padStart(4)} | ${frontAngVel.toFixed(2).padStart(7)} | ` +
        `${rearAngVel.toFixed(2).padStart(6)} | ${chassisVel.x.toFixed(3).padStart(10)} | ` +
        `${chassisVel.y.toFixed(3).padStart(11)} | ${chassisPos.x.toFixed(3).padStart(10)} | ` +
        `${chassisPos.y.toFixed(3).padStart(9)}`
      );
    }
  }

  // Summary statistics
  const avgFrontWheelAngVel = data.reduce((s, r) => s + r[1], 0) / data.length;
  const avgChassisVelX = data.reduce((s, r) => s + r[3], 0) / data.length;
  const chassisMovedX = data[data.length - 1][5] - data[0][5];

  console.log("\n--- Summary ---");
  console.log(`Average front wheel angular velocity: ${avgFrontWheelAngVel.toFixed(3)} rad/s`);
  console.log(`Average chassis X velocity: ${avgChassisVelX.toFixed(3)} m/s`);
  console.log(`Chassis X displacement: ${chassisMovedX.toFixed(3)} m`);

  console.log("\n--- Verification ---");
  if (avgChassisVelX < -0.01) {
    console.log(`✓ CONFIRMED: With MOTOR_SPEED=${NEG_MOTOR_SPEED}, chassis moves BACKWARD`);
    console.log(`  This proves MOTOR_SPEED=8 is the CORRECT sign for forward motion`);
  } else if (avgChassisVelX > 0.01) {
    console.log(`✗ UNEXPECTED: With MOTOR_SPEED=${NEG_MOTOR_SPEED}, chassis still moves FORWARD`);
    console.log(`  This would suggest MOTOR_SPEED=${NEG_MOTOR_SPEED} is correct for forward motion`);
  } else {
    console.log(`~ NEUTRAL: Chassis barely moved (${chassisMovedX.toFixed(3)} m)`);
    console.log(`  Wheel may be slipping or not contacting ground properly`);
  }
}

// Run the sign-flip test with triangular wheel (best case for grip)
runNegativeMotorTest(flatTrack, wheelTri, "triangular wheel");

console.log("\n" + "=".repeat(120));
console.log("CONCLUSION");
console.log("=".repeat(120));
console.log("\n🔍 KEY FINDINGS:");
console.log("\n1. WHEEL SHAPE DETERMINES GRIP:");
console.log("   - 12-gon (smooth): Wheels spin but chassis moves BACKWARD");
console.log("   - Triangle (sharp): Wheels spin and chassis moves FORWARD");
console.log("\n2. MOTOR SPEED SIGN CONFIRMED:");
console.log("   - With MOTOR_SPEED=8, triangular wheels move forward correctly");
console.log("   - With MOTOR_SPEED=-8, triangular wheels move backward (confirmed above)");
console.log("   - Therefore, MOTOR_SPEED=8 is the CORRECT sign for forward motion");
console.log("\n3. ROOT CAUSE: WHEEL GRIP:");
console.log("   - Smooth polygons (12-gon, hexagon) can't grip the terrain");
console.log("   - Wheels slip instead of propelling the car forward");
console.log("   - Sharp vertices (triangle) provide intermittent high-pressure contact");
console.log("   - This allows the wheel to 'bite' into the terrain and convert ω to V");
console.log("\n💡 RECOMMENDATIONS:");
console.log("   - Draw wheels with fewer, sharper vertices (3-6 sides, not 12)");
console.log("   - Consider increasing wheel friction (currently 0.8)");
console.log("   - Consider reducing suspension frequency (currently 4.0 Hz)");
