import { World, Vec2, Polygon, WheelJoint } from "planck";
import type { Body, Joint } from "planck";

export interface WheelSwap {
  swap_tick: number;
  polygon: [number, number][];
}

const WHEEL_DENSITY = 1.0;
const WHEEL_FRICTION = 2.5;  // Increased from 0.8 for better terrain grip while maintaining performance (bf-5fz89)
const WHEEL_RESTITUTION = 0.3;
const SUSPENSION_FREQ_HZ = 2.5;  // Softer suspension improves ground contact on irregular terrain
const SUSPENSION_DAMPING_RATIO = 0.7;
const MOTOR_SPEED = 8;
const MOTOR_MAX_TORQUE = 40;
/**
 * Reference radius the motor target is calibrated against. The motor asks for
 * MOTOR_SPEED rad/s at this radius and scales inversely with the actual wheel
 * radius, so every wheel gets the same linear surface speed
 * (MOTOR_SPEED * MOTOR_REF_RADIUS m/s) instead of top speed growing linearly
 * with radius (v = ω·r). Wheel choice then differentiates via bump/airtime
 * geometry, obstacle clearance and tooth-terrain interlock rather than raw
 * top speed (drawrace-d85f702c).
 */
export const MOTOR_REF_RADIUS = 0.5;
/** Floor against degenerate/near-zero polygons so the ratio stays finite. */
const MIN_EFFECTIVE_RADIUS = 0.05;

/**
 * Mean rolling radius = polygon perimeter / 2π — the physical rolling
 * circumference of the wheel, so v = ω·R is exactly distance travelled per
 * radian and equalizing ω·R across shapes equalizes linear top speed by
 * construction. (Max-vertex radius was rejected: it overestimates the rolling
 * circumference of spiky shapes — a triangle's corners, a star's points — so
 * those wheels got under-spun and lost the corner-strike grip that locomotes
 * them on flats; see packages/engine-core/scripts/radius-law-lab.ts and
 * diagnostic-wheel-spin.test.ts for the A/B evidence.)
 */
export function wheelRadiusOf(polygon: [number, number][]): number {
  const verts =
    polygon.length > 1 &&
    Math.hypot(polygon[0][0] - polygon[polygon.length - 1][0], polygon[0][1] - polygon[polygon.length - 1][1]) < 1e-6
      ? polygon.slice(0, -1)
      : polygon;
  let perimeter = 0;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return perimeter / (2 * Math.PI);
}

/**
 * Farthest-vertex distance from the vertex centroid — the wheel's physical
 * size, used for spawn clearance and layout. NOT the rolling radius: spiky
 * shapes reach farther than they roll. Motor targets must use wheelRadiusOf.
 */
export function wheelMaxExtent(polygon: [number, number][]): number {
  const verts =
    polygon.length > 1 &&
    Math.hypot(polygon[0][0] - polygon[polygon.length - 1][0], polygon[0][1] - polygon[polygon.length - 1][1]) < 1e-6
      ? polygon.slice(0, -1)
      : polygon;
  const cx = verts.reduce((s, q) => s + q[0], 0) / verts.length;
  const cy = verts.reduce((s, q) => s + q[1], 0) / verts.length;
  return Math.max(...verts.map((q) => Math.hypot(q[0] - cx, q[1] - cy)));
}

/** Motor speed (rad/s) giving a wheel of `radius` the reference linear speed. */
export function motorSpeedForRadius(radius: number): number {
  return MOTOR_SPEED * (MOTOR_REF_RADIUS / Math.max(radius, MIN_EFFECTIVE_RADIUS));
}

/** Motor speed (rad/s) giving `polygon` the reference linear speed. */
export function motorSpeedFor(polygon: [number, number][]): number {
  return motorSpeedForRadius(wheelRadiusOf(polygon));
}

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

  if (pv.length <= 12) {
    // Planck.js supports up to 12 vertices in a single Polygon fixture
    body.createFixture(Polygon(pv), {
      density: WHEEL_DENSITY,
      friction: WHEEL_FRICTION,
      restitution: WHEEL_RESTITUTION,
    });
  } else {
    // Fan-triangulate from centroid for >12 vertices
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
      motorSpeed: motorSpeedFor(newPolygon),
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
      motorSpeed: motorSpeedFor(newPolygon),
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
      motorSpeed: motorSpeedFor(newPolygon),
      maxMotorTorque: MOTOR_MAX_TORQUE,
    }),
  )!;

  swapLog.push({ swap_tick: swapTick, polygon: newPolygon });

  return { newFrontBody, newFrontJoint, newRearBody, newRearJoint };
}
