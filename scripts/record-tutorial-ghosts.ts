#!/usr/bin/env node
/**
 * Generate tutorial ghosts with specific wheel swap patterns.
 *
 * Ghost A: 1 early swap — a triangle that becomes a circle
 * Ghost B: 2 mid-run swaps — big wheel on flats, small wheel on steep ramp
 * Ghost C: 3 swaps demonstrating the 500ms cooldown
 *
 * Usage: npx tsx scripts/record-tutorial-ghosts.ts
 */

import { writeFileSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { RaceSim } from "../packages/engine-core/src/race-sim.js";
import { processDraw, type Point } from "../packages/engine-core/src/draw-pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load the actual hills-01 track
const trackJsonPath = join(__dirname, "..", "apps", "web", "public", "tracks", "hills-01.json");
const trackData = JSON.parse(readFileSync(trackJsonPath, "utf-8"));

/**
 * Helper to create polygon vertices directly in physics coordinates (meters)
 * Vertices are centered at origin with specified radius
 */
function makePolygonVertices(radius: number, sides: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides;
    pts.push({
      x: Math.round(radius * Math.cos(angle) * 1000) / 1000,
      y: Math.round(radius * Math.sin(angle) * 1000) / 1000,
    });
  }
  return pts;
}

/**
 * Helper to create a circle (many vertices)
 */
function makeCircleVertices(radius: number, vertexCount: number = 16): Point[] {
  return makePolygonVertices(radius, vertexCount);
}

/**
 * Helper to create a triangle
 */
function makeTriangleVertices(radius: number): Point[] {
  return makePolygonVertices(radius, 3);
}

/**
 * Helper to create a hexagon
 */
function makeHexagonVertices(radius: number): Point[] {
  return makePolygonVertices(radius, 6);
}

/**
 * Helper to create a large wheel (for flats) - more vertices for smoother roll
 */
function makeLargeWheelVertices(radius: number): Point[] {
  return makePolygonVertices(radius, 16);
}

/**
 * Helper to create a small wheel (for ramps) - fewer vertices
 */
function makeSmallWheelVertices(radius: number): Point[] {
  return makePolygonVertices(radius, 6);
}

/**
 * Process raw points into wheel vertices centered at origin
 * Note: This function is kept for compatibility but the new helpers
 * create vertices directly in physics coordinates.
 */
function processToVertices(rawPoints: Point[]): Point[] {
  const totalTravel = rawPoints.reduce((acc, p, i, arr) => {
    if (i === 0) return 0;
    return acc + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y);
  }, 0);

  const drawResult = processDraw(rawPoints, totalTravel);
  if (!drawResult) {
    throw new Error("Failed to process wheel drawing");
  }

  const cx = drawResult.centroid.x;
  const cy = drawResult.centroid.y;
  return drawResult.vertices.map((v) => ({
    x: v.x - cx,
    y: v.y - cy,
  }));
}

/**
 * Run a simulation with wheel swaps at specified ticks
 */
function runSimulationWithSwaps(
  initialVertices: Point[],
  swaps: { tick: number; vertices: Point[] }[],
  seed = 42
): { finishTimeMs: number; finishTicks: number; wheels: Array<{ swap_tick: number; polygon: [number, number][] }> } {
  const sim = new RaceSim(trackData, initialVertices, seed);
  sim.enableMotor();

  // Build wheels array starting with initial wheel
  const wheels: Array<{ swap_tick: number; polygon: [number, number][] }> = [
    {
      swap_tick: 0,
      polygon: initialVertices.map((v) => [v.x, v.y] as [number, number]),
    },
  ];

  let swapIndex = 0;
  while (!sim.isFinished()) {
    const snap = sim.step();

    // Check if we should swap at this tick
    if (swapIndex < swaps.length && swaps[swapIndex].tick === snap.tick) {
      const swap = swaps[swapIndex];
      sim.swapWheel(swap.vertices);
      wheels.push({
        swap_tick: swap.tick,
        polygon: swap.vertices.map((v) => [v.x, v.y] as [number, number]),
      });
      swapIndex++;
    }

    if (snap.finished) {
      return {
        finishTimeMs: snap.elapsedMs,
        finishTicks: snap.tick,
        wheels,
      };
    }
  }

  // If we didn't finish, return what we have
  const finalSnap = sim.snapshot();
  return {
    finishTimeMs: finalSnap.elapsedMs,
    finishTicks: finalSnap.tick,
    wheels,
  };
}

/**
 * Generate Ghost A: 1 early swap — triangle → circle
 *
 * Strategy: Start with a triangle (visibly distinct from circle), swap to circle at tick 60 (~1 second).
 * Note: Wheels larger than 0.72 radius timeout on hills-01, so we use smaller sizes.
 */
