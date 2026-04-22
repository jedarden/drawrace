import { useState } from "react";
import { DrawScreen } from "./DrawScreen.js";
import type { DrawResult } from "@drawrace/engine-core";

type Screen = "draw" | "ready";

export function App() {
  const [screen, setScreen] = useState<Screen>("draw");
  const [drawResult, setDrawResult] = useState<DrawResult | null>(null);

  const handleDrawComplete = (result: DrawResult) => {
    setDrawResult(result);
    setScreen("ready");
  };

  const handleReset = () => {
    setDrawResult(null);
    setScreen("draw");
  };

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      {screen === "draw" && (
        <DrawScreen onComplete={handleDrawComplete} />
      )}
      {screen === "ready" && drawResult && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            backgroundColor: "#F4EAD5",
            color: "#2B2118",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2>Wheel ready!</h2>
          <p>
            {drawResult.vertices.length} vertices, {drawResult.convexPieces.length} convex pieces
          </p>
          <p>Area: {drawResult.area.toFixed(0)} px²</p>
          <button
            onClick={handleReset}
            style={{
              marginTop: 20,
              padding: "12px 32px",
              fontSize: 18,
              backgroundColor: "#D94F3A",
              color: "white",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Draw Again
          </button>
        </div>
      )}
    </div>
  );
}
