import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { parseSurfaces, validateZones, type SurfaceSegment, createHeadlessRace, type TrackDef, type WheelDef, hashSeed } from "@drawrace/engine-core";

export interface TrackPoint {
  x: number;
  y: number;
}

export interface TrackData {
  id: string;
  numeric_id: number;
  name: string;
  version: number;
  world: {
    gravity: [number, number];
    pixelsPerMeter: number;
  };
  camera: {
    followAxis: "x";
    deadzone: [number, number];
    maxZoomOut: number;
  };
  terrain: TrackPoint[];
  surfaces: SurfaceSegment[];
  obstacles: Array<{
    type: "box" | "circle";
    pos: [number, number];
    size?: [number, number];
    radius?: number;
    angle?: number;
    friction?: number;
  }>;
  ramps: Array<{
    zone: string;
    x_start: number;
    x_end: number;
  }>;
  hazards: Array<{
    type: "pit";
    x_start: number;
    x_end: number;
    y?: number;
    depthMeters?: number;
  }>;
  zones: Array<{
    id: string;
    x_start: number;
    x_end: number;
  }>;
  start: {
    pos: [number, number];
    facing: number;
  };
  finish: {
    pos: [number, number];
    width: number;
  };
  metadata: {
    targetTimeSeconds: number;
    tutorialGhosts: string[];
  };
}

const SURFACE_TYPES = ["normal", "ice", "snow", "water", "mud", "rock"] as const;
const SURFACE_COLORS: Record<string, string> = {
  normal: "#E5D3B0",
  ice: "#D6EAF0",
  snow: "#F0EDE6",
  water: "#B8D4E3",
  mud: "#C4A96A",
  rock: "#B8A99A",
};

interface TrackEditorProps {
  initialTrack?: Partial<TrackData>;
  onSave: (track: TrackData) => void;
  onCancel: () => void;
}

const PPM = 30; // pixels per meter
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 600;
const VIEWPORT_SCALE = 60; // pixels per meter in editor

function worldToScreen(x: number, y: number, offsetX: number = 0): { x: number; y: number } {
  return {
    x: x * VIEWPORT_SCALE + offsetX,
    y: CANVAS_HEIGHT - 50 - (y * VIEWPORT_SCALE), // flip Y, 50px bottom margin
  };
}

function screenToWorld(sx: number, sy: number, offsetX: number = 0): TrackPoint {
  return {
    x: (sx - offsetX) / VIEWPORT_SCALE,
    y: (CANVAS_HEIGHT - 50 - sy) / VIEWPORT_SCALE,
  };
}

