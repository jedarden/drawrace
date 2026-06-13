import { useState, useEffect, useCallback } from "react";
import { DrawScreen } from "./DrawScreen.js";
import type { StrokePoint } from "./DrawScreen.js";
import { RaceScreen } from "./RaceScreen.js";
import { ResultScreen } from "./ResultScreen.js";
import { SettingsScreen } from "./SettingsScreen.js";
import { LandingScreen } from "./LandingScreen.js";
import { LeaderboardScreen } from "./LeaderboardScreen.js";
import { DailyChallengeScreen } from "./DailyChallengeScreen.js";
import { TrackEditor } from "./TrackEditor.js";
import { TrackModeration } from "./TrackModeration.js";
import { fetchGhosts, submitCrashReport, submitTrack, type GhostData } from "./api.js";
import { getHaptics } from "./Haptics.js";
import { getPlayerUuid } from "./player-identity.js";
import type { DrawResult, WheelSwap, DrawConstraints, ChallengeModifiers } from "@drawrace/engine-core";
import { parseSurfaces, validateZones, hashSeed, areaCentroid, convexDecompose, computeBBox } from "@drawrace/engine-core";
import { decodeWheelFromShare } from "./ResultScreen.js";

type Screen = "draw" | "race" | "result" | "daily" | "daily_draw" | "daily_race" | "daily_result" | "track_editor" | "track_moderation";

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

  // Race run index and seed
  const [runIndex, setRunIndex] = useState(0);
  const [raceSeed, setRaceSeed] = useState<number>(() => {
    // Initial seed from track, player, and runIndex
    const playerId = getPlayerUuid();
    return hashSeed(TRACKS[0].id, playerId, 0);
  });

  // Daily challenge state
  const [dailyChallengeTrackId, setDailyChallengeTrackId] = useState<number | null>(null);
  const [dailyModifiers, setDailyModifiers] = useState<ChallengeModifiers | null>(null);
  const [dailyChallengeDate, setDailyChallengeDate] = useState<string | null>(null);
  const [dailyGhosts, setDailyGhosts] = useState<GhostData[]>([]);

  // Track moderation state
  const [showModeration, setShowModeration] = useState(false);

  // Initialize haptics and check landing screen
  useEffect(() => {
    getHaptics();
    const dismissed = localStorage.getItem(LANDING_DISMISSED_KEY) === "true";
    setShowLanding(!dismissed);

    // Check for moderation mode via URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('moderate') === 'true') {
      setShowModeration(true);
      setShowLanding(false);
    }
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

  // Handle shared wheel links: ?wheel=<base64>
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const wheelParam = urlParams.get("wheel");
    if (!wheelParam) return;

    const decoded = decodeWheelFromShare(wheelParam);
    if (!decoded) return;

    const { vertices, trackId } = decoded;
    const trackInfo = TRACKS.find((t) => t.numeric_id === trackId) ?? TRACKS[0];

    fetch(`/tracks/${trackInfo.id}.json`)
      .then((r) => r.json())
      .then((trackData: TrackData) => {
        validateTrackData(trackData);

        const { cx, cy, area } = areaCentroid(vertices);
        const convexPieces = convexDecompose(vertices);
        const bbox = computeBBox(vertices);
        const sharedDraw: DrawResult = {
          vertices,
          centroid: { x: cx, y: cy },
          convexPieces,
          isOpenLoop: false,
          area,
          bboxDiagonal: bbox.diagonal,
        };

        const playerId = getPlayerUuid();
        const newSeed = hashSeed(trackInfo.id, playerId, 0);

        setCurrentTrackIndex(TRACKS.indexOf(trackInfo));
        setTrack(trackData);
        setDrawResult(sharedDraw);
        setRawStrokePoints([]);
        setRaceSeed(newSeed);
        setShowLanding(false);
        setScreen("race");
        fetchGhosts(trackData.numeric_id).then(setGhosts);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDrawComplete = useCallback((result: DrawResult, strokePoints: StrokePoint[]) => {
    setDrawResult(result);
    setRawStrokePoints(strokePoints);

    // Generate new seed for this run using track, player, and runIndex
    const playerId = getPlayerUuid();
    const currentTrack = TRACKS[currentTrackIndex];
    // For daily challenges, use the daily track ID
    const trackId = screen === "daily_draw" && dailyChallengeTrackId
      ? `daily-${dailyChallengeTrackId}`
      : currentTrack.id;
    const newSeed = hashSeed(trackId, playerId, runIndex);
    setRaceSeed(newSeed);

    // Transition to appropriate race screen
    if (screen === "daily_draw") {
      setScreen("daily_race");
    } else {
      setScreen("race");
    }
  }, [screen, currentTrackIndex, runIndex, dailyChallengeTrackId]);

  const handleRaceFinished = useCallback((elapsedMs: number, wheelSwaps: WheelSwap[], stuck: boolean) => {
    setFinishTimeMs(elapsedMs);
    setSwapLog(wheelSwaps);
    setStuck(stuck);
    // Transition to appropriate result screen
    if (screen === "daily_race") {
      setScreen("daily_result");
    } else {
      setScreen("result");
    }
  }, [screen]);

  const handleRetry = useCallback(() => {
    setDrawResult(null);
    setRawStrokePoints([]);
    setFinishTimeMs(0);
    setSwapLog([]);
    // Increment runIndex for the new attempt
    setRunIndex((prev) => prev + 1);
    // Return to appropriate draw screen
    if (screen === "daily_result" || screen === "daily_race") {
      setScreen("daily_draw");
    } else {
      setScreen("draw");
      if (track) {
        fetchGhosts(track.numeric_id).then(setGhosts);
      }
    }
  }, [screen, track]);

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

  const handleDailyChallengeStart = useCallback(async (trackId: number, modifiers: ChallengeModifiers, ghosts: GhostData[], challengeDate: string) => {
    setDailyChallengeTrackId(trackId);
    setDailyModifiers(modifiers);
    setDailyChallengeDate(challengeDate);
    setDailyGhosts(ghosts);

    // Find the track data for the daily challenge
    const trackInfo = TRACKS.find((t) => t.numeric_id === trackId);
    if (!trackInfo) return;

    try {
      const trackData: TrackData = await fetch(`/tracks/${trackInfo.id}.json`).then((r) => r.json());
      // Apply modifiers to the track data
      trackData.modifiers = modifiers;
      validateTrackData(trackData);
      setTrack(trackData);
      setScreen("daily_draw");
    } catch (e) {
      console.error("Failed to load daily challenge track:", e);
    }
  }, []);

  const handleShowDailyChallenge = useCallback(() => {
    setScreen("daily");
  }, []);

  const handleDailyBack = useCallback(() => {
    setScreen("draw");
    // Clear daily challenge state
    setDailyChallengeTrackId(null);
    setDailyModifiers(null);
    setDailyChallengeDate(null);
    setDailyGhosts([]);
  }, []);

  const handleQuitFromRace = useCallback(() => {
    // Return to Home (LandingScreen) when quitting a race
    setShowLanding(true);
    // Clear race state
    setDrawResult(null);
    setRawStrokePoints([]);
    setFinishTimeMs(0);
    setSwapLog([]);
  }, []);

  const handleOpenTrackEditor = useCallback(() => {
    setScreen("track_editor");
    setShowLanding(false);
  }, []);

  const handleTrackEditorSave = useCallback(async (trackData: any) => {
    try {
      await submitTrack(trackData);
      setShowLanding(true);
    } catch (e) {
      console.error("Failed to save track:", e);
      alert("Failed to save track. Please try again.");
    }
  }, []);

  const handleTrackEditorCancel = useCallback(() => {
    setShowLanding(true);
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
      <LandingScreen onStart={handleLandingStart} onOpenTrackEditor={handleOpenTrackEditor} dismissed={!showLanding} />
      {screen === "draw" && (
        <DrawScreen
          onComplete={handleDrawComplete}
          onOpenSettings={() => setSettingsOpen(true)}
          constraints={constraints}
          trackName={currentTrackInfo.name}
          onRotateTrack={handleRotateTrack}
          onShowDailyChallenge={handleShowDailyChallenge}
        />
      )}
      {screen === "race" && drawResult && (
        <RaceScreen
          track={track}
          wheelDraw={drawResult}
          ghosts={ghosts}
          onFinished={handleRaceFinished}
          onRestart={handleRetry}
          onQuit={handleQuitFromRace}
          constraints={constraints}
          seed={raceSeed}
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
      {screen === "daily" && (
        <DailyChallengeScreen
          onStart={handleDailyChallengeStart}
          onBack={handleDailyBack}
        />
      )}
      {screen === "daily_draw" && track && dailyModifiers && (
        <DrawScreen
          onComplete={handleDrawComplete}
          onOpenSettings={() => setSettingsOpen(true)}
          constraints={constraints}
          trackName={TRACKS.find((t) => t.numeric_id === dailyChallengeTrackId)?.name ?? "Daily Challenge"}
          onRotateTrack={undefined}
          onBack={handleDailyBack}
          isDailyChallenge={true}
          dailyModifiers={dailyModifiers}
        />
      )}
      {screen === "daily_race" && drawResult && track && dailyModifiers && dailyChallengeDate && (
        <RaceScreen
          track={track}
          wheelDraw={drawResult}
          ghosts={dailyGhosts}
          onFinished={handleRaceFinished}
          onRestart={handleRetry}
          onQuit={handleDailyBack}
          constraints={constraints}
          seed={raceSeed}
        />
      )}
      {screen === "daily_result" && drawResult && track && dailyChallengeDate && (
        <ResultScreen
          finishTimeMs={finishTimeMs}
          wheelDraw={drawResult}
          rawStrokePoints={rawStrokePoints}
          trackId={track.numeric_id}
          swapLog={swapLog}
          stuck={stuck}
          ghosts={dailyGhosts.map((g) => ({ name: g.name, finishTimeMs: g.finishTimeMs }))}
          onRetry={handleRetry}
          onShowLeaderboard={() => setShowLeaderboard(true)}
          isDailyChallenge={true}
          dailyChallengeDate={dailyChallengeDate}
        />
      )}
      {screen === "track_editor" && (
        <TrackEditor onSave={handleTrackEditorSave} onCancel={handleTrackEditorCancel} />
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
      {showModeration && (
        <TrackModeration onClose={() => setShowModeration(false)} />
      )}
    </div>
  );
}
