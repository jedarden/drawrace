import { World, Vec2, Edge, Circle, Box, WheelJoint, type Joint } from "planck";
import { PHYSICS_VERSION } from "./version.js";
import { sfc32 } from "./prng.js";
import { InjectedClock } from "./clock.js";
import { type TrackDef, type HeadlessRaceResult } from "./headless-race.js";
import { buildWheelBody, executeTwinWheelSwap, type WheelSwap } from "./swap.js";
import { parseSurfaces, applyDrag, createSurfaceContactFilter } from "./surface.js";

export type { WheelSwap };

export interface MultiWheelInput {
  /** wheels[0].swap_tick must be 0 (initial spawn); remaining entries are mid-race swaps */
  wheels: WheelSwap[];
  track: TrackDef;
  seed: number;
}

const DT = 1 / 60;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const MAX_TICKS = 60 * 180; // 3-minute DNF ceiling
const CHASSIS_DENSITY = 2.0;
const SUSPENSION_FREQ_HZ = 4.0;
const SUSPENSION_DAMPING_RATIO = 0.7;
const MOTOR_SPEED = 8;
const MOTOR_MAX_TORQUE = 40;

export function runHeadless(input: MultiWheelInput): HeadlessRaceResult {
  const { track, wheels, seed } = input;

  if (wheels.length === 0) throw new Error("wheels must not be empty");
  if (wheels[0].swap_tick !== 0) throw new Error("wheels[0].swap_tick must be 0");

  // Swaps scheduled after tick 0, sorted ascending
  const pendingSwaps = wheels.slice(1).sort((a, b) => a.swap_tick - b.swap_tick);
  let swapIdx = 0;

  const prng = sfc32(seed);
  const clock = new InjectedClock();

  const [gx, gy] = track.world.gravity;
  const world = new World({ x: gx, y: gy });

  // --- terrain ---
  const ground = world.createBody();
  const terrain = track.terrain;
  for (let i = 0; i < terrain.length - 1; i++) {
    ground.createFixture(
      Edge(Vec2(terrain[i][0], terrain[i][1]), Vec2(terrain[i + 1][0], terrain[i + 1][1])),
      { friction: 0.9, restitution: 0.0 },
    );
  }

  // --- surface contact filter + drag ---
  // Only register contact filter when surfaces are explicitly defined
  const terrainMinX = terrain[0][0];
  const terrainMaxX = terrain[terrain.length - 1][0];
  const surfaces = parseSurfaces(track.surfaces, terrainMinX, terrainMaxX);
  if (track.surfaces && Array.isArray(track.surfaces) && track.surfaces.length > 0) {
    world.on("pre-solve", createSurfaceContactFilter(ground, surfaces));
  }

  // --- obstacles ---
  if (track.obstacles) {
    for (const obs of track.obstacles) {
      const ob = world.createBody({
        position: Vec2(obs.pos[0], obs.pos[1]),
        angle: obs.angle ?? 0,
        type: "static",
      });
      if (obs.type === "box" && obs.size) {
        ob.createFixture(Box(obs.size[0] / 2, obs.size[1] / 2), {
          friction: obs.friction ?? 0.8,
          restitution: 0.0,
        });
      } else if (obs.type === "circle" && obs.radius) {
        ob.createFixture(Circle(obs.radius), {
          friction: obs.friction ?? 0.6,
          restitution: 0.0,
        });
      }
    }
  }

  // --- terrain Y at start X ---
  const startX = track.start.pos[0];
  const tp = track.terrain;
  let terrainY = tp[0][1];
  for (let i = 0; i < tp.length - 1; i++) {
    if (tp[i][0] <= startX && startX <= tp[i + 1][0]) {
      const t = (startX - tp[i][0]) / (tp[i + 1][0] - tp[i][0]);
      terrainY = tp[i][1] + t * (tp[i + 1][1] - tp[i][1]);
      break;
    }
  }

  // --- initial wheel spawn position (mirrors headless-race.ts exactly) ---
  const initialPoly = wheels[0].polygon;
  const rawVerts = initialPoly;
  const wv =
    rawVerts.length > 1 &&
    Math.hypot(rawVerts[0][0] - rawVerts[rawVerts.length - 1][0], rawVerts[0][1] - rawVerts[rawVerts.length - 1][1]) < 1e-6
      ? rawVerts.slice(0, -1)
      : rawVerts;
  const wcX = wv.reduce((s, v) => s + v[0], 0) / wv.length;
  const wcY = wv.reduce((s, v) => s + v[1], 0) / wv.length;
  const wheelRadius = Math.max(...wv.map((v) => Math.hypot(v[0] - wcX, v[1] - wcY)));
  const wheelSpawnY = terrainY - wheelRadius;

  // --- bodies ---
  let wheelBody = buildWheelBody(world, initialPoly, startX, wheelSpawnY);

  const chassisSpawnY = wheelSpawnY - 1.5;
  const chassisBody = world.createBody({ position: Vec2(startX, chassisSpawnY), type: "dynamic" });
  chassisBody.createFixture(Box(1.2, 0.4), {
    density: CHASSIS_DENSITY,
    friction: 0.5,
    restitution: 0.1,
  });

  let rearWheelBody = buildWheelBody(world, initialPoly, startX - 0.9, wheelSpawnY);

  // --- joints ---
  let wheelJoint: Joint = world.createJoint(
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
  )!;

  let rearWheelJoint: Joint = world.createJoint(
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
  )!;

  const swapLog: WheelSwap[] = [{ swap_tick: 0, polygon: initialPoly }];
  const finishX = track.finish.pos[0];
  let ticks = 0;
  const hashAccum: number[] = [];

  for (ticks = 0; ticks < MAX_TICKS; ticks++) {
    applyDrag(chassisBody, surfaces);
    world.step(DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    clock.advance(DT * 1000);

    const currentTick = ticks + 1;

    // Apply any swap scheduled exactly at this tick
    while (swapIdx < pendingSwaps.length && pendingSwaps[swapIdx].swap_tick === currentTick) {
      const swap = pendingSwaps[swapIdx];
      const res = executeTwinWheelSwap(
        world,
        chassisBody,
        wheelBody,
        wheelJoint,
        rearWheelBody,
        rearWheelJoint,
        swap.polygon,
        swap.swap_tick,
        swapLog,
      );
      wheelBody = res.newFrontBody;
      wheelJoint = res.newFrontJoint;
      rearWheelBody = res.newRearBody;
      rearWheelJoint = res.newRearJoint;
      swapIdx++;
    }

    // Sample wheel state for deterministic hash
    const wp = wheelBody.getPosition();
    const wa = wheelBody.getAngle();
    hashAccum.push(wp.x, wp.y, wa);

    prng.next();

    if (wp.x >= finishX) break;
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
  let h = 0x811c9dc5;
  const buf = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) buf[i] = samples[i];
  const bytes = new Uint8Array(buf.buffer);
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