export function TrackEditor({ initialTrack, onSave, onCancel }: TrackEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [track, setTrack] = useState<TrackData>(() => ({
    id: initialTrack?.id || `community-${Date.now()}`,
    numeric_id: initialTrack?.numeric_id || 100,
    name: initialTrack?.name || "New Track",
    version: initialTrack?.version || 1,
    world: initialTrack?.world || { gravity: [0, 10], pixelsPerMeter: 30 },
    camera: initialTrack?.camera || { followAxis: "x", deadzone: [120, 80], maxZoomOut: 1.0 },
    terrain: initialTrack?.terrain || [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
      { x: 40, y: 0 },
    ],
    surfaces: initialTrack?.surfaces || [{ x_range: [0, 40], type: "normal" }],
    obstacles: initialTrack?.obstacles || [],
    ramps: initialTrack?.ramps || [],
    hazards: initialTrack?.hazards || [],
    zones: initialTrack?.zones || [{ id: "A", x_start: 0, x_end: 40 }],
    start: initialTrack?.start || { pos: [1.5, -1.5], facing: 1 },
    finish: initialTrack?.finish || { pos: [39, 0], width: 0.2 },
    metadata: initialTrack?.metadata || { targetTimeSeconds: 45, tutorialGhosts: [] },
  }));

  const [editMode, setEditMode] = useState<"terrain" | "obstacles" | "surfaces" | "zones" | "ramps" | "hazards" | "metadata" | "startfinish">("terrain");
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [draggingPoint, setDraggingPoint] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  // Simulation state
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ finishTime: number; stuck: boolean; finished: boolean } | null>(null);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = "#F4EAD5";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid
    ctx.strokeStyle = "rgba(43, 33, 24, 0.1)";
    ctx.lineWidth = 1;
    const gridSize = VIEWPORT_SCALE; // 1 meter grid
    for (let x = offsetX % gridSize; x < CANVAS_WIDTH; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Draw surfaces
    track.surfaces.forEach((surface) => {
      const startX = worldToScreen(surface.x_range[0], 0, offsetX).x;
      const endX = worldToScreen(surface.x_range[1], 0, offsetX).x;
      ctx.fillStyle = SURFACE_COLORS[surface.type] || SURFACE_COLORS.normal;
      ctx.fillRect(startX, 0, endX - startX, CANVAS_HEIGHT);
    });

    // Draw terrain
    if (track.terrain.length >= 2) {
      ctx.beginPath();
      const first = worldToScreen(track.terrain[0].x, track.terrain[0].y, offsetX);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < track.terrain.length; i++) {
        const pt = worldToScreen(track.terrain[i].x, track.terrain[i].y, offsetX);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = "#2B2118";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      // Draw control points
      track.terrain.forEach((pt, i) => {
        const scr = worldToScreen(pt.x, pt.y, offsetX);
        ctx.beginPath();
        ctx.arc(scr.x, scr.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = selectedPoint === i ? "#D94F3A" : "#FFFFFF";
        ctx.fill();
        ctx.strokeStyle = "#2B2118";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    // Draw obstacles
    track.obstacles.forEach((obs, i) => {
      const pos = worldToScreen(obs.pos[0], obs.pos[1], offsetX);
      ctx.fillStyle = "#8B4513";
      if (obs.type === "box" && obs.size) {
        const width = obs.size[0] * VIEWPORT_SCALE;
        const height = obs.size[1] * VIEWPORT_SCALE;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(obs.angle || 0);
        ctx.fillRect(-width / 2, -height / 2, width, height);
        ctx.restore();
      } else if (obs.type === "circle" && obs.radius) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, obs.radius * VIEWPORT_SCALE, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Draw start position
    const start = worldToScreen(track.start.pos[0], track.start.pos[1], offsetX);
    ctx.fillStyle = "rgba(0, 128, 0, 0.3)";
    ctx.beginPath();
    ctx.arc(start.x, start.y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#008000";
    ctx.font = "12px sans-serif";
    ctx.fillText("START", start.x - 20, start.y - 20);

    // Draw finish line
    const finish = worldToScreen(track.finish.pos[0], track.finish.pos[1], offsetX);
    ctx.strokeStyle = "#D94F3A";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(finish.x, finish.y - track.finish.width * VIEWPORT_SCALE);
    ctx.lineTo(finish.x, finish.y + track.finish.width * VIEWPORT_SCALE);
    ctx.stroke();
    ctx.fillStyle = "#D94F3A";
    ctx.font = "12px sans-serif";
    ctx.fillText("FINISH", finish.x + 10, finish.y);

    // Draw zone markers
    track.zones.forEach((zone, i) => {
      const startX = worldToScreen(zone.x_start, 0, offsetX).x;
      const endX = worldToScreen(zone.x_end, 0, offsetX).x;
      ctx.fillStyle = "rgba(43, 33, 24, 0.1)";
      ctx.fillRect(startX, 0, endX - startX, 30);
      ctx.fillStyle = "#2B2118";
      ctx.font = "14px sans-serif";
      ctx.fillText(`Zone ${zone.id}`, startX + 5, 20);
    });

    // Draw ramps
    track.ramps.forEach((ramp) => {
      const startX = worldToScreen(ramp.x_start, 0, offsetX).x;
      const endX = worldToScreen(ramp.x_end, 0, offsetX).x;
      ctx.fillStyle = "rgba(216, 79, 58, 0.3)";
      ctx.fillRect(startX, 0, endX - startX, 10);
      ctx.fillStyle = "#D94F3A";
      ctx.font = "12px sans-serif";
      ctx.fillText(`RAMP (${ramp.zone})`, startX + 5, CANVAS_HEIGHT - 60);
    });

    // Draw hazards (pits)
    track.hazards.forEach((hazard) => {
      if (hazard.type === "pit") {
        const startX = worldToScreen(hazard.x_start, hazard.y || -2, offsetX).x;
        const endX = worldToScreen(hazard.x_end, hazard.y || -2, offsetX).x;
        const depth = (hazard.depthMeters || 2) * VIEWPORT_SCALE;
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(startX, CANVAS_HEIGHT - 50, endX - startX, depth);
        ctx.strokeStyle = "#D94F3A";
        ctx.lineWidth = 2;
        ctx.strokeRect(startX, CANVAS_HEIGHT - 50, endX - startX, depth);
        ctx.fillStyle = "#D94F3A";
        ctx.font = "12px sans-serif";
        ctx.fillText("PIT", startX + 5, CANVAS_HEIGHT - 55);
      }
    });

    // Draw scale indicator
    ctx.fillStyle = "#2B2118";
    ctx.fillRect(20, CANVAS_HEIGHT - 40, 60, 2);
    ctx.font = "12px sans-serif";
    ctx.fillText("1m", 45, CANVAS_HEIGHT - 45);
  }, [track, selectedPoint, offsetX]);

  useEffect(() => {
    render();
  }, [render]);

  // Create test wheel (circle)
  const createTestWheel = useCallback((): WheelDef => {
    // Create a circle with 32 vertices
    const vertices: [number, number][] = [];
    const radius = 0.4;
    const segments = 32;
    for (let i = 0; i < segments; i++) {
      const angle = (2 * Math.PI * i) / segments;
      vertices.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
    }
    return { vertices };
  }, []);

  // Run test simulation
  const runTestSimulation = useCallback(async () => {
    if (!validateTrack()) return;

    setSimulating(true);
    setSimResult(null);

    // Allow UI to update before running heavy simulation
    setTimeout(() => {
      try {
        const playerId = localStorage.getItem('drawrace.player_uuid') || 'test-player';
        const seed = hashSeed(track.id, playerId, 0);

        const trackDef: TrackDef = {
          id: track.id,
          world: track.world,
          terrain: track.terrain.map(p => [p.x, p.y]) as [number, number][],
          obstacles: track.obstacles,
          zones: track.zones,
          ramps: track.ramps.map(r => ({
            zone: r.zone,
            x_start: r.x_start,
            x_end: r.x_end,
            type: 'ramp' as any,
          })),
          hazards: track.hazards.map(h => ({
            zone: '',
            type: h.type,
            x_start: h.x_start,
            x_end: h.x_end,
          })),
          surfaces: track.surfaces,
          start: track.start,
          finish: track.finish,
        };

        const wheelDef = createTestWheel();

        const result = createHeadlessRace({
          seed,
          track: trackDef,
          wheel: wheelDef,
          playerId,
          runIndex: 0,
        });

        const finishTime = result.finishTicks / 60; // Convert to seconds
        setSimResult({
          finishTime,
          stuck: result.stuck,
          finished: result.finalX >= track.finish.pos[0],
        });
      } catch (e) {
        console.error('Simulation failed:', e);
        setValidationError(e instanceof Error ? e.message : String(e));
      } finally {
        setSimulating(false);
      }
    }, 10);
  }, [track, validateTrack, createTestWheel]);

  // Validate track
  const validateTrack = useCallback(() => {
    try {
      if (track.terrain.length < 2) {
        throw new Error("Terrain must have at least 2 points");
      }

      const minX = track.terrain[0].x;
      const maxX = track.terrain[track.terrain.length - 1].x;

      // Validate surfaces
      parseSurfaces(track.surfaces, minX, maxX);

      // Validate zones
      validateZones(track.zones, minX, maxX);

      setValidationError(null);
      return true;
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, [track]);

  // Handle canvas interactions
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (editMode !== "terrain") return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Find if clicked on a point
      for (let i = 0; i < track.terrain.length; i++) {
        const pt = worldToScreen(track.terrain[i].x, track.terrain[i].y, offsetX);
        const dist = Math.sqrt((x - pt.x) ** 2 + (y - pt.y) ** 2);
        if (dist < 10) {
          setDraggingPoint(i);
          setSelectedPoint(i);
          return;
        }
      }

      // Add new point
      const worldPt = screenToWorld(x, y, offsetX);
      const newTerrain = [...track.terrain];
      // Insert in X order
      let insertIndex = newTerrain.findIndex((pt) => pt.x > worldPt.x);
      if (insertIndex === -1) insertIndex = newTerrain.length;
      newTerrain.splice(insertIndex, 0, worldPt);
      setTrack((prev) => ({ ...prev, terrain: newTerrain }));
      setSelectedPoint(insertIndex);
    },
    [editMode, track.terrain, offsetX]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (draggingPoint === null) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const worldPt = screenToWorld(x, y, offsetX);

      const newTerrain = [...track.terrain];
      // Keep X monotonic - clamp to neighbors
      const minX = draggingPoint > 0 ? newTerrain[draggingPoint - 1].x + 0.1 : 0;
      const maxX =
        draggingPoint < newTerrain.length - 1
          ? newTerrain[draggingPoint + 1].x - 0.1
          : 1000;
      worldPt.x = Math.max(minX, Math.min(maxX, worldPt.x));

      newTerrain[draggingPoint] = worldPt;
      setTrack((prev) => ({ ...prev, terrain: newTerrain }));
    },
    [draggingPoint, track.terrain, offsetX]
  );

  const handlePointerUp = useCallback(() => {
    setDraggingPoint(null);
  }, []);

  const handleDeletePoint = useCallback(() => {
    if (selectedPoint === null || track.terrain.length <= 2) return;
    const newTerrain = track.terrain.filter((_, i) => i !== selectedPoint);
    setTrack((prev) => ({ ...prev, terrain: newTerrain }));
    setSelectedPoint(null);
  }, [selectedPoint, track.terrain.length]);

  const handleAddSurface = useCallback(() => {
    const lastX = track.surfaces.length > 0 ? track.surfaces[track.surfaces.length - 1].x_range[1] : 0;
    setTrack((prev) => ({
      ...prev,
      surfaces: [...prev.surfaces, { x_range: [lastX, lastX + 10], type: "normal" }],
    }));
  }, [track.surfaces]);

  const handleSave = useCallback(() => {
    // First validate track structure
    if (!validateTrack()) return;

    // Validate that track is playable by running a simulation
    try {
      const playerId = localStorage.getItem('drawrace.player_uuid') || 'validator';
      const seed = hashSeed(track.id, playerId, 0);

      const trackDef: TrackDef = {
        id: track.id,
        world: track.world,
        terrain: track.terrain.map(p => [p.x, p.y]) as [number, number][],
        obstacles: track.obstacles,
        zones: track.zones,
        ramps: track.ramps.map(r => ({
          zone: r.zone,
          x_start: r.x_start,
          x_end: r.x_end,
          type: 'ramp' as any,
        })),
        hazards: track.hazards.map(h => ({
          zone: '',
          type: h.type,
          x_start: h.x_start,
          x_end: h.x_end,
        })),
        surfaces: track.surfaces,
        start: track.start,
        finish: track.finish,
      };

      const wheelDef = createTestWheel();

      const result = createHeadlessRace({
        seed,
        track: trackDef,
        wheel: wheelDef,
        playerId,
        runIndex: 0,
      });

      // Check if track is playable (wheel can finish)
      const finishX = track.finish.pos[0];
      if (result.finalX < finishX) {
        if (result.stuck) {
          setValidationError("Track is not playable: test wheel got stuck. Adjust terrain to ensure wheels can progress.");
          return;
        }
        setValidationError("Track is not playable: test wheel could not reach finish line. Make the track less difficult.");
        return;
      }

      // Track passed validation
      onSave(track);
    } catch (e) {
      setValidationError(e instanceof Error ? e.message : String(e));
    }
  }, [validateTrack, track, onSave, createTestWheel]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#F4EAD5" }}>
      <div style={{ display: "flex", padding: "10px", gap: "10px", alignItems: "center", borderBottom: "1px solid #2B2118" }}>
        <h2 style={{ margin: 0, fontSize: "20px" }}>Track Editor</h2>
        <input
          type="text"
          value={track.name}
          onChange={(e) => setTrack((prev) => ({ ...prev, name: e.target.value }))}
          style={{ padding: "5px", fontSize: "14px" }}
          placeholder="Track name"
        />
        <div style={{ flex: 1 }} />
        <button
          onClick={runTestSimulation}
          disabled={simulating}
          style={{
            padding: "8px 16px",
            backgroundColor: "#7CA05C",
            color: "white",
            border: "none",
            opacity: simulating ? 0.6 : 1,
          }}
        >
          {simulating ? "Testing..." : "Test Drive"}
        </button>
        <button onClick={onCancel} style={{ padding: "8px 16px" }}>
          Cancel
        </button>
        <button onClick={handleSave} style={{ padding: "8px 16px", backgroundColor: "#D94F3A", color: "white", border: "none" }}>
          Save Track
        </button>
      </div>

      <div style={{ display: "flex", flex: 1 }}>
        <div style={{ width: "280px", padding: "10px", backgroundColor: "rgba(43, 33, 24, 0.05)", borderRight: "1px solid #2B2118", overflowY: "auto" }}>
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Edit Mode</h3>
            <select
              value={editMode}
              onChange={(e) => setEditMode(e.target.value as any)}
              style={{ width: "100%", padding: "5px" }}
            >
              <option value="terrain">Terrain</option>
              <option value="surfaces">Surfaces</option>
              <option value="obstacles">Obstacles</option>
              <option value="ramps">Ramps</option>
              <option value="hazards">Hazards</option>
              <option value="zones">Zones</option>
              <option value="startfinish">Start/Finish</option>
              <option value="metadata">Metadata</option>
            </select>
          </div>

          {editMode === "terrain" && (
            <div>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Terrain Tools</h3>
              <p style={{ fontSize: "12px", color: "#2B2118" }}>
                Click to add points, drag to move. Selected point: {selectedPoint ?? "none"}
              </p>
              <button onClick={handleDeletePoint} disabled={selectedPoint === null} style={{ width: "100%", padding: "8px", marginBottom: "10px" }}>
                Delete Point
              </button>
              <div style={{ marginTop: "10px" }}>
                <label style={{ fontSize: "12px" }}>Scroll X:</label>
                <input
                  type="range"
                  min="0"
                  max="500"
                  value={offsetX}
                  onChange={(e) => setOffsetX(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
                <span style={{ fontSize: "12px" }}>{Math.round(offsetX)}px</span>
              </div>
            </div>
          )}

          {editMode === "surfaces" && (
            <div>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Surfaces</h3>
              <button onClick={handleAddSurface} style={{ width: "100%", padding: "8px", marginBottom: "10px" }}>
                + Add Surface
              </button>
              {track.surfaces.map((surf, i) => (
                <div key={i} style={{ marginBottom: "10px", padding: "10px", backgroundColor: "white", borderRadius: "4px" }}>
                  <select
                    value={surf.type}
                    onChange={(e) => {
                      const newSurfaces = [...track.surfaces];
                      newSurfaces[i] = { ...surf, type: e.target.value as any };
                      setTrack((prev) => ({ ...prev, surfaces: newSurfaces }));
                    }}
                    style={{ width: "100%", padding: "5px", marginBottom: "5px" }}
                  >
                    {SURFACE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "flex", gap: "5px" }}>
                    <input
                      type="number"
                      value={surf.x_range[0]}
                      onChange={(e) => {
                        const newSurfaces = [...track.surfaces];
                        newSurfaces[i] = { ...surf, x_range: [Number(e.target.value), surf.x_range[1]] };
                        setTrack((prev) => ({ ...prev, surfaces: newSurfaces }));
                      }}
                      style={{ width: "50%", padding: "5px" }}
                      placeholder="Start X"
                    />
                    <input
                      type="number"
                      value={surf.x_range[1]}
                      onChange={(e) => {
                        const newSurfaces = [...track.surfaces];
                        newSurfaces[i] = { ...surf, x_range: [surf.x_range[0], Number(e.target.value)] };
                        setTrack((prev) => ({ ...prev, surfaces: newSurfaces }));
                      }}
                      style={{ width: "50%", padding: "5px" }}
                      placeholder="End X"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const newSurfaces = track.surfaces.filter((_, j) => j !== i);
                      setTrack((prev) => ({ ...prev, surfaces: newSurfaces }));
                    }}
                    style={{ width: "100%", padding: "5px", marginTop: "5px", backgroundColor: "#D94F3A", color: "white", border: "none" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {editMode === "obstacles" && (
            <div>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Obstacles</h3>
              <button
                onClick={() => {
                  setTrack((prev) => ({
                    ...prev,
                    obstacles: [...prev.obstacles, { type: "box", pos: [10, 1], size: [0.5, 0.5], angle: 0, friction: 0.8 }],
                  }));
                }}
                style={{ width: "100%", padding: "8px", marginBottom: "10px" }}
              >
                + Add Box
              </button>
              {track.obstacles.map((obs, i) => (
                <div key={i} style={{ marginBottom: "10px", padding: "10px", backgroundColor: "white", borderRadius: "4px" }}>
                  <div style={{ marginBottom: "5px" }}>
                    <label style={{ fontSize: "12px" }}>Type:</label>
                    <select
                      value={obs.type}
                      onChange={(e) => {
                        const newObs = [...track.obstacles];
                        newObs[i] = { ...obs, type: e.target.value as any };
                        setTrack((prev) => ({ ...prev, obstacles: newObs }));
                      }}
                      style={{ marginLeft: "5px", padding: "5px" }}
                    >
                      <option value="box">Box</option>
                      <option value="circle">Circle</option>
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      const newObs = track.obstacles.filter((_, j) => j !== i);
                      setTrack((prev) => ({ ...prev, obstacles: newObs }));
                    }}
                    style={{ width: "100%", padding: "5px", backgroundColor: "#D94F3A", color: "white", border: "none" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {editMode === "zones" && (
            <div>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Zones</h3>
              <button
                onClick={() => {
                  const lastX = track.zones.length > 0 ? track.zones[track.zones.length - 1].x_end : 0;
                  setTrack((prev) => ({
                    ...prev,
                    zones: [...prev.zones, { id: String.fromCharCode(65 + track.zones.length), x_start: lastX, x_end: lastX + 10 }],
                  }));
                }}
                style={{ width: "100%", padding: "8px", marginBottom: "10px" }}
              >
                + Add Zone
              </button>
              {track.zones.map((zone, i) => (
                <div key={i} style={{ marginBottom: "10px", padding: "10px", backgroundColor: "white", borderRadius: "4px" }}>
                  <input
                    type="text"
                    value={zone.id}
                    onChange={(e) => {
                      const newZones = [...track.zones];
                      newZones[i] = { ...zone, id: e.target.value };
                      setTrack((prev) => ({ ...prev, zones: newZones }));
                    }}
                    style={{ width: "100%", padding: "5px", marginBottom: "5px" }}
                    placeholder="Zone ID"
                  />
                  <div style={{ display: "flex", gap: "5px" }}>
                    <input
                      type="number"
                      value={zone.x_start}
                      onChange={(e) => {
                        const newZones = [...track.zones];
                        newZones[i] = { ...zone, x_start: Number(e.target.value) };
                        setTrack((prev) => ({ ...prev, zones: newZones }));
                      }}
                      style={{ width: "50%", padding: "5px" }}
                      placeholder="Start X"
                    />
                    <input
                      type="number"
                      value={zone.x_end}
                      onChange={(e) => {
                        const newZones = [...track.zones];
                        newZones[i] = { ...zone, x_end: Number(e.target.value) };
                        setTrack((prev) => ({ ...prev, zones: newZones }));
                      }}
                      style={{ width: "50%", padding: "5px" }}
                      placeholder="End X"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const newZones = track.zones.filter((_, j) => j !== i);
                      setTrack((prev) => ({ ...prev, zones: newZones }));
                    }}
                    style={{ width: "100%", padding: "5px", marginTop: "5px", backgroundColor: "#D94F3A", color: "white", border: "none" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {editMode === "ramps" && (
            <div>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Ramps</h3>
              <p style={{ fontSize: "12px", color: "#2B2118", marginBottom: "10px" }}>
                Ramps launch the car upward when crossed in the linked zone.
              </p>
              <button
                onClick={() => {
                  const lastX = track.terrain[track.terrain.length - 1]?.x || 0;
                  setTrack((prev) => ({
                    ...prev,
                    ramps: [...prev.ramps, { zone: "A", x_start: lastX - 5, x_end: lastX }],
                  }));
                }}
                style={{ width: "100%", padding: "8px", marginBottom: "10px" }}
              >
                + Add Ramp
              </button>
              {track.ramps.map((ramp, i) => (
                <div key={i} style={{ marginBottom: "10px", padding: "10px", backgroundColor: "white", borderRadius: "4px" }}>
                  <div style={{ marginBottom: "5px" }}>
                    <label style={{ fontSize: "12px" }}>Zone:</label>
                    <select
                      value={ramp.zone}
                      onChange={(e) => {
                        const newRamps = [...track.ramps];
                        newRamps[i] = { ...ramp, zone: e.target.value };
                        setTrack((prev) => ({ ...prev, ramps: newRamps }));
                      }}
                      style={{ marginLeft: "5px", padding: "5px", width: "60%" }}
                    >
                      {track.zones.map((z) => (
                        <option key={z.id} value={z.id}>
                          {z.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: "5px" }}>
                    <input
                      type="number"
                      value={ramp.x_start}
                      onChange={(e) => {
                        const newRamps = [...track.ramps];
                        newRamps[i] = { ...ramp, x_start: Number(e.target.value) };
                        setTrack((prev) => ({ ...prev, ramps: newRamps }));
                      }}
                      style={{ width: "50%", padding: "5px" }}
                      placeholder="Start X"
                    />
                    <input
                      type="number"
                      value={ramp.x_end}
                      onChange={(e) => {
                        const newRamps = [...track.ramps];
                        newRamps[i] = { ...ramp, x_end: Number(e.target.value) };
                        setTrack((prev) => ({ ...prev, ramps: newRamps }));
                      }}
                      style={{ width: "50%", padding: "5px" }}
                      placeholder="End X"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const newRamps = track.ramps.filter((_, j) => j !== i);
                      setTrack((prev) => ({ ...prev, ramps: newRamps }));
                    }}
                    style={{ width: "100%", padding: "5px", marginTop: "5px", backgroundColor: "#D94F3A", color: "white", border: "none" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {editMode === "hazards" && (
            <div>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Hazards</h3>
              <p style={{ fontSize: "12px", color: "#2B2118", marginBottom: "10px" }}>
                Hazards like pits end the run if the car falls in.
              </p>
              <button
                onClick={() => {
                  const lastX = track.terrain[track.terrain.length - 1]?.x || 0;
                  setTrack((prev) => ({
                    ...prev,
                    hazards: [...prev.hazards, { type: "pit", x_start: lastX - 3, x_end: lastX - 1, y: -2, depthMeters: 2 }],
                  }));
                }}
                style={{ width: "100%", padding: "8px", marginBottom: "10px" }}
              >
                + Add Pit
              </button>
              {track.hazards.map((hazard, i) => (
                <div key={i} style={{ marginBottom: "10px", padding: "10px", backgroundColor: "white", borderRadius: "4px" }}>
                  <div style={{ marginBottom: "5px" }}>
                    <label style={{ fontSize: "12px" }}>Type:</label>
                    <select
                      value={hazard.type}
                      onChange={(e) => {
                        const newHazards = [...track.hazards];
                        newHazards[i] = { ...hazard, type: e.target.value as any };
                        setTrack((prev) => ({ ...prev, hazards: newHazards }));
                      }}
                      style={{ marginLeft: "5px", padding: "5px", width: "55%" }}
                    >
                      <option value="pit">Pit</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: "5px", marginBottom: "5px" }}>
                    <input
                      type="number"
                      value={hazard.x_start}
                      onChange={(e) => {
                        const newHazards = [...track.hazards];
                        newHazards[i] = { ...hazard, x_start: Number(e.target.value) };
                        setTrack((prev) => ({ ...prev, hazards: newHazards }));
                      }}
                      style={{ width: "33%", padding: "5px" }}
                      placeholder="Start X"
                    />
                    <input
                      type="number"
                      value={hazard.x_end}
                      onChange={(e) => {
                        const newHazards = [...track.hazards];
                        newHazards[i] = { ...hazard, x_end: Number(e.target.value) };
                        setTrack((prev) => ({ ...prev, hazards: newHazards }));
                      }}
                      style={{ width: "33%", padding: "5px" }}
                      placeholder="End X"
                    />
                    <input
                      type="number"
                      value={hazard.depthMeters || 2}
                      onChange={(e) => {
                        const newHazards = [...track.hazards];
                        newHazards[i] = { ...hazard, depthMeters: Number(e.target.value) };
                        setTrack((prev) => ({ ...prev, hazards: newHazards }));
                      }}
                      style={{ width: "33%", padding: "5px" }}
                      placeholder="Depth"
                    />
                  </div>
                  <button
                    onClick={() => {
                      const newHazards = track.hazards.filter((_, j) => j !== i);
                      setTrack((prev) => ({ ...prev, hazards: newHazards }));
                    }}
                    style={{ width: "100%", padding: "5px", marginTop: "5px", backgroundColor: "#D94F3A", color: "white", border: "none" }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {editMode === "startfinish" && (
            <div>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Start Position</h3>
              <p style={{ fontSize: "12px", color: "#2B2118", marginBottom: "10px" }}>
                Where the car spawns. Adjust X, Y, and facing direction.
              </p>
              <div style={{ marginBottom: "15px", padding: "10px", backgroundColor: "white", borderRadius: "4px" }}>
                <div style={{ display: "flex", gap: "5px", marginBottom: "5px" }}>
                  <input
                    type="number"
                    value={track.start.pos[0]}
                    onChange={(e) => {
                      setTrack((prev) => ({
                        ...prev,
                        start: { ...prev.start, pos: [Number(e.target.value), prev.start.pos[1]] },
                      }));
                    }}
                    style={{ width: "50%", padding: "5px" }}
                    placeholder="X"
                  />
                  <input
                    type="number"
                    value={track.start.pos[1]}
                    onChange={(e) => {
                      setTrack((prev) => ({
                        ...prev,
                        start: { ...prev.start, pos: [prev.start.pos[0], Number(e.target.value)] },
                      }));
                    }}
                    style={{ width: "50%", padding: "5px" }}
                    placeholder="Y"
                  />
                </div>
                <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                  <label style={{ fontSize: "12px" }}>Facing:</label>
                  <input
                    type="number"
                    value={track.start.facing}
                    onChange={(e) => {
                      setTrack((prev) => ({
                        ...prev,
                        start: { ...prev.start, facing: Number(e.target.value) },
                      }));
                    }}
                    style={{ width: "60%", padding: "5px" }}
                    placeholder="1 or -1"
                  />
                  <span style={{ fontSize: "11px", color: "#6E5F48" }}>(1 = right, -1 = left)</span>
                </div>
              </div>

              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Finish Line</h3>
              <p style={{ fontSize: "12px", color: "#2B2118", marginBottom: "10px" }}>
                Where the race ends. Adjust position and width.
              </p>
              <div style={{ marginBottom: "15px", padding: "10px", backgroundColor: "white", borderRadius: "4px" }}>
                <div style={{ display: "flex", gap: "5px", marginBottom: "5px" }}>
                  <input
                    type="number"
                    value={track.finish.pos[0]}
                    onChange={(e) => {
                      setTrack((prev) => ({
                        ...prev,
                        finish: { ...prev.finish, pos: [Number(e.target.value), prev.finish.pos[1]] },
                      }));
                    }}
                    style={{ width: "50%", padding: "5px" }}
                    placeholder="X"
                  />
                  <input
                    type="number"
                    value={track.finish.pos[1]}
                    onChange={(e) => {
                      setTrack((prev) => ({
                        ...prev,
                        finish: { ...prev.finish, pos: [prev.finish.pos[0], Number(e.target.value)] },
                      }));
                    }}
                    style={{ width: "50%", padding: "5px" }}
                    placeholder="Y"
                  />
                </div>
                <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                  <label style={{ fontSize: "12px" }}>Width:</label>
                  <input
                    type="number"
                    value={track.finish.width}
                    onChange={(e) => {
                      setTrack((prev) => ({
                        ...prev,
                        finish: { ...prev.finish, width: Number(e.target.value) },
                      }));
                    }}
                    style={{ width: "60%", padding: "5px" }}
                    placeholder="Width"
                  />
                </div>
              </div>
            </div>
          )}

          {editMode === "metadata" && (
            <div>
              <h3 style={{ margin: "0 0 10px 0", fontSize: "16px" }}>Track Metadata</h3>
              <p style={{ fontSize: "12px", color: "#2B2118", marginBottom: "10px" }}>
                Track settings like target time and tutorial ghosts.
              </p>
              <div style={{ marginBottom: "15px", padding: "10px", backgroundColor: "white", borderRadius: "4px" }}>
                <div style={{ marginBottom: "10px" }}>
                  <label style={{ fontSize: "12px", display: "block", marginBottom: "5px" }}>Target Time (seconds):</label>
                  <input
                    type="number"
                    value={track.metadata.targetTimeSeconds}
                    onChange={(e) => {
                      setTrack((prev) => ({
                        ...prev,
                        metadata: { ...prev.metadata, targetTimeSeconds: Number(e.target.value) },
                      }));
                    }}
                    style={{ width: "100%", padding: "5px" }}
                    placeholder="45"
                  />
                  <p style={{ fontSize: "11px", color: "#6E5F48", marginTop: "5px" }}>
                    Recommended completion time for leaderboard ranking
                  </p>
                </div>
                <div>
                  <label style={{ fontSize: "12px", display: "block", marginBottom: "5px" }}>Tutorial Ghost IDs:</label>
                  <input
                    type="text"
                    value={track.metadata.tutorialGhosts.join(", ")}
                    onChange={(e) => {
                      const ghostIds = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      setTrack((prev) => ({
                        ...prev,
                        metadata: { ...prev.metadata, tutorialGhosts: ghostIds },
                      }));
                    }}
                    style={{ width: "100%", padding: "5px" }}
                    placeholder="ghost-001, ghost-002"
                  />
                  <p style={{ fontSize: "11px", color: "#6E5F48", marginTop: "5px" }}>
                    Comma-separated ghost IDs for tutorial tracks
                  </p>
                </div>
              </div>
            </div>
          )}

          <div style={{ marginTop: "20px", padding: "10px", backgroundColor: validationError ? "#FEE" : "#EFE", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 5px 0", fontSize: "14px" }}>Validation</h4>
            <p style={{ margin: 0, fontSize: "12px" }}>{validationError || "Track is valid ✓"}</p>
          </div>

          {simResult && (
            <div style={{ marginTop: "10px", padding: "10px", backgroundColor: simResult.finished ? "#EFE" : "#FEE", borderRadius: "4px" }}>
              <h4 style={{ margin: "0 0 5px 0", fontSize: "14px" }}>Test Results</h4>
              {simResult.finished ? (
                <div style={{ fontSize: "12px" }}>
                  <p style={{ margin: "2px 0" }}>✓ Finished in {simResult.finishTime.toFixed(2)}s</p>
                  <p style={{ margin: "2px 0", color: "#6E5F48" }}>
                    Target: {track.metadata.targetTimeSeconds}s
                  </p>
                  <p style={{ margin: "2px 0", color: simResult.finishTime <= track.metadata.targetTimeSeconds ? "#7CA05C" : "#D94F3A" }}>
                    {simResult.finishTime <= track.metadata.targetTimeSeconds ? "Within target time ✓" : "Above target time"}
                  </p>
                </div>
              ) : (
                <div style={{ fontSize: "12px" }}>
                  <p style={{ margin: "2px 0" }}>✗ Did not finish</p>
                  {simResult.stuck && <p style={{ margin: "2px 0", color: "#D94F3A" }}>Wheel got stuck</p>}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "20px" }}>
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            style={{
              border: "2px solid #2B2118",
              backgroundColor: "white",
              cursor: editMode === "terrain" ? "crosshair" : "default",
            }}
          />
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#2B2118" }}>
            Terrain length: {track.terrain.length} points | Track X range: {track.terrain[0]?.x.toFixed(1)}m - {track.terrain[track.terrain.length - 1]?.x.toFixed(1)}m
          </div>
        </div>
      </div>
    </div>
  );
}
