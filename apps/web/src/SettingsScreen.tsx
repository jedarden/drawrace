import { useState, useEffect, useCallback } from "react";
import { getHaptics } from "./Haptics.js";
import { getSoundManager } from "./Sound.js";
import {
  getRecoveryPhrase,
  ensureRecoveryPhrase,
  formatRecoveryPhrase,
  isValidRecoveryPhrase,
} from "./recovery-phrase.js";
import { claimName, fetchPlayerName } from "./api.js";
import type { DrawConstraints } from "@drawrace/engine-core";

interface SettingsScreenProps {
  onClose: () => void;
  onShowLanding?: () => void;
  constraints?: DrawConstraints;
  onConstraintsChange?: (constraints: DrawConstraints) => void;
}

type DisplayState = "idle" | "clearing" | "cleared";
type RecoveryState = "hidden" | "showing" | "restoring";

const CONSTRAINTS_KEY = "drawrace.constraints";

/**
 * Compute SHA-256 hash of a recovery phrase.
 */
async function hashRecoveryPhrase(words: string[]): Promise<string> {
  const phrase = words.join(" ");
  const encoder = new TextEncoder();
  const data = encoder.encode(phrase);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function SettingsScreen({ onClose, onShowLanding, constraints, onConstraintsChange }: SettingsScreenProps) {
  const haptics = getHaptics();
  const sound = getSoundManager();
  const [soundEnabled, setSoundEnabled] = useState(sound.isEnabled);
  const [hapticsEnabled, setHapticsEnabled] = useState(haptics.isEnabled);
  const [reducedMotion, setReducedMotion] = useState(
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [displayName, setDisplayName] = useState("");
  const [displayState, setDisplayState] = useState<DisplayState>("idle");
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("hidden");
  const [recoveryPhrase, setRecoveryPhrase] = useState<string[] | null>(null);
  const [restoreInput, setRestoreInput] = useState("");
  const [localConstraints, setLocalConstraints] = useState<DrawConstraints>(constraints ?? {});

  useEffect(() => {
    const storedName = localStorage.getItem("drawrace.displayName");
    if (storedName) setDisplayName(storedName);

    // Load saved constraints
    const savedConstraints = localStorage.getItem(CONSTRAINTS_KEY);
    if (savedConstraints) {
      try {
        const parsed = JSON.parse(savedConstraints);
        setLocalConstraints(parsed);
        onConstraintsChange?.(parsed);
      } catch {
        // Ignore invalid stored constraints
      }
    }
  }, [onConstraintsChange]);

  const handleSoundToggle = useCallback(() => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    sound.saveSettings(newValue);
    haptics.uiTap();
  }, [soundEnabled, sound, haptics]);

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

  const handleShowRecoveryPhrase = useCallback(() => {
    const phrase = getRecoveryPhrase() ?? ensureRecoveryPhrase();
    setRecoveryPhrase(phrase);
    setRecoveryState("showing");
    haptics.uiTap();
  }, [haptics]);

  const handleRestoreIdentity = useCallback(() => {
    setRecoveryState("restoring");
    setRestoreInput("");
    haptics.uiTap();
  }, [haptics]);

  const handleRestoreSubmit = useCallback(async () => {
    const words = restoreInput.trim().split(/\s+/);
    if (!isValidRecoveryPhrase(words)) {
      alert("Invalid recovery phrase. Please check and try again.");
      haptics.uiTap();
      return;
    }

    try {
      const response = await fetch("/v1/identity/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recovery_phrase: words }),
      });

      if (!response.ok) {
        const error = await response.json();
        alert(`Failed to restore: ${error.message}`);
        haptics.uiTap();
        return;
      }

      const data = await response.json();
      const restoredUuid = data.player_uuid;

      // Save the restored UUID and fetch the associated name
      localStorage.setItem("drawrace-player-uuid", restoredUuid);

      // Fetch the player's name
      const nameResponse = await fetch(`/v1/names?uuid=${restoredUuid}`);
      if (nameResponse.ok) {
        const nameData = await nameResponse.json();
        if (nameData.name) {
          localStorage.setItem("drawrace.displayName", nameData.name);
          setDisplayName(nameData.name);
        }
      }

      alert("Identity restored successfully! Your name has been loaded.");
      setRecoveryState("hidden");
      sound.playUiTap();
    } catch (e) {
      alert(`Network error: ${e}`);
    }
    haptics.uiTap();
  }, [restoreInput, haptics, sound]);

  const handleConstraintToggle = useCallback((key: keyof DrawConstraints) => {
    return () => {
      const newValue = !localConstraints[key];
      const newConstraints = { ...localConstraints, [key]: newValue };
      setLocalConstraints(newConstraints);
      localStorage.setItem(CONSTRAINTS_KEY, JSON.stringify(newConstraints));
      onConstraintsChange?.(newConstraints);
      haptics.uiTap();
    };
  }, [localConstraints, onConstraintsChange, haptics]);

  const handleConstraintValueChange = useCallback((key: keyof DrawConstraints, value: number | undefined) => {
    const newConstraints = { ...localConstraints, [key]: value };
    setLocalConstraints(newConstraints);
    localStorage.setItem(CONSTRAINTS_KEY, JSON.stringify(newConstraints));
    onConstraintsChange?.(newConstraints);
    haptics.uiTap();
  }, [localConstraints, onConstraintsChange, haptics]);

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

          {/* Wheel Constraint Modes - Post-v1 Progression Hooks */}
          <div style={{ paddingTop: 8, paddingBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#6E5F48", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Challenge Modes
            </div>
            <SettingRow
              label="Single-Stroke Mode"
              description="Draw your wheel in one continuous stroke"
              enabled={localConstraints.singleStroke ?? false}
              onToggle={handleConstraintToggle("singleStroke")}
            />
            <SettingRow
              label="Convex-Only Mode"
              description="Only convex (round) shapes allowed"
              enabled={localConstraints.convexOnly ?? false}
              onToggle={handleConstraintToggle("convexOnly")}
            />
            <SettingRow
              label="Single-Wheel Mode"
              description="No mid-race redraws allowed"
              enabled={localConstraints.singleWheel ?? false}
              onToggle={handleConstraintToggle("singleWheel")}
            />
          </div>

          {/* Numeric Constraint Modes */}
          <div style={{ paddingTop: 8, paddingBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#6E5F48", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Constraint Limits
            </div>
            <NumericConstraintRow
              label="Max Vertices"
              description="Limit wheel polygon vertex count"
              value={localConstraints.vertexCapped}
              min={8}
              max={32}
              placeholder="Off"
              onChange={(value) => handleConstraintValueChange("vertexCapped", value)}
            />
            <NumericConstraintRow
              label="Max Diameter"
              description="Limit wheel size in pixels"
              value={localConstraints.diameterCapped}
              min={50}
              max={300}
              step={10}
              placeholder="Off"
              onChange={(value) => handleConstraintValueChange("diameterCapped", value)}
            />
            <NumericConstraintRow
              label="Max Swaps"
              description="Limit wheel redraws per race"
              value={localConstraints.swapCapped}
              min={1}
              max={20}
              placeholder="Off"
              onChange={(value) => handleConstraintValueChange("swapCapped", value)}
            />
          </div>

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
            <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#6E5F48" }}>
              Saved automatically when you leave the field
            </p>
          </div>

          {/* Recovery phrase section */}
          <div style={{ paddingTop: 8, paddingBottom: 8 }}>
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
                <div style={{ fontSize: 16, fontWeight: 600, color: "#2B2118" }}>
                  Recovery Phrase
                </div>
                <div style={{ fontSize: 13, color: "#6E5F48" }}>
                  Save 4 words to restore your name on a new device
                </div>
              </div>
              <button
                onClick={handleShowRecoveryPhrase}
                aria-label="Show recovery phrase"
                style={{
                  padding: "8px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "inherit",
                  backgroundColor: "#3D6B4A",
                  color: "#F4EAD5",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Show
              </button>
            </div>
            <button
              onClick={handleRestoreIdentity}
              aria-label="Restore identity from recovery phrase"
              style={{
                marginTop: 8,
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "inherit",
                backgroundColor: "transparent",
                color: "#3D6B4A",
                border: "1px solid #3D6B4A",
                borderRadius: 8,
                cursor: "pointer",
                width: "100%",
              }}
            >
              Restore from Recovery Phrase
            </button>
          </div>

          {onShowLanding && (
            <div style={{ paddingTop: 16, borderTop: "1px solid rgba(43,33,24,0.1)" }}>
              <button
                onClick={() => {
                  haptics.uiTap();
                  onShowLanding();
                }}
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: 16,
                  fontWeight: 600,
                  backgroundColor: "#3D6B4A",
                  color: "#F4EAD5",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                Show Install Instructions
              </button>
              <p style={{ margin: "8px 0 0 0", fontSize: 12, color: "#6E5F48" }}>
                Learn how to install DrawRace as an app on your device
              </p>
            </div>
          )}

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
                color: "#2B2118",
                border: "2px solid #2B2118",
                borderRadius: 8,
                cursor: displayState === "clearing" ? "not-allowed" : "pointer",
                opacity: displayState === "clearing" ? 0.7 : 1,
              }}
            >
              {displayState === "idle" && "Clear All Data"}
              {displayState === "clearing" && "Clearing..."}
              {displayState === "cleared" && "Data Cleared!"}
            </button>
            <p style={{ margin: "8px 0 0 0", fontSize: 12, color: "#6E5F48" }}>
              This will clear your display name, settings, and all cached data
            </p>
          </div>
        </div>

        {/* Show recovery phrase modal */}
        {recoveryState === "showing" && recoveryPhrase && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-title"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(43, 33, 24, 0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              padding: 16,
              zIndex: 1,
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
                Save these 4 words to restore your name on a new device. Store them safely!
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
                    sound.playUiTap();
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
                    sound.playUiTap();
                    setRecoveryState("hidden");
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
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Restore recovery phrase modal */}
        {recoveryState === "restoring" && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-title"
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(43, 33, 24, 0.8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              padding: 16,
              zIndex: 1,
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
              <h3 id="restore-title" style={{ margin: "0 0 16px 0", fontSize: 20, color: "#2B2118" }}>
                Restore Your Identity
              </h3>
              <p style={{ margin: "0 0 16px 0", fontSize: 14, color: "#6E5F48", lineHeight: 1.5 }}>
                Enter your 4-word recovery phrase to restore your name on this device.
              </p>
              <input
                type="text"
                value={restoreInput}
                onChange={(e) => setRestoreInput(e.target.value)}
                placeholder="word1 word2 word3 word4"
                autoFocus
                style={{
                  width: "100%",
                  padding: "12px",
                  fontSize: 16,
                  border: "2px solid #2B2118",
                  borderRadius: 8,
                  backgroundColor: "#FBF4E3",
                  color: "#2B2118",
                  boxSizing: "border-box",
                  marginBottom: 16,
                  fontFamily: "monospace",
                }}
              />
              <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
                <button
                  onClick={handleRestoreSubmit}
                  aria-label="Restore identity"
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
                  Restore
                </button>
                <button
                  onClick={() => {
                    sound.playUiTap();
                    setRecoveryState("hidden");
                  }}
                  aria-label="Cancel restore"
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
                  Cancel
                </button>
              </div>
              <p style={{ margin: "12px 0 0 0", fontSize: 11, color: "#6E5F48" }}>
                Enter your recovery phrase exactly as shown when you claimed your name.
              </p>
            </div>
          </div>
        )}
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
        <div style={{ fontSize: 13, color: "#6E5F48" }}>{description}</div>
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

interface NumericConstraintRowProps {
  label: string;
  description: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  placeholder: string;
  onChange: (value: number | undefined) => void;
}

function NumericConstraintRow({
  label,
  description,
  value,
  min,
  max,
  step = 1,
  placeholder,
  onChange,
}: NumericConstraintRowProps) {
  const [inputValue, setInputValue] = useState(value?.toString() ?? "");

  useEffect(() => {
    setInputValue(value?.toString() ?? "");
  }, [value]);

  const handleBlur = useCallback(() => {
    if (inputValue.trim() === "") {
      onChange(undefined);
      setInputValue("");
    } else {
      const num = parseInt(inputValue, 10);
      if (!isNaN(num) && num >= min && num <= max) {
        onChange(num);
      } else {
        // Reset to current valid value or clear
        setInputValue(value?.toString() ?? "");
      }
    }
  }, [inputValue, min, max, value, onChange]);

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select();
  }, []);

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
      <div style={{ flex: 1, paddingRight: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#2B2118" }}>{label}</div>
        <div style={{ fontSize: 13, color: "#6E5F48" }}>{description}</div>
      </div>
      <input
        type="number"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        aria-label={`${label} limit`}
        style={{
          width: 70,
          padding: "6px 10px",
          fontSize: 14,
          border: "2px solid #2B2118",
          borderRadius: 8,
          backgroundColor: "#FBF4E3",
          color: "#2B2118",
          boxSizing: "border-box",
          textAlign: "center",
        }}
      />
    </div>
  );
}
