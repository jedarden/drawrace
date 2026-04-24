import { World, Vec2, Edge, Polygon, Circle, Box, WheelJoint, type Body, type Joint, type WheelJoint as WheelJointType } from "planck";
import { PHYSICS_VERSION } from "./version.js";
import { sfc32, hashSeed } from "./prng.js";
import { buildWheelBody, executeTwinWheelSwap } from "./swap.js";
import type { WheelSwap } from "./swap.js";
import { parseSurfaces, applyDrag, createSurfaceContactFilter, type SurfaceSegment } from "./surface.js";

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

export interface SimBody {
  x: number;
  y: number;
  angle: number;
}

export interface RaceSnapshot {
  wheel: SimBody;
  chassis: SimBody;
  rearWheel: SimBody;
  tick: number;
  elapsedMs: number;
  finished: boolean;
}

const DT = 1 / 60;
const VELOCITY_ITERATIONS = 8;
const POSITION_ITERATIONS = 3;
const MAX_TICKS = 60 * 180;
const WHEEL_DENSITY = 1.0;
const WHEEL_FRICTION = 0.8;
const WHEEL_RESTITUTION = 0.3;
const CHASSIS_DENSITY = 1.0;
const MOTOR_SPEED = 8;
const MOTOR_MAX_TORQUE = 40;
const SUSPENSION_FREQ_HZ = 4.0;
const SUSPENSION_DAMPING_RATIO = 0.7;

export class RaceSim {
  private world: World;
  private wheelBody: Body;
  private wheelJoint!: Joint;
  private chassisBody: Body;
  private rearWheelBody: Body;
  private rearWheelJoint!: Joint;
  private prng: ReturnType<typeof sfc32>;
  private tick = 0;
  private elapsedMs = 0;
  private finished = false;
  private finishX: number;
  private motorEnabled = false;
  private wheelSwapLog: WheelSwap[] = [];
  private surfaces: SurfaceSegment[];
  readonly track: TrackDef;

