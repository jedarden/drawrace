import { Vec2 } from "planck";
import type { Body, Contact } from "planck";

export type SurfaceType = "normal" | "ice" | "snow" | "water" | "mud" | "rock";

export const SURFACE_TYPES: readonly SurfaceType[] = [
  "normal", "ice", "snow", "water", "mud", "rock",
] as const;

export interface SurfacePreset {
  friction: number;
  restitution: number;
  drag: number;
}

export const SURFACE_PRESETS: Record<SurfaceType, SurfacePreset> = {
  normal: { friction: 0.9,  restitution: 0.0,  drag: 0 },
  ice:    { friction: 0.10, restitution: 0.0,  drag: 0 },
  snow:   { friction: 0.45, restitution: 0.0,  drag: 0 },
  water:  { friction: 0.05, restitution: 0.0,  drag: 4.0 },
  mud:    { friction: 0.70, restitution: 0.0,  drag: 1.5 },
  rock:   { friction: 0.95, restitution: 0.25, drag: 0 },
};

export interface SurfaceSegment {
  x_range: [number, number];
  type: SurfaceType;
}

const VALID_SURFACE_SET = new Set<string>(SURFACE_TYPES);

export function isValidSurfaceType(type: string): type is SurfaceType {
  return VALID_SURFACE_SET.has(type);
}

export function parseSurfaces(
  raw: unknown,
  terrainMinX: number,
  terrainMaxX: number,
): SurfaceSegment[] {
  if (!raw || !Array.isArray(raw) || raw.length === 0) {
    return [{ x_range: [terrainMinX, terrainMaxX], type: "normal" }];
  }

  const segments: SurfaceSegment[] = [];

  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i];
    if (
      !seg || typeof seg !== "object" || Array.isArray(seg) ||
      !Array.isArray((seg as Record<string, unknown>).x_range) ||
      typeof (seg as Record<string, unknown>).type !== "string"
    ) {
      throw new Error(`Invalid surface segment at index ${i}: ${JSON.stringify(seg)}`);
    }
    const s = seg as { x_range: unknown[]; type: string };
    if (s.x_range.length !== 2 || typeof s.x_range[0] !== "number" || typeof s.x_range[1] !== "number") {
      throw new Error(`Invalid x_range in surface segment at index ${i}`);
    }
    if (!isValidSurfaceType(s.type)) {
      throw new Error(`Unknown surface type "${s.type}" in segment at index ${i}`);
    }
    segments.push({
      x_range: [s.x_range[0], s.x_range[1]],
      type: s.type,
    });
  }

  segments.sort((a, b) => a.x_range[0] - b.x_range[0]);

  let prevEnd = terrainMinX;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (Math.abs(seg.x_range[0] - prevEnd) > 1e-6) {
      throw new Error(
        `Surface gap or overlap at x=${prevEnd}: segment ${i} starts at ${seg.x_range[0]}`,
      );
    }
    prevEnd = seg.x_range[1];
  }
  if (Math.abs(prevEnd - terrainMaxX) > 1e-6) {
    throw new Error(
      `Surface coverage gap: last segment ends at ${prevEnd}, terrain ends at ${terrainMaxX}`,
    );
  }

  return segments;
}

export function lookupSurface(x: number, surfaces: SurfaceSegment[]): SurfacePreset {
  let lo = 0;
  let hi = surfaces.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = surfaces[mid];
    if (x < seg.x_range[0]) {
      hi = mid - 1;
    } else if (x > seg.x_range[1]) {
      lo = mid + 1;
    } else {
      return SURFACE_PRESETS[seg.type];
    }
  }
  return SURFACE_PRESETS.normal;
}

export function applyDrag(chassisBody: Body, surfaces: SurfaceSegment[]): void {
  const cx = chassisBody.getPosition().x;
  const preset = lookupSurface(cx, surfaces);
  if (preset.drag > 0) {
    const vel = chassisBody.getLinearVelocity();
    chassisBody.applyForceToCenter(
      Vec2(-preset.drag * vel.x, -preset.drag * vel.y),
    );
  }
}

export function createSurfaceContactFilter(
  groundBody: Body,
  surfaces: SurfaceSegment[],
): (contact: Contact) => void {
  return (contact: Contact) => {
    const fA = contact.getFixtureA();
    const fB = contact.getFixtureB();

    if (fA.getBody() !== groundBody && fB.getBody() !== groundBody) return;

    const otherFixture = fA.getBody() === groundBody ? fB : fA;
    if (!otherFixture.getBody().isDynamic()) return;

    const wm = contact.getWorldManifold(null);
    if (!wm || !wm.points || wm.points.length === 0) return;

    const cx = wm.points[0].x;
    const preset = lookupSurface(cx, surfaces);

    contact.setFriction(otherFixture.getFriction() * preset.friction);
    contact.setRestitution(Math.max(otherFixture.getRestitution(), preset.restitution));
  };
}
