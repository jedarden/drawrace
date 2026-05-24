import { useEffect, useState, useMemo } from "react";
import { fetchDailyChallenge, fetchDailyGhosts, type DailyChallengeResponse, type GhostData } from "./api.js";
import type { ChallengeModifiers } from "@drawrace/engine-core";

interface DailyChallengeScreenProps {
  onStart: (trackId: number, modifiers: ChallengeModifiers, ghosts: GhostData[], challengeDate: string) => void;
  onBack: () => void;
}

function formatModifier(value: number, label: string): { label: string; color: string; display: string } {
  const display = value.toFixed(1);
  if (value > 1.1) {
    return { label, color: "#D94F3A", display: `${label} ↑ ${display}x` };
  } else if (value < 0.9) {
    return { label, color: "#4A7C59", display: `${label} ↓ ${display}x` };
  }
  return { label, color: "#6E5F48", display: `${label} ${display}x` };
}

function getTimeUntilNextChallenge(): { hours: number; minutes: number; seconds: number } {
  const now = new Date();
  const utcNow = new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
                          now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds());
  const tomorrow = new Date(Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), utcNow.getUTCDate() + 1));
  const diff = tomorrow.getTime() - utcNow.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);
  return { hours, minutes, seconds };
}

const TRACK_NAMES: Record<number, string> = {
  1: "Scribble Slope",
  2: "Canyon Run",
  3: "Dune Drifter",
};

export function DailyChallengeScreen({ onStart, onBack }: DailyChallengeScreenProps) {
  const [challenge, setChallenge] = useState<DailyChallengeResponse | null>(null);
  const [ghosts, setGhosts] = useState<GhostData[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(getTimeUntilNextChallenge());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchDailyChallenge();
        if (data && !cancelled) {
          setChallenge(data);
          const ghostData = await fetchDailyGhosts(data.challenge_date);
          if (!cancelled) {
            setGhosts(ghostData);
            setLoading(false);
          }
        }
      } catch {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(getTimeUntilNextChallenge());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const modifiers = useMemo(() => {
    if (!challenge) return [];
    return [
      formatModifier(challenge.modifiers.gravity_multiplier, "Gravity"),
      formatModifier(challenge.modifiers.friction_multiplier, "Friction"),
      formatModifier(challenge.modifiers.chassis_mass_multiplier, "Mass"),
    ];
  }, [challenge]);

  const handleStart = () => {
    if (challenge) {
      onStart(challenge.track_id, challenge.modifiers, ghosts, challenge.challenge_date);
    }
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading daily challenge"
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
        Loading daily challenge...
      </div>
    );
  }

  if (!challenge) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          width: "100vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#F4EAD5",
          fontFamily: '"Caveat", "Patrick Hand", "Comic Sans MS", cursive, system-ui, sans-serif',
          color: "#2B2118",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 32, fontWeight: "bold" }}>Daily Challenge Unavailable</div>
        <button
          onClick={onBack}
          aria-label="Go back to main menu"
          style={{
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
          Back
        </button>
      </div>
    );
  }

  const { hours, minutes, seconds } = timeLeft;

  return (
    <div
      role="main"
      aria-label="Daily challenge screen"
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#F4EAD5",
        fontFamily: '"Caveat", "Patrick Hand", "Comic Sans MS", cursive, system-ui, sans-serif',
        color: "#2B2118",
        padding: 24,
        boxSizing: "border-box",
        gap: 24,
      }}
    >
      <div style={{ fontSize: 48, fontWeight: "bold", textAlign: "center" }}>
        Daily Challenge
      </div>

      <div style={{ fontSize: 20, color: "#6E5F48", textAlign: "center" }}>
        {TRACK_NAMES[challenge.track_id] || `Track ${challenge.track_id}`}
      </div>

      <div style={{ fontSize: 16, color: "#6E5F48", textAlign: "center" }}>
        Resets in {hours}h {minutes}m {seconds}s
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "100%",
          maxWidth: 320,
        }}
        role="list"
        aria-label="Challenge modifiers"
      >
        {modifiers.map((m) => (
          <div
            key={m.label}
            role="listitem"
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 18,
              padding: "8px 16px",
              backgroundColor: "#FBF4E3",
              border: "2px solid #2B2118",
              borderRadius: 8,
            }}
          >
            <span>{m.label}</span>
            <span style={{ color: m.color, fontWeight: "bold" }}>{m.display.split(" ")[1]} {m.display.split(" ")[2]}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 14, color: "#6E5F48", textAlign: "center", maxWidth: 400 }}>
        {ghosts.length > 0 ? `${ghosts.length} ghosts to beat` : "Be the first to set a time!"}
      </div>

      <div style={{ display: "flex", gap: 16, flexDirection: "column" }}>
        <button
          onClick={handleStart}
          aria-label="Start daily challenge"
          style={{
            padding: "14px 48px",
            fontSize: 18,
            fontWeight: 600,
            fontFamily: "inherit",
            backgroundColor: "#4A7C59",
            color: "#F4EAD5",
            border: "2px solid #2B2118",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Start Challenge
        </button>

        <button
          onClick={onBack}
          aria-label="Go back to main menu"
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
          Back
        </button>
      </div>
    </div>
  );
}
