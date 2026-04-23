import { useRef, useEffect, useState } from "react";
import { RaceSim } from "@drawrace/engine-core";
import type { DrawResult, TrackDef } from "@drawrace/engine-core";
import { createRenderer, createGhostWheelPath, preloadAssets } from "./Renderer.js";
import { ParticleSystem } from "./Particles.js";
import { getPerformanceManager } from "./PerformanceManager.js";
import { getHaptics } from "./Haptics.js";
import { getSoundManager } from "./Sound.js";

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
  const [ariaAnnouncement, setAriaAnnouncement] = useState("Race starting. Countdown: 3");

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

      const ppm = track.world.pixelsPerMeter;
      const rawVerts = wheelDraw.vertices.map((v) => ({ x: v.x / ppm, y: v.y / ppm }));
      const maxR = Math.max(...rawVerts.map((v) => Math.hypot(v.x, v.y)));
      const MIN_R = 0.3;
      const MAX_R = 1.0;
      const scale = maxR < MIN_R ? MIN_R / maxR : maxR > MAX_R ? MAX_R / maxR : 1;
      const playerVerts = rawVerts.map((v) => ({ x: v.x * scale, y: v.y * scale }));
      const sim = new RaceSim(track, playerVerts);
      const ghostSims = ghosts.map((g) => new RaceSim(track, g.wheelVertices, g.seed));

      const particles = new ParticleSystem();
      particlesRef.current = particles;

      const physDraw = { ...wheelDraw, vertices: playerVerts };
      const render = createRenderer(canvas, track, physDraw);
      const ghostWheelPaths = ghosts.map((g) => createGhostWheelPath(g.wheelVertices));
      const perf = getPerformanceManager();
      const sound = getSoundManager();
      const haptics = getHaptics();

      // Render initial frame
      const initSnap = sim.snapshot();
      prevWheelPosRef.current = { x: initSnap.wheel.x, y: initSnap.wheel.y };
      const initGhosts = ghostSims.map((gs, i) => ({ snapshot: gs.snapshot(), wheelPath: ghostWheelPaths[i] }));
      render(initSnap, initGhosts, particles, 3);

      let countdownTick = 0;
      const COUNTDOWN_TICKS = 180;
      phaseRef.current = "countdown";
      countdownRef.current = 3;
      let lastCountdownVal = 3;

      let lastTime = performance.now();
      let accumTime = 0;
      let maxObservedSpeed = 1;

      function loop() {
        if (cancelled) return;
        const now = performance.now();
        const dt = now - lastTime;
        lastTime = now;

        perf.recordFrame(dt);

        if (phaseRef.current === "countdown") {
          const snap = sim.snapshot();
          const ghostSnaps = ghostSims.map((gs, i) => ({ snapshot: gs.snapshot(), wheelPath: ghostWheelPaths[i] }));
          particles.update(1 / 60);
          render(snap, ghostSnaps, particles, countdownRef.current);

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

          if (speed > maxObservedSpeed) maxObservedSpeed = speed;
          sound.updateMotorSpeed(speed / maxObservedSpeed);

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
      getSoundManager().stopMotorHum();
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
      <div
        role="status"
        aria-label="Countdown"
        aria-live="assertive"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}
      >
        {ariaAnnouncement}
      </div>
    </div>
  );
}
