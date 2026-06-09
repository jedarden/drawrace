import { describe, it, expect, beforeEach } from "vitest";
import {
  registerTracks,
  runBot,
  parametricWheel,
  fuzzRun,
  type BotRun,
  type Ghost,
} from "./index.js";

// Mock track data (hills-01 track definition)
const mockTracks = [
  {
    id: "hills-01",
    numeric_id: 1,
    name: "Scribble Slope",
    version: 32,
    world: { gravity: [0.0, 10.0] as [number, number], pixelsPerMeter: 30 },
    camera: { followAxis: "x", deadzone: [120, 80], maxZoomOut: 1.0 },
    terrain: [
      [0, 0.0], [1, 0.15], [2, -0.1], [3, 0.1], [4, -0.15], [5, 0.2], [6, 0.0], [7, 0.15], [8, 0.0],
      [9, 0.5], [10, 1.2], [11, 1.9], [12, 2.6], [13, 3.3], [14, 4.0], [15, 4.3],
      [16, 4.3], [17, 4.3], [18, 4.3],
      [19, 4.6], [20, 3.9], [21, 4.5], [22, 4.0], [23, 4.4], [24, 4.1], [25, 4.3],
      [26, 4.2], [27, 4.3], [28, 4.3],
      [29, 4.2], [30, 4.1], [31, 4.15], [32, 4.2], [33, 4.3], [34, 4.5],
      [35, 4.8], [36, 5.5], [37, 6.2], [38, 6.4],
      [39, 6.4], [40, 6.4]
    ] as [number, number][],
    zones: [
      { id: "A", x_start: 0, x_end: 8 },
      { id: "B", x_start: 8, x_end: 18 },
      { id: "C", x_start: 18, x_end: 28 },
      { id: "D", x_start: 28, x_end: 40 }
    ],
    obstacles: [
      { type: "box", pos: [20.0, 4.4], size: [0.3, 0.15] },
      { type: "box", pos: [22.5, 4.5], size: [0.3, 0.15] },
      { type: "box", pos: [25.0, 4.7], size: [0.3, 0.15] }
    ],
    ramps: [{ zone: "D", x_start: 36, x_end: 38 }],
    hazards: [{ type: "pit", x_start: 38, x_end: 40, y: 8.0 }],
    surfaces: [
      { x_range: [0, 8], type: "normal" },
      { x_range: [8, 18], type: "ice" },
      { x_range: [18, 28], type: "snow" },
      { x_range: [28, 34], type: "water" },
      { x_range: [34, 40], type: "normal" }
    ],
    start: { pos: [1.5, 0.0], facing: 1 },
    finish: { pos: [40.0, 6.4], width: 0.2 },
    metadata: { targetTimeSeconds: 45, tutorialGhosts: [] }
  }
];

