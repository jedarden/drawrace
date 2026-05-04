/**
 * Regenerate all golden values for the current physics version.
 * Usage: npx tsx scripts/regen-goldens.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createHeadlessRace,
  type TrackDef,
  type WheelDef,
} from "../packages/engine-core/src/headless-race.js";
import { runHeadless } from "../packages/engine-core/src/headless.js";
import { type WheelSwap } from "../packages/engine-core/src/swap.js";
import { PHYSICS_VERSION } from "../packages/engine-core/src/version.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

function isSingleWheel(g: GoldenEntry): g is SingleWheelGolden {
  return "wheel" in g;
}

const path = join(__dirname, "..", "packages", "engine-core", "golden", "wheels.json");
const raw = readFileSync(path, "utf-8");
const goldenFile: GoldenFile = JSON.parse(raw);

console.log(`Current physicsVersion: ${goldenFile.physicsVersion}`);
console.log(`New physicsVersion: ${PHYSICS_VERSION}`);

for (const entry of goldenFile.goldens) {
  if (isSingleWheel(entry)) {
    const result = createHeadlessRace({
      seed: entry.seed,
      track: TEST_TRACK,
      wheel: entry.wheel,
    });
    console.log(
      `  ${entry.id}: finishTicks ${entry.finishTicks} → ${result.finishTicks}, hash ${entry.streamHash} → ${result.streamHash}`,
    );
    entry.finishTicks = result.finishTicks;
    entry.finalX = result.finalX;
    entry.streamHash = result.streamHash;
    entry.physicsVersion = PHYSICS_VERSION;
  } else {
    if (entry.structuralReject) {
      entry.physicsVersion = PHYSICS_VERSION;
      console.log(`  ${entry.id}: structuralReject — kept as-is, version updated`);
      continue;
    }
    const result = runHeadless({
      seed: entry.seed,
      track: TEST_TRACK,
      wheels: entry.wheels,
    });
    console.log(
      `  ${entry.id}: finishTicks ${entry.finishTicks} → ${result.finishTicks}, hash ${entry.streamHash} → ${result.streamHash}`,
    );
    entry.finishTicks = result.finishTicks;
    entry.finalX = result.finalX;
    entry.streamHash = result.streamHash;
    entry.physicsVersion = PHYSICS_VERSION;
  }
}

goldenFile.physicsVersion = PHYSICS_VERSION;
writeFileSync(path, JSON.stringify(goldenFile, null, 2) + "\n");
console.log(`\nWrote updated goldens to ${path}`);

// Also regenerate swaps.json
const swapPath = join(__dirname, "..", "packages", "engine-core", "golden", "swaps.json");
const swapRaw = readFileSync(swapPath, "utf-8");
const swapFile: SwapGoldenFile = JSON.parse(swapRaw);

console.log(`\nRegenerating swaps.json (version ${swapFile.physicsVersion} → ${PHYSICS_VERSION})`);
for (const entry of swapFile.swapGoldens) {
  const result = runHeadless({
    seed: entry.seed,
    track: TEST_TRACK,
    wheels: entry.wheels,
  });
  console.log(
    `  ${entry.id}: finishTicks ${entry.finishTicks} → ${result.finishTicks}, hash ${entry.streamHash} → ${result.streamHash}`,
  );
  entry.finishTicks = result.finishTicks;
  entry.finalX = result.finalX;
  entry.streamHash = result.streamHash;
  entry.physicsVersion = PHYSICS_VERSION;
}
swapFile.physicsVersion = PHYSICS_VERSION;
writeFileSync(swapPath, JSON.stringify(swapFile, null, 2) + "\n");
console.log(`\nWrote updated swap goldens to ${swapPath}`);
