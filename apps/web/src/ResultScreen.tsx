import { useMemo, useEffect, useState } from "react";
import type { DrawResult } from "@drawrace/engine-core";
import type { StrokePoint } from "./DrawScreen.js";
import { submitGhost, waitForVerdict, isOnline, type SubmissionVerdict } from "./api.js";

interface GhostResult {
  name: string;
  finishTimeMs: number;
}

interface ResultScreenProps {
  finishTimeMs: number;
  wheelDraw: DrawResult;
  rawStrokePoints: StrokePoint[];
  trackId: number;
  ghosts: GhostResult[];
  onRetry: () => void;
}

function formatTime(ms: number): string {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const frac = Math.floor((totalSec * 1000) % 1000);
  return `${min}:${sec.toString().padStart(2, "0")}.${frac.toString().padStart(3, "0")}`;
}

export function ResultScreen({ finishTimeMs, wheelDraw, rawStrokePoints, trackId, ghosts, onRetry }: ResultScreenProps) {
  const [verdict, setVerdict] = useState<SubmissionVerdict | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const online = isOnline();

  useEffect(() => {
    if (!online || submitting) return;
    setSubmitting(true);

    let cancelled = false;
    (async () => {
      const submissionId = await submitGhost({
        trackId,
        finishTimeMs,
        wheelVertices: wheelDraw.vertices,
        rawStrokePoints,
      });
      if (!submissionId || cancelled) return;

      const result = await waitForVerdict(submissionId, (v) => {
        if (!cancelled) setVerdict(v);
      });
      if (result && !cancelled) {
        setVerdict(result);
      }
    })();

    return () => { cancelled = true; };
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const comparisons = useMemo(() => {
    return ghosts.map((g) => {
      const diff = finishTimeMs - g.finishTimeMs;
      return {
        name: g.name,
        ghostTime: g.finishTimeMs,
        beat: diff < 0,
        diffMs: Math.abs(diff),
      };
    }).sort((a, b) => a.ghostTime - b.ghostTime);
  }, [finishTimeMs, ghosts]);

  const beaten = comparisons.filter((c) => c.beat).length;

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
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 44, fontWeight: "bold", fontFamily: "monospace" }}>
        {formatTime(finishTimeMs)}
      </div>

      {online && verdict && verdict.status === "pending_validation" && (
        <div style={{ fontSize: 14, opacity: 0.6 }}>
          Verifying time...
        </div>
      )}
      {online && verdict && verdict.status === "accepted" && (
        <div style={{ fontSize: 14, color: "#7CA05C" }}>
          Rank #{verdict.rank} — {verdict.bucket} {verdict.is_pb ? "(New PB!)" : ""}
        </div>
      )}
      {online && verdict && verdict.status === "rejected" && (
        <div style={{ fontSize: 14, color: "#D94F3A" }}>
          Time not accepted
        </div>
      )}

      <div style={{ fontSize: 16, opacity: 0.7 }}>
        {beaten > 0
          ? `Beat ${beaten} of ${ghosts.length} ghosts`
          : ghosts.length > 0
          ? `Didn't beat any ghosts yet`
          : ""}
      </div>

      <div
        style={{
          width: 96,
          height: 96,
          border: "2px solid #2B2118",
          borderRadius: 8,
          backgroundColor: "#FBF4E3",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <svg width="80" height="80" viewBox="-50 -50 100 100">
          <polygon
            points={wheelDraw.vertices
              .map((v) => `${(v.x * 40).toFixed(1)},${(v.y * 40).toFixed(1)}`)
              .join(" ")}
            fill="#D94F3A"
            stroke="#2B2118"
            strokeWidth="2"
          />
        </svg>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 300 }}>
        {comparisons.map((c) => (
          <div
            key={c.name}
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 14,
              padding: "4px 0",
              borderBottom: "1px solid rgba(43,33,24,0.1)",
            }}
          >
            <span>{c.beat ? "Beat" : "Lost to"} {c.name}</span>
            <span style={{ fontFamily: "monospace", color: c.beat ? "#7CA05C" : "#D94F3A" }}>
              {formatTime(c.ghostTime)}
            </span>
          </div>
        ))}
      </div>

      <button
        onClick={onRetry}
        style={{
          marginTop: 16,
          padding: "14px 48px",
          fontSize: 18,
          fontWeight: 600,
          backgroundColor: "#D94F3A",
          color: "white",
          border: "none",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Try Again
      </button>
    </div>
  );
}
