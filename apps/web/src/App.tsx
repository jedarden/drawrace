import { useState, useEffect, useCallback } from "react";
import { DrawScreen } from "./DrawScreen.js";
import type { StrokePoint } from "./DrawScreen.js";
import { RaceScreen } from "./RaceScreen.js";
import { ResultScreen } from "./ResultScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { LandingScreen } from "./LandingScreen.js";
import { fetchGhosts, submitCrashReport, type GhostData } from "./api.js";
import { getHaptics } from "./Haptics.js";
import type { DrawResult } from "@drawrace/engine-core";

type Screen = "draw" | "race" | "result";

const LANDING_DISMISSED_KEY = "drawrace_landing_dismissed";

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLanding, setShowLanding] = useState(false);

  // Initialize haptics and check landing screen
  useEffect(() => {
    getHaptics();
    const dismissed = localStorage.getItem(LANDING_DISMISSED_KEY) === "true";
    setShowLanding(!dismissed);
  }, []);

  // Global crash reporter — captures unhandled errors and submits to /v1/crash
  useEffect(() => {
    const handleError = (ev: ErrorEvent) => {
      submitCrashReport({
        message: ev.message,
        stack: ev.error?.stack,
        url: ev.filename,
        line: ev.lineno,
        column: ev.colno,
      });
    };
    const handleRejection = (ev: PromiseRejectionEvent) => {
      const reason = ev.reason;
      submitCrashReport({
        message: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
        metadata: { type: "unhandledrejection" },
      });
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

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

  const handleLandingStart = useCallback(() => {
    setShowLanding(false);
    localStorage.setItem(LANDING_DISMISSED_KEY, "true");
  }, []);

  const handleShowLanding = useCallback(() => {
    setShowLanding(true);
  }, []);

  if (!track) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading"
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#F4EAD5",
          fontFamily: '"Caveat", "Patrick Hand", "Comic Sans MS", cursive, system-ui, sans-serif',
          color: "#2B2118",
          fontSize: 24,
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }} role="application" aria-label="DrawRace Game">
      <LandingScreen onStart={handleLandingStart} dismissed={!showLanding} />
      {screen === "draw" && (
        <DrawScreen
          onComplete={handleDrawComplete}
          onOpenSettings={() => setSettingsOpen(true)}
        />
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
      {settingsOpen && (
        <SettingsScreen onClose={() => setSettingsOpen(false)} onShowLanding={handleShowLanding} />
      )}
    </div>
  );
}
