import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  World,
  Vec2,
  Edge,
  Box,
  WheelJoint,
  RevoluteJoint,
  Circle,
} from "planck";
import {
  createHeadlessRace,
  type TrackDef,
  type WheelDef,
} from "./headless-race.js";
import { runHeadless } from "./headless.js";
import { buildWheelBody, executeWheelSwap, type WheelSwap } from "./swap.js";
import { PHYSICS_VERSION } from "./version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TEST_TRACK: TrackDef = {
  id: "hills-01",
  world: { gravity: [0, 10], pixelsPerMeter: 30 },
  terrain: [
    [0, 5],
    [5, 5],
    [10, 5.3],
    [15, 5.3],
    [18, 5.8],
    [22, 5.8],
    [25, 5],
    [30, 5],
    [35, 5.2],
    [40, 5.2],
  ],
  start: { pos: [1.5, 3.5], facing: 1 },
  finish: { pos: [39, 3.5], width: 0.2 },
};

// ---------------------------------------------------------------------------
// Unified golden file types (§Testing 3 Layer 2)
// ---------------------------------------------------------------------------

interface SingleWheelGolden {
  id: string;
  seed: number;
  trackId: string;
  wheel: WheelDef;
  finishTicks: number;
  finalX: number;
  streamHash: string;
  physicsVersion: number;
}

interface MultiWheelGolden {
  id: string;
  seed: number;
  trackId: string;
  wheels: WheelSwap[];
  finishTicks?: number;
  finalX?: number;
  streamHash?: string;
  structuralReject?: boolean;
  rejectReason?: string;
  physicsVersion: number;
}

type GoldenEntry = SingleWheelGolden | MultiWheelGolden;

interface GoldenFile {
  physicsVersion: number;
  goldens: GoldenEntry[];
}

function isSingleWheel(g: GoldenEntry): g is SingleWheelGolden {
  return "wheel" in g;
}

function isMultiWheel(g: GoldenEntry): g is MultiWheelGolden {
  return "wheels" in g;
}

// ---------------------------------------------------------------------------
// Swap golden file types (legacy swaps.json — kept for backwards compatibility)
// ---------------------------------------------------------------------------

interface SwapGoldenFile {
  physicsVersion: number;
  swapGoldens: Array<{
    id: string;
    seed: number;
    trackId: string;
    wheels: WheelSwap[];
    finishTicks: number;
    finalX: number;
    streamHash: string;
    physicsVersion: number;
  }>;
}

