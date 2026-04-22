import { describe, it, expect } from "vitest";
import {
  computeBBox,
  closeLoop,
  simplifyStroke,
  areaCentroid,
  convexDecompose,
  processDraw,
  type Point,
} from "./draw-pipeline.js";

function circlePoints(
  cx: number,
  cy: number,
  r: number,
  n: number
): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    pts.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pts;
}

function travelDistance(pts: Point[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return d;
}

describe("computeBBox", () => {
  it("computes correct bounds and diagonal", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 3, y: 8 },
    ];
    const bbox = computeBBox(pts);
    expect(bbox.minX).toBe(0);
    expect(bbox.maxX).toBe(10);
    expect(bbox.minY).toBe(0);
    expect(bbox.maxY).toBe(8);
    expect(bbox.diagonal).toBeCloseTo(Math.hypot(10, 8));
  });
});

describe("closeLoop", () => {
  it("closes a nearly-closed stroke", () => {
    const pts = circlePoints(50, 50, 40, 40);
    const { closed, isOpenLoop } = closeLoop(pts);
    const last = closed[closed.length - 1];
    expect(last.x).toBeCloseTo(pts[0].x);
    expect(last.y).toBeCloseTo(pts[0].y);
    expect(isOpenLoop).toBe(false);
  });

  it("force-closes an open stroke", () => {
    const pts = circlePoints(50, 50, 40, 40).slice(0, 20);
    const { closed, isOpenLoop } = closeLoop(pts);
    expect(isOpenLoop).toBe(true);
    const last = closed[closed.length - 1];
    expect(last.x).toBeCloseTo(pts[0].x);
  });
});

describe("simplifyStroke", () => {
  it("reduces vertex count while preserving shape", () => {
    const pts = circlePoints(100, 100, 80, 100);
    const simplified = simplifyStroke(pts);
    expect(simplified.length).toBeLessThan(100);
    expect(simplified.length).toBeGreaterThanOrEqual(8);
    expect(simplified.length).toBeLessThanOrEqual(32);
  });

  it("enforces max vertex cap", () => {
    const pts: Point[] = [];
    for (let i = 0; i < 200; i++) {
      pts.push({ x: i * 0.5, y: Math.sin(i * 0.3) * 100 });
    }
    const simplified = simplifyStroke(pts);
    expect(simplified.length).toBeLessThanOrEqual(32);
  });
});

describe("areaCentroid", () => {
  it("computes centroid of a unit square", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    const { cx, cy, area } = areaCentroid(pts);
    expect(cx).toBeCloseTo(0.5);
    expect(cy).toBeCloseTo(0.5);
    expect(area).toBeCloseTo(1.0);
  });

  it("computes centroid of a circle approximation", () => {
    const pts = circlePoints(50, 60, 30, 64);
    const { cx, cy } = areaCentroid(pts);
    expect(cx).toBeCloseTo(50, 0);
    expect(cy).toBeCloseTo(60, 0);
  });
});

describe("convexDecompose", () => {
  it("returns single piece for convex polygon", () => {
    const pts = circlePoints(0, 0, 10, 8);
    const pieces = convexDecompose(pts);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(8);
    }
  });

  it("decomposes a concave shape into multiple pieces", () => {
    const pts: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 5, y: 5 },
      { x: 0, y: 10 },
    ];
    const pieces = convexDecompose(pts);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
  });
});

describe("processDraw", () => {
  it("rejects too-short strokes", () => {
    const pts = circlePoints(50, 50, 5, 10);
    const travel = travelDistance(pts);
    const result = processDraw(pts, travel);
    expect(result).toBeNull();
  });

  it("rejects too-few samples", () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const travel = 400;
    const result = processDraw(pts, travel);
    expect(result).toBeNull();
  });

  it("processes a valid circle drawing", () => {
    const pts = circlePoints(150, 150, 80, 60);
    const travel = travelDistance(pts);
    expect(travel).toBeGreaterThan(150);
    expect(pts.length).toBeGreaterThanOrEqual(20);

    const result = processDraw(pts, travel);
    expect(result).not.toBeNull();
    expect(result!.vertices.length).toBeGreaterThanOrEqual(8);
    expect(result!.vertices.length).toBeLessThanOrEqual(32);
    expect(result!.area).toBeGreaterThan(0);
    expect(result!.convexPieces.length).toBeGreaterThanOrEqual(1);
  });

  it("centroids vertices around origin", () => {
    const pts = circlePoints(200, 200, 80, 60);
    const travel = travelDistance(pts);
    const result = processDraw(pts, travel)!;
    const avgX = result.vertices.reduce((s, v) => s + v.x, 0) / result.vertices.length;
    const avgY = result.vertices.reduce((s, v) => s + v.y, 0) / result.vertices.length;
    expect(avgX).toBeCloseTo(0, -1);
    expect(avgY).toBeCloseTo(0, -1);
  });
});
