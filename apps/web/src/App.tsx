import { useState, useEffect, useCallback } from "react";
import { DrawScreen } from "./DrawScreen.js";
import type { StrokePoint } from "./DrawScreen.js";
import { RaceScreen } from "./RaceScreen.js";
import { ResultScreen } from "./ResultScreen.js";
import { fetchGhosts, type GhostData } from "./api.js";
import type { DrawResult } from "@drawrace/engine-core";

type Screen = "draw" | "race" | "result";

interface TrackData {
  id: string;
  numeric_id: number;
  world: { gravity: [number, number]; pixelsPerMeter: number };
  terrain: [number, number][];
  obstacles?: Array<{
    type: string;
    pos: [number, number];
    size?: [number, number];
    radius?: number;
    angle?: number;
    friction?: number;
  }>;
  start: { pos: [number, number]; facing: number };
  finish: { pos: [number, number]; width: number };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("draw");
  const [drawResult, setDrawResult] = useState<DrawResult | null>(null);
  const [rawStrokePoints, setRawStrokePoints] = useState<StrokePoint[]>([]);
  const [finishTimeMs, setFinishTimeMs] = useState(0);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [ghosts, setGhosts] = useState<GhostData[]>([]);

  useEffect(() => {
    fetch("/tracks/hills-01.json")
      .then((r) => r.json())
      .then((trackData: TrackData) => {
        setTrack(trackData);
        fetchGhosts(trackData.numeric_id).then(setGhosts);
      });
  }, []);

  const handleDrawComplete = useCallback((result: DrawResult, strokePoints: StrokePoint[]) => {
    setDrawResult(result);
    setRawStrokePoints(strokePoints);
    setScreen("race");
  }, []);

  const handleRaceFinished = useCallback((elapsedMs: number) => {
    setFinishTimeMs(elapsedMs);
    setScreen("result");
  }, []);

  const handleRetry = useCallback(() => {
    setDrawResult(null);
    setRawStrokePoints([]);
    setFinishTimeMs(0);
    setScreen("draw");
    if (track) {
      fetchGhosts(track.numeric_id).then(setGhosts);
    }
  }, [track]);

  if (!track) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#F4EAD5",
          fontFamily: "system-ui, sans-serif",
          color: "#2B2118",
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      {screen === "draw" && (
        <DrawScreen onComplete={handleDrawComplete} />
      )}
      {screen === "race" && drawResult && (
        <RaceScreen
          track={track}
          wheelDraw={drawResult}
          ghosts={ghosts}
          onFinished={handleRaceFinished}
        />
      )}
      {screen === "result" && drawResult && (
        <ResultScreen
          finishTimeMs={finishTimeMs}
          wheelDraw={drawResult}
          rawStrokePoints={rawStrokePoints}
          trackId={track.numeric_id}
          ghosts={ghosts.map((g) => ({ name: g.name, finishTimeMs: g.finishTimeMs }))}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
}
