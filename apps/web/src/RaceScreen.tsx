import { useRef, useEffect } from "react";
import { RaceSim } from "@drawrace/engine-core";
import type { DrawResult, TrackDef } from "@drawrace/engine-core";
import { createRenderer, createGhostWheelPath, preloadAssets } from "./Renderer.js";
import { ParticleSystem } from "./Particles.js";
import { getPerformanceManager } from "./PerformanceManager.js";
import { getHaptics } from "./Haptics.js";

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
}

type RacePhase = "countdown" | "racing" | "done";

export function RaceScreen({ track, wheelDraw, ghosts, onFinished }: RaceScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<RacePhase>("countdown");
  const countdownRef = useRef(3);
  const rafRef = useRef<number>(0);
  const finishedCalledRef = useRef(false);
  const particlesRef = useRef<ParticleSystem | null>(null);
  const confettiTriggeredRef = useRef(false);
  const prevWheelPosRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    let cancelled = false;
    let rafId: number = 0;

    (async () => {
      await preloadAssets();
      if (cancelled) return;

      const sim = new RaceSim(track, wheelDraw.vertices);
      const ghostSims = ghosts.map((g) => new RaceSim(track, g.wheelVertices, g.seed));

      const particles = new ParticleSystem();
      particlesRef.current = particles;

      const render = createRenderer(canvas, track, wheelDraw);
      const ghostWheelPaths = ghosts.map((g) => createGhostWheelPath(g.wheelVertices));
      const perf = getPerformanceManager();

      // Render initial frame
      const initSnap = sim.snapshot();
      prevWheelPosRef.current = { x: initSnap.wheel.x, y: initSnap.wheel.y };
      const initGhosts = ghostSims.map((gs, i) => ({ snapshot: gs.snapshot(), wheelPath: ghostWheelPaths[i] }));
      render(initSnap, initGhosts, particles, 3);

      let countdownTick = 0;
      const COUNTDOWN_TICKS = 180;
      phaseRef.current = "countdown";
      countdownRef.current = 3;

      let lastTime = performance.now();
      let accumTime = 0;

      function loop() {
        if (cancelled) return;
        const now = performance.now();
        const dt = now - lastTime;
        lastTime = now;

        perf.recordFrame(dt);

        if (phaseRef.current === "countdown") {
          sim.step();
          ghostSims.forEach((gs) => gs.step());

          const snap = sim.snapshot();
          const ghostSnaps = ghostSims.map((gs, i) => ({ snapshot: gs.snapshot(), wheelPath: ghostWheelPaths[i] }));
          particles.update(1 / 60);
          render(snap, ghostSnaps, particles, countdownRef.current);

          countdownTick++;
          const newCountdown = 3 - Math.floor(countdownTick / 60);
          if (newCountdown !== countdownRef.current && newCountdown >= 0) {
            countdownRef.current = newCountdown;
          }

          if (countdownTick >= COUNTDOWN_TICKS) {
            phaseRef.current = "racing";
            sim.enableMotor();
            ghostSims.forEach((gs) => gs.enableMotor());
            getHaptics().raceStart();
          }

          rafId = requestAnimationFrame(loop);
          return;
        }

        if (phaseRef.current === "racing") {
          accumTime += dt;
          const simDt = perf.simDt * 1000;

          while (accumTime >= simDt) {
            sim.step();
            ghostSims.forEach((gs) => gs.step());
            accumTime -= simDt;
          }

          const snap = sim.snapshot();

          // Compute wheel speed from position delta (SimBody has no vx/vy)
          const dx = snap.wheel.x - prevWheelPosRef.current.x;
          const dy = snap.wheel.y - prevWheelPosRef.current.y;
          const speed = Math.hypot(dx, dy) * 60; // approx m/s
          prevWheelPosRef.current = { x: snap.wheel.x, y: snap.wheel.y };

          // Filter ghosts based on performance
          const maxGhosts = perf.maxGhosts;
          const activeGhostSnaps = ghostSims.slice(0, maxGhosts).map((gs, i) => ({
            snapshot: gs.snapshot(),
            wheelPath: ghostWheelPaths[i],
          }));

          // Emit dust behind wheel
          particles.setParticleLevel(perf.particleLevel);
          if (perf.particleLevel !== "none") {
            const cw = canvasRef.current?.width ?? 400;
            const ch = canvasRef.current?.height ?? 800;
            const wheelSX = snap.wheel.x * 30 - cw * 0.35;
            const wheelSY = -snap.wheel.y * 30 - ch * 0.6;
            particles.emitDust(wheelSX, wheelSY, speed);
          }

          particles.update(1 / 60);
          render(snap, activeGhostSnaps, particles);

          if (snap.finished && !confettiTriggeredRef.current) {
            confettiTriggeredRef.current = true;
            getHaptics().finishLine();
            if (perf.particleLevel !== "none") {
              const cw = canvasRef.current?.width ?? 400;
              const ch = canvasRef.current?.height ?? 800;
              particles.emitConfetti(cw / 2, ch * 0.4);
            }
          }

          if (snap.finished) {
            phaseRef.current = "done";
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
    })();

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [track, wheelDraw, ghosts, onFinished]);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#F4EAD5" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Race view. Your wheel is shown in red, ghosts in gray."
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
