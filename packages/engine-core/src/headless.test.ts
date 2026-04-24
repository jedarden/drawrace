import { describe, it, expect } from "vitest";
import { World, Vec2, Edge, Box, WheelJoint, RevoluteJoint, Circle } from "planck";
import { runHeadless, type MultiWheelInput } from "./headless.js";
import { createHeadlessRace, type TrackDef } from "./headless-race.js";
import { buildWheelBody, executeWheelSwap, type WheelSwap } from "./swap.js";

// Shared test track (matches golden.test.ts)
const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 5], [5, 5], [10, 5.3], [15, 5.3],
    [18, 5.8], [22, 5.8], [25, 5], [30, 5],
    [35, 5.2], [40, 5.2],
  ],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [39, 3.5], width: 0.2 },
};

// 8-vertex circle (fits in one Planck polygon fixture)
const CIRC_8: [number, number][] = [
  [0.4, 0], [0.283, 0.283], [0, 0.4], [-0.283, 0.283],
  [-0.4, 0], [-0.283, -0.283], [0, -0.4], [0.283, -0.283],
];

// Equilateral triangle (3 vertices — clearly different shape)
const TRI: [number, number][] = [
  [0, -0.4], [0.346, 0.2], [-0.346, 0.2],
];

const SEED = 42;

// ---------------------------------------------------------------------------
// swap.ts — low-level unit tests
// ---------------------------------------------------------------------------

describe("buildWheelBody", () => {
  it("creates a dynamic body at the requested spawn position", () => {
    const world = new World(Vec2(0, 10));
    const body = buildWheelBody(world, CIRC_8, 3.0, 1.5);
    expect(body.getPosition().x).toBeCloseTo(3.0, 12);
    expect(body.getPosition().y).toBeCloseTo(1.5, 12);
    expect(body.isDynamic()).toBe(true);
  });

  it("strips trailing duplicate vertex and still creates fixtures", () => {
    const polyWithDupe: [number, number][] = [...CIRC_8, CIRC_8[0]];
    const world = new World(Vec2(0, 10));
    const body = buildWheelBody(world, polyWithDupe, 0, 0);
    expect(body.getFixtureList()).not.toBeNull();
  });

  it("fan-triangulates polygons with >8 vertices", () => {
    // 16-vertex circle — must use fan triangulation path
    const circ16: [number, number][] = Array.from({ length: 16 }, (_, i) => {
      const a = (2 * Math.PI * i) / 16;
      return [Math.round(0.5 * Math.cos(a) * 1000) / 1000, Math.round(0.5 * Math.sin(a) * 1000) / 1000];
    });
    const world = new World(Vec2(0, 10));
    const body = buildWheelBody(world, circ16, 0, 0);
    expect(body.isDynamic()).toBe(true);
    expect(body.getFixtureList()).not.toBeNull();
  });
});

describe("executeWheelSwap", () => {
  function setupMinimalWorld() {
    const world = new World(Vec2(0, 10));
    // Ground
    const ground = world.createBody();
    ground.createFixture(Edge(Vec2(-100, 5), Vec2(100, 5)), { friction: 0.9, restitution: 0 });

    const wheelBody = buildWheelBody(world, CIRC_8, 1.5, 3.0);

    const chassisBody = world.createBody({ position: Vec2(1.5, 1.5), type: "dynamic" });
    chassisBody.createFixture(Box(1.2, 0.4), { density: 2.0, friction: 0.5, restitution: 0.1 });

    const rearBody = world.createBody({ position: Vec2(0.6, 3.0), type: "dynamic" });
    rearBody.createFixture(Circle(0.35), { density: 1.0, friction: 0.8, restitution: 0.3 });

    const wheelJoint = world.createJoint(
      WheelJoint({
        bodyA: chassisBody, bodyB: wheelBody,
        localAnchorA: Vec2(0.5, 0.5), localAnchorB: Vec2(0, 0),
        localAxisA: Vec2(0, 1),
        frequencyHz: 4.0, dampingRatio: 0.7,
        enableMotor: true, motorSpeed: 8, maxMotorTorque: 40,
      }),
    )!;

    world.createJoint(
      RevoluteJoint({
        bodyA: chassisBody, bodyB: rearBody,
        localAnchorA: Vec2(-0.9, 0.5), localAnchorB: Vec2(0, 0),
        enableMotor: false,
      }),
    );

    return { world, wheelBody, chassisBody, wheelJoint };
  }

  it("position continuity: new wheel spawns at old wheel position (± 1e-9)", () => {
    const { world, wheelBody, chassisBody, wheelJoint } = setupMinimalWorld();

    // Warm up with 30 steps so the wheel is actually moving
    for (let i = 0; i < 30; i++) world.step(1 / 60, 8, 3);

    const preX = wheelBody.getPosition().x;
    const preY = wheelBody.getPosition().y;

    const swapLog: WheelSwap[] = [];
    const { newWheelBody } = executeWheelSwap(
      world, chassisBody, wheelBody, wheelJoint, TRI, 30, swapLog,
    );

    expect(newWheelBody.getPosition().x).toBeCloseTo(preX, 9);
    expect(newWheelBody.getPosition().y).toBeCloseTo(preY, 9);
  });

  it("velocity handoff: new wheel linear velocity equals chassis linear velocity", () => {
    const { world, wheelBody, chassisBody, wheelJoint } = setupMinimalWorld();

    for (let i = 0; i < 30; i++) world.step(1 / 60, 8, 3);

    const cvx = chassisBody.getLinearVelocity().x;
    const cvy = chassisBody.getLinearVelocity().y;

    const swapLog: WheelSwap[] = [];
    const { newWheelBody } = executeWheelSwap(
      world, chassisBody, wheelBody, wheelJoint, TRI, 30, swapLog,
    );

    expect(newWheelBody.getLinearVelocity().x).toBeCloseTo(cvx, 12);
    expect(newWheelBody.getLinearVelocity().y).toBeCloseTo(cvy, 12);
  });

  it("new wheel angular velocity is zero after swap", () => {
    const { world, wheelBody, chassisBody, wheelJoint } = setupMinimalWorld();
    for (let i = 0; i < 30; i++) world.step(1 / 60, 8, 3);

    const swapLog: WheelSwap[] = [];
    const { newWheelBody } = executeWheelSwap(
      world, chassisBody, wheelBody, wheelJoint, TRI, 30, swapLog,
    );

    expect(newWheelBody.getAngularVelocity()).toBeCloseTo(0, 12);
  });

  it("appends to swapLog with correct tick and polygon", () => {
    const { world, wheelBody, chassisBody, wheelJoint } = setupMinimalWorld();
    for (let i = 0; i < 10; i++) world.step(1 / 60, 8, 3);

    const swapLog: WheelSwap[] = [];
    executeWheelSwap(world, chassisBody, wheelBody, wheelJoint, TRI, 10, swapLog);

    expect(swapLog).toHaveLength(1);
    expect(swapLog[0].swap_tick).toBe(10);
    expect(swapLog[0].polygon).toEqual(TRI);
  });
});