function loadGoldens(): GoldenFile {
  const path = join(__dirname, "..", "golden", "wheels.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as GoldenFile;
}

function loadSwapGoldens(): SwapGoldenFile {
  const path = join(__dirname, "..", "golden", "swaps.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as SwapGoldenFile;
}

// ---------------------------------------------------------------------------
// Helper: run simulation up to a specific tick and return wheel x,y position.
// Used by swap-position-continuity assertions.
// Mirrors headless.ts physics setup (no surface filter) for determinism.
// ---------------------------------------------------------------------------

function captureWheelPositionAtTick(
  wheels: WheelSwap[],
  seed: number,
  stopTick: number,
): { x: number; y: number } {
  const track = TEST_TRACK;
  const [gx, gy] = track.world.gravity;
  const world = new World({ x: gx, y: gy });

  const ground = world.createBody();
  const terrain = track.terrain;
  for (let i = 0; i < terrain.length - 1; i++) {
    ground.createFixture(
      Edge(
        Vec2(terrain[i][0], terrain[i][1]),
        Vec2(terrain[i + 1][0], terrain[i + 1][1]),
      ),
      { friction: 0.9, restitution: 0.0 },
    );
  }

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

  const initialPoly = wheels[0].polygon;
  const rawVerts = initialPoly;
  const wv =
    rawVerts.length > 1 &&
    Math.hypot(
      rawVerts[0][0] - rawVerts[rawVerts.length - 1][0],
      rawVerts[0][1] - rawVerts[rawVerts.length - 1][1],
    ) < 1e-6
      ? rawVerts.slice(0, -1)
      : rawVerts;
  const wcX = wv.reduce((s, v) => s + v[0], 0) / wv.length;
  const wcY = wv.reduce((s, v) => s + v[1], 0) / wv.length;
  const wheelRadius = Math.max(...wv.map((v) => Math.hypot(v[0] - wcX, v[1] - wcY)));
  const wheelSpawnY = terrainY - wheelRadius;

  let wheelBody = buildWheelBody(world, initialPoly, startX, wheelSpawnY);

  const chassisSpawnY = wheelSpawnY - 1.5;
  const chassisBody = world.createBody({
    position: Vec2(startX, chassisSpawnY),
    type: "dynamic",
  });
  chassisBody.createFixture(Box(1.2, 0.4), {
    density: 2.0,
    friction: 0.5,
    restitution: 0.1,
  });

  const rearWheelBody = world.createBody({
    position: Vec2(startX - 0.9, wheelSpawnY),
    type: "dynamic",
  });
  rearWheelBody.createFixture(Circle(0.35), {
    density: 1.0,
    friction: 0.8,
    restitution: 0.3,
  });

  let wheelJoint = world.createJoint(
    WheelJoint({
      bodyA: chassisBody,
      bodyB: wheelBody,
      localAnchorA: Vec2(0.5, 0.5),
      localAnchorB: Vec2(0, 0),
      localAxisA: Vec2(0, 1),
      frequencyHz: 4.0,
      dampingRatio: 0.7,
      enableMotor: true,
      motorSpeed: 8,
      maxMotorTorque: 40,
    }),
  )!;

  world.createJoint(
    RevoluteJoint({
      bodyA: chassisBody,
      bodyB: rearWheelBody,
      localAnchorA: Vec2(-0.9, 0.5),
      localAnchorB: Vec2(0, 0),
      enableMotor: false,
    }),
  );

  const pendingSwaps = wheels.slice(1).sort((a, b) => a.swap_tick - b.swap_tick);
  let swapIdx = 0;
  const swapLog: WheelSwap[] = [{ swap_tick: 0, polygon: initialPoly }];

  for (let tick = 0; tick < stopTick; tick++) {
    world.step(1 / 60, 8, 3);
    const currentTick = tick + 1;
    while (
      swapIdx < pendingSwaps.length &&
      pendingSwaps[swapIdx].swap_tick === currentTick
    ) {
      const res = executeWheelSwap(
        world,
        chassisBody,
        wheelBody,
        wheelJoint,
        pendingSwaps[swapIdx].polygon,
        pendingSwaps[swapIdx].swap_tick,
        swapLog,
      );
      wheelBody = res.newWheelBody;
      wheelJoint = res.newWheelJoint;
      swapIdx++;
    }
  }

  const pos = wheelBody.getPosition();
  return { x: pos.x, y: pos.y };
}

// ---------------------------------------------------------------------------
// Layer 2 — Single-wheel deterministic physics goldens
// ---------------------------------------------------------------------------

describe("Physics golden (Layer 2) — single wheel", () => {
  it("produces identical streamHash across 100 consecutive runs", () => {
    const goldenFile = loadGoldens();
    const entry = goldenFile.goldens.find(isSingleWheel)!;
    expect(entry).toBeDefined();

    const results: string[] = [];
    for (let i = 0; i < 100; i++) {
      const result = createHeadlessRace({
        seed: entry.seed,
        track: TEST_TRACK,
        wheel: entry.wheel,
      });
      results.push(result.streamHash);
    }
    const first = results[0];
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(first);
    }
  });

  it("matches pinned golden values from golden/wheels.json (single-wheel entries)", () => {
    const goldenFile = loadGoldens();

    expect(goldenFile.physicsVersion).toBe(PHYSICS_VERSION);

    const singleEntries = goldenFile.goldens.filter(isSingleWheel);
    expect(singleEntries.length).toBeGreaterThan(0);

    for (const golden of singleEntries) {
      const result = createHeadlessRace({
        seed: golden.seed,
        track: TEST_TRACK,
        wheel: golden.wheel,
      });
      expect(result.streamHash, `streamHash mismatch for ${golden.id}`).toBe(
        golden.streamHash,
      );
      expect(result.finishTicks, `finishTicks mismatch for ${golden.id}`).toBe(
        golden.finishTicks,
      );
      expect(result.physicsVersion).toBe(golden.physicsVersion);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — Multi-wheel (swap) goldens from unified wheels.json
// ---------------------------------------------------------------------------

describe("Physics golden (Layer 2) — swap scenarios (unified wheels.json)", () => {
  it("matches all pinned non-structural-reject multi-wheel entries in golden/wheels.json", () => {
    const goldenFile = loadGoldens();
    expect(goldenFile.physicsVersion).toBe(PHYSICS_VERSION);

    const multiEntries = goldenFile.goldens.filter(
      (g): g is MultiWheelGolden =>
        isMultiWheel(g) && g.structuralReject !== true,
    );
    expect(multiEntries.length).toBeGreaterThan(0);

    for (const golden of multiEntries) {
      expect(golden.streamHash, `streamHash missing for ${golden.id}`).toBeDefined();
      expect(golden.finishTicks, `finishTicks missing for ${golden.id}`).toBeDefined();

      const result = runHeadless({
        seed: golden.seed,
        track: TEST_TRACK,
        wheels: golden.wheels,
      });
      expect(result.streamHash, `streamHash mismatch for ${golden.id}`).toBe(
        golden.streamHash,
      );
      expect(result.finishTicks, `finishTicks mismatch for ${golden.id}`).toBe(
        golden.finishTicks,
      );
      expect(result.physicsVersion).toBe(golden.physicsVersion);
    }
  });

  // ── New P1 scenarios ────────────────────────────────────────────────────

  it("swap-tri-to-circ-t300: triangle start → circle at t=300 — matches golden", () => {
    const goldenFile = loadGoldens();
    const entry = goldenFile.goldens.find(
      (g) => g.id === "swap-tri-to-circ-t300",
    ) as MultiWheelGolden | undefined;
    expect(entry).toBeDefined();
    expect(entry!.wheels).toHaveLength(2);
    expect(entry!.wheels[0].swap_tick).toBe(0);
    expect(entry!.wheels[1].swap_tick).toBe(300);

    const result = runHeadless({
      seed: entry!.seed,
      track: TEST_TRACK,
      wheels: entry!.wheels,
    });
    expect(result.streamHash).toBe(entry!.streamHash);
    expect(result.finishTicks).toBe(entry!.finishTicks);
  });

  it("swap-circ-to-tri-t600: circle start → triangle at t=600 — matches golden", () => {
    const goldenFile = loadGoldens();
    const entry = goldenFile.goldens.find(
      (g) => g.id === "swap-circ-to-tri-t600",
    ) as MultiWheelGolden | undefined;
    expect(entry).toBeDefined();
    expect(entry!.wheels[0].swap_tick).toBe(0);
    expect(entry!.wheels[1].swap_tick).toBe(600);

    const result = runHeadless({
      seed: entry!.seed,
      track: TEST_TRACK,
      wheels: entry!.wheels,
    });
    expect(result.streamHash).toBe(entry!.streamHash);
    expect(result.finishTicks).toBe(entry!.finishTicks);
  });

  it("swap-chain-3: circle → oval → star (swaps at 300 and 900) — matches golden", () => {
    const goldenFile = loadGoldens();
    const entry = goldenFile.goldens.find(
      (g) => g.id === "swap-chain-3",
    ) as MultiWheelGolden | undefined;
    expect(entry).toBeDefined();
    expect(entry!.wheels).toHaveLength(3);
    expect(entry!.wheels[0].swap_tick).toBe(0);
    expect(entry!.wheels[1].swap_tick).toBe(300);
    expect(entry!.wheels[2].swap_tick).toBe(900);

    const result = runHeadless({
      seed: entry!.seed,
      track: TEST_TRACK,
      wheels: entry!.wheels,
    });
    expect(result.streamHash).toBe(entry!.streamHash);
    expect(result.finishTicks).toBe(entry!.finishTicks);
  });

  it("swap-cap-20: exactly 21 wheel entries (1 initial + 20 swaps) — matches golden", () => {
    const goldenFile = loadGoldens();
    const entry = goldenFile.goldens.find(
      (g) => g.id === "swap-cap-20",
    ) as MultiWheelGolden | undefined;
    expect(entry).toBeDefined();
    // 1 initial + 20 swaps = 21 entries; validates the 20-swap cap exactly
    expect(entry!.wheels).toHaveLength(21);
    // Swaps at 60, 120, ..., 1200 (evenly spaced every 60 ticks)
    for (let i = 0; i < 20; i++) {
      expect(entry!.wheels[i + 1].swap_tick).toBe((i + 1) * 60);
    }

    const result = runHeadless({
      seed: entry!.seed,
      track: TEST_TRACK,
      wheels: entry!.wheels,
    });
    expect(result.streamHash).toBe(entry!.streamHash);
    expect(result.finishTicks).toBe(entry!.finishTicks);
  });

  it("swap-cooldown-violation: tagged structuralReject=true with < 30 tick gap (§Gameplay 1)", () => {
    const goldenFile = loadGoldens();
    const entry = goldenFile.goldens.find(
      (g) => g.id === "swap-cooldown-violation",
    ) as MultiWheelGolden | undefined;
    expect(entry).toBeDefined();
    // Must be marked as a structural reject — no physics values stored
    expect(entry!.structuralReject).toBe(true);
    expect(entry!.rejectReason).toBe("cooldown_violation");
    // Swap gap must be less than the 30-tick (500 ms) cooldown minimum
    expect(entry!.wheels).toHaveLength(2);
    const gap = entry!.wheels[1].swap_tick - entry!.wheels[0].swap_tick;
    expect(gap).toBeLessThan(30);
    // No physics fields should be present
    expect(entry!.finishTicks).toBeUndefined();
    expect(entry!.streamHash).toBeUndefined();
  });

  it("swap-position-continuity: matches golden AND position change across swap ≤ 0.5 m", () => {
    const goldenFile = loadGoldens();
    const entry = goldenFile.goldens.find(
      (g) => g.id === "swap-position-continuity",
    ) as MultiWheelGolden | undefined;
    expect(entry).toBeDefined();
    expect(entry!.wheels[1].swap_tick).toBe(500);

    // Verify the streamHash matches the stored golden
    const result = runHeadless({
      seed: entry!.seed,
      track: TEST_TRACK,
      wheels: entry!.wheels,
    });
    expect(result.streamHash).toBe(entry!.streamHash);
    expect(result.finishTicks).toBe(entry!.finishTicks);

    // Position-continuity assertion: no teleport across the swap boundary.
    // The new wheel spawns at the old wheel's position; after one physics step
    // (tick 501) it should be within ~0.5 m of where the old wheel was at tick 499.
    const pos499 = captureWheelPositionAtTick(entry!.wheels, entry!.seed, 499);
    const pos501 = captureWheelPositionAtTick(entry!.wheels, entry!.seed, 501);
    expect(Math.abs(pos501.x - pos499.x)).toBeLessThan(0.5);
    expect(Math.abs(pos501.y - pos499.y)).toBeLessThan(0.5);
  });

  it("all non-structural-reject swap entries produce identical streamHash across 100 runs", () => {
    const goldenFile = loadGoldens();
    const multiEntries = goldenFile.goldens.filter(
      (g): g is MultiWheelGolden =>
        isMultiWheel(g) && g.structuralReject !== true,
    );

    for (const entry of multiEntries) {
      const hashes: string[] = [];
      for (let i = 0; i < 100; i++) {
        hashes.push(
          runHeadless({
            seed: entry.seed,
            track: TEST_TRACK,
            wheels: entry.wheels,
          }).streamHash,
        );
      }
      const first = hashes[0];
      for (let i = 1; i < hashes.length; i++) {
        expect(hashes[i], `determinism failure on run ${i} of ${entry.id}`).toBe(
          first,
        );
      }
      expect(first).toBe(entry.streamHash);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — Legacy swaps.json goldens (backwards-compatibility)
// ---------------------------------------------------------------------------

describe("Physics golden (Layer 2) — swap scenarios (legacy swaps.json)", () => {
  it("swap-tick0-only: matches pinned golden in swaps.json", () => {
    const swapFile = loadSwapGoldens();
    const swapEntry = swapFile.swapGoldens.find((g) => g.id === "swap-tick0-only")!;
    expect(swapEntry).toBeDefined();

    const result = runHeadless({
      seed: swapEntry.seed,
      track: TEST_TRACK,
      wheels: swapEntry.wheels,
    });
    // Verify against its own pinned golden (runHeadless, no surface filter)
    expect(result.finishTicks).toBe(swapEntry.finishTicks);
    expect(result.streamHash).toBe(swapEntry.streamHash);
  });

  it("swap-position-continuity (swaps.json): matches pinned golden", () => {
    const swapFile = loadSwapGoldens();
    const entry = swapFile.swapGoldens.find(
      (g) => g.id === "swap-position-continuity",
    )!;
    expect(entry).toBeDefined();

    const result = runHeadless({
      seed: entry.seed,
      track: TEST_TRACK,
      wheels: entry.wheels,
    });
    expect(result.streamHash).toBe(entry.streamHash);
    expect(result.finishTicks).toBe(entry.finishTicks);
    expect(result.physicsVersion).toBe(entry.physicsVersion);
  });

  it("produces identical streamHash across 100 runs for seeded 5-swap run", () => {
    const swapFile = loadSwapGoldens();
    const entry = swapFile.swapGoldens.find((g) => g.id === "swap-5-determinism")!;
    expect(entry).toBeDefined();

    const hashes: string[] = [];
    for (let i = 0; i < 100; i++) {
      hashes.push(
        runHeadless({ seed: entry.seed, track: TEST_TRACK, wheels: entry.wheels })
          .streamHash,
      );
    }
    const first = hashes[0];
    for (let i = 1; i < hashes.length; i++) {
      expect(hashes[i]).toBe(first);
    }
    expect(first).toBe(entry.streamHash);
  });

  it("matches all pinned swap goldens from golden/swaps.json", () => {
    const swapFile = loadSwapGoldens();
    expect(swapFile.physicsVersion).toBe(PHYSICS_VERSION);

    for (const golden of swapFile.swapGoldens) {
      const result = runHeadless({
        seed: golden.seed,
        track: TEST_TRACK,
        wheels: golden.wheels,
      });
      expect(result.streamHash, `streamHash mismatch: ${golden.id}`).toBe(
        golden.streamHash,
      );
      expect(result.finishTicks, `finishTicks mismatch: ${golden.id}`).toBe(
        golden.finishTicks,
      );
      expect(result.physicsVersion).toBe(golden.physicsVersion);
    }
  });
});
