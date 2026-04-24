import { useRef, useEffect, useState, useCallback } from "react";
import { RaceSim } from "@drawrace/engine-core";
import type { DrawResult, TrackDef } from "@drawrace/engine-core";
import { createRenderer, createGhostWheelPath, preloadAssets } from "./Renderer.js";
import { ParticleSystem } from "./Particles.js";
import { getPerformanceManager } from "./PerformanceManager.js";
import { getHaptics } from "./Haptics.js";
import { getSoundManager } from "./Sound.js";
import { DrawOverlay } from "./DrawOverlay.js";
import { PauseMenu } from "./PauseMenu.js";
import { MAX_SWAPS } from "./cooldown-machine.js";

interface GhostDef {
  id: string;
  name: string;
  wheelVertices: Array<{ x: number; y: number }>;
  finishTimeMs: number;
  seed: number;
}

interface RaceScreenProps {
  track: TrackDef;
  wheelDraw: DrawResult;
  ghosts: GhostDef[];
  onFinished: (elapsedMs: number) => void;
  onRestart: () => void;
  onQuit: () => void;
}

type RacePhase = "countdown" | "racing" | "done";

// Collision detection thresholds
const COLLISION_VY_THRESHOLD = 0.5; // m/s vertical velocity change
const COLLISION_COOLDOWN_TICKS = 15; // ~250ms at 60Hz

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const centis = Math.floor((ms % 1000) / 10);
  return `${min}:${String(sec).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

export function RaceScreen({ track, wheelDraw, ghosts, onFinished, onRestart, onQuit }: RaceScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<RacePhase>("countdown");
  const countdownRef = useRef(3);
  const rafRef = useRef<number>(0);
  const finishedCalledRef = useRef(false);
  const particlesRef = useRef<ParticleSystem | null>(null);
  const confettiTriggeredRef = useRef(false);
  const prevWheelPosRef = useRef({ x: 0, y: 0 });
  const pausedRef = useRef(false);

  // RaceSim ref — set inside effect so swapWheel can be called from outside the loop
  const simRef = useRef<RaceSim | null>(null);

  // React-visible race state
  const [racingPhase, setRacingPhase] = useState<RacePhase>("countdown");
  const [swapCount, setSwapCount] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [ariaAnnouncement, setAriaAnnouncement] = useState("Race starting. Countdown: 3");

  // Capture ghosts in a ref so a late-arriving fetch cannot restart the effect mid-race
  const ghostsRef = useRef(ghosts);
  ghostsRef.current = ghosts;

  // ── Pause / resume ───────────────────────────────────────────────────────
  const handlePause = useCallback(() => {
    if (phaseRef.current !== "racing") return;
    pausedRef.current = true;
    setPaused(true);
    getSoundManager().stopMotorHum();
  }, []);

  const handleResume = useCallback(() => {
    pausedRef.current = false;
    setPaused(false);
    if (phaseRef.current === "racing") {
      getSoundManager().startMotorHum();
    }
  }, []);

  // ── Swap commit handler ──────────────────────────────────────────────────
  const handleSwapCommit = useCallback((result: DrawResult) => {
    const sim = simRef.current;
    if (!sim) return;
    // Convert DrawResult vertices (CSS px, centered) to physics world units
    // DrawScreen uses same PPM as the track
    const ppm = track.world.pixelsPerMeter;
    const physVerts = result.vertices.map((v) => ({ x: v.x / ppm, y: v.y / ppm }));
    // Clamp max wheel radius same as initial wheel setup
    const maxR = Math.max(...physVerts.map((v) => Math.hypot(v.x, v.y)));
    const MIN_R = 0.3;
    const MAX_R = 1.0;
    const scale = maxR < MIN_R ? MIN_R / maxR : maxR > MAX_R ? MAX_R / maxR : 1;
    const scaledVerts = physVerts.map((v) => ({ x: v.x * scale, y: v.y * scale }));
    sim.swapWheel(scaledVerts);
    setSwapCount((c) => c + 1);
  }, [track.world.pixelsPerMeter]);

  // ── Main race loop ───────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const capturedGhosts = ghostsRef.current;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width > 0 ? rect.width : window.innerWidth;
    canvas.height = rect.height > 0 ? rect.height : window.innerHeight;

    let cancelled = false;
    let rafId: number = 0;

    (async () => {
      try {
        await preloadAssets();
        if (cancelled) return;

        const ppm = track.world.pixelsPerMeter;
        const rawVerts = wheelDraw.vertices.map((v) => ({ x: v.x / ppm, y: v.y / ppm }));
        const maxR = Math.max(...rawVerts.map((v) => Math.hypot(v.x, v.y)));
        const MIN_R = 0.3;
        const MAX_R = 1.0;
        const scale = maxR < MIN_R ? MIN_R / maxR : maxR > MAX_R ? MAX_R / maxR : 1;
        const playerVerts = rawVerts.map((v) => ({ x: v.x * scale, y: v.y * scale }));
        const sim = new RaceSim(track, playerVerts);
        simRef.current = sim;
        const ghostSims = capturedGhosts.map((g) => new RaceSim(track, g.wheelVertices, g.seed));

        const particles = new ParticleSystem();
        particlesRef.current = particles;

        const physDraw = { ...wheelDraw, vertices: playerVerts };
        const renderer = createRenderer(canvas, track, physDraw);
        const ghostWheelPaths = capturedGhosts.map((g) => createGhostWheelPath(g.wheelVertices));
        const perf = getPerformanceManager();
        const sound = getSoundManager();
        const haptics = getHaptics();

        const initSnap = sim.snapshot();
        prevWheelPosRef.current = { x: initSnap.wheel.x, y: initSnap.wheel.y };
        const initGhosts = ghostSims.map((gs, i) => ({
          snapshot: gs.snapshot(),
          wheelPath: ghostWheelPaths[i],
        }));
        renderer.render(initSnap, initGhosts, particles, 3);

        let countdownTick = 0;
        const COUNTDOWN_TICKS = 180;
        phaseRef.current = "countdown";
        countdownRef.current = 3;
        let lastCountdownVal = 3;

        const MAX_ACCUM_MS = 200;
        let lastTime = performance.now();
        let accumTime = 0;
        let maxObservedSpeed = 1;

        let prevWheelY = initSnap.wheel.y;
        let collisionCooldown = 0;

        function loop() {
          if (cancelled) return;
          if (pausedRef.current) {
            rafId = requestAnimationFrame(loop);
            return;
          }

          const now = performance.now();
          const dt = now - lastTime;
          lastTime = now;

          perf.recordFrame(dt);

          if (phaseRef.current === "countdown") {
            const snap = sim.snapshot();
            const ghostSnaps = ghostSims.map((gs, i) => ({
              snapshot: gs.snapshot(),
              wheelPath: ghostWheelPaths[i],
            }));
            particles.update(1 / 60);
            renderer.render(snap, ghostSnaps, particles, countdownRef.current);

            countdownTick++;
            const newCountdown = 3 - Math.floor(countdownTick / 60);
            if (newCountdown !== lastCountdownVal && newCountdown >= 1) {
              lastCountdownVal = newCountdown;
              countdownRef.current = newCountdown;
              sound.playCountdown();
              setAriaAnnouncement(`Countdown: ${newCountdown}`);
            }

            if (countdownTick >= COUNTDOWN_TICKS) {
              phaseRef.current = "racing";
              setRacingPhase("racing");
              sim.enableMotor();
              ghostSims.forEach((gs) => gs.enableMotor());
              sound.playGo();
              sound.startMotorHum();
              haptics.raceStart();
              setAriaAnnouncement("GO! Race started");
            }

            rafId = requestAnimationFrame(loop);
            return;
          }

          if (phaseRef.current === "racing") {
            accumTime += dt;
            if (accumTime > MAX_ACCUM_MS) accumTime = MAX_ACCUM_MS;
            const simDt = perf.simDt * 1000;

            while (accumTime >= simDt) {
              sim.step();
              ghostSims.forEach((gs) => gs.step());
              accumTime -= simDt;
            }

            const snap = sim.snapshot();

            // Update elapsed for HUD (every ~10 frames to avoid excessive re-renders)
            if (snap.tick % 6 === 0) {
              setElapsedMs(snap.elapsedMs);
            }

            // Telemetry
            if (snap.tick % 300 === 0 && snap.tick > 0) {
              console.log(
                `[RACE] tick=${snap.tick} pos=(${snap.wheel.x.toFixed(1)}, ${snap.wheel.y.toFixed(1)}) finished=${snap.finished}`,
              );
            }

            const dx = snap.wheel.x - prevWheelPosRef.current.x;
            const dy = snap.wheel.y - prevWheelPosRef.current.y;
            const speed = Math.hypot(dx, dy) * 60;
            prevWheelPosRef.current = { x: snap.wheel.x, y: snap.wheel.y };

            if (speed > maxObservedSpeed) maxObservedSpeed = speed;
            sound.updateMotorSpeed(speed / maxObservedSpeed);

            if (collisionCooldown > 0) collisionCooldown--;
            const vy = snap.wheel.y - prevWheelY;
            if (collisionCooldown === 0 && Math.abs(vy) > COLLISION_VY_THRESHOLD) {
              renderer.triggerInkFlash(snap.wheel.x, snap.wheel.y);
              renderer.triggerCameraShake(Math.min(6, Math.abs(vy) * 8));
              sound.playBounce();
              collisionCooldown = COLLISION_COOLDOWN_TICKS;
            }
            prevWheelY = snap.wheel.y;

            const maxGhosts = perf.maxGhosts;
            const activeGhostSnaps = ghostSims.slice(0, maxGhosts).map((gs, i) => ({
              snapshot: gs.snapshot(),
              wheelPath: ghostWheelPaths[i],
            }));

            particles.setParticleLevel(perf.particleLevel);
            if (perf.particleLevel !== "none") {
              const cw = canvasRef.current?.width ?? 400;
              const ch = canvasRef.current?.height ?? 800;
              const wheelSX = snap.wheel.x * 30 - cw * 0.35;
              const wheelSY = -snap.wheel.y * 30 - ch * 0.6;
              particles.emitDust(wheelSX, wheelSY, speed);
            }

            particles.update(1 / 60);
            renderer.render(snap, activeGhostSnaps, particles);

            if (snap.finished && !confettiTriggeredRef.current) {
              confettiTriggeredRef.current = true;
              sound.stopMotorHum();
              if (snap.elapsedMs >= 179000) {
                sound.playDnf();
              } else {
                sound.playFinishLine();
              }
              haptics.finishLine();
              if (snap.elapsedMs < 179000 && perf.particleLevel !== "none") {
                const cw = canvasRef.current?.width ?? 400;
                const ch = canvasRef.current?.height ?? 800;
                particles.emitConfetti(cw / 2, ch * 0.4);
              }
            }

            if (snap.finished) {
              phaseRef.current = "done";
              setRacingPhase("done");
              if (!finishedCalledRef.current) {
                finishedCalledRef.current = true;
                onFinished(snap.elapsedMs);
              }
              return;
            }

            rafId = requestAnimationFrame(loop);
          }
        }

        rafId = requestAnimationFrame(loop);
      } catch (err) {
        console.error("[RaceScreen] Race init failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      simRef.current = null;
      getSoundManager().stopMotorHum();
      if (rafId) cancelAnimationFrame(rafId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, wheelDraw, onFinished]);

  // ── Swap counter chip color ──────────────────────────────────────────────
  const isCapped = swapCount >= MAX_SWAPS;
  const swapCounterColor = isCapped
    ? "#D94F3A"
    : swapCount >= Math.floor(MAX_SWAPS * 0.7)
      ? "#6E5F48"
      : "#2B2118";

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        backgroundColor: "#F4EAD5",
      }}
    >
      {/* Race canvas — covers full viewport */}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Race view. Your wheel is shown in red, ghosts in gray."
        style={{ width: "100%", height: "100%", display: "block" }}
      />

      {/* ── HUD row (top of screen) ── */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 44,
          display: "flex",
          alignItems: "center",
          paddingLeft: 8,
          paddingRight: 12,
          gap: 8,
          pointerEvents: "none",
        }}
      >
        {/* Pause button — top-left, 44×44, the ONLY way to pause */}
        <button
          aria-label="Pause race"
          onClick={handlePause}
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(244,234,213,0.85)",
            border: "2px solid #2B2118",
            borderRadius: 8,
            fontSize: 20,
            cursor: "pointer",
            color: "#2B2118",
            pointerEvents: "auto",
          }}
        >
          ⏸
        </button>

        {/* Timer — grows to fill available space */}
        <span
          style={{
            flex: 1,
            fontFamily: '"Patrick Hand SC", "Caveat", monospace',
            fontSize: 18,
            color: "#2B2118",
            opacity: 0.85,
            textAlign: "center",
          }}
        >
          {formatTime(elapsedMs)}
        </span>

        {/* Swap counter chip — top-right */}
        <span
          aria-label={`Swaps: ${swapCount} of ${MAX_SWAPS}`}
          style={{
            fontFamily: '"Patrick Hand SC", "Caveat", monospace',
            fontSize: 16,
            fontWeight: 600,
            color: swapCounterColor,
            opacity: 0.9,
            background: "rgba(244,234,213,0.75)",
            borderRadius: 6,
            padding: "2px 8px",
            border: isCapped ? "1.5px solid #D94F3A" : "1.5px solid #6E5F48",
            pointerEvents: "none",
          }}
        >
          {swapCount}/{MAX_SWAPS}
        </span>
      </div>

      {/* ── Draw overlay — bottom 40% of viewport ── */}
      <DrawOverlay
        active={racingPhase === "racing"}
        swapCount={swapCount}
        onSwapCommit={handleSwapCommit}
      />

      {/* ── Pause menu ── */}
      {paused && (
        <PauseMenu
          onResume={handleResume}
          onRestart={onRestart}
          onQuit={onQuit}
        />
      )}

      {/* Accessible aria-live region for screen readers */}
      <div
        role="status"
        aria-label="Race status"
        aria-live="assertive"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
        }}
      >
        {ariaAnnouncement}
      </div>
    </div>
  );
}
