import { useMemo, useEffect, useState, useCallback } from "react";
import type { DrawResult, WheelSwap } from "@drawrace/engine-core";
import type { StrokePoint } from "./DrawScreen.js";
import { submitGhost, waitForVerdict, isOnline, type SubmissionVerdict } from "./api.js";
import { getSoundManager } from "./Sound.js";
import { getHaptics } from "./Haptics.js";
import { ensureRecoveryPhrase, wasRecoveryPhraseShown, markRecoveryPhraseShown, formatRecoveryPhrase } from "./recovery-phrase.js";

export function encodeWheelForShare(vertices: Array<{ x: number; y: number }>, trackId: number): string {
  const payload = { v: vertices.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]), t: trackId };
  return btoa(JSON.stringify(payload));
}

export function decodeWheelFromShare(encoded: string): { vertices: Array<{ x: number; y: number }>; trackId: number } | null {
  try {
    const payload = JSON.parse(atob(encoded));
    if (!Array.isArray(payload.v) || typeof payload.t !== "number") return null;
    const vertices = payload.v.map(([x, y]: [number, number]) => ({ x, y }));
    return { vertices, trackId: payload.t };
  } catch {
    return null;
  }
}

interface GhostResult {
  name: string;
  finishTimeMs: number;
}

interface ResultScreenProps {
  finishTimeMs: number;
  wheelDraw: DrawResult;
  rawStrokePoints: StrokePoint[];
  trackId: number;
  swapLog: WheelSwap[];
  stuck: boolean;
  ghosts: GhostResult[];
  onRetry: () => void;
  onShowLeaderboard: () => void;
  isDailyChallenge?: boolean;
  dailyChallengeDate?: string;
}

function formatTime(ms: number): string {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const frac = Math.floor((totalSec * 1000) % 1000);
  return `${min}:${sec.toString().padStart(2, "0")}.${frac.toString().padStart(3, "0")}`;
}

