import { useCallback } from "react";

interface PauseMenuProps {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
}

const FONT = '"Caveat", "Patrick Hand", cursive, system-ui';

export function PauseMenu({ onResume, onRestart, onQuit }: PauseMenuProps) {
  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onResume();
    },
    [onResume],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Game paused"
      onClick={handleBackdrop}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(244,234,213,0.92)",
        zIndex: 20,
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          minWidth: 220,
          padding: "32px 40px",
        }}
      >
        <span
          style={{
            fontSize: 28,
            color: "#2B2118",
            fontWeight: 600,
            letterSpacing: 4,
          }}
        >
          PAUSED
        </span>

        {/* Resume — primary CTA */}
        <button
          onClick={onResume}
          autoFocus
          aria-label="Resume race"
          style={{
            width: "100%",
            height: 56,
            fontSize: 20,
            fontWeight: 600,
            fontFamily: FONT,
            backgroundColor: "#D94F3A",
            color: "#2B2118",
            border: "2px solid #2B2118",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Resume
        </button>

        {/* Restart — secondary */}
        <button
          onClick={onRestart}
          aria-label="Restart race"
          style={{
            width: "100%",
            height: 48,
            fontSize: 18,
            fontWeight: 600,
            fontFamily: FONT,
            backgroundColor: "#FBF4E3",
            color: "#2B2118",
            border: "2px solid #2B2118",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          Restart
        </button>

        {/* Quit — tertiary text link */}
        <button
          onClick={onQuit}
          aria-label="Quit race"
          style={{
            background: "none",
            border: "none",
            fontFamily: FONT,
            fontSize: 16,
            color: "#6E5F48",
            cursor: "pointer",
            padding: "4px 8px",
            textDecoration: "underline",
          }}
        >
          Quit
        </button>
      </div>
    </div>
  );
}
