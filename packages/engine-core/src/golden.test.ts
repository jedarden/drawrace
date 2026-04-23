import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  createHeadlessRace,
  type TrackDef,
  type WheelDef,
} from "./headless-race.js";
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

function loadGoldens(): GoldenFile {
  const path = join(__dirname, "..", "golden", "wheels.json");
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw) as GoldenFile;
}

describe("Physics golden (Layer 2)", () => {
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