export function ResultScreen({ finishTimeMs, wheelDraw, rawStrokePoints, trackId, swapLog, stuck, ghosts, onRetry, onShowLeaderboard, isDailyChallenge, dailyChallengeDate }: ResultScreenProps) {
  const [verdict, setVerdict] = useState<SubmissionVerdict | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showRecoveryPhrase, setShowRecoveryPhrase] = useState(false);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[] | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  const handleShare = useCallback(() => {
    const encoded = encodeWheelForShare(wheelDraw.vertices, trackId);
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("wheel", encoded);
    navigator.clipboard.writeText(url.toString()).then(() => {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    });
    getSoundManager().playUiTap();
    getHaptics().uiTap();
  }, [wheelDraw.vertices, trackId]);

  const online = isOnline();

  // Generate recovery phrase on first accepted verdict
  useEffect(() => {
    if (verdict?.status === "accepted" && !wasRecoveryPhraseShown()) {
      const phrase = ensureRecoveryPhrase();
      setRecoveryPhrase(phrase);
      setShowRecoveryPhrase(true);
      markRecoveryPhraseShown();
    }
  }, [verdict]);

  useEffect(() => {
    // Skip submission for stuck-DNF runs (only submit completed runs)
    if (!online || submitting || stuck) return;
    setSubmitting(true);

    let cancelled = false;
    (async () => {
      // Convert swap log from engine format to API format
      const wheels = swapLog.map(swap => ({
        swapTick: swap.swap_tick,
        vertices: swap.polygon.map(([x, y]) => ({ x, y })),
      }));
      const submissionId = await submitGhost({
        trackId,
        finishTimeMs,
        wheelVertices: wheelDraw.vertices,
        rawStrokePoints,
        wheels,
        dailyChallengeDate: isDailyChallenge ? dailyChallengeDate : undefined,
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
  }, [online, stuck]); // eslint-disable-line react-hooks/exhaustive-deps

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
      role="main"
      aria-label="Race results screen"
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
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      {/* Stuck-DNF message */}
      {stuck && (
        <div
          style={{
            fontSize: 28,
            fontWeight: "bold",
            color: "#D94F3A",
            textAlign: "center",
            padding: "12px 24px",
            background: "#FBF4E3",
            border: "3px solid #2B2118",
            borderRadius: 12,
            boxShadow: "4px 4px 0 rgba(43,33,24,0.2)",
          }}
          role="alert"
          aria-live="assertive"
        >
          Stuck!
          <div style={{ fontSize: 18, fontWeight: "normal", color: "#6E5F48", marginTop: 4 }}>
            Try a different wheel shape
          </div>
        </div>
      )}

      {isDailyChallenge && (
        <div
          style={{
            fontSize: 20,
            fontWeight: "bold",
            color: "#4A7C59",
            textAlign: "center",
            padding: "8px 16px",
            background: "rgba(74, 124, 89, 0.15)",
            border: "2px solid #4A7C59",
            borderRadius: 8,
          }}
          role="status"
          aria-live="polite"
        >
          Daily Challenge
        </div>
      )}

      <div style={{ fontSize: 44, fontWeight: "bold", fontFamily: "monospace" }} role="timer" aria-label={`Finish time: ${formatTime(finishTimeMs)}`}>
        {formatTime(finishTimeMs)}
      </div>

      {online && verdict && verdict.status === "pending_validation" && (
        <div style={{ fontSize: 14, color: "#6E5F48" }} role="status" aria-live="polite">
          Verifying time...
        </div>
      )}
      {online && verdict && verdict.status === "accepted" && (
        <div style={{ fontSize: 14, color: "#4A7C59" }} role="status" aria-live="polite">
          Rank #{verdict.rank} — {verdict.bucket} {verdict.is_pb ? "(New Personal Best!)" : ""}
        </div>
      )}
      {online && verdict && verdict.status === "rejected" && (
        <div style={{ fontSize: 14, color: "#D94F3A" }} role="alert" aria-live="assertive">
          Time not accepted
        </div>
      )}

      <div style={{ fontSize: 16, color: "#6E5F48" }} role="status" aria-live="polite">
        {beaten > 0
          ? `Beat ${beaten} of ${ghosts.length} ghosts`
          : ghosts.length > 0
          ? `Didn't beat any ghosts yet`
          : ""}
      </div>

      <div
        role="img"
        aria-label="Your wheel shape"
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
        <svg width="80" height="80" viewBox="-50 -50 100 100" aria-hidden="true">
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

      <ul
        style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 300 }}
        role="list"
        aria-label="Ghost comparison results"
      >
        {comparisons.map((c) => (
          <li
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
            <span style={{ fontFamily: "monospace", color: c.beat ? "#4A7C59" : "#6E5F48" }}>
              {formatTime(c.ghostTime)}
            </span>
          </li>
        ))}
      </ul>

      <button
        onClick={() => {
          getSoundManager().playUiTap();
          getHaptics().uiTap();
          onRetry();
        }}
        aria-label="Try again with a new wheel"
        style={{
          marginTop: 16,
          padding: "14px 48px",
          fontSize: 18,
          fontWeight: 600,
          fontFamily: "inherit",
          backgroundColor: "#D94F3A",
          color: "#2B2118",
          border: "2px solid #2B2118",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        Try Again
      </button>

      <button
        onClick={handleShare}
        aria-label="Copy share link for this wheel shape"
        style={{
          padding: "10px 32px",
          fontSize: 16,
          fontWeight: 600,
          fontFamily: "inherit",
          backgroundColor: "transparent",
          color: "#2B2118",
          border: "2px solid #2B2118",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        {shareCopied ? "Link copied!" : "Share Wheel"}
      </button>

      {online && (
        <button
          onClick={() => {
            getSoundManager().playUiTap();
            getHaptics().uiTap();
            onShowLeaderboard();
          }}
          aria-label="View leaderboard"
          style={{
            padding: "10px 32px",
            fontSize: 16,
            fontWeight: 600,
            fontFamily: "inherit",
            backgroundColor: "transparent",
            color: "#2B2118",
            border: "2px solid #2B2118",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Leaderboard
        </button>
      )}

      {/* Recovery phrase chip - shown after first race */}
      {online && !showRecoveryPhrase && (
        <button
          onClick={() => {
            getSoundManager().playUiTap();
            getHaptics().uiTap();
            const phrase = ensureRecoveryPhrase();
            setRecoveryPhrase(phrase);
            setShowRecoveryPhrase(true);
          }}
          aria-label="Get your recovery phrase"
          style={{
            padding: "8px 16px",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "inherit",
            backgroundColor: "#3D6B4A",
            color: "#F4EAD5",
            border: "none",
            borderRadius: 16,
            cursor: "pointer",
          }}
        >
          Claim a name
        </button>
      )}

      {/* Recovery phrase modal */}
      {showRecoveryPhrase && recoveryPhrase && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recovery-title"
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(43, 33, 24, 0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              backgroundColor: "#F4EAD5",
              borderRadius: 16,
              padding: 24,
              maxWidth: 400,
              width: "100%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            }}
          >
            <h3 id="recovery-title" style={{ margin: "0 0 16px 0", fontSize: 20, color: "#2B2118" }}>
              Your Recovery Phrase
            </h3>
            <p style={{ margin: "0 0 16px 0", fontSize: 14, color: "#6E5F48", lineHeight: 1.5 }}>
              Save these 4 words to restore your name on a new device. You can find them again in Settings.
            </p>
            <div
              style={{
                backgroundColor: "#FBF4E3",
                border: "2px solid #2B2118",
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
                textAlign: "center",
                fontSize: 18,
                fontWeight: 600,
                color: "#2B2118",
                fontFamily: "monospace",
                wordSpacing: "8px",
              }}
            >
              {formatRecoveryPhrase(recoveryPhrase)}
            </div>
            <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
              <button
                onClick={() => {
                  getSoundManager().playUiTap();
                  getHaptics().uiTap();
                  navigator.clipboard.writeText(formatRecoveryPhrase(recoveryPhrase));
                }}
                aria-label="Copy recovery phrase to clipboard"
                style={{
                  padding: "12px",
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  backgroundColor: "#D94F3A",
                  color: "#2B2118",
                  border: "2px solid #2B2118",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Copy to Clipboard
              </button>
              <button
                onClick={() => {
                  getSoundManager().playUiTap();
                  getHaptics().uiTap();
                  setShowRecoveryPhrase(false);
                }}
                aria-label="Close recovery phrase"
                style={{
                  padding: "12px",
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  backgroundColor: "transparent",
                  color: "#2B2118",
                  border: "2px solid #2B2118",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Got it, I've saved it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
