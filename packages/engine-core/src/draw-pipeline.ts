import simplify from "simplify-js";
import { makeCCW, quickDecomp, type Polygon, type Point as DecompPoint } from "poly-decomp-es";

export interface Point {
  x: number;
  y: number;
}

export interface DrawResult {
  vertices: Point[];
  centroid: Point;
  convexPieces: Point[][];
  isOpenLoop: boolean;
  area: number;
  bboxDiagonal: number; // For diameter-capped constraint validation
}

export interface DrawConstraints {
  singleStroke?: boolean;
  convexOnly?: boolean;
  vertexCapped?: number; // Max vertices allowed (e.g., 10, 12, 16)
  diameterCapped?: number; // Max bounding-box diameter in pixels
  swapCapped?: number; // Max wheel swaps allowed (e.g., 2, 3, 5)
  singleWheel?: boolean; // Only initial wheel, no mid-race redraws
}

export interface ConstraintViolation {
  type:
    | "single-stroke"
    | "convex-only"
    | "vertex-capped"
    | "diameter-capped"
    | "swap-capped"
    | "single-wheel";
  message: string;
}

export function validateConstraints(
  result: DrawResult,
  constraints: DrawConstraints,
  strokeCount: number = 1,
  swapCount: number = 0
): ConstraintViolation | null {
  if (constraints.singleStroke && strokeCount > 1) {
    return {
      type: "single-stroke",
      message: `Single-stroke mode requires drawing in one continuous stroke (detected ${strokeCount} strokes)`,
    };
  }

  if (constraints.convexOnly && result.convexPieces.length > 1) {
    return {
      type: "convex-only",
      message: `Convex-only mode requires a convex shape (detected ${result.convexPieces.length} convex pieces)`,
    };
  }

  if (
    constraints.vertexCapped !== undefined &&
    result.vertices.length > constraints.vertexCapped
  ) {
    return {
      type: "vertex-capped",
      message: `Vertex-capped mode requires ≤${constraints.vertexCapped} vertices (detected ${result.vertices.length})`,
    };
  }

  if (
    constraints.diameterCapped !== undefined &&
    result.bboxDiagonal > constraints.diameterCapped
  ) {
    return {
      type: "diameter-capped",
      message: `Diameter-capped mode requires ≤${constraints.diameterCapped}px diameter (detected ${result.bboxDiagonal.toFixed(0)}px)`,
    };
  }

  if (constraints.swapCapped !== undefined && swapCount > constraints.swapCapped) {
    return {
      type: "swap-capped",
      message: `Swap-capped mode allows ≤${constraints.swapCapped} wheel swaps (${swapCount} used)`,
    };
  }

  if (constraints.singleWheel && swapCount > 0) {
    return {
      type: "single-wheel",
      message: `Single-wheel mode allows no mid-race redraws (${swapCount} swaps detected)`,
    };
  }

  return null;
}

/**
 * Compute the number of wheel swaps from a wheels array.
 * wheels[0] is the initial wheel (swap_tick=0), so swap count is wheels.length - 1.
 */
export function computeSwapCount(wheels: { swap_tick: number }[]): number {
  return Math.max(0, wheels.length - 1);
}

const MIN_TRAVEL = 150;
const MIN_SAMPLES = 20;
const MAX_VERTICES = 32;
const MIN_VERTICES = 8;
const MAX_DECOMP_PIECES = 8;

export function computeBBox(pts: Point[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  diagonal: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    diagonal: Math.hypot(maxX - minX, maxY - minY),
  };
}

export function closeLoop(
  pts: Point[]
): { closed: Point[]; isOpenLoop: boolean } {
  const bbox = computeBBox(pts);
  const threshold = Math.max(20, Math.min(60, 0.15 * bbox.diagonal));
  const first = pts[0];
  const last = pts[pts.length - 1];
  const dist = Math.hypot(last.x - first.x, last.y - first.y);
  const isOpenLoop = dist >= threshold;
  return {
    closed: [...pts, { x: first.x, y: first.y }],
    isOpenLoop,
  };
}

export function simplifyStroke(pts: Point[]): Point[] {
  const bbox = computeBBox(pts);
  let tol = Math.max(1.5, Math.min(5.0, 0.008 * bbox.diagonal));
  let simplified = simplify(pts, tol, true);

  for (let i = 0; i < 3; i++) {
    if (simplified.length <= MAX_VERTICES) break;
    tol *= 2;
    simplified = simplify(pts, tol, true);
  }

  if (simplified.length > MAX_VERTICES) {
    simplified = simplified.slice(0, MAX_VERTICES);
  }

  return simplified;
}

export function areaCentroid(pts: Point[]): { cx: number; cy: number; area: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    area += cross;
    cx += (pts[i].x + pts[j].x) * cross;
    cy += (pts[i].y + pts[j].y) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-8) {
    const avgX = pts.reduce((s, p) => s + p.x, 0) / n;
    const avgY = pts.reduce((s, p) => s + p.y, 0) / n;
    return { cx: avgX, cy: avgY, area: 0 };
  }
  cx /= 6 * area;
  cy /= 6 * area;
  return { cx, cy, area: Math.abs(area) };
}

export function convexDecompose(pts: Point[]): Point[][] {
  const poly: Polygon = pts.map((p) => [p.x, p.y] as DecompPoint);
  makeCCW(poly);
  let pieces = quickDecomp(poly);

  if (pieces.length > MAX_DECOMP_PIECES) {
    pieces = pieces.slice(0, MAX_DECOMP_PIECES);
  }

  return pieces.map((piece) =>
    piece.map((v: DecompPoint) => ({ x: v[0], y: v[1] }))
  );
}

export function processDraw(
  rawPoints: Point[],
  totalTravel: number
): DrawResult | null {
  if (rawPoints.length < MIN_SAMPLES || totalTravel < MIN_TRAVEL) {
    return null;
  }

  const { closed, isOpenLoop } = closeLoop(rawPoints);
  const simplified = simplifyStroke(closed);

  if (simplified.length < MIN_VERTICES) {
    return null;
  }

  const { cx, cy, area } = areaCentroid(simplified);
  if (area < 1e-4) {
    return null;
  }

  const bodyLocal = simplified.map((p) => ({
    x: p.x - cx,
    y: p.y - cy,
  }));

  // closeLoop appends the first point to close the polygon; strip the
  // duplicate to avoid a degenerate zero-area triangle in the physics fan decomposition.
  if (
    bodyLocal.length > 1 &&
    Math.hypot(
      bodyLocal[0].x - bodyLocal[bodyLocal.length - 1].x,
      bodyLocal[0].y - bodyLocal[bodyLocal.length - 1].y,
    ) < 1e-6
  ) {
    bodyLocal.pop();
  }

  const convexPieces = convexDecompose(bodyLocal);
  const bbox = computeBBox(bodyLocal);

  return {
    vertices: bodyLocal,
    centroid: { x: cx, y: cy },
    convexPieces,
    isOpenLoop,
    area,
    bboxDiagonal: bbox.diagonal,
  };
}
