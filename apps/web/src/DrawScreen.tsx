import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { processDraw, validateConstraints, type DrawResult, type Point, type DrawConstraints, type ConstraintViolation } from "@drawrace/engine-core";
import { getHaptics } from "./Haptics.js";
import { getSoundManager } from "./Sound.js";

export interface StrokePoint extends Point {
  t: number;
}

interface DrawScreenProps {
  onComplete: (result: DrawResult, strokePoints: StrokePoint[]) => void;
  onOpenSettings: () => void;
  constraints?: DrawConstraints;
  trackName?: string;
  onRotateTrack?: () => void;
  onShowDailyChallenge?: () => void;
  onBack?: () => void;
  isDailyChallenge?: boolean;
  dailyModifiers?: { gravity_multiplier: number; friction_multiplier: number; chassis_mass_multiplier: number };
}

const CANVAS_SIZE_CSS = 300;

export function DrawScreen({ onComplete, onOpenSettings, constraints, trackName, onRotateTrack, onShowDailyChallenge, onBack, isDailyChallenge, dailyModifiers }: DrawScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rawPointsRef = useRef<StrokePoint[]>([]);
  const travelRef = useRef(0);
  const startTimeRef = useRef(0);
  const activePointerRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const strokeCountRef = useRef(0);
  const [canRace, setCanRace] = useState(false);
  const [previewResult, setPreviewResult] = useState<DrawResult | null>(null);
  const [constraintViolation, setConstraintViolation] = useState<ConstraintViolation | null>(null);
  const activeConstraints = useMemo(() => {
    const modes: string[] = [];
    if (constraints?.singleStroke) modes.push("Single-Stroke");
    if (constraints?.convexOnly) modes.push("Convex-Only");
    return modes;
  }, [constraints]);
  const sound = getSoundManager();
  const haptics = getHaptics();

  useEffect(() => {
    const offscreen = document.createElement("canvas");
    offscreen.width = CANVAS_SIZE_CSS;
    offscreen.height = CANVAS_SIZE_CSS;
    offCanvasRef.current = offscreen;
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const renderStroke = useCallback(() => {
    const canvas = canvasRef.current;
    const off = offCanvasRef.current;
    if (!canvas || !off) return;

    // Do NOT use desynchronized:true — on Android Chrome that context flag
    // causes the offscreen→onscreen blit to never appear visually even though
    // the 2D API calls succeed.  The race canvas (Renderer.ts) has the same
    // constraint.  A 300×300 draw canvas has no latency requirement anyway.
    const ctx = canvas.getContext("2d");
    const offCtx = off.getContext("2d");
    if (!ctx || !offCtx) return;

    const pts = rawPointsRef.current;
    if (pts.length < 2) return;

    offCtx.clearRect(0, 0, off.width, off.height);
    offCtx.strokeStyle = "#2B2118";
    offCtx.lineWidth = 2;
    offCtx.lineCap = "round";
    offCtx.lineJoin = "round";
    offCtx.beginPath();
    offCtx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const mx = (prev.x + cur.x) / 2;
      const my = (prev.y + cur.y) / 2;
      offCtx.quadraticCurveTo(prev.x, prev.y, mx, my);
    }
    offCtx.stroke();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#F4EAD5";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(off, 0, 0);

    if (previewResult) {
      ctx.strokeStyle = "rgba(217, 79, 58, 0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const piece of previewResult.convexPieces) {
        ctx.moveTo(piece[0].x + previewResult.centroid.x, piece[0].y + previewResult.centroid.y);
        for (let i = 1; i < piece.length; i++) {
          ctx.lineTo(piece[i].x + previewResult.centroid.x, piece[i].y + previewResult.centroid.y);
        }
        ctx.closePath();
      }
      ctx.stroke();
    }
  }, [previewResult]);

  const scheduleRender = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(renderStroke);
  }, [renderStroke]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.setPointerCapture(e.pointerId);
      activePointerRef.current = e.pointerId;
      startTimeRef.current = Date.now();

      // Track stroke count: if we already have points, this is a new stroke
      if (rawPointsRef.current.length > 0) {
        strokeCountRef.current += 1;
      } else {
        strokeCountRef.current = 1;
      }

      rawPointsRef.current = [{ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, t: 0 }];
      travelRef.current = 0;
      setCanRace(false);
      setPreviewResult(null);
      setConstraintViolation(null);
      scheduleRender();
    },
    [scheduleRender]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerId !== activePointerRef.current) return;
      const pts = rawPointsRef.current;
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const events = e.nativeEvent instanceof PointerEvent
        ? (e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent])
        : [e.nativeEvent];

      for (const ce of events) {
        // Coalesced events on Android Chrome may not have offsetX/offsetY set.
        // Fall back to computing from clientX/clientY.
        const x = ce.offsetX != null ? ce.offsetX : (rect ? ce.clientX - rect.left : 0);
        const y = ce.offsetY != null ? ce.offsetY : (rect ? ce.clientY - rect.top : 0);
        if (pts.length > 0) {
          const prev = pts[pts.length - 1];
          const d = Math.hypot(x - prev.x, y - prev.y);
          if (d < 1.0) continue;
          travelRef.current += d;
        }
        pts.push({ x, y, t: Date.now() - startTimeRef.current });
      }

      const travel = travelRef.current;
      const enoughSamples = pts.length >= 20;
      setCanRace(travel >= 150 && enoughSamples);
      scheduleRender();
    },
    [scheduleRender]
  );

  const onPointerUp = useCallback(() => {
    activePointerRef.current = null;
  }, []);

  const handleRace = useCallback(() => {
    const rawPts = rawPointsRef.current;
    const plainPts: Point[] = rawPts.map(({ x, y }) => ({ x, y }));
    const result = processDraw(plainPts, travelRef.current);
    if (result) {
      // Validate constraints if any are specified
      if (constraints) {
        const violation = validateConstraints(result, constraints, strokeCountRef.current);
        if (violation) {
          setConstraintViolation(violation);
          sound.playDnf();
          return;
        }
      }

      if (!result.isOpenLoop) {
        sound.playStrokeClosure();
      } else {
        sound.playUiTap();
      }
      haptics.uiTap();
      onComplete(result, rawPts);
    }
  }, [onComplete, sound, haptics, constraints]);

  const handleClear = useCallback(() => {
    rawPointsRef.current = [];
    travelRef.current = 0;
    activePointerRef.current = null;
    strokeCountRef.current = 0;
    setCanRace(false);
    setPreviewResult(null);
    setConstraintViolation(null);
    sound.playClear();
    haptics.uiTap();
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#F4EAD5";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [sound, haptics]);

  return (
    <div
      role="main"
      aria-label="Draw your wheel screen"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        backgroundColor: "#F4EAD5",
        fontFamily: '"Caveat", "Patrick Hand", "Comic Sans MS", cursive, system-ui, sans-serif',
        color: "#2B2118",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: 350 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>
            {isDailyChallenge ? "Daily Challenge" : "Draw your wheel"}
          </h1>
          {trackName && (
            <div
              style={{
                fontSize: 14,
                color: "#6E5F48",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
              aria-label="Current track"
            >
              <span style={{ fontWeight: 600 }}>Track:</span> {trackName}
              {onRotateTrack && (
                <button
                  onClick={() => {
                    sound.playUiTap();
                    haptics.uiTap();
                    onRotateTrack();
                  }}
                  aria-label="Switch to next track"
                  style={{
                    background: "none",
                    border: "1px solid #6E5F48",
                    borderRadius: 4,
                    padding: "2px 6px",
                    fontSize: 12,
                    cursor: "pointer",
                    color: "#6E5F48",
                    marginLeft: 4,
                  }}
                >
                  Switch →
                </button>
              )}
            </div>
          )}
          {activeConstraints.length > 0 && (
            <div
              style={{
                fontSize: 12,
                color: "#D94F3A",
                fontWeight: 600,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
              aria-label="Active challenge modes"
            >
              {activeConstraints.map((mode) => (
                <span
                  key={mode}
                  style={{
                    backgroundColor: "rgba(217, 79, 58, 0.15)",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {mode}
                </span>
              ))}
            </div>
          )}
          {isDailyChallenge && dailyModifiers && (
            <div
              style={{
                fontSize: 12,
                color: "#4A7C59",
                fontWeight: 600,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
              aria-label="Daily challenge modifiers"
            >
              <span style={{ backgroundColor: "rgba(74, 124, 89, 0.15)", padding: "2px 6px", borderRadius: 4 }}>
                G: {dailyModifiers.gravity_multiplier.toFixed(1)}x
              </span>
              <span style={{ backgroundColor: "rgba(74, 124, 89, 0.15)", padding: "2px 6px", borderRadius: 4 }}>
                F: {dailyModifiers.friction_multiplier.toFixed(1)}x
              </span>
              <span style={{ backgroundColor: "rgba(74, 124, 89, 0.15)", padding: "2px 6px", borderRadius: 4 }}>
                M: {dailyModifiers.chassis_mass_multiplier.toFixed(1)}x
              </span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {onBack && (
            <button
              onClick={() => {
                sound.playUiTap();
                haptics.uiTap();
                onBack();
              }}
              aria-label="Go back"
              style={{
                background: "none",
                border: "2px solid #2B2118",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 20,
                cursor: "pointer",
                color: "#2B2118",
              }}
            >
              ←
            </button>
          )}
          <button
            onClick={() => {
              sound.playUiTap();
              haptics.uiTap();
              onOpenSettings();
            }}
            aria-label="Open settings"
            style={{
              background: "none",
              border: "2px solid #2B2118",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 20,
              cursor: "pointer",
              color: "#2B2118",
            }}
          >
            ⚙️
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE_CSS}
        height={CANVAS_SIZE_CSS}
        role="img"
        aria-label="Drawing canvas. Use mouse or touch to draw a wheel shape."
        style={{
          width: CANVAS_SIZE_CSS,
          height: CANVAS_SIZE_CSS,
          border: "2px solid #2B2118",
          borderRadius: 8,
          touchAction: "none",
          cursor: "crosshair",
          backgroundColor: "#F4EAD5",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div style={{ display: "flex", gap: 12 }} role="toolbar" aria-label="Drawing controls">
        <button
          onClick={handleClear}
          aria-label="Clear drawing"
          style={{
            padding: "12px 24px",
            fontSize: 16,
            backgroundColor: "#2B2118",
            color: "#F4EAD5",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Clear
        </button>
        <button
          onClick={handleRace}
          disabled={!canRace}
          aria-label={canRace ? "Start race" : "Draw a wheel first to enable race"}
          style={{
            padding: "12px 24px",
            fontSize: 16,
            fontWeight: 600,
            fontFamily: "inherit",
            backgroundColor: canRace ? "#D94F3A" : "#999",
            color: canRace ? "#2B2118" : "#666",
            border: canRace ? "2px solid #2B2118" : "none",
            borderRadius: 8,
            cursor: canRace ? "pointer" : "not-allowed",
          }}
        >
          Race!
        </button>
      </div>
      <div style={{ fontSize: 14, color: "#6E5F48" }} role="status" aria-live="polite">
        {canRace ? "Wheel ready!" : "Draw a complete wheel shape (minimum size and length required)"}
      </div>
      {constraintViolation && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            fontSize: 14,
            color: "#A13A2E",
            backgroundColor: "rgba(161, 58, 46, 0.1)",
            padding: "8px 12px",
            borderRadius: 8,
            textAlign: "center",
            maxWidth: 350,
          }}
        >
          {constraintViolation.message}
        </div>
      )}
      {!isDailyChallenge && onShowDailyChallenge && (
        <button
          onClick={() => {
            sound.playUiTap();
            haptics.uiTap();
            onShowDailyChallenge();
          }}
          aria-label="Open daily challenge"
          style={{
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "inherit",
            backgroundColor: "#4A7C59",
            color: "#F4EAD5",
            border: "2px solid #2B2118",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Daily Challenge
        </button>
      )}
    </div>
  );
}
