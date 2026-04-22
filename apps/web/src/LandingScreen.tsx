import { useState } from "react";
import { submitFeedback } from "./api.js";

interface LandingScreenProps {
  onStart: () => void;
  dismissed: boolean;
}

type FeedbackState = "idle" | "submitting" | "sent" | "error";

export function LandingScreen({ onStart, dismissed }: LandingScreenProps) {
  const [feedbackCategory, setFeedbackCategory] = useState<"bug" | "feature" | "other">("bug");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackState, setFeedbackState] = useState<FeedbackState>("idle");

  if (dismissed) {
    return null;
  }

  const isIOS = /iP(hone|od|ad)/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  const handleSubmitFeedback = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackState("submitting");
    const ok = await submitFeedback(feedbackCategory, feedbackText, {
      source: "beta-landing",
      timestamp: new Date().toISOString(),
    });
    setFeedbackState(ok ? "sent" : "error");
    if (ok) {
      setTimeout(() => {
        setFeedbackText("");
        setFeedbackState("idle");
      }, 2000);
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby="landing-title"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "#F4EAD5",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: '"Caveat", "Patrick Hand", "Comic Sans MS", cursive, system-ui, sans-serif',
        color: "#2B2118",
        zIndex: 1000,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          maxWidth: 500,
          width: "100%",
          backgroundColor: "#FFF8E7",
          borderRadius: 16,
          padding: 32,
          boxShadow: "0 8px 32px rgba(43, 33, 24, 0.2)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <h1
            id="landing-title"
            style={{
              fontSize: 48,
              margin: "0 0 8px 0",
              fontWeight: "normal",
            }}
          >
            DrawRace
          </h1>
          <span
            style={{
              display: "inline-block",
              padding: "4px 12px",
              backgroundColor: "#D94F3A",
              color: "white",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            BETA
          </span>
        </div>

        <p style={{ fontSize: 20, margin: "0 0 24px 0", textAlign: "center", lineHeight: 1.4 }}>
          Draw your wheel, race against ghosts!
        </p>

        <div style={{ marginBottom: 24, fontSize: 18, lineHeight: 1.5 }}>
          <strong>How to play:</strong>
          <ol style={{ margin: "12px 0", paddingLeft: 20 }}>
            <li>Draw a wheel shape on the canvas</li>
            <li>Tap <strong>Race!</strong> to start</li>
            <li>Watch your wheel roll against 3 ghosts</li>
            <li>Try different shapes to find the fastest wheel</li>
          </ol>
        </div>

        <div style={{ marginBottom: 24, fontSize: 18, lineHeight: 1.5 }}>
          <strong>Install for the best experience:</strong>
          <ul style={{ margin: "12px 0", paddingLeft: 20 }}>
            <li>Faster loading</li>
            <li>Works offline</li>
            <li>Full-screen racing</li>
          </ul>
        </div>

        {isIOS && (
          <div style={{
            backgroundColor: "#E8DED0",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            fontSize: 16
          }}>
            <strong>iPhone/iPad:</strong>
            <ol style={{ margin: "8px 0", paddingLeft: 20, lineHeight: 1.6 }}>
              <li>Tap the <strong>Share</strong> button <span aria-label="share icon">&#x232B;</span></li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
              <li>Tap <strong>Add</strong> to install</li>
            </ol>
          </div>
        )}

        {isAndroid && (
          <div style={{
            backgroundColor: "#E8DED0",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            fontSize: 16
          }}>
            <strong>Android (Chrome):</strong>
            <ol style={{ margin: "8px 0", paddingLeft: 20, lineHeight: 1.6 }}>
              <li>Tap the <strong>&#x22EE;</strong> menu (top right)</li>
              <li>Tap <strong>Add to Home Screen</strong> or <strong>Install App</strong></li>
              <li>Tap <strong>Install</strong> to confirm</li>
            </ol>
          </div>
        )}

        {!isIOS && !isAndroid && (
          <div style={{
            backgroundColor: "#E8DED0",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            fontSize: 16
          }}>
            <strong>Desktop:</strong>
            <p style={{ margin: "8px 0", lineHeight: 1.6 }}>
              Look for the install icon in your browser&apos;s address bar.
            </p>
          </div>
        )}

        <button
          onClick={onStart}
          style={{
            width: "100%",
            padding: "16px 32px",
            fontSize: 24,
            fontFamily: "inherit",
            backgroundColor: "#4A7C59",
            color: "#F4EAD5",
            border: "none",
            borderRadius: 12,
            cursor: "pointer",
            transition: "transform 0.1s, backgroundColor 0.1s",
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = "scale(0.97)";
            e.currentTarget.style.backgroundColor = "#3D6B4A";
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.backgroundColor = "#4A7C59";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            e.currentTarget.style.backgroundColor = "#4A7C59";
          }}
        >
          Start Racing
        </button>

        <div style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid rgba(43,33,24,0.15)" }}>
          <h2 style={{ fontSize: 20, margin: "0 0 12px 0" }}>Send Feedback</h2>
          <p style={{ fontSize: 14, margin: "0 0 12px 0", color: "#6E5F48" }}>
            Found a bug? Have an idea? Let us know.
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {(["bug", "feature", "other"] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setFeedbackCategory(cat)}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  fontSize: 14,
                  fontWeight: 600,
                  border: `2px solid ${feedbackCategory === cat ? "#D94F3A" : "#2B2118"}`,
                  borderRadius: 8,
                  backgroundColor: feedbackCategory === cat ? "#D94F3A" : "transparent",
                  color: feedbackCategory === cat ? "white" : "#2B2118",
                  cursor: "pointer",
                }}
              >
                {cat === "bug" ? "Bug" : cat === "feature" ? "Feature" : "Other"}
              </button>
            ))}
          </div>

          <textarea
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={
              feedbackCategory === "bug"
                ? "What went wrong? What device/browser?"
                : feedbackCategory === "feature"
                ? "What would you like to see?"
                : "Share your thoughts..."
            }
            rows={3}
            maxLength={5000}
            style={{
              width: "100%",
              padding: 12,
              fontSize: 16,
              border: "2px solid #2B2118",
              borderRadius: 8,
              backgroundColor: "#FBF4E3",
              color: "#2B2118",
              resize: "vertical",
              boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />

          <button
            onClick={handleSubmitFeedback}
            disabled={feedbackState === "submitting" || !feedbackText.trim()}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "10px",
              fontSize: 16,
              fontWeight: 600,
              backgroundColor:
                feedbackState === "sent"
                  ? "#7CA05C"
                  : feedbackState === "error"
                  ? "#A13A2E"
                  : "#D94F3A",
              color: "white",
              border: "none",
              borderRadius: 8,
              cursor:
                feedbackState === "submitting" || !feedbackText.trim()
                  ? "not-allowed"
                  : "pointer",
              opacity: feedbackState === "submitting" || !feedbackText.trim() ? 0.7 : 1,
            }}
          >
            {feedbackState === "idle" && "Send Feedback"}
            {feedbackState === "submitting" && "Sending..."}
            {feedbackState === "sent" && "Thanks! Feedback sent."}
            {feedbackState === "error" && "Failed to send — try again"}
          </button>
        </div>

        <p style={{
          fontSize: 14,
          marginTop: 16,
          textAlign: "center",
          opacity: 0.7,
          margin: "16px 0 0 0"
        }}>
          You can always access this screen from Settings
        </p>
      </div>
    </div>
  );
}
