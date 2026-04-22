import { useState, useEffect, useCallback } from "react";
import { getHaptics } from "./Haptics.js";

interface SettingsScreenProps {
  onClose: () => void;
}

type DisplayState = "idle" | "clearing" | "cleared";

export function SettingsScreen({ onClose }: SettingsScreenProps) {
  const haptics = getHaptics();
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(haptics.isEnabled);
  const [reducedMotion, setReducedMotion] = useState(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [displayName, setDisplayName] = useState("");
  const [displayState, setDisplayState] = useState<DisplayState>("idle");

  useEffect(() => {
    const storedSound = localStorage.getItem("drawrace.sound");
    const storedName = localStorage.getItem("drawrace.displayName");
    if (storedSound) setSoundEnabled(storedSound === "true");
    if (storedName) setDisplayName(storedName);
  }, []);

  const handleSoundToggle = useCallback(() => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    localStorage.setItem("drawrace.sound", newValue.toString());
    haptics.uiTap();
  }, [soundEnabled, haptics]);

  const handleHapticsToggle = useCallback(() => {
    const newValue = !hapticsEnabled;
    setHapticsEnabled(newValue);
    haptics.saveSettings(newValue);
    if (newValue) haptics.uiTap();
  }, [hapticsEnabled, haptics]);

  const handleReducedMotionToggle = useCallback(() => {
    const newValue = !reducedMotion;
    setReducedMotion(newValue);
    localStorage.setItem("drawrace.reducedMotion", newValue.toString());
    haptics.uiTap();
  }, [reducedMotion, haptics]);

  const handleDisplayNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setDisplayName(e.target.value);
  }, []);

  const handleDisplayNameSave = useCallback(() => {
    localStorage.setItem("drawrace.displayName", displayName);
    haptics.uiTap();
  }, [displayName, haptics]);

  const handleClearData = useCallback(() => {
    setDisplayState("clearing");
    haptics.tap(20);
    setTimeout(() => {
      localStorage.clear();
      setDisplayState("cleared");
      haptics.tap(10);
      setTimeout(() => {
        setDisplayState("idle");
        setDisplayName("");
        setSoundEnabled(false);
        setHapticsEnabled(false);
      }, 1500);
    }, 500);
  }, [haptics]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(43, 33, 24, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: "#F4EAD5",
          borderRadius: 16,
          padding: 24,
          width: "100%",
          maxWidth: 400,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 id="settings-title" style={{ margin: 0, fontSize: 24, color: "#2B2118" }}>
            Settings
          </h2>
          <button
            onClick={onClose}
            aria-label="Close settings"
            style={{
              background: "none",
              border: "none",
              fontSize: 24,
              cursor: "pointer",
              color: "#2B2118",
              padding: 8,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SettingRow
            label="Sound Effects"
            description="Race sounds and notifications"
            enabled={soundEnabled}
            onToggle={handleSoundToggle}
          />
          <SettingRow
            label="Haptics"
            description="Vibration feedback"
            enabled={hapticsEnabled}
            onToggle={handleHapticsToggle}
          />
          <SettingRow
            label="Reduced Motion"
            description="Disable animations and particles"
            enabled={reducedMotion}
            onToggle={handleReducedMotionToggle}
          />

          <div style={{ paddingTop: 8, paddingBottom: 8 }}>
            <label
              htmlFor="displayName"
              style={{
                display: "block",
                fontSize: 16,
                fontWeight: 600,
                color: "#2B2118",
                marginBottom: 4,
              }}
            >
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={handleDisplayNameChange}
              onBlur={handleDisplayNameSave}
              placeholder="Enter your name"
              maxLength={20}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 16,
                border: "2px solid #2B2118",
                borderRadius: 8,
                backgroundColor: "#FBF4E3",
                color: "#2B2118",
                boxSizing: "border-box",
              }}
            />
            <p style={{ margin: "4px 0 0 0", fontSize: 12, opacity: 0.7 }}>
              Saved automatically when you leave the field
            </p>
          </div>

          <div style={{ paddingTop: 16, borderTop: "1px solid rgba(43,33,24,0.1)" }}>
            <button
              onClick={handleClearData}
              disabled={displayState === "clearing"}
              aria-label="Clear all saved data including display name and settings"
              style={{
                width: "100%",
                padding: "12px",
                fontSize: 16,
                fontWeight: 600,
                backgroundColor: displayState === "cleared" ? "#7CA05C" : "#A13A2E",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: displayState === "clearing" ? "not-allowed" : "pointer",
                opacity: displayState === "clearing" ? 0.7 : 1,
              }}
            >
              {displayState === "idle" && "Clear All Data"}
              {displayState === "clearing" && "Clearing..."}
              {displayState === "cleared" && "Data Cleared!"}
            </button>
            <p style={{ margin: "8px 0 0 0", fontSize: 12, opacity: 0.7 }}>
              This will clear your display name, settings, and all cached data
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SettingRowProps {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}

function SettingRow({ label, description, enabled, onToggle }: SettingRowProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "12px 0",
        borderBottom: "1px solid rgba(43,33,24,0.1)",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#2B2118" }}>{label}</div>
        <div style={{ fontSize: 13, opacity: 0.7 }}>{description}</div>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={enabled}
        aria-label={`${label}: ${enabled ? "enabled" : "disabled"}`}
        style={{
          position: "relative",
          width: 52,
          height: 28,
          backgroundColor: enabled ? "#D94F3A" : "#ccc",
          borderRadius: 14,
          border: "none",
          cursor: "pointer",
          transition: "background-color 0.2s",
          padding: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: enabled ? 26 : 2,
            width: 24,
            height: 24,
            backgroundColor: "white",
            borderRadius: 12,
            transition: "left 0.2s",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </button>
    </div>
  );
}
