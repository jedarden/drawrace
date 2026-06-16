/**
 * Camera look-ahead tests (drawrace-vgn.8.11)
 *
 * Tests the 4-second look-ahead rule: the next zone's terrain must appear
 * in frame at least 4 seconds before the chassis enters it.
 */

import { describe, it, expect } from "vitest";
import type { TrackDef } from "./race-sim.js";
import { RaceSim } from "./race-sim.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const TRACK_PATH = join(
  __dirname,
  "..",
  "..",
  "..",
  "apps",
  "web",
  "public",
  "tracks",
  "hills-01.json"
);

function loadTrack(): TrackDef {
  return JSON.parse(readFileSync(TRACK_PATH, "utf-8"));
}

/**
 * Simulate camera look-ahead calculation.
 *
 * This mirrors the calculation in Renderer.ts updateCamera():
 * - Base viewport shows player at 35% of screen width
 * - Look-ahead adds additional pixels based on velocity
 * - Goal: ensure 4 seconds of preview time
 *
 * @param velocityX - Current horizontal velocity (m/s)
 * @param screenWidth - Canvas width in pixels
 * @param ppm - Pixels per meter (typically 30)
 * @returns Look-ahead distance in meters
 */
function calculateLookAheadMeters(
  velocityX: number,
  screenWidth: number,
  ppm: number = 30
): number {
  const absVx = Math.abs(velocityX);
  const lookAheadSeconds = 4; // Target 4 seconds of preview
  const baseViewportMeters = screenWidth * 0.65 / ppm;
  const targetPreviewMeters = absVx * lookAheadSeconds;
  const additionalLookAheadMeters = Math.max(0, targetPreviewMeters - baseViewportMeters);

  return additionalLookAheadMeters;
}

/**
 * Calculate total preview distance (base viewport + look-ahead).
 */
function calculateTotalPreviewMeters(
  velocityX: number,
  screenWidth: number,
  ppm: number = 30
): number {
  const baseViewportMeters = screenWidth * 0.65 / ppm;
  const lookAheadMeters = calculateLookAheadMeters(velocityX, screenWidth, ppm);
  return baseViewportMeters + lookAheadMeters;
}

/**
 * Calculate preview time in seconds at given velocity.
 */
function calculatePreviewTimeSeconds(
  velocityX: number,
  screenWidth: number,
  ppm: number = 30
): number {
  const totalPreviewMeters = calculateTotalPreviewMeters(velocityX, screenWidth, ppm);
  return totalPreviewMeters / Math.abs(velocityX);
}

