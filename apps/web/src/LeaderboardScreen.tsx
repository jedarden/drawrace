import { useEffect, useState } from "react";
import {
  fetchLeaderboardContext,
  fetchLeaderboardTop,
  isOnline,
  type LeaderboardEntry,
} from "./api.js";
import { getHaptics } from "./Haptics.js";

interface LeaderboardScreenProps {
  trackId: number;
  onClose: () => void;
}

function formatTime(ms: number): string {
  const totalSec = ms / 1000;
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  const frac = Math.floor((totalSec * 1000) % 1000);
  return `${min}:${sec.toString().padStart(2, "0")}.${frac.toString().padStart(3, "0")}`;
}

type Tab = "top" | "around";

export function LeaderboardScreen({ trackId, onClose }: LeaderboardScreenProps) {
  const [tab, setTab] = useState<Tab>("top");
  const [topEntries, setTopEntries] = useState<LeaderboardEntry[]>([]);
  const [contextEntries, setContextEntries] = useState<LeaderboardEntry[]>([]);
  const [playerRank, setPlayerRank] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const online = isOnline();

  useEffect(() => {
    if (!online) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    (async () => {
      const [top, ctx] = await Promise.all([
        fetchLeaderboardTop(trackId, 50),
        fetchLeaderboardContext(trackId, 5),
      ]);

      if (cancelled) return;

      if (top) {
        setTopEntries(top.entries);
      }
      if (ctx) {
        setContextEntries(ctx.entries);
        setPlayerRank(ctx.player_rank);
      }

      if (!top && !ctx) {
        setError(true);
      }
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [trackId, online]);

  const entries = tab === "top" ? topEntries : contextEntries;

  return (
    <div
      role="dialog"
      aria-label="Leaderboard"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#F4EAD5",
        fontFamily: '"Caveat", "Patrick Hand", "Comic Sans MS", cursive, system-ui, sans-serif',
        color: "#2B2118",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "2px solid #2B2118",
        }}
      >
        <button
          onClick={() => {
            getHaptics().uiTap();
            onClose();
          }}
          aria-label="Close leaderboard"
          style={{
            background: "none",
            border: "2px solid #2B2118",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 16,
            fontFamily: "inherit",
            cursor: "pointer",
            color: "#2B2118",
          }}
        >
          Back
        </button>
        <div style={{ fontSize: 22, fontWeight: "bold" }}>Leaderboard</div>
        <div style={{ width: 70 }} />
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        style={{
          display: "flex",
          borderBottom: "2px solid rgba(43,33,24,0.2)",
        }}
      >
        <button
          role="tab"
          aria-selected={tab === "top"}
          onClick={() => setTab("top")}
          style={{
            flex: 1,
            padding: "10px 0",
            fontSize: 16,
            fontFamily: "inherit",
            cursor: "pointer",
            border: "none",
            borderBottom: tab === "top" ? "3px solid #D94F3A" : "3px solid transparent",
            background: "none",
            color: tab === "top" ? "#2B2118" : "#6E5F48",
            fontWeight: tab === "top" ? "bold" : "normal",
          }}
        >
          Top Times
        </button>
        <button
          role="tab"
          aria-selected={tab === "around"}
          onClick={() => setTab("around")}
          style={{
            flex: 1,
            padding: "10px 0",
            fontSize: 16,
            fontFamily: "inherit",
            cursor: "pointer",
            border: "none",
            borderBottom: tab === "around" ? "3px solid #D94F3A" : "3px solid transparent",
            background: "none",
            color: tab === "around" ? "#2B2118" : "#6E5F48",
            fontWeight: tab === "around" ? "bold" : "normal",
          }}
        >
          Your Rank
        </button>
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px 16px",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {!online && (
          <div
            role="status"
            style={{
              textAlign: "center",
              padding: "40px 0",
              color: "#6E5F48",
              fontSize: 16,
            }}
          >
            Go online to see the leaderboard
          </div>
        )}

        {online && loading && (
          <div
            role="status"
            aria-live="polite"
            style={{
              textAlign: "center",
              padding: "40px 0",
              color: "#6E5F48",
              fontSize: 16,
            }}
          >
            Loading...
          </div>
        )}

        {online && !loading && error && (
          <div
            role="alert"
            style={{
              textAlign: "center",
              padding: "40px 0",
              color: "#D94F3A",
              fontSize: 16,
            }}
          >
            Could not load leaderboard
          </div>
        )}

        {online && !loading && !error && entries.length === 0 && (
          <div
            role="status"
            style={{
              textAlign: "center",
              padding: "40px 0",
              color: "#6E5F48",
              fontSize: 16,
            }}
          >
            {tab === "around"
              ? "Race online to see your rank"
              : "No times recorded yet"}
          </div>
        )}

        {online && !loading && !error && entries.length > 0 && (
          <ol
            role="list"
            aria-label={tab === "top" ? "Top times" : "Rankings near you"}
            style={{ listStyle: "none", padding: 0, margin: 0 }}
          >
            {entries.map((entry) => (
              <li
                key={entry.ghost_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 0",
                  borderBottom: "1px solid rgba(43,33,24,0.1)",
                  backgroundColor: entry.is_self ? "rgba(217,79,58,0.08)" : "transparent",
                  borderRadius: entry.is_self ? 6 : 0,
                  paddingLeft: entry.is_self ? 8 : 0,
                  paddingRight: entry.is_self ? 8 : 0,
                }}
              >
                <span
                  style={{
                    width: 36,
                    fontSize: 16,
                    fontWeight: "bold",
                    color: entry.rank <= 3 ? "#D94F3A" : "#6E5F48",
                    fontFamily: "monospace",
                  }}
                >
                  {entry.rank}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 16,
                    fontWeight: entry.is_self ? "bold" : "normal",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.name}
                  {entry.is_self ? " (you)" : ""}
                </span>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 14,
                    color: "#6E5F48",
                  }}
                >
                  {formatTime(entry.time_ms)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Player rank footer */}
      {online && !loading && playerRank !== null && tab === "around" && (
        <div
          role="status"
          style={{
            textAlign: "center",
            padding: "12px",
            borderTop: "2px solid rgba(43,33,24,0.2)",
            fontSize: 16,
            fontWeight: "bold",
          }}
        >
          Your rank: #{playerRank}
        </div>
      )}
    </div>
  );
}
