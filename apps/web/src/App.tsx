import { useState, useEffect, useCallback } from "react";
import { DrawScreen } from "./DrawScreen.js";
import type { StrokePoint } from "./DrawScreen.js";
import { RaceScreen } from "./RaceScreen.js";
import { ResultScreen } from "./ResultScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { LandingScreen } from "./LandingScreen.js";
import { LeaderboardScreen } from "./LeaderboardScreen.js";
import { fetchGhosts, submitCrashReport, type GhostData } from "./api.js";
import { getHaptics } from "./Haptics.js";
import type { DrawResult, WheelSwap, DrawConstraints } from "@drawrace/engine-core";
import { parseSurfaces, validateZones } from "@drawrace/engine-core";

type Screen = "draw" | "race" | "result";

const LANDING_DISMISSED_KEY = "drawrace_landing_dismissed";
const CONSTRAINTS_KEY = "drawrace.constraints";
const TRACKS_KEY = "drawrace.currentTrack";

const TRACKS = [
  { id: "hills-01", numeric_id: 1, name: "Scribble Slope" },
  { id: "canyon-02", numeric_id: 2, name: "Canyon Run" },
  { id: "dunes-03", numeric_id: 3, name: "Dune Drifter" },
];

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
  zones?: Array<{ id: string; x_start: number; x_end: number }>;
  ramps?: Array<{ zone: string; x_start: number; x_end: number }>;
  hazards?: Array<{ zone: string; type: string; x_start: number; x_end: number }>;
  surfaces?: unknown;
  start: { pos: [number, number]; facing: number };
  finish: { pos: [number, number]; width: number };
}

function validateTrackData(track: TrackData): void {
  const terrainMinX = track.terrain[0][0];
  const terrainMaxX = track.terrain[track.terrain.length - 1][0];

  // Validate surfaces tile coverage (parseSurfaces throws on gaps/overlaps)
  parseSurfaces(track.surfaces, terrainMinX, terrainMaxX);

  // Validate zones tile coverage
  validateZones(track.zones, terrainMinX, terrainMaxX);
}

export function App() {
  const [screen, setScreen] = useState<Screen>("draw");
  const [drawResult, setDrawResult] = useState<DrawResult | null>(null);
  const [rawStrokePoints, setRawStrokePoints] = useState<StrokePoint[]>([]);
  const [finishTimeMs, setFinishTimeMs] = useState(0);
  const [swapLog, setSwapLog] = useState<WheelSwap[]>([]);
  const [stuck, setStuck] = useState(false);
  const [track, setTrack] = useState<TrackData | null>(null);
  const [ghosts, setGhosts] = useState<GhostData[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLanding, setShowLanding] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [constraints, setConstraints] = useState<DrawConstraints>(() => {
    const saved = localStorage.getItem(CONSTRAINTS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return {};
      }
    }
    return {};
  });
  const [currentTrackIndex, setCurrentTrackIndex] = useState(() => {
    const saved = localStorage.getItem(TRACKS_KEY);
    if (saved) {
      const index = parseInt(saved, 10);
      if (index >= 0 && index < TRACKS.length) {
        return index;
      }
    }
    return 0;
  });

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
    const currentTrack = TRACKS[currentTrackIndex];
    fetch(`/tracks/${currentTrack.id}.json`)
      .then((r) => r.json())
      .then((trackData: TrackData) => {
        validateTrackData(trackData);
        setTrack(trackData);
        fetchGhosts(trackData.numeric_id).then(setGhosts);
      });
  }, [currentTrackIndex]);

  const handleDrawComplete = useCallback((result: DrawResult, strokePoints: StrokePoint[]) => {
    setDrawResult(result);
    setRawStrokePoints(strokePoints);
    setScreen("race");
  }, []);

  const handleRaceFinished = useCallback((elapsedMs: number, wheelSwaps: WheelSwap[], stuck: boolean) => {
    setFinishTimeMs(elapsedMs);
    setSwapLog(wheelSwaps);
    setStuck(stuck);
    setScreen("result");
  }, []);

  const handleRetry = useCallback(() => {
    setDrawResult(null);
    setRawStrokePoints([]);
    setFinishTimeMs(0);
    setSwapLog([]);
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

  const handleConstraintsChange = useCallback((newConstraints: DrawConstraints) => {
    setConstraints(newConstraints);
  }, []);

  const handleRotateTrack = useCallback(() => {
    setCurrentTrackIndex((prev) => {
      const next = (prev + 1) % TRACKS.length;
      localStorage.setItem(TRACKS_KEY, next.toString());
      return next;
    });
  }, []);

  const currentTrackInfo = TRACKS[currentTrackIndex];

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
          constraints={constraints}
          trackName={currentTrackInfo.name}
          onRotateTrack={handleRotateTrack}
        />
      )}
      {screen === "race" && drawResult && (
        <RaceScreen
          track={track}
          wheelDraw={drawResult}
          ghosts={ghosts}
          onFinished={handleRaceFinished}
          onRestart={handleRetry}
          onQuit={handleRetry}
          constraints={constraints}
        />
      )}
      {screen === "result" && drawResult && (
        <ResultScreen
          finishTimeMs={finishTimeMs}
          wheelDraw={drawResult}
          rawStrokePoints={rawStrokePoints}
          trackId={track.numeric_id}
          swapLog={swapLog}
          stuck={stuck}
          ghosts={ghosts.map((g) => ({ name: g.name, finishTimeMs: g.finishTimeMs }))}
          onRetry={handleRetry}
          onShowLeaderboard={() => setShowLeaderboard(true)}
        />
      )}
      {settingsOpen && (
        <SettingsScreen
          onClose={() => setSettingsOpen(false)}
          onShowLanding={handleShowLanding}
          constraints={constraints}
          onConstraintsChange={handleConstraintsChange}
        />
      )}
      {showLeaderboard && track && (
        <LeaderboardScreen
          trackId={track.numeric_id}
          onClose={() => setShowLeaderboard(false)}
        />
      )}
    </div>
  );
}