function generateGhostA() {
  console.log("Generating Ghost A: triangle → circle (early swap)");

  // Start with a triangle (visibly distinct from circle, but still viable)
  const initialVertices = makeTriangleVertices(0.65);

  // Swap to circle at tick 60 (~1 second, early in race)
  const circleVertices = makeCircleVertices(0.68, 16);

  const result = runSimulationWithSwaps(initialVertices, [
    { tick: 60, vertices: circleVertices },
  ], 1001);

  return {
    id: "ghost-tutorial-a",
    name: "Early Swapper",
    trackId: "hills-01",
    seed: 1001,
    finishTimeMs: result.finishTimeMs,
    finishTicks: result.finishTicks,
    wheelVertices: initialVertices,
    wheels: result.wheels,
  };
}

/**
 * Generate Ghost B: 2 mid-run swaps — big wheel on flats, small wheel on steep ramp
 *
 * Strategy: Start with a big wheel for Zone A flats (x 0-8), swap to smaller wheel before
 * Zone B steep ramp (x 8-18, goes from 0.5 to 4.3 height), then swap back for Zone C.
 * Note: Wheels larger than 0.72 radius timeout on hills-01, so we use smaller sizes.
 */
function generateGhostB() {
  console.log("Generating Ghost B: big wheel on flats → small wheel on ramp → medium wheel (2 mid-run swaps)");

  // Start with a big wheel for Zone A flats (good for small bumps)
  const bigVertices = makeCircleVertices(0.70, 16);

  // Small wheel for Zone B steep ramp (easier to climb)
  const smallVertices = makePolygonVertices(0.60, 6);

  // Medium wheel for Zone C rolling hills
  const mediumVertices = makeCircleVertices(0.68, 12);

  // Swap to small wheel at tick 100 (~1.7s, before Zone B ramp starts at x=8)
  // Swap to medium wheel at tick 250 (~4.2s, after Zone B ramp)
  const result = runSimulationWithSwaps(bigVertices, [
    { tick: 100, vertices: smallVertices },
    { tick: 250, vertices: mediumVertices },
  ], 2002);

  return {
    id: "ghost-tutorial-b",
    name: "Adaptive Racer",
    trackId: "hills-01",
    seed: 2002,
    finishTimeMs: result.finishTimeMs,
    finishTicks: result.finishTicks,
    wheelVertices: bigVertices,
    wheels: result.wheels,
  };
}

/**
 * Generate Ghost C: 3 swaps demonstrating the 500ms cooldown
 *
 * Strategy: Make swaps at ticks 300, 330, 360 (500ms apart = 30 ticks at 60fps).
 * This clearly shows that the overlay grey-out is intentional cooldown, not a bug.
 * Note: Wheels larger than 0.72 radius timeout on hills-01, so we use smaller sizes.
 */
function generateGhostC() {
  console.log("Generating Ghost C: 3 swaps at 500ms intervals (demonstrating cooldown)");

  // Start with a circle
  const initialVertices = makeCircleVertices(0.68, 16);

  // Pentagon for first swap (visibly different)
  const pentagonVertices = makePolygonVertices(0.67, 5);

  // Octagon for second swap
  const octagonVertices = makePolygonVertices(0.66, 8);

  // Circle for third swap (back to start)
  const circleVertices = makeCircleVertices(0.65, 16);

  // 500ms = 30 ticks at 60fps
  const result = runSimulationWithSwaps(initialVertices, [
    { tick: 300, vertices: pentagonVertices },
    { tick: 330, vertices: octagonVertices },
    { tick: 360, vertices: circleVertices },
  ], 3003);

  return {
    id: "ghost-tutorial-c",
    name: "Cooldown Demo",
    trackId: "hills-01",
    seed: 3003,
    finishTimeMs: result.finishTimeMs,
    finishTicks: result.finishTicks,
    wheelVertices: initialVertices,
    wheels: result.wheels,
  };
}

function main() {
  console.log("Generating tutorial ghosts for hills-01 track...\n");

  const ghostA = generateGhostA();
  console.log(`  Ghost A: ${ghostA.finishTimeMs}ms, ${ghostA.wheels.length} wheels`);

  const ghostB = generateGhostB();
  console.log(`  Ghost B: ${ghostB.finishTimeMs}ms, ${ghostB.wheels.length} wheels`);

  const ghostC = generateGhostC();
  console.log(`  Ghost C: ${ghostC.finishTimeMs}ms, ${ghostC.wheels.length} wheels`);

  // Ensure output directory exists
  const outputDir = join(__dirname, "..", "apps", "web", "public", "ghosts");
  mkdirSync(outputDir, { recursive: true });

  // Write ghosts
  const ghosts = [
    { file: "ghost-tutorial-a.json", data: ghostA },
    { file: "ghost-tutorial-b.json", data: ghostB },
    { file: "ghost-tutorial-c.json", data: ghostC },
  ];

  for (const { file, data } of ghosts) {
    const outputPath = join(outputDir, file);
    writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`\nWrote: ${outputPath}`);
  }

  console.log("\nTutorial ghosts generated successfully!");
  console.log("\nSwap patterns:");
  console.log("  Ghost A: triangle → circle at tick 60 (~1s, early swap)");
  console.log("  Ghost B: big → small at tick 100 (~1.7s, before Zone B ramp), small → medium at tick 250 (~4.2s)");
  console.log("  Ghost C: 3 swaps at ticks 300, 330, 360 (500ms apart, shows cooldown)");
}

main();