  constructor(
    track: TrackDef,
    wheelVertices: Array<{ x: number; y: number }>,
    seed?: number
  ) {
    this.track = track;
    const s = seed ?? hashSeed(track.id, "browser", 0);
    this.prng = sfc32(s);
    this.finishX = track.finish.pos[0];

    const [gx, gy] = track.world.gravity;
    this.world = new World({ x: gx, y: gy });

    // Build terrain
    const ground = this.world.createBody();
    const terrain = track.terrain;
    for (let i = 0; i < terrain.length - 1; i++) {
      ground.createFixture(
        Edge(Vec2(terrain[i][0], terrain[i][1]), Vec2(terrain[i + 1][0], terrain[i + 1][1])),
        { friction: 0.9, restitution: 0.0 }
      );
    }

    // Parse surfaces; register contact filter only when explicitly defined
    // (tracks without surfaces use Planck's default geometric-mean friction)
    const terrainMinX = terrain[0][0];
    const terrainMaxX = terrain[terrain.length - 1][0];
    this.surfaces = parseSurfaces(track.surfaces, terrainMinX, terrainMaxX);
    if (track.surfaces && Array.isArray(track.surfaces) && track.surfaces.length > 0) {
      this.world.on("pre-solve", createSurfaceContactFilter(ground, this.surfaces));
    }

    // Add obstacles
    if (track.obstacles) {
      for (const obs of track.obstacles) {
        const obsBody = this.world.createBody({
          position: Vec2(obs.pos[0], obs.pos[1]),
          angle: obs.angle ?? 0,
          type: "static",
        });
        if (obs.type === "box" && obs.size) {
          obsBody.createFixture(Box(obs.size[0] / 2, obs.size[1] / 2), {
            friction: obs.friction ?? 0.8, restitution: 0.0,
          });
        } else if (obs.type === "circle" && obs.radius) {
          obsBody.createFixture(Circle(obs.radius), {
            friction: obs.friction ?? 0.6, restitution: 0.0,
          });
        }
      }
    }

    // Wheel vertices → physics body
    // Strip trailing duplicate to prevent degenerate triangle in fan decomposition
    const wv = wheelVertices.length > 1 &&
      Math.hypot(
        wheelVertices[0].x - wheelVertices[wheelVertices.length - 1].x,
        wheelVertices[0].y - wheelVertices[wheelVertices.length - 1].y,
      ) < 1e-6
      ? wheelVertices.slice(0, -1)
      : wheelVertices;
    const wcX = wv.reduce((s, v) => s + v.x, 0) / wv.length;
    const wcY = wv.reduce((s, v) => s + v.y, 0) / wv.length;
    const wheelRadius = Math.max(...wv.map((v) => Math.hypot(v.x - wcX, v.y - wcY)));

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

    // Place wheel center below terrain surface; gravity [0,10] pushes up to rest on it
    const wheelSpawnY = terrainY - wheelRadius;

    // Front wheel (player-drawn)
    const wheelVerts = wv.map((v) => Vec2(v.x, v.y));
    this.wheelBody = this.world.createBody({
      position: Vec2(startX, wheelSpawnY),
      type: "dynamic",
    });
    if (wheelVerts.length <= 8) {
      this.wheelBody.createFixture(Polygon(wheelVerts), {
        density: WHEEL_DENSITY, friction: WHEEL_FRICTION, restitution: WHEEL_RESTITUTION,
      });
    } else {
      const cx = wheelVerts.reduce((s, v) => s + v.x, 0) / wheelVerts.length;
      const cy = wheelVerts.reduce((s, v) => s + v.y, 0) / wheelVerts.length;
      const center = Vec2(cx, cy);
      for (let i = 0; i < wheelVerts.length; i++) {
        const next = (i + 1) % wheelVerts.length;
        this.wheelBody.createFixture(Polygon([center, wheelVerts[i], wheelVerts[next]]), {
          density: WHEEL_DENSITY, friction: WHEEL_FRICTION, restitution: WHEEL_RESTITUTION,
        });
      }
    }

    // Chassis (lower Y = further from terrain in gravity-up convention)
    const chassisSpawnY = wheelSpawnY - 1.5;
    this.chassisBody = this.world.createBody({
      position: Vec2(startX, chassisSpawnY),
      type: "dynamic",
    });
    this.chassisBody.createFixture(Box(1.2, 0.4), {
      density: CHASSIS_DENSITY, friction: 0.5, restitution: 0.1,
    });

    // Rear wheel (drawn polygon — AWD, same shape as front)
    const rearSpawnX = startX - 0.9;
    const rearSpawnY = wheelSpawnY;
    this.rearWheelBody = buildWheelBody(this.world, wv.map((v) => [v.x, v.y] as [number, number]), rearSpawnX, rearSpawnY);

    // Front wheel joint (suspension + motor) — stored so swapWheel can rebind it
    const frontJoint = this.world.createJoint(
      WheelJoint({
        bodyA: this.chassisBody,
        bodyB: this.wheelBody,
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
    if (!frontJoint) throw new Error("Failed to create wheel joint");
    this.wheelJoint = frontJoint;

    // Initialize swap log with the initial wheel (swap_tick 0)
    const initialPoly = wv.map((v) => [v.x, v.y] as [number, number]);
    this.wheelSwapLog = [{ swap_tick: 0, polygon: initialPoly }];

    // Rear wheel joint (WheelJoint with suspension + motor — AWD)
    const rearJoint = this.world.createJoint(
      WheelJoint({
        bodyA: this.chassisBody,
        bodyB: this.rearWheelBody,
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
    if (!rearJoint) throw new Error("Failed to create rear wheel joint");
    this.rearWheelJoint = rearJoint;
  }

  swapWheel(vertices: Array<{ x: number; y: number }>): void {
    if (this.finished) return;
    const poly = vertices.map((v) => [v.x, v.y] as [number, number]);
    const result = executeTwinWheelSwap(
      this.world,
      this.chassisBody,
      this.wheelBody,
      this.wheelJoint,
      this.rearWheelBody,
      this.rearWheelJoint,
      poly,
      this.tick,
      this.wheelSwapLog,
    );
    this.wheelBody = result.newFrontBody;
    this.wheelJoint = result.newFrontJoint;
    this.rearWheelBody = result.newRearBody;
    this.rearWheelJoint = result.newRearJoint;
  }

  getSwapLog(): WheelSwap[] {
    return this.wheelSwapLog;
  }

  enableMotor(): void {
    this.motorEnabled = true;
  }

  step(): RaceSnapshot {
    if (this.finished || this.tick >= MAX_TICKS) {
      this.finished = true;
      return this.snapshot();
    }

    // Gravity always active; motor controlled separately
    if (!this.motorEnabled) {
      // Temporarily disable motor torque during countdown
      const joints = this.chassisBody.getJointList();
      let curr = joints;
      while (curr) {
        const j = curr.joint!;
        if (j.getType() === "wheel-joint") {
          (j as WheelJointType).setMaxMotorTorque(0);
        }
        curr = curr.next;
      }
    } else {
      const joints = this.chassisBody.getJointList();
      let curr = joints;
      while (curr) {
        const j = curr.joint!;
        if (j.getType() === "wheel-joint") {
          (j as WheelJointType).setMaxMotorTorque(MOTOR_MAX_TORQUE);
        }
        curr = curr.next;
      }
    }

    applyDrag(this.chassisBody, this.surfaces);
    this.world.step(DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    this.tick++;
    this.elapsedMs += DT * 1000;
    this.prng.next();

    const wp = this.wheelBody.getPosition();
    if (wp.x >= this.finishX) {
      this.finished = true;
    }

    return this.snapshot();
  }

  snapshot(): RaceSnapshot {
    const wp = this.wheelBody.getPosition();
    const cp = this.chassisBody.getPosition();
    const rp = this.rearWheelBody.getPosition();
    return {
      wheel: { x: wp.x, y: wp.y, angle: this.wheelBody.getAngle() },
      chassis: { x: cp.x, y: cp.y, angle: this.chassisBody.getAngle() },
      rearWheel: { x: rp.x, y: rp.y, angle: this.rearWheelBody.getAngle() },
      tick: this.tick,
      elapsedMs: this.elapsedMs,
      finished: this.finished,
    };
  }

  isFinished(): boolean {
    return this.finished;
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }
}

export { PHYSICS_VERSION, DT };
