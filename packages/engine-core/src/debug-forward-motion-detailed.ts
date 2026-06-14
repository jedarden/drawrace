/**
 * Detailed debug test to understand why the car isn't moving.
 * This instrumented version will print position over time.
 */

import { World, Vec2, Edge, Polygon, Box, WheelJoint } from "planck";

const DT = 1 / 60;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const MAX_TICKS = 60 * 10; // Run for 10 seconds instead of 3 minutes
const CHASSIS_DENSITY = 1.0;
const WHEEL_DENSITY = 1.0;
const WHEEL_FRICTION = 2.5;
const WHEEL_RESTITUTION = 0.3;
const MOTOR_SPEED = 8;
const MOTOR_MAX_TORQUE = 40;
const SUSPENSION_FREQ_HZ = 2.5;
const SUSPENSION_DAMPING_RATIO = 0.7;

// Unit circle wheel
const UNIT_CIRCLE_12: [number, number][] = [];
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  UNIT_CIRCLE_12.push([Math.cos(angle), Math.sin(angle)]);
}

// Simple track
const terrain = [[0, 5], [120, 5]];
const startX = 1.5;
const terrainY = 5;

console.log("=== Detailed Debug Test ===");
console.log("Wheel vertices:", UNIT_CIRCLE_12.length);
console.log("Start position: X=", startX);

// Create world
const world = new World({ x: 0, y: 10 });

// Build terrain
const ground = world.createBody();
for (let i = 0; i < terrain.length - 1; i++) {
  ground.createFixture(
    Edge(Vec2(terrain[i][0], terrain[i][1]), Vec2(terrain[i + 1][0], terrain[i + 1][1])),
    { friction: 0.9, restitution: 0.0 }
  );
}

// Calculate wheel properties
const rawVerts = UNIT_CIRCLE_12;
const wv = rawVerts;
const wcX = wv.reduce((s, v) => s + v[0], 0) / wv.length;
const wcY = wv.reduce((s, v) => s + v[1], 0) / wv.length;
const wheelRadius = Math.max(...wv.map((v) => Math.hypot(v[0] - wcX, v[1] - wcY)));

console.log("Wheel center: X=", wcX.toFixed(4), "Y=", wcY.toFixed(4));
console.log("Wheel radius:", wheelRadius.toFixed(4));

// Add left barrier
const leftBarrier = world.createBody({
  position: Vec2(startX - 0.05, terrainY - 2),
  type: "static",
});
leftBarrier.createFixture(Box(0.05, 10), {
  friction: 0.0,
  restitution: 0.0,
});

// Wheel spawn position
const wheelSpawnY = terrainY - wheelRadius;
console.log("Wheel spawn Y:", wheelSpawnY.toFixed(4));

// Create wheel body
const wheelBody = world.createBody({
  position: Vec2(startX, wheelSpawnY),
  type: "dynamic",
});

// Create wheel fixture
const pv = wv.map((v) => Vec2(v[0], v[1]));
if (pv.length <= 8) {
  wheelBody.createFixture(Polygon(pv), {
    density: WHEEL_DENSITY,
    friction: WHEEL_FRICTION,
    restitution: WHEEL_RESTITUTION,
  });
} else {
  // Fan-triangulate for >8 vertices
  const cx = pv.reduce((s, v) => s + v.x, 0) / pv.length;
  const cy = pv.reduce((s, v) => s + v.y, 0) / pv.length;
  const center = Vec2(cx, cy);
  for (let i = 0; i < pv.length; i++) {
    const next = (i + 1) % pv.length;
    wheelBody.createFixture(Polygon([center, pv[i], pv[next]]), {
      density: WHEEL_DENSITY,
      friction: WHEEL_FRICTION,
      restitution: WHEEL_RESTITUTION,
    });
  }
}

// Chassis
const chassisSpawnY = wheelSpawnY - 1.5;
const chassisBody = world.createBody({
  position: Vec2(startX, chassisSpawnY),
  type: "dynamic",
});
chassisBody.createFixture(Box(1.2, 0.4), {
  density: CHASSIS_DENSITY,
  friction: 0.5,
  restitution: 0.1,
});

// Rear wheel
const rearWheelBody = world.createBody({
  position: Vec2(startX - 0.9, wheelSpawnY),
  type: "dynamic",
});
if (pv.length <= 8) {
  rearWheelBody.createFixture(Polygon(pv), {
    density: WHEEL_DENSITY,
    friction: WHEEL_FRICTION,
    restitution: WHEEL_RESTITUTION,
  });
} else {
  const cx = pv.reduce((s, v) => s + v.x, 0) / pv.length;
  const cy = pv.reduce((s, v) => s + v.y, 0) / pv.length;
  const center = Vec2(cx, cy);
  for (let i = 0; i < pv.length; i++) {
    const next = (i + 1) % pv.length;
    rearWheelBody.createFixture(Polygon([center, pv[i], pv[next]]), {
      density: WHEEL_DENSITY,
      friction: WHEEL_FRICTION,
      restitution: WHEEL_RESTITUTION,
    });
  }
}

// Front wheel joint
world.createJoint(
  WheelJoint({
    bodyA: chassisBody,
    bodyB: wheelBody,
    localAnchorA: Vec2(0.5, 0.5),
    localAnchorB: Vec2(0, 0),
    localAxisA: Vec2(0, 1),
    frequencyHz: SUSPENSION_FREQ_HZ,
    dampingRatio: SUSPENSION_DAMPING_RATIO,
    enableMotor: true,
    motorSpeed: MOTOR_SPEED,
    maxMotorTorque: MOTOR_MAX_TORQUE,
  })
);

// Rear wheel joint
world.createJoint(
  WheelJoint({
    bodyA: chassisBody,
    bodyB: rearWheelBody,
    localAnchorA: Vec2(-0.9, 0.5),
    localAnchorB: Vec2(0, 0),
    localAxisA: Vec2(0, 1),
    frequencyHz: SUSPENSION_FREQ_HZ,
    dampingRatio: SUSPENSION_DAMPING_RATIO,
    enableMotor: true,
    motorSpeed: MOTOR_SPEED,
    maxMotorTorque: MOTOR_MAX_TORQUE,
  })
);

// Simulate and print positions
console.log("\nTick,WheelX,WheelY,ChassisX,ChassisY,WheelAngVel,RearAngVel");
for (let tick = 0; tick < MAX_TICKS; tick++) {
  world.step(DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);

  if (tick % 60 === 0) { // Print every second
    const wp = wheelBody.getPosition();
    const cp = chassisBody.getPosition();
    const angVel = wheelBody.getAngularVelocity();
    const rearAngVel = rearWheelBody.getAngularVelocity();
    console.log(`${tick},${wp.x.toFixed(4)},${wp.y.toFixed(4)},${cp.x.toFixed(4)},${cp.y.toFixed(4)},${angVel.toFixed(4)},${rearAngVel.toFixed(4)}`);
  }
}

const finalWheelX = wheelBody.getPosition().x;
console.log("\n=== Final Result ===");
console.log("Final wheel X:", finalWheelX.toFixed(4));
console.log("Distance traveled:", (finalWheelX - startX).toFixed(4));