describe("@drawrace/bot", () => {
  beforeEach(() => {
    registerTracks(mockTracks);
  });

  describe("parametricWheel", () => {
    it("generates a circle wheel", () => {
      const circle = parametricWheel("circle", { radius: 50, points: 12 });
      expect(circle).toHaveLength(12);
      expect(circle[0]).toHaveLength(2);
      // All vertices should be at approximately the same distance from origin
      for (const [x, y] of circle) {
        const dist = Math.sqrt(x * x + y * y);
        expect(dist).toBeCloseTo(50, 0);
      }
    });

    it("generates an oval wheel", () => {
      const oval = parametricWheel("oval", { radius: 50, points: 12, aspectRatio: 1.5 });
      expect(oval).toHaveLength(12);
      // X coordinates should be larger than Y coordinates
      const maxX = Math.max(...oval.map(([x]) => Math.abs(x)));
      const maxY = Math.max(...oval.map(([, y]) => Math.abs(y)));
      expect(maxX).toBeGreaterThan(maxY);
    });

    it("generates a star wheel", () => {
      const star = parametricWheel("star", { radius: 50, points: 5, innerRadius: 20 });
      expect(star).toHaveLength(10); // 2x points for star
      // Check alternating radius pattern
      const radii = star.map(([x, y]) => Math.sqrt(x * x + y * y));
      const outerRadii = radii.filter((_, i) => i % 2 === 0);
      const innerRadii = radii.filter((_, i) => i % 2 === 1);
      expect(Math.max(...outerRadii)).toBeGreaterThan(Math.max(...innerRadii));
    });

    it("generates a blob wheel with noise", () => {
      const blob1 = parametricWheel("blob", { radius: 50, points: 12, noise: 0.2, seed: 42 });
      const blob2 = parametricWheel("blob", { radius: 50, points: 12, noise: 0.2, seed: 43 });
      expect(blob1).toHaveLength(12);
      expect(blob2).toHaveLength(12);
      // Different seeds should produce different shapes
      expect(blob1).not.toEqual(blob2);
    });

    it("throws on unknown wheel kind", () => {
      expect(() => parametricWheel("unknown" as any, { radius: 50 }))
        .toThrow("Unknown wheel kind");
    });
  });

  describe("runBot", () => {
    it("runs a basic bot simulation", async () => {
      const run: BotRun = {
        shape: parametricWheel("circle", { radius: 50, points: 12 }),
        track: 1,
        seed: 12345,
      };

      const result = await runBot(run);

      expect(result).toBeDefined();
      expect(result.finishTicks).toBeGreaterThan(0);
      expect(result.finishMs).toBeGreaterThan(0);
      expect(result.finalX).toBeGreaterThanOrEqual(0);
      expect(result.dnf).toBe(false);
      expect(result.positionStream).toBeInstanceOf(Array);
      expect(result.positionStream.length).toBeGreaterThan(0);
    });

    it("includes position data in stream", async () => {
      const run: BotRun = {
        shape: parametricWheel("circle", { radius: 50, points: 8 }),
        track: 1,
        seed: 999,
      };

      const result = await runBot(run);

      expect(result.positionStream.length).toBeGreaterThan(0);
      const firstPos = result.positionStream[0];
      expect(firstPos).toHaveProperty("x");
      expect(firstPos).toHaveProperty("y");
      expect(firstPos).toHaveProperty("tick");
      expect(firstPos.tick).toBe(1);
    });

    it("calculates rank delta vs ghosts", async () => {
      const run: BotRun = {
        shape: parametricWheel("circle", { radius: 50, points: 12 }),
        track: 1,
        seed: 54321,
      };

      const ghosts: Ghost[] = [
        {
          wheelVertices: parametricWheel("circle", { radius: 50, points: 12 }).map(([x, y]) => ({ x, y })),
          finishTimeMs: 60000, // 60 seconds
          seed: 111,
        },
        {
          wheelVertices: parametricWheel("circle", { radius: 50, points: 12 }).map(([x, y]) => ({ x, y })),
          finishTimeMs: 70000, // 70 seconds
          seed: 222,
        },
      ];

      const result = await runBot(run, ghosts);

      expect(result.rankDelta).toBeDefined();
      expect(typeof result.rankDelta).toBe("number");
    });

    it("handles empty ghost array", async () => {
      const run: BotRun = {
        shape: parametricWheel("circle", { radius: 50, points: 12 }),
        track: 1,
        seed: 11111,
      };

      const result = await runBot(run, []);
      expect(result.rankDelta).toBe(0);
    });

    it("throws on unregistered track", async () => {
      const run: BotRun = {
        shape: parametricWheel("circle", { radius: 50, points: 12 }),
        track: 999, // Not registered
        seed: 12345,
      };

      await expect(runBot(run)).rejects.toThrow("Track 999 not registered");
    });
  });

  describe("fuzzRun", () => {
    it("runs a small fuzz iteration", () => {
      const result = fuzzRun(2, 1);

      expect(result.totalRuns).toBe(2);
      expect(result.dnfCount).toBeGreaterThanOrEqual(0);
      expect(result.crashCount).toBe(0); // Should not crash with valid shapes
      expect(result.errorCount).toBe(0);
      expect(result.unexpectedDnfs).toBeInstanceOf(Array);
    });

    it("tests all registered tracks when no trackId specified", () => {
      // Register additional tracks
      registerTracks([
        ...mockTracks,
        {
          ...mockTracks[0],
          id: "canyon-02",
          numeric_id: 2,
          name: "Canyon Run",
        },
      ]);

      const result = fuzzRun(2); // 2 runs across 2 tracks = 1 each

      expect(result.totalRuns).toBe(2);
    });
  });
});
