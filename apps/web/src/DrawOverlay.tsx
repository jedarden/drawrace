import { useRef, useCallback, useEffect, useState } from "react";
import { processDraw } from "@drawrace/engine-core";
import type { DrawResult } from "@drawrace/engine-core";
import {
  MAX_SWAPS,
  COOLDOWN_MS,
  type SwapPhase,
  getCooldownProgress,
} from "./cooldown-machine.js";

interface DrawOverlayProps {
  /** True once the race GO fires; false during countdown and after finish */
  active: boolean;
  /** Total mid-race swaps committed so far (used for N/20 cap enforcement) */
  swapCount: number;
  /** Called with the processed DrawResult when a valid stroke is committed */
  onSwapCommit: (result: DrawResult) => void;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

interface PreviewState {
  vertices: Array<{ x: number; y: number }>;
  startMs: number;
}

export function DrawOverlay({ active, swapCount, onSwapCommit }: DrawOverlayProps) {
  const strokeCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drawing state
  const rawPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const travelRef = useRef(0);
  const activePointerRef = useRef<number | null>(null);
  const strokeRafRef = useRef<number>(0);

  // Phase state — internal, synced from active prop and swap commits
  const [phase, setPhase] = useState<SwapPhase>("inactive");
  const phaseRef = useRef<SwapPhase>("inactive");
  phaseRef.current = phase;

  // Keep latest swapCount accessible in async callbacks without stale closures
  const swapCountRef = useRef(swapCount);
  swapCountRef.current = swapCount;

  // Cooldown gauge animation
  const [cooldownProgress, setCooldownProgress] = useState(0);
  const cooldownStartMsRef = useRef(0);

  // Swap preview animation
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const previewRafRef = useRef<number>(0);

  // Sync active → phase transitions
  useEffect(() => {
    if (active) {
      setPhase((prev) => {
        if (prev === "inactive") {
          return swapCountRef.current >= MAX_SWAPS ? "capped" : "active";
        }
        return prev;
      });
    } else {
      setPhase("inactive");
    }
  }, [active]);

  // Watch for cap being reached while in active state
  useEffect(() => {
    if (swapCount >= MAX_SWAPS) {
      setPhase((prev) => (prev === "active" ? "capped" : prev));
    }
  }, [swapCount]);

  // Animate cooldown gauge when phase enters "cooldown"
  useEffect(() => {
    if (phase !== "cooldown") {
      setCooldownProgress(0);
      return;
    }
    cooldownStartMsRef.current = performance.now();
    let rafId: number;
    function tick() {
      const elapsed = performance.now() - cooldownStartMsRef.current;
      const p = Math.min(elapsed / COOLDOWN_MS, 1);
      setCooldownProgress(p);
      if (p < 1) {
        rafId = requestAnimationFrame(tick);
      }
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [phase]);

  // Animate swap preview: draw polygon on canvas, scale 120%→100% over 300ms
  useEffect(() => {
    if (!preview) return;

    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const SIZE = 120;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Normalize vertices to fit in the preview canvas
    const verts = preview.vertices;
    const xs = verts.map((v) => v.x);
    const ys = verts.map((v) => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const range = Math.max(maxX - minX, maxY - minY) || 1;
    const pad = 12;
    const scale = (SIZE - 2 * pad) / range;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "rgba(217, 79, 58, 0.25)";
    ctx.strokeStyle = "#D94F3A";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i <= verts.length; i++) {
      const v = verts[i % verts.length];
      const sx = SIZE / 2 + (v.x - cx) * scale;
      const sy = SIZE / 2 + (v.y - cy) * scale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.fill();
    ctx.stroke();

    const startMs = preview.startMs;
    const DURATION = 300;
    let rafId: number;
    function animatePreview() {
      const t = Math.min((performance.now() - startMs) / DURATION, 1);
      const s = 1.2 - 0.2 * easeOutBack(t);
      if (canvas) {
        canvas.style.transform = `translate(-50%, -50%) scale(${s})`;
        canvas.style.opacity = t >= 1 ? "0" : "1";
      }
      if (t < 1) {
        rafId = requestAnimationFrame(animatePreview);
      } else {
        setPreview(null);
      }
    }
    rafId = requestAnimationFrame(animatePreview);
    previewRafRef.current = rafId;
    return () => cancelAnimationFrame(rafId);
  }, [preview]);

  // Sync stroke canvas size to container
  useEffect(() => {
    const canvas = strokeCanvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const resize = () => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (strokeRafRef.current) cancelAnimationFrame(strokeRafRef.current);
      if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
    };
  }, []);

  const renderStroke = useCallback(() => {
    const canvas = strokeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pts = rawPointsRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (pts.length < 2) return;

    ctx.strokeStyle = "#2B2118";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const mx = (prev.x + cur.x) / 2;
      const my = (prev.y + cur.y) / 2;
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    ctx.stroke();
  }, []);

  const scheduleStrokeRender = useCallback(() => {
    if (strokeRafRef.current) cancelAnimationFrame(strokeRafRef.current);
    strokeRafRef.current = requestAnimationFrame(renderStroke);
  }, [renderStroke]);

  const clearStrokeCanvas = useCallback(() => {
    const canvas = strokeCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Always capture so the race canvas never sees events inside this rect
      (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

      // Only start stroke if in active phase and under cap
      if (phaseRef.current !== "active") return;
      if (swapCountRef.current >= MAX_SWAPS) return;

      activePointerRef.current = e.pointerId;

      const canvas = strokeCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      rawPointsRef.current = [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
      travelRef.current = 0;
      scheduleStrokeRender();
    },
    [scheduleStrokeRender],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== activePointerRef.current) return;

      const canvas = strokeCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();

      const pts = rawPointsRef.current;
      const coalescedEvents =
        e.nativeEvent instanceof PointerEvent
          ? (e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent])
          : [e.nativeEvent];

      for (const ce of coalescedEvents) {
        const x = ce.clientX - rect.left;
        const y = ce.clientY - rect.top;
        if (pts.length > 0) {
          const prev = pts[pts.length - 1];
          const d = Math.hypot(x - prev.x, y - prev.y);
          if (d < 1.0) continue;
          travelRef.current += d;
        }
        pts.push({ x, y });
      }
      scheduleStrokeRender();
    },
    [scheduleStrokeRender],
  );

  const finishStroke = useCallback(() => {
    if (activePointerRef.current === null) return;
    activePointerRef.current = null;

    const pts = rawPointsRef.current;
    const travel = travelRef.current;
    rawPointsRef.current = [];
    travelRef.current = 0;
    clearStrokeCanvas();

    // Reject if not in active phase or at cap
    if (phaseRef.current !== "active") return;
    if (swapCountRef.current >= MAX_SWAPS) return;
    // Reject strokes too short
    if (travel < 150 || pts.length < 20) return;

    const result = processDraw(pts, travel);
    if (!result) return;

    // Transition to cooldown before calling onSwapCommit so UI updates immediately
    setPhase("cooldown");
    cooldownStartMsRef.current = performance.now();

    onSwapCommit(result);

    // Trigger swap preview at approximate wheel screen position (35% from left)
    setPreview({ vertices: result.vertices, startMs: performance.now() });

    // Schedule cooldown expiry
    const expireAt = cooldownStartMsRef.current + COOLDOWN_MS;
    setTimeout(() => {
      const remaining = expireAt - performance.now();
      const delay = remaining > 0 ? remaining : 0;
      if (delay > 0) {
        setTimeout(() => {
          setPhase(swapCountRef.current >= MAX_SWAPS ? "capped" : "active");
        }, delay);
      } else {
        setPhase(swapCountRef.current >= MAX_SWAPS ? "capped" : "active");
      }
    }, COOLDOWN_MS);
  }, [clearStrokeCanvas, onSwapCommit]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== activePointerRef.current) return;
      finishStroke();
    },
    [finishStroke],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerId !== activePointerRef.current) return;
      finishStroke();
    },
    [finishStroke],
  );

  if (phase === "inactive") return null;

  const isGreyed = phase === "cooldown" || phase === "capped";
  const cooldownNow = phase === "cooldown" ? getCooldownProgress(
    { phase, swapCount, cooldownStartMs: cooldownStartMsRef.current },
    performance.now(),
  ) : 0;

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Mid-race draw area: draw a new wheel shape"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: "40%",
        touchAction: "none",
        zIndex: 10,
        cursor: phase === "active" ? "crosshair" : "default",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {/* Cream background — 50% alpha active, 70% when greyed (cooldown/capped) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "#F4EAD5",
          opacity: isGreyed ? 0.7 : 0.5,
          pointerEvents: "none",
          filter: isGreyed ? "saturate(0.4)" : "none",
          transition: "opacity 0.1s ease, filter 0.1s ease",
        }}
      />

      {/* Cooldown gauge — progress bar across top edge */}
      {phase === "cooldown" && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            backgroundColor: "rgba(43,33,24,0.15)",
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.min(cooldownProgress * 100, 100)}%`,
              backgroundColor: "#6E5F48",
            }}
          />
        </div>
      )}

      {/* In-progress stroke canvas */}
      <canvas
        ref={strokeCanvasRef}
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          opacity: isGreyed ? 0.3 : 1,
        }}
      />

      {/* Swap preview: newly-committed polygon, scales 120%→100% (easeOutBack, 300ms) */}
      {preview && (
        <canvas
          ref={previewCanvasRef}
          aria-hidden="true"
          style={{
            position: "absolute",
            // Approximate screen position of the player's wheel (35% from left, top of overlay)
            left: "35%",
            top: "0%",
            width: 120,
            height: 120,
            pointerEvents: "none",
            transformOrigin: "center center",
            transform: "translate(-50%, -50%) scale(1.2)",
          }}
        />
      )}
    </div>
  );
}
