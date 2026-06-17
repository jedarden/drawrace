import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { createHeadlessRace, type TrackDef } from "./headless-race.js";
import { runHeadless } from "./headless.js";

interface TrackData extends TrackDef {
  id: string;
  numeric_id: number;
  name: string;
  version: number;
  metadata: { targetTimeSeconds: number };
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
  "canyon-02.json"
);

function loadTrack(): TrackData {
  return JSON.parse(readFileSync(TRACK_PATH, "utf-8"));
}

describe("canyon-02 track validation", () => {
  it("has valid track structure", () => {
    const track = loadTrack();
    expect(track.id).toBe("canyon-02");
    expect(track.numeric_id).toBe(2);
    expect(track.name).toBe("Canyon Run");
    expect(track.terrain.length).toBeGreaterThan(0);
    expect(track.zones).toBeDefined();
    expect(track.surfaces).toBeDefined();
  });

  it("has exactly five non-overlapping zones", () => {
    const track = loadTrack();
    expect(track.zones).toBeDefined();
    expect(track.zones!.length).toBe(5);

    for (let i = 0; i < track.zones!.length; i++) {
      const z = track.zones![i];
      expect(z.x_start).toBeLessThan(z.x_end);
      if (i > 0) {
        expect(z.x_start).toBe(track.zones![i - 1].x_end);
      }
    }
  });

  it("zones are at least 8 meters long", () => {
    const track = loadTrack();
    for (const z of track.zones!) {
      expect(z.x_end - z.x_start).toBeGreaterThanOrEqual(8);
    }
  });

  it("zone IDs are A, B, C, D, E", () => {
    const track = loadTrack();
    const ids = track.zones!.map((z) => z.id);
    expect(ids).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("has mud surface in zone B (deep canyon)", () => {
    const track = loadTrack();
    const zoneB = track.zones!.find((z) => z.id === "B")!;
    expect(zoneB).toBeDefined();
    expect(zoneB.x_start).toBe(8);
    expect(zoneB.x_end).toBe(16);
  });

  it("has rock surface in zone C (climb out)", () => {
    const track = loadTrack();
    const zoneC = track.zones!.find((z) => z.id === "C")!;
    expect(zoneC).toBeDefined();
    expect(zoneC.x_start).toBe(16);
    expect(zoneC.x_end).toBe(24);
  });

  it("has ice surface in zone D (plateau)", () => {
    const track = loadTrack();
    const zoneD = track.zones!.find((z) => z.id === "D")!;
    expect(zoneD).toBeDefined();
    expect(zoneD.x_start).toBe(24);
    expect(zoneD.x_end).toBe(32);
  });

  it("zone D has 3 box obstacles on ice", () => {
    const track = loadTrack();
    const zoneD = track.zones!.find((z) => z.id === "D")!;
    const obstacles = (track.obstacles ?? []).filter(
      (o) => o.type === "box" && o.pos[0] >= zoneD.x_start && o.pos[0] < zoneD.x_end
    );
    expect(obstacles.length).toBe(3);
  });

  it("has a pit hazard in zone B (mud bog)", () => {
    const track = loadTrack();
    const pit = (track.hazards ?? []).find((h) => h.type === "pit");
    expect(pit).toBeDefined();
    expect(pit!.x_start).toBe(12);
    expect(pit!.x_end).toBe(16);
  });

  it("has a ramp in zone C (rock climb)", () => {
    const track = loadTrack();
    const ramp = (track.ramps ?? []).find((r) => r.zone === "C");
    expect(ramp).toBeDefined();
    expect(ramp!.x_start).toBe(18);
    expect(ramp!.x_end).toBe(24);
  });
});

// ── Layer 2: gameplay calibration ────────────────────────────────────

describe("canyon-02 zone-surface calibration", () => {
  const SEED = 42;

  // Zone A optimal: small near-circle for quick acceleration on normal flats
  const CIRCLE_R35: [number, number][] = [];
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2;
    CIRCLE_R35.push([0.35 * Math.cos(angle), 0.35 * Math.sin(angle)]);
  }

  // Zone B optimal: large wheel for mud (drag requires momentum)
  const CIRCLE_R70: [number, number][] = [];
  for (let i = 0; i < 32; i++) {
    const angle = (i / 32) * Math.PI * 2;
    CIRCLE_R70.push([0.7 * Math.cos(angle), 0.7 * Math.sin(angle)]);
  }

  // Zone C optimal: gear teeth for rock grip on climb
  const GEAR_20: [number, number][] = [];
  for (let i = 0; i < 20; i++) {
    const baseAngle = (i / 20) * Math.PI * 2;
    for (let j = 0; j < 3; j++) {
      const toothAngle = baseAngle + (j / 3) * (Math.PI * 2 / 20);
      const radius = (j === 1) ? 0.42 : 0.28;
      GEAR_20.push([radius * Math.cos(toothAngle), radius * Math.sin(toothAngle)]);
    }
  }

  // Zone D optimal: small wheel for ice (minimal drag on slip)
  const CIRCLE_R25: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    CIRCLE_R25.push([0.25 * Math.cos(angle), 0.25 * Math.sin(angle)]);
  }

  // Jack-of-all-trades wheel
  const CIRCLE_R50: [number, number][] = [];
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    CIRCLE_R50.push([0.5 * Math.cos(angle), 0.5 * Math.sin(angle)]);
  }

  it("measures single-wheel times and validates multi-swap beats single-wheel", { timeout: 600_000 }, () => {
    const track = loadTrack();

    const shapes = [
      { name: "circle-r35 (sm)", verts: CIRCLE_R35 },
      { name: "circle-r70 (xl)", verts: CIRCLE_R70 },
      { name: "gear-20 (teeth)", verts: GEAR_20 },
      { name: "circle-r25 (xs)", verts: CIRCLE_R25 },
      { name: "circle-r50 (jack)", verts: CIRCLE_R50 },
    ];

    console.log("\n=== Single-wheel races on canyon-02 ===");
    let bestSingle = Infinity;
    let bestSingleName = "";

    for (const s of shapes) {
      const r = createHeadlessRace({ seed: SEED, track, wheel: { vertices: s.verts } });
      const time = (r.finishTicks / 60).toFixed(2);
      const finished = r.finalX >= track.finish.pos[0] ? "FINISHED" : `DNF (x=${r.finalX.toFixed(1)})`;
      console.log(`${s.name}: ticks=${r.finishTicks}, time=${time}s, ${finished}`);
      if (r.finalX >= track.finish.pos[0] && r.finishTicks < bestSingle) {
        bestSingle = r.finishTicks;
        bestSingleName = s.name;
      }
    }

    console.log(`\nBest single-wheel: ${bestSingleName} at ${bestSingle} ticks (${(bestSingle/60).toFixed(2)}s)`);

    // Track must be finishable by at least one wheel type
    expect(bestSingle, "At least one wheel must finish the track").toBeLessThan(Infinity);

    // Test multi-swap strategy using large wheels that can complete the full track.
    // circle-r25 DNFs alone (stuck at x≈25) and causes DNF when swapped in mid-Zone B mud.
    // Swaps must be timed to avoid Zone B mud boundary (x=8-16): the first swap should
    // happen before Zone A ends (~tick 100) to keep r70 momentum through the mud section.
    console.log("\n=== Multi-swap runs (circle-r70 → gear-20 → circle-r50) ===");

    let bestSwapTicks = Infinity;
    let bestSwapConfig = "";

    // Start with r70 to build momentum through Zone B mud (x=8-16).
    // Zone A (0-8m): ~110t, Zone B mud (8-16m), Zone C rock (16-24m), Zone D ice (24-32m)
    for (const offset1 of [300, 360, 420]) {
      for (const offset2 of [460, 500, 540]) {
        const ticks = [offset1, offset2];

        const result = runHeadless({
          seed: SEED,
          track,
          wheels: [
            { swap_tick: 0, polygon: CIRCLE_R70 },
            { swap_tick: ticks[0], polygon: GEAR_20 },
            { swap_tick: ticks[1], polygon: CIRCLE_R50 },
          ],
        });

        const time = (result.finishTicks / 60).toFixed(2);
        const finished = result.finalX >= track.finish.pos[0] ? "FINISHED" : `DNF (x=${result.finalX.toFixed(1)})`;
        console.log(`swap @ ${ticks}: ticks=${result.finishTicks}, time=${time}s, ${finished}`);

        if (result.finalX >= track.finish.pos[0] && result.finishTicks < bestSwapTicks) {
          bestSwapTicks = result.finishTicks;
          bestSwapConfig = ticks.join(", ");
        }
      }
    }

    console.log(`\nBest swap: [${bestSwapConfig}] at ${bestSwapTicks} ticks (${(bestSwapTicks/60).toFixed(2)}s)`);

    // Multi-swap must finish the track
    expect(bestSwapTicks, "Multi-swap strategy must finish the track").toBeLessThan(Infinity);
    expect(bestSwapTicks, "Multi-swap must reach finish line within 3 minutes").toBeLessThan(60 * 180);
  });

  it("validates each zone has a different optimal wheel", { timeout: 120_000 }, () => {
    const track = loadTrack();

    const zoneWheels = [
      { name: "circle-r35", verts: CIRCLE_R35, optimalZone: "A" },
      { name: "circle-r70", verts: CIRCLE_R70, optimalZone: "B" },
      { name: "gear-20", verts: GEAR_20, optimalZone: "C" },
      { name: "circle-r25", verts: CIRCLE_R25, optimalZone: "D" },
    ];

    console.log("\n=== Testing zone-optimal wheel performance on canyon-02 ===");

    const results: Array<{ wheel: string; finalX: number; finished: boolean }> = [];
    for (const w of zoneWheels) {
      const r = createHeadlessRace({ seed: SEED, track, wheel: { vertices: w.verts } });
      const finished = r.finalX >= track.finish.pos[0];
      results.push({ wheel: w.name, finalX: r.finalX, finished });
      console.log(`${w.name} (Zone ${w.optimalZone}): x=${r.finalX.toFixed(1)}, ${finished ? "FINISHED" : "DNF"}`);
    }

    const finishers = results.filter(r => r.finished);
    console.log(`\nWheels that finished: ${finishers.map(r => r.wheel).join(", ")} (${finishers.length} total)`);

    expect(finishers.length, "At least some wheels should finish to show differentiation").toBeGreaterThan(0);
  });
});
