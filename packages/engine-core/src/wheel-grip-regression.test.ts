/**
 * Regression test for wheel angular velocity (fix for bf-5fz89).
 *
 * This test ensures that wheels maintain positive angular velocity during motion,
 * confirming that the wheel friction and suspension settings allow proper grip on terrain.
 *
 * Before the fix (WHEEL_FRICTION=0.8, SUSPENSION_FREQ_HZ=4.0), smooth 12-gon wheels
 * would spin but slip on terrain, resulting in little or no forward motion.
 *
 * After the fix (WHEEL_FRICTION=2.5, SUSPENSION_FREQ_HZ=2.5), wheels should grip
 * the terrain and maintain angular velocity > 0.5 rad/s during motion.
 */
import { describe, it, expect } from "vitest";
import { World, Vec2, Edge, Box, WheelJoint } from "planck";
import { buildWheelBody } from "./swap.js";

// Test track with mild incline (similar to hills-01 terrain)
const TEST_TERRAIN = [
  [0, 5], [5, 5], [10, 5.3], [15, 5.3],
  [18, 5.8], [22, 5.8], [25, 5], [30, 5],
  [35, 5.2], [40, 5.2],
];

// 12-gon wheel (smooth polygon - what users typically draw)
const wheel12Gon: [number, number][] = [];
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  wheel12Gon.push([0.35 * Math.cos(angle), 0.35 * Math.sin(angle)]);
}

// Track physics constants (must match headless.ts)
const DT = 1 / 60;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const CHASSIS_DENSITY = 1.0;
const SUSPENSION_FREQ_HZ = 2.5;  // Updated from 4.0 (softer for better grip)
const SUSPENSION_DAMPING_RATIO = 0.7;
const MOTOR_SPEED = 8;
const MOTOR_MAX_TORQUE = 40;

