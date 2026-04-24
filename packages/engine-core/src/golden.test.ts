import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  createHeadlessRace,
  type TrackDef,
  type WheelDef,
} from "./headless-race.js";
import { runHeadless } from "./headless.js";
import type { WheelSwap } from "./swap.js";
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
// Single-wheel golden file types
// ---------------------------------------------------------------------------

interface GoldenFile {
  physicsVersion: number;
  goldens: Array<{
    id: string;
    seed: number;
    trackId: string;
    wheel: WheelDef;
    finishTicks: number;
    finalX: number;
    streamHash: string;
    physicsVersion: number;
  }>;
}

// ---------------------------------------------------------------------------
// Swap golden file types
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
// Layer 2 — Single-wheel deterministic physics goldens
// ---------------------------------------------------------------------------

describe("Physics golden (Layer 2) — single wheel", () => {
  it("produces identical streamHash across 100 consecutive runs", () => {
    const goldenFile = loadGoldens();
    const entry = goldenFile.goldens[0];
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

  it("matches pinned golden values from golden/wheels.json", () => {
    const goldenFile = loadGoldens();

    expect(goldenFile.physicsVersion).toBe(PHYSICS_VERSION);

    for (const golden of goldenFile.goldens) {
      const result = createHeadlessRace({
        seed: golden.seed,
        track: TEST_TRACK,
        wheel: golden.wheel,
      });
      expect(result.streamHash).toBe(golden.streamHash);
      expect(result.finishTicks).toBe(golden.finishTicks);
      expect(result.physicsVersion).toBe(golden.physicsVersion);
    }
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — Multi-wheel (swap) goldens
// ---------------------------------------------------------------------------

describe("Physics golden (Layer 2) — swap scenarios", () => {
  it("swap-tick0-only: runHeadless with single wheel at tick 0 matches createHeadlessRace", () => {
    const swapFile = loadSwapGoldens();
    const swapEntry = swapFile.swapGoldens.find((g) => g.id === "swap-tick0-only")!;
    const goldenFile = loadGoldens();
    const singleEntry = goldenFile.goldens.find((g) => g.id === "circ-32-r40")!;

    const multiResult = runHeadless({
      seed: swapEntry.seed,
      track: TEST_TRACK,
      wheels: swapEntry.wheels,
    });
    const singleResult = createHeadlessRace({
      seed: singleEntry.seed,
      track: TEST_TRACK,
      wheel: singleEntry.wheel,
    });

    // Both routes must produce identical results for the same polygon
    expect(multiResult.finishTicks).toBe(singleResult.finishTicks);
    expect(multiResult.streamHash).toBe(singleResult.streamHash);
    // And match their pinned goldens
    expect(multiResult.streamHash).toBe(swapEntry.streamHash);
    expect(multiResult.finishTicks).toBe(swapEntry.finishTicks);
  });

  it("swap-position-continuity: matches pinned golden (Layer 2 §Testing 3)", () => {
    const swapFile = loadSwapGoldens();
    const entry = swapFile.swapGoldens.find((g) => g.id === "swap-position-continuity")!;
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
      hashes.push(runHeadless({ seed: entry.seed, track: TEST_TRACK, wheels: entry.wheels }).streamHash);
    }
    const first = hashes[0];
    for (let i = 1; i < hashes.length; i++) {
      expect(hashes[i]).toBe(first);
    }
    // Also matches pinned golden
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
      expect(result.streamHash).toBe(golden.streamHash);
      expect(result.finishTicks).toBe(golden.finishTicks);
      expect(result.physicsVersion).toBe(golden.physicsVersion);
    }
  });
});
