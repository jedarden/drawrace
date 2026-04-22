import { useState, useEffect, useCallback } from "react";
import { DrawScreen } from "./DrawScreen.js";
import { RaceScreen } from "./RaceScreen.js";
import { ResultScreen } from "./ResultScreen.js";
import type { DrawResult } from "@drawrace/engine-core";

type Screen = "draw" | "race" | "result";

interface GhostData {
  id: string;
  name: string;
  wheelVertices: Array<{ x: number; y: number }>;
  finishTimeMs: number;
  seed: number;
}

interface TrackData {
  id: string;
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
  const [finishTimeMs, setFinishTimeMs] = useState(0);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [ghosts, setGhosts] = useState<GhostData[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/tracks/hills-01.json").then((r) => r.json()),
      fetch("/ghosts/ghost-dev-001.json").then((r) => r.json()),
      fetch("/ghosts/ghost-dev-002.json").then((r) => r.json()),
      fetch("/ghosts/ghost-dev-003.json").then((r) => r.json()),
    ]).then(([trackData, ...ghostArr]) => {
      setTrack(trackData);
      setGhosts(ghostArr);
    });
  }, []);

  const handleDrawComplete = useCallback((result: DrawResult) => {
    setDrawResult(result);
    setScreen("race");
  }, []);

  const handleRaceFinished = useCallback((elapsedMs: number) => {
    setFinishTimeMs(elapsedMs);
    setScreen("result");
  }, []);

  const handleRetry = useCallback(() => {
    setDrawResult(null);
    setFinishTimeMs(0);
    setScreen("draw");
  }, []);

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
          ghosts={ghosts.map((g) => ({ name: g.name, finishTimeMs: g.finishTimeMs }))}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
}