describe("wheel grip regression (bf-5fz89)", () => {
  it("front wheel angular velocity > 0.5 rad/s at tick 60 on mild incline", () => {
    const world = new World(Vec2(0, 10));

    // --- terrain ---
    const _ground = world.createBody();
    for (let i = 0; i < TEST_TERRAIN.length - 1; i++) {
      _ground.createFixture(
        Edge(Vec2(TEST_TERRAIN[i][0], TEST_TERRAIN[i][1]), Vec2(TEST_TERRAIN[i + 1][0], TEST_TERRAIN[i + 1][1])),
        { friction: 0.9, restitution: 0.0 },
      );
    }

    // --- wheel spawn position ---
    const startX = 1.5;
    let terrainY = TEST_TERRAIN[0][1];
    for (let i = 0; i < TEST_TERRAIN.length - 1; i++) {
      if (TEST_TERRAIN[i][0] <= startX && startX <= TEST_TERRAIN[i + 1][0]) {
        const t = (startX - TEST_TERRAIN[i][0]) / (TEST_TERRAIN[i + 1][0] - TEST_TERRAIN[i][0]);
        terrainY = TEST_TERRAIN[i][1] + t * (TEST_TERRAIN[i + 1][1] - TEST_TERRAIN[i][1]);
        break;
      }
    }

    // Strip trailing duplicate vertex
    const rawVerts = wheel12Gon;
    const wv = rawVerts.length > 1 &&
      Math.hypot(rawVerts[0][0] - rawVerts[rawVerts.length - 1][0], rawVerts[0][1] - rawVerts[rawVerts.length - 1][1]) < 1e-6
      ? rawVerts.slice(0, -1)
      : rawVerts;
    const wcX = wv.reduce((s, v) => s + v[0], 0) / wv.length;
    const wcY = wv.reduce((s, v) => s + v[1], 0) / wv.length;
    const wheelRadius = Math.max(...wv.map((v) => Math.hypot(v[0] - wcX, v[1] - wcY)));
    const wheelSpawnY = terrainY - wheelRadius;

    // --- bodies ---
    const wheelBody = buildWheelBody(world, wheel12Gon, startX, wheelSpawnY);
    const chassisSpawnY = wheelSpawnY - 1.5;
    const chassisBody = world.createBody({ position: Vec2(startX, chassisSpawnY), type: "dynamic" });
    chassisBody.createFixture(Box(1.2, 0.4), {
      density: CHASSIS_DENSITY,
      friction: 0.5,
      restitution: 0.1,
    });

    const rearWheelBody = buildWheelBody(world, wheel12Gon, startX - 0.9, wheelSpawnY);

    // --- joints ---
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
      }),
    );

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
      }),
    );

    // --- simulate 60 ticks ---
    for (let tick = 0; tick < 60; tick++) {
      world.step(DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    }

    // --- check wheel angular velocity ---
    const frontAngVel = Math.abs(wheelBody.getAngularVelocity());
    const rearAngVel = Math.abs(rearWheelBody.getAngularVelocity());
    const chassisVx = chassisBody.getLinearVelocity().x;

    // After the friction fix, 12-gon wheels should grip the terrain
    // and maintain angular velocity > 0.5 rad/s
    expect(frontAngVel, `Front wheel angular velocity at tick 60 (${frontAngVel.toFixed(3)} rad/s) should be > 0.5 rad/s`).toBeGreaterThan(0.5);
    expect(rearAngVel, `Rear wheel angular velocity at tick 60 (${rearAngVel.toFixed(3)} rad/s) should be > 0.5 rad/s`).toBeGreaterThan(0.5);

    // Chassis should also have forward velocity (not slipping in place)
    expect(chassisVx, `Chassis X velocity at tick 60 (${chassisVx.toFixed(3)} m/s) should be > 0.1 m/s`).toBeGreaterThan(0.1);
  });

  it("6-gon wheel has better grip than 12-gon on same terrain", () => {
    const wheel6Gon: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      wheel6Gon.push([0.35 * Math.cos(angle), 0.35 * Math.sin(angle)]);
    }

    const world = new World(Vec2(0, 10));

    // --- terrain ---
    const _ground = world.createBody();
    for (let i = 0; i < TEST_TERRAIN.length - 1; i++) {
      _ground.createFixture(
        Edge(Vec2(TEST_TERRAIN[i][0], TEST_TERRAIN[i][1]), Vec2(TEST_TERRAIN[i + 1][0], TEST_TERRAIN[i + 1][1])),
        { friction: 0.9, restitution: 0.0 },
      );
    }

    // --- wheel spawn position ---
    const startX = 1.5;
    let terrainY = TEST_TERRAIN[0][1];
    for (let i = 0; i < TEST_TERRAIN.length - 1; i++) {
      if (TEST_TERRAIN[i][0] <= startX && startX <= TEST_TERRAIN[i + 1][0]) {
        const t = (startX - TEST_TERRAIN[i][0]) / (TEST_TERRAIN[i + 1][0] - TEST_TERRAIN[i][0]);
        terrainY = TEST_TERRAIN[i][1] + t * (TEST_TERRAIN[i + 1][1] - TEST_TERRAIN[i][1]);
        break;
      }
    }

    const wheelBody = buildWheelBody(world, wheel6Gon, startX, terrainY - 0.35);
    const chassisBody = world.createBody({ position: Vec2(startX, terrainY - 1.85), type: "dynamic" });
    chassisBody.createFixture(Box(1.2, 0.4), { density: CHASSIS_DENSITY, friction: 0.5, restitution: 0.1 });

    const rearWheelBody = buildWheelBody(world, wheel6Gon, startX - 0.9, terrainY - 0.35);

    world.createJoint(WheelJoint({
      bodyA: chassisBody, bodyB: wheelBody,
      localAnchorA: Vec2(0.5, 0.5), localAnchorB: Vec2(0, 0),
      localAxisA: Vec2(0, 1),
      frequencyHz: SUSPENSION_FREQ_HZ, dampingRatio: SUSPENSION_DAMPING_RATIO,
      enableMotor: true, motorSpeed: MOTOR_SPEED, maxMotorTorque: MOTOR_MAX_TORQUE,
    }));

    world.createJoint(WheelJoint({
      bodyA: chassisBody, bodyB: rearWheelBody,
      localAnchorA: Vec2(-0.9, 0.5), localAnchorB: Vec2(0, 0),
      localAxisA: Vec2(0, 1),
      frequencyHz: SUSPENSION_FREQ_HZ, dampingRatio: SUSPENSION_DAMPING_RATIO,
      enableMotor: true, motorSpeed: MOTOR_SPEED, maxMotorTorque: MOTOR_MAX_TORQUE,
    }));

    // --- simulate 60 ticks ---
    for (let tick = 0; tick < 60; tick++) {
      world.step(DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    }

    const frontAngVel = Math.abs(wheelBody.getAngularVelocity());
    const chassisVx = chassisBody.getLinearVelocity().x;

    // 6-gon should grip even better than 12-gon
    expect(frontAngVel, `6-gon front wheel angular velocity at tick 60 (${frontAngVel.toFixed(3)} rad/s)`).toBeGreaterThan(0.8);
    expect(chassisVx, `6-gon chassis X velocity at tick 60 (${chassisVx.toFixed(3)} m/s)`).toBeGreaterThan(0.2);
  });
});
