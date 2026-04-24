import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

interface Zone {
  id: string;
  x_start: number;
  x_end: number;
}

interface TrackData {
  terrain: [number, number][];
  zones?: Zone[];
  obstacles?: Array<{ type: string; pos: [number, number]; size?: [number, number] }>;
  finish: { pos: [number, number]; width: number };
}

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

function loadTrack(): TrackData {
  return JSON.parse(readFileSync(TRACK_PATH, "utf-8"));
}

describe("hills-01 zones", () => {
  it("has exactly four non-overlapping zones", () => {
    const track = loadTrack();
    expect(track.zones).toBeDefined();
    expect(track.zones!.length).toBe(4);

    for (let i = 0; i < track.zones!.length; i++) {
      const z = track.zones![i];
      expect(z.x_start).toBeLessThan(z.x_end);
      if (i > 0) {
        expect(z.x_start).toBe(track.zones![i - 1].x_end);
      }
    }
  });

  it("zones have ordered contiguous x_start/x_end", () => {
    const track = loadTrack();
    const zones = track.zones!;
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].x_start).toBe(zones[i - 1].x_end);
    }
  });

  it("aggregate zone length matches terrain extent", () => {
    const track = loadTrack();
    const zones = track.zones!;

    const terrainMinX = track.terrain[0][0];
    const terrainMaxX = track.terrain[track.terrain.length - 1][0];

    expect(zones[0].x_start).toBe(terrainMinX);
    expect(zones[zones.length - 1].x_end).toBeLessThanOrEqual(terrainMaxX);

    const totalZoneLength = zones.reduce((sum, z) => sum + (z.x_end - z.x_start), 0);
    expect(totalZoneLength).toBe(zones[zones.length - 1].x_end - zones[0].x_start);
  });

  it("each zone is at least 8 meters long (>=8 seconds at ~1 m/s)", () => {
    const track = loadTrack();
    for (const z of track.zones!) {
      expect(z.x_end - z.x_start).toBeGreaterThanOrEqual(8);
    }
  });

  it("zone IDs are A, B, C, D", () => {
    const track = loadTrack();
    const ids = track.zones!.map((z) => z.id);
    expect(ids).toEqual(["A", "B", "C", "D"]);
  });

  it("zone C has 3 box obstacles", () => {
    const track = loadTrack();
    const zoneC = track.zones!.find((z) => z.id === "C")!;
    const obstacles = (track.obstacles ?? []).filter(
      (o) => o.type === "box" && o.pos[0] >= zoneC.x_start && o.pos[0] < zoneC.x_end
    );
    expect(obstacles.length).toBe(3);
  });
});