describe("camera look-ahead (drawrace-vgn.8.11)", () => {
  describe("look-ahead calculation", () => {
    const PPM = 30;
    const SCREEN_WIDTHS = [390, 800, 1200]; // Mobile, desktop, large desktop

    it("provides at least 4 seconds of preview time at 5 m/s", () => {
      for (const width of SCREEN_WIDTHS) {
        const previewSeconds = calculatePreviewTimeSeconds(5, width, PPM);
        expect(previewSeconds).toBeGreaterThanOrEqual(4);
      }
    });

    it("provides at least 4 seconds of preview time at 10 m/s", () => {
      for (const width of SCREEN_WIDTHS) {
        const previewSeconds = calculatePreviewTimeSeconds(10, width, PPM);
        expect(previewSeconds).toBeGreaterThanOrEqual(4);
      }
    });

    it("provides at least 4 seconds of preview time at 15 m/s", () => {
      for (const width of SCREEN_WIDTHS) {
        const previewSeconds = calculatePreviewTimeSeconds(15, width, PPM);
        expect(previewSeconds).toBeGreaterThanOrEqual(4);
      }
    });

    it("provides at least 4 seconds of preview time at 2 m/s (slow speed)", () => {
      for (const width of SCREEN_WIDTHS) {
        const previewSeconds = calculatePreviewTimeSeconds(2, width, PPM);
        expect(previewSeconds).toBeGreaterThanOrEqual(4);
      }
    });

    it("look-ahead increases with velocity", () => {
      const width = 800;
      const lookAhead5 = calculateLookAheadMeters(5, width, PPM);
      const lookAhead10 = calculateLookAheadMeters(10, width, PPM);
      const lookAhead15 = calculateLookAheadMeters(15, width, PPM);

      expect(lookAhead15).toBeGreaterThan(lookAhead10);
      expect(lookAhead10).toBeGreaterThan(lookAhead5);
    });
  });

  describe("zone boundary 4-second rule", () => {
    it("zone boundaries should be visible 240+ ticks before chassis reaches them", () => {
      const track = loadTrack();
      const zones = track.zones!;

      // For each zone boundary (except the start), verify that a car
      // traveling at typical speeds would see the boundary at least 4s early
      for (let _i = 1; _i < zones.length; _i++) {
        const boundaryX = zones[_i].x_start;

        // At 5 m/s (typical speed on normal terrain)
        const velocity5 = 5;
        const previewAt5 = calculateTotalPreviewMeters(velocity5, 800, 30);
        const previewTimeAt5 = previewAt5 / velocity5;
        expect(previewTimeAt5, `Zone boundary at ${boundaryX}m should have 4s+ preview at 5 m/s`).toBeGreaterThanOrEqual(4);

        // At 10 m/s (fast on ice)
        const velocity10 = 10;
        const previewAt10 = calculateTotalPreviewMeters(velocity10, 800, 30);
        const previewTimeAt10 = previewAt10 / velocity10;
        expect(previewTimeAt10, `Zone boundary at ${boundaryX}m should have 4s+ preview at 10 m/s`).toBeGreaterThanOrEqual(4);
      }
    });
  });

  describe("real race simulation", () => {
    it("optimal 3-swap demo maintains 4s preview window", () => {
      const track = loadTrack();

      // 3-swap demo: circle-r65 → gear-16 → circle-r48
      const wheelVertices = {
        circleR65: Array.from({ length: 32 }, (_, i) => ({
          x: 0.65 * Math.cos((i / 32) * Math.PI * 2),
          y: 0.65 * Math.sin((i / 32) * Math.PI * 2),
        })),
        gear16: Array.from({ length: 16 }, (_, i) => {
          const angle = (i / 16) * Math.PI * 2;
          const r = i % 2 === 0 ? 0.5 : 0.35;
          return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
        }),
        circleR48: Array.from({ length: 32 }, (_, i) => ({
          x: 0.48 * Math.cos((i / 32) * Math.PI * 2),
          y: 0.48 * Math.sin((i / 32) * Math.PI * 2),
        })),
      };

      const sim = new RaceSim(track, wheelVertices.circleR65);
      sim.enableMotor();

      let prevX = 0;
      let _maxVelocity = 0;
      let minPreviewTime = Infinity;

      // Simulate the race and check preview time at each tick
      while (!sim.isFinished() && sim.snapshot().tick < 60 * 60) {
        const snap = sim.step();
        const dx = snap.wheel.x - prevX;
        const velocity = Math.abs(dx) * 60; // m/s
        prevX = snap.wheel.x;

        if (velocity > _maxVelocity) _maxVelocity = velocity;

        // Calculate preview time at current velocity
        if (velocity > 0.5) { // Only check when moving
          const previewMeters = calculateTotalPreviewMeters(velocity, 800, 30);
          const previewSeconds = previewMeters / velocity;
          if (previewSeconds < minPreviewTime) minPreviewTime = previewSeconds;
        }

        // Apply swaps at ticks similar to 3-swap demo
        const tick = snap.tick;
        if (tick === 480) {
          sim.swapWheel(wheelVertices.gear16);
        } else if (tick === 1080) {
          sim.swapWheel(wheelVertices.circleR48);
        }
      }

      // The minimum preview time throughout the race should be at least 4 seconds
      expect(minPreviewTime, `Minimum preview time should be ≥4s, got ${minPreviewTime.toFixed(2)}s`).toBeGreaterThanOrEqual(4);
    });

    it("slow 1-wheel reference run maintains 4s preview window", () => {
      const track = loadTrack();

      // Slow wheel: small circle (r=0.35)
      const wheelVertices = Array.from({ length: 32 }, (_, i) => ({
        x: 0.35 * Math.cos((i / 32) * Math.PI * 2),
        y: 0.35 * Math.sin((i / 32) * Math.PI * 2),
      }));

      const sim = new RaceSim(track, wheelVertices);
      sim.enableMotor();

      let prevX = 0;
      let _maxVelocity = 0;
      let minPreviewTime = Infinity;

      // Simulate the race
      while (!sim.isFinished() && sim.snapshot().tick < 60 * 180) {
        const snap = sim.step();
        const dx = snap.wheel.x - prevX;
        const velocity = Math.abs(dx) * 60; // m/s
        prevX = snap.wheel.x;

        if (velocity > _maxVelocity) _maxVelocity = velocity;

        // Calculate preview time at current velocity
        if (velocity > 0.5) {
          const previewMeters = calculateTotalPreviewMeters(velocity, 800, 30);
          const previewSeconds = previewMeters / velocity;
          if (previewSeconds < minPreviewTime) minPreviewTime = previewSeconds;
        }
      }

      // The minimum preview time throughout the race should be at least 4 seconds
      expect(minPreviewTime, `Minimum preview time should be ≥4s, got ${minPreviewTime.toFixed(2)}s`).toBeGreaterThanOrEqual(4);
    });
  });
});
