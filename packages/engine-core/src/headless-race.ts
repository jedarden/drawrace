import { World, Vec2, Edge, Polygon, Circle, Box, WheelJoint, RevoluteJoint } from "planck";
import { PHYSICS_VERSION } from "./version.js";
import { sfc32, hashSeed } from "./prng.js";
import { InjectedClock } from "./clock.js";
import { parseSurfaces, applyDrag, createSurfaceContactFilter } from "./surface.js";
import { buildWheelBody } from "./swap.js";

export interface TrackDef {
  id: string;
  world: { gravity: [number, number]; pixelsPerMeter: number };
  terrain: [number, number][];
  obstacles?: Array<{
    type: string;
    pos: [number, number];
    size?: [number, number];
    radius?: number;
    angle?: number;
    friction?: number;
  }>;
  zones?: Array<{ id: string; x_start: number; x_end: number }>;
  ramps?: Array<{ zone: string; x_start: number; x_end: number }>;
  hazards?: Array<{ zone: string; type: string; x_start: number; x_end: number }>;
  surfaces?: unknown;
  start: { pos: [number, number]; facing: number };
  finish: { pos: [number, number]; width: number };
}

export interface WheelDef {
  vertices: [number, number][];
}

export interface HeadlessRaceInput {
  seed: number;
  track: TrackDef;
  wheel: WheelDef;
  playerId?: string;
  runIndex?: number;
}

export interface HeadlessRaceResult {
  finishTicks: number;
  finalX: number;
  streamHash: string;
  physicsVersion: number;
}

const DT = 1 / 60;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const MAX_TICKS = 60 * 180; // 3 minute DNF
const CHASSIS_DENSITY = 1.0;
const WHEEL_DENSITY = 1.0;
const WHEEL_FRICTION = 0.8;
const WHEEL_RESTITUTION = 0.3;
const REAR_WHEEL_RADIUS = 0.35;
const MOTOR_SPEED = 8;
const MOTOR_MAX_TORQUE = 40;
const SUSPENSION_FREQ_HZ = 4.0;
const SUSPENSION_DAMPING_RATIO = 0.7;

export function createHeadlessRace(
  input: HeadlessRaceInput
): HeadlessRaceResult {
  const { track, wheel } = input;
  const seed =
    input.seed ??
    hashSeed(track.id, input.playerId ?? "headless", input.runIndex ?? 0);
  const prng = sfc32(seed);
  const clock = new InjectedClock();

  const [gx, gy] = track.world.gravity;
  const world = new World({ x: gx, y: gy });

  // Build terrain as chain of edges on ground body
  const ground = world.createBody();
  const terrain = track.terrain;
  for (let i = 0; i < terrain.length - 1; i++) {
    ground.createFixture(
      Edge(Vec2(terrain[i][0], terrain[i][1]), Vec2(terrain[i + 1][0], terrain[i + 1][1])),
      { friction: 0.9, restitution: 0.0 }
    );
  }

  // Parse surfaces; register contact filter only when explicitly defined
  const terrainMinX = terrain[0][0];
  const terrainMaxX = terrain[terrain.length - 1][0];
  const surfaces = parseSurfaces(track.surfaces, terrainMinX, terrainMaxX);
  if (track.surfaces && Array.isArray(track.surfaces) && track.surfaces.length > 0) {
    world.on("pre-solve", createSurfaceContactFilter(ground, surfaces));
  }

  // Add obstacles
  if (track.obstacles) {
    for (const obs of track.obstacles) {
      const obsBody = world.createBody({
        position: Vec2(obs.pos[0], obs.pos[1]),
        angle: obs.angle ?? 0,
        type: "static",
      });
      if (obs.type === "box" && obs.size) {
        obsBody.createFixture(
          Box(obs.size[0] / 2, obs.size[1] / 2),
          { friction: obs.friction ?? 0.8, restitution: 0.0 }
        );
      } else if (obs.type === "circle" && obs.radius) {
        obsBody.createFixture(
          Circle(obs.radius),
          { friction: obs.friction ?? 0.6, restitution: 0.0 }
        );
      }
    }
  }

  // Strip trailing duplicate vertex
  const rawVerts = wheel.vertices;
  const wv = rawVerts.length > 1 &&
    Math.hypot(rawVerts[0][0] - rawVerts[rawVerts.length - 1][0],
               rawVerts[0][1] - rawVerts[rawVerts.length - 1][1]) < 1e-6
    ? rawVerts.slice(0, -1)
    : rawVerts;
  const wcX = wv.reduce((s, v) => s + v[0], 0) / wv.length;
  const wcY = wv.reduce((s, v) => s + v[1], 0) / wv.length;
  const wheelRadius = Math.max(...wv.map((v) => Math.hypot(v[0] - wcX, v[1] - wcY)));

  // Find terrain surface Y at start X by linear interpolation
  const startX = track.start.pos[0];
  const terrainPts = track.terrain;
  let terrainY = terrainPts[0][1];
  for (let i = 0; i < terrainPts.length - 1; i++) {
    if (terrainPts[i][0] <= startX && startX <= terrainPts[i + 1][0]) {
      const t = (startX - terrainPts[i][0]) / (terrainPts[i + 1][0] - terrainPts[i][0]);
      terrainY = terrainPts[i][1] + t * (terrainPts[i + 1][1] - terrainPts[i][1]);
      break;
    }
  }

  // Place wheel center just below terrain surface; gravity pushes it up to rest on surface
  const wheelSpawnY = terrainY - wheelRadius;

  // Front wheel (drawn polygon — AWD)
  const wheelBody = buildWheelBody(world, wv, startX, wheelSpawnY);

  // Chassis positioned below wheel
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

  // Rear wheel (drawn polygon — AWD, same shape as front)
  const rearWheelBody = buildWheelBody(world, wv, startX - 0.9, wheelSpawnY);

  // Front wheel joint (suspension + motor)
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

  // Rear wheel joint (suspension + motor — AWD)
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

  // Simulate
  const finishX = track.finish.pos[0];
  let ticks = 0;
  const hashAccum: number[] = [];

  for (ticks = 0; ticks < MAX_TICKS; ticks++) {
    applyDrag(chassisBody, surfaces);
    world.step(DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    clock.advance(DT * 1000);

    // Sample state for hash (deterministic: position + angle per tick)
    const wp = wheelBody.getPosition();
    const wa = wheelBody.getAngle();
    hashAccum.push(wp.x, wp.y, wa);

    // Consume one PRNG value per tick to keep stream aligned
    prng.next();

    // Check finish
    if (wp.x >= finishX) {
      break;
    }
  }

  const finalX = wheelBody.getPosition().x;
  const streamHash = computeStreamHash(hashAccum);

  return {
    finishTicks: ticks + 1,
    finalX,
    streamHash,
    physicsVersion: PHYSICS_VERSION,
  };
}

function computeStreamHash(samples: number[]): string {
  // FNV-1a over the float samples (deterministic across JS engines for same input)
  let h = 0x811c9dc5;
  const buf = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    buf[i] = samples[i];
  }
  const bytes = new Uint8Array(buf.buffer);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Re-export for convenience
export { PHYSICS_VERSION } from "./version.js";
export { sfc32, hashSeed } from "./prng.js";
export { InjectedClock } from "./clock.js";
export type { Clock } from "./clock.js";
