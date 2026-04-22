import { useRef, useEffect, useState } from "react";
import { RaceSim } from "@drawrace/engine-core";
import type { DrawResult, TrackDef } from "@drawrace/engine-core";
import { createRenderer, createGhostWheelPath } from "./Renderer.js";

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
  const simRef = useRef<RaceSim | null>(null);
  const ghostSimsRef = useRef<RaceSim[]>([]);
  const rafRef = useRef<number>(0);
  const renderFnRef = useRef<((snap: any, ghosts: any[]) => void) | null>(null);
  const finishedCalledRef = useRef(false);
  const [countdownDisplay, setCountdownDisplay] = useState(3);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    // Use CSS dimensions for rendering calculations
    canvas.width = rect.width;
    canvas.height = rect.height;

    // Create player simulation
    const sim = new RaceSim(track, wheelDraw.vertices);
    simRef.current = sim;

    // Create ghost simulations
    const ghostSims = ghosts.map((g) => new RaceSim(track, g.wheelVertices, g.seed));
    ghostSimsRef.current = ghostSims;

    // Create renderer
    const render = createRenderer(canvas, track, wheelDraw);
    renderFnRef.current = render;

    // Build ghost wheel paths
    const ghostWheelPaths = ghosts.map((g) => createGhostWheelPath(g.wheelVertices));

    // Render initial frame
    const snap = sim.snapshot();
    const ghostSnaps = ghostSims.map((gs) => ({ snapshot: gs.snapshot(), wheelPath: ghostWheelPaths[ghostSims.indexOf(gs)] }));
    render(snap, ghostSnaps);

    // Countdown phase — 3 seconds
    let countdownTick = 0;
    const COUNTDOWN_TICKS = 180; // 3 seconds at 60fps
    phaseRef.current = "countdown";
    countdownRef.current = 3;
    setCountdownDisplay(3);

    function loop() {
      if (phaseRef.current === "countdown") {
        // Step physics with gravity only (no motor)
        const snap = sim.snapshot();
        const ghostSnaps = ghostSims.map((gs, i) => ({ snapshot: gs.snapshot(), wheelPath: ghostWheelPaths[i] }));
        render(snap, ghostSnaps);
        sim.step();
        ghostSims.forEach((gs) => gs.step());

        countdownTick++;
        const newCountdown = 3 - Math.floor(countdownTick / 60);
        if (newCountdown !== countdownRef.current && newCountdown >= 0) {
          countdownRef.current = newCountdown;
          setCountdownDisplay(newCountdown);
        }

        if (countdownTick >= COUNTDOWN_TICKS) {
          phaseRef.current = "racing";
          sim.enableMotor();
          ghostSims.forEach((gs) => gs.enableMotor());
          setCountdownDisplay(-1);
        }

        rafRef.current = requestAnimationFrame(loop);
        return;
      }

      if (phaseRef.current === "racing") {
        const snap = sim.step();
        const ghostSnaps = ghostSims.map((gs, i) => {
          const gsnap = gs.step();
          return { snapshot: gsnap, wheelPath: ghostWheelPaths[i] };
        });
        render(snap, ghostSnaps);

        if (snap.finished) {
          phaseRef.current = "done";
          if (!finishedCalledRef.current) {
            finishedCalledRef.current = true;
            onFinished(snap.elapsedMs);
          }
          return;
        }

        rafRef.current = requestAnimationFrame(loop);
      }
    }

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [track, wheelDraw, ghosts, onFinished]);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#F4EAD5" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {phaseRef.current === "countdown" && countdownRef.current >= 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(244, 234, 213, 0.6)",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontSize: 96,
              fontWeight: "bold",
              color: "#2B2118",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {countdownRef.current === 0 ? "GO!" : countdownRef.current}
          </span>
        </div>
      )}
    </div>
  );
}
