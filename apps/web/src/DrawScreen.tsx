import { useRef, useCallback, useEffect, useState } from "react";
import { processDraw, type DrawResult, type Point } from "@drawrace/engine-core";

interface DrawScreenProps {
  onComplete: (result: DrawResult) => void;
}

const CANVAS_SIZE_CSS = 300;

export function DrawScreen({ onComplete }: DrawScreenProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rawPointsRef = useRef<Point[]>([]);
  const travelRef = useRef(0);
  const activePointerRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);
  const [canRace, setCanRace] = useState(false);
  const [previewResult, setPreviewResult] = useState<DrawResult | null>(null);

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
      rawPointsRef.current = [{ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }];
      travelRef.current = 0;
      setCanRace(false);
      setPreviewResult(null);
      scheduleRender();
    },
    [scheduleRender]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerId !== activePointerRef.current) return;
      const pts = rawPointsRef.current;
      const events = e.nativeEvent instanceof PointerEvent
        ? (e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent])
        : [e.nativeEvent];

      for (const ce of events) {
        const x = ce.offsetX;
        const y = ce.offsetY;
        if (pts.length > 0) {
          const prev = pts[pts.length - 1];
          const d = Math.hypot(x - prev.x, y - prev.y);
          if (d < 1.0) continue;
          travelRef.current += d;
        }
        pts.push({ x, y });
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
    const result = processDraw(rawPointsRef.current, travelRef.current);
    if (result) {
      onComplete(result);
    }
  }, [onComplete]);

  const handleClear = useCallback(() => {
    rawPointsRef.current = [];
    travelRef.current = 0;
    activePointerRef.current = null;
    setCanRace(false);
    setPreviewResult(null);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#F4EAD5";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        backgroundColor: "#F4EAD5",
        fontFamily: "system-ui, sans-serif",
        color: "#2B2118",
        gap: 16,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 24 }}>Draw your wheel</h1>
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE_CSS}
        height={CANVAS_SIZE_CSS}
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
      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={handleClear}
          style={{
            padding: "10px 24px",
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
          style={{
            padding: "10px 24px",
            fontSize: 16,
            backgroundColor: canRace ? "#D94F3A" : "#999",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: canRace ? "pointer" : "not-allowed",
          }}
        >
          Race!
        </button>
      </div>
    </div>
  );
}