// ---------------------------------------------------------------------------
// headless.ts — integration tests
// ---------------------------------------------------------------------------

describe("runHeadless", () => {
  it("swap at tick 0 produces identical result to createHeadlessRace", () => {
    const singleResult = createHeadlessRace({
      seed: SEED,
      track: TEST_TRACK,
      wheel: { vertices: CIRC_8 },
    });

    const multiResult = runHeadless({
      seed: SEED,
      track: TEST_TRACK,
      wheels: [{ swap_tick: 0, polygon: CIRC_8 }],
    });

    expect(multiResult.finishTicks).toBe(singleResult.finishTicks);
    expect(multiResult.streamHash).toBe(singleResult.streamHash);
    expect(multiResult.physicsVersion).toBe(singleResult.physicsVersion);
  });

  it("rejects empty wheels array", () => {
    expect(() =>
      runHeadless({ seed: SEED, track: TEST_TRACK, wheels: [] }),
    ).toThrow();
  });

  it("rejects non-zero swap_tick on first wheel", () => {
    expect(() =>
      runHeadless({
        seed: SEED,
        track: TEST_TRACK,
        wheels: [{ swap_tick: 5, polygon: CIRC_8 }],
      }),
    ).toThrow();
  });

  it("produces a valid result for a 2-wheel run (circle → triangle)", () => {
    const input: MultiWheelInput = {
      seed: SEED,
      track: TEST_TRACK,
      wheels: [
        { swap_tick: 0, polygon: CIRC_8 },
        { swap_tick: 60, polygon: TRI },
      ],
    };
    const result = runHeadless(input);
    expect(result.finishTicks).toBeGreaterThan(0);
    expect(result.streamHash).toMatch(/^[0-9a-f]{8}$/);
    expect(result.physicsVersion).toBeGreaterThan(0);
  });

  it("100/100 identical streamHash for a seeded 5-swap run (determinism)", () => {
    const wheels: WheelSwap[] = [
      { swap_tick: 0, polygon: CIRC_8 },
      { swap_tick: 60, polygon: TRI },
      { swap_tick: 120, polygon: CIRC_8 },
      { swap_tick: 180, polygon: TRI },
      { swap_tick: 240, polygon: CIRC_8 },
    ];
    const input: MultiWheelInput = { seed: SEED, track: TEST_TRACK, wheels };

    const hashes: string[] = [];
    for (let i = 0; i < 100; i++) {
      hashes.push(runHeadless(input).streamHash);
    }

    const first = hashes[0];
    for (let i = 1; i < hashes.length; i++) {
      expect(hashes[i]).toBe(first);
    }
  });

  it("out-of-order wheels array is sorted and applied correctly (same hash as sorted input)", () => {
    const sortedInput: MultiWheelInput = {
      seed: SEED,
      track: TEST_TRACK,
      wheels: [
        { swap_tick: 0, polygon: CIRC_8 },
        { swap_tick: 60, polygon: TRI },
        { swap_tick: 120, polygon: CIRC_8 },
      ],
    };
    const unsortedInput: MultiWheelInput = {
      seed: SEED,
      track: TEST_TRACK,
      wheels: [
        { swap_tick: 0, polygon: CIRC_8 },
        { swap_tick: 120, polygon: CIRC_8 },  // intentionally out of order
        { swap_tick: 60, polygon: TRI },
      ],
    };

    expect(runHeadless(sortedInput).streamHash).toBe(runHeadless(unsortedInput).streamHash);
  });
});
