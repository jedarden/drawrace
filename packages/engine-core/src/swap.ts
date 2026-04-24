import { World, Vec2, Polygon, WheelJoint } from "planck";
import type { Body, Joint } from "planck";

export interface WheelSwap {
  swap_tick: number;
  polygon: [number, number][];
}

const WHEEL_DENSITY = 1.0;
const WHEEL_FRICTION = 0.8;
const WHEEL_RESTITUTION = 0.3;
const SUSPENSION_FREQ_HZ = 4.0;
const SUSPENSION_DAMPING_RATIO = 0.7;
const MOTOR_SPEED = 8;
const MOTOR_MAX_TORQUE = 40;

export function buildWheelBody(
  world: World,
  polygon: [number, number][],
  spawnX: number,
  spawnY: number,
): Body {
  // Strip trailing duplicate vertex (closed-loop artefact)
  const raw = polygon;
  const verts =
    raw.length > 1 &&
    Math.hypot(raw[0][0] - raw[raw.length - 1][0], raw[0][1] - raw[raw.length - 1][1]) < 1e-6
      ? raw.slice(0, -1)
      : raw;

  const body = world.createBody({ position: Vec2(spawnX, spawnY), type: "dynamic" });
  const pv = verts.map((v) => Vec2(v[0], v[1]));

  if (pv.length <= 8) {
    body.createFixture(Polygon(pv), {
      density: WHEEL_DENSITY,
      friction: WHEEL_FRICTION,
      restitution: WHEEL_RESTITUTION,
    });
  } else {
    // Fan-triangulate from centroid for >8 vertices
    const cx = pv.reduce((s, v) => s + v.x, 0) / pv.length;
    const cy = pv.reduce((s, v) => s + v.y, 0) / pv.length;
    const center = Vec2(cx, cy);
    for (let i = 0; i < pv.length; i++) {
      const next = (i + 1) % pv.length;
      body.createFixture(Polygon([center, pv[i], pv[next]]), {
        density: WHEEL_DENSITY,
        friction: WHEEL_FRICTION,
        restitution: WHEEL_RESTITUTION,
      });
    }
  }

  return body;
}

export interface SwapResult {
  newWheelBody: Body;
  newWheelJoint: Joint;
}

export interface TwinSwapResult {
  newFrontBody: Body;
  newFrontJoint: Joint;
  newRearBody: Body;
  newRearJoint: Joint;
}

export function executeWheelSwap(
  world: World,
  chassisBody: Body,
  oldWheelBody: Body,
  oldWheelJoint: Joint,
  newPolygon: [number, number][],
  swapTick: number,
  swapLog: WheelSwap[],
): SwapResult {
  // Capture values before destroying bodies (Vec2 refs may be invalidated after destroy)
  const px = oldWheelBody.getPosition().x;
  const py = oldWheelBody.getPosition().y;
  const cvx = chassisBody.getLinearVelocity().x;
  const cvy = chassisBody.getLinearVelocity().y;

  // Destroy old joint first, then body
  world.destroyJoint(oldWheelJoint);
  world.destroyBody(oldWheelBody);

  // Spawn new wheel at old wheel's world position
  const newWheelBody = buildWheelBody(world, newPolygon, px, py);
  // Carry chassis linear velocity; reset angular velocity (new moment of inertia)
  newWheelBody.setLinearVelocity(Vec2(cvx, cvy));
  newWheelBody.setAngularVelocity(0);

  // Rebind WheelJoint with identical suspension/damping/motor params
  const newWheelJoint = world.createJoint(
    WheelJoint({
      bodyA: chassisBody,
      bodyB: newWheelBody,
      localAnchorA: Vec2(0.5, 0.5),
      localAnchorB: Vec2(0, 0),
      localAxisA: Vec2(0, 1),
      frequencyHz: SUSPENSION_FREQ_HZ,
      dampingRatio: SUSPENSION_DAMPING_RATIO,
      enableMotor: true,
      motorSpeed: MOTOR_SPEED,
      maxMotorTorque: MOTOR_MAX_TORQUE,
    }),
  )!;

  swapLog.push({ swap_tick: swapTick, polygon: newPolygon });

  return { newWheelBody, newWheelJoint };
}

const REAR_LOCAL_ANCHOR_A = Vec2(-0.9, 0.5);

export function executeTwinWheelSwap(
  world: World,
  chassisBody: Body,
  oldFrontBody: Body,
  oldFrontJoint: Joint,
  oldRearBody: Body,
  oldRearJoint: Joint,
  newPolygon: [number, number][],
  swapTick: number,
  swapLog: WheelSwap[],
): TwinSwapResult {
  // Capture chassis velocity before any destruction
  const cvx = chassisBody.getLinearVelocity().x;
  const cvy = chassisBody.getLinearVelocity().y;

  // Front axle swap
  const frontPx = oldFrontBody.getPosition().x;
  const frontPy = oldFrontBody.getPosition().y;
  world.destroyJoint(oldFrontJoint);
  world.destroyBody(oldFrontBody);
  const newFrontBody = buildWheelBody(world, newPolygon, frontPx, frontPy);
  newFrontBody.setLinearVelocity(Vec2(cvx, cvy));
  newFrontBody.setAngularVelocity(0);
  const newFrontJoint = world.createJoint(
    WheelJoint({
      bodyA: chassisBody,
      bodyB: newFrontBody,
      localAnchorA: Vec2(0.5, 0.5),
      localAnchorB: Vec2(0, 0),
      localAxisA: Vec2(0, 1),
      frequencyHz: SUSPENSION_FREQ_HZ,
      dampingRatio: SUSPENSION_DAMPING_RATIO,
      enableMotor: true,
      motorSpeed: MOTOR_SPEED,
      maxMotorTorque: MOTOR_MAX_TORQUE,
    }),
  )!;

  // Rear axle swap
  const rearPx = oldRearBody.getPosition().x;
  const rearPy = oldRearBody.getPosition().y;
  world.destroyJoint(oldRearJoint);
  world.destroyBody(oldRearBody);
  const newRearBody = buildWheelBody(world, newPolygon, rearPx, rearPy);
  newRearBody.setLinearVelocity(Vec2(cvx, cvy));
  newRearBody.setAngularVelocity(0);
  const newRearJoint = world.createJoint(
    WheelJoint({
      bodyA: chassisBody,
      bodyB: newRearBody,
      localAnchorA: REAR_LOCAL_ANCHOR_A,
      localAnchorB: Vec2(0, 0),
      localAxisA: Vec2(0, 1),
      frequencyHz: SUSPENSION_FREQ_HZ,
      dampingRatio: SUSPENSION_DAMPING_RATIO,
      enableMotor: true,
      motorSpeed: MOTOR_SPEED,
      maxMotorTorque: MOTOR_MAX_TORQUE,
    }),
  )!;

  swapLog.push({ swap_tick: swapTick, polygon: newPolygon });

  return { newFrontBody, newFrontJoint, newRearBody, newRearJoint };
}
