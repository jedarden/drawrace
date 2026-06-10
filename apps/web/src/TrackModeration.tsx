import { useState, useEffect, useCallback } from "react";
import { TrackEditor } from "./TrackEditor.js";
import { createHeadlessRace, type TrackDef, type WheelDef, hashSeed } from "@drawrace/engine-core";
import { getApiUrl } from "./api-config.js";

interface PendingTrack {
  track_id: string;
  status: string;
  message: string;
}

interface TrackModerationProps {
  onClose: () => void;
}

export function TrackModeration({ onClose }: TrackModerationProps) {
  const [pendingTracks, setPendingTracks] = useState<PendingTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  const [viewingTrack, setViewingTrack] = useState<any | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ finishTime: number; stuck: boolean; finished: boolean } | null>(null);

  const fetchPendingTracks = useCallback(async () => {
    const apiUrl = getApiUrl();
    if (!apiUrl) {
      setLoading(false);
      return;
    }

    try {
      const resp = await fetch(`${apiUrl}/v1/tracks/pending`, {
        headers: {
          "X-DrawRace-Player": localStorage.getItem('drawrace.player_uuid') || 'admin',
        },
      });
      if (resp.ok) {
        const tracks = await resp.json();
        setPendingTracks(tracks);
      }
    } catch (e) {
      console.error("Failed to fetch pending tracks:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPendingTracks();
  }, [fetchPendingTracks]);

  const handleViewTrack = useCallback(async (trackId: string) => {
    const apiUrl = getApiUrl();
    if (!apiUrl) return;

    try {
      const resp = await fetch(`${apiUrl}/v1/tracks/${trackId}`);
      if (resp.ok) {
        const data = await resp.json();
        setViewingTrack(data.track_data);
        setSelectedTrack(trackId);
      }
    } catch (e) {
      console.error("Failed to fetch track:", e);
    }
  }, []);

  const handleTestTrack = useCallback(async () => {
    if (!viewingTrack) return;

    setTesting(true);
    setTestResult(null);

    setTimeout(() => {
      try {
        const playerId = 'admin-validator';
        const seed = hashSeed(viewingTrack.id, playerId, 0);

        const trackDef: TrackDef = {
          id: viewingTrack.id,
          world: viewingTrack.world,
          terrain: viewingTrack.terrain,
          obstacles: viewingTrack.obstacles,
          zones: viewingTrack.zones,
          ramps: viewingTrack.ramps,
          hazards: viewingTrack.hazards,
          surfaces: viewingTrack.surfaces,
          start: viewingTrack.start,
          finish: viewingTrack.finish,
        };

        // Create test wheel (circle)
        const vertices: [number, number][] = [];
        const radius = 0.4;
        const segments = 32;
        for (let i = 0; i < segments; i++) {
          const angle = (2 * Math.PI * i) / segments;
          vertices.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
        }
        const wheelDef: WheelDef = { vertices };

        const result = createHeadlessRace({
          seed,
          track: trackDef,
          wheel: wheelDef,
          playerId,
          runIndex: 0,
        });

        const finishTime = result.finishTicks / 60;
        setTestResult({
          finishTime,
          stuck: result.stuck,
          finished: result.finalX >= viewingTrack.finish.pos[0],
        });
      } catch (e) {
        console.error("Test simulation failed:", e);
      } finally {
        setTesting(false);
      }
    }, 10);
  }, [viewingTrack]);

  const handlePublish = useCallback(async (trackId: string) => {
    const apiUrl = getApiUrl();
    if (!apiUrl) return;

    try {
      const resp = await fetch(`${apiUrl}/v1/tracks/${trackId}/publish`, {
        method: "POST",
      });
      if (resp.ok) {
        // Refresh the list
        fetchPendingTracks();
        // Clear selection
        setSelectedTrack(null);
        setViewingTrack(null);
        setTestResult(null);
      }
    } catch (e) {
      console.error("Failed to publish track:", e);
      alert("Failed to publish track");
    }
  }, [fetchPendingTracks]);

  const handleReject = useCallback(async (trackId: string) => {
    const apiUrl = getApiUrl();
    if (!apiUrl) return;

    const reason = prompt("Reason for rejection (optional):");
    if (reason === null) return; // Cancelled

    try {
      const resp = await fetch(`${apiUrl}/v1/tracks/${trackId}/reject`, {
        method: "POST",
      });
      if (resp.ok) {
        // Refresh the list
        fetchPendingTracks();
        // Clear selection
        setSelectedTrack(null);
        setViewingTrack(null);
        setTestResult(null);
      }
    } catch (e) {
      console.error("Failed to reject track:", e);
      alert("Failed to reject track");
    }
  }, [fetchPendingTracks]);

  if (viewingTrack) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#F4EAD5" }}>
        <div style={{ display: "flex", padding: "10px", gap: "10px", alignItems: "center", borderBottom: "1px solid #2B2118" }}>
          <h2 style={{ margin: 0, fontSize: "20px" }}>Review Track: {viewingTrack.name}</h2>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleTestTrack}
            disabled={testing}
            style={{
              padding: "8px 16px",
              backgroundColor: "#7CA05C",
              color: "white",
              border: "none",
              opacity: testing ? 0.6 : 1,
            }}
          >
            {testing ? "Testing..." : "Test Drive"}
          </button>
          <button
            onClick={() => setViewingTrack(null)}
            style={{ padding: "8px 16px" }}
          >
            Back
          </button>
        </div>

        {testResult && (
          <div style={{ padding: "10px", backgroundColor: testResult.finished ? "#EFE" : "#FEE", margin: "10px", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 5px 0", fontSize: "14px" }}>Test Results</h4>
            {testResult.finished ? (
              <div style={{ fontSize: "12px" }}>
                <p style={{ margin: "2px 0" }}>✓ Finished in {testResult.finishTime.toFixed(2)}s</p>
                <p style={{ margin: "2px 0", color: "#6E5F48" }}>
                  Target: {viewingTrack.metadata.targetTimeSeconds}s
                </p>
              </div>
            ) : (
              <div style={{ fontSize: "12px" }}>
                <p style={{ margin: "2px 0" }}>✗ Did not finish</p>
                {testResult.stuck && <p style={{ margin: "2px 0", color: "#D94F3A" }}>Wheel got stuck</p>}
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1, overflow: "auto", padding: "20px" }}>
          <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "white", borderRadius: "4px", border: "1px solid #2B2118" }}>
            <h3 style={{ margin: "0 0 10px 0" }}>Track Details</h3>
            <div style={{ fontSize: "14px" }}>
              <p><strong>Name:</strong> {viewingTrack.name}</p>
              <p><strong>ID:</strong> {selectedTrack}</p>
              <p><strong>Target Time:</strong> {viewingTrack.metadata.targetTimeSeconds}s</p>
              <p><strong>Length:</strong> {viewingTrack.terrain[0]?.x.toFixed(1)}m - {viewingTrack.terrain[viewingTrack.terrain.length - 1]?.x.toFixed(1)}m</p>
              <p><strong>Zones:</strong> {viewingTrack.zones?.length || 0}</p>
              <p><strong>Surfaces:</strong> {viewingTrack.surfaces?.length || 0}</p>
              <p><strong>Obstacles:</strong> {viewingTrack.obstacles?.length || 0}</p>
              <p><strong>Hazards:</strong> {viewingTrack.hazards?.length || 0}</p>
            </div>
          </div>

          <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "white", borderRadius: "4px", border: "1px solid #2B2118" }}>
            <h3 style={{ margin: "0 0 10px 0" }}>Terrain Preview</h3>
            <canvas
              width={800}
              height={400}
              style={{
                border: "1px solid #2B2118",
                backgroundColor: "#F4EAD5",
              }}
              ref={(canvas) => {
                if (!canvas) return;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;

                // Clear
                ctx.fillStyle = "#F4EAD5";
                ctx.fillRect(0, 0, 800, 400);

                // Draw terrain
                if (viewingTrack.terrain.length >= 2) {
                  const scale = 20;
                  ctx.beginPath();
                  ctx.strokeStyle = "#2B2118";
                  ctx.lineWidth = 2;
                  viewingTrack.terrain.forEach((pt: { x: number; y: number }, i: number) => {
                    const sx = pt.x * scale;
                    const sy = 350 - (pt.y * scale);
                    if (i === 0) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                  });
                  ctx.stroke();
                }
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "10px", justifyContent: "center", padding: "20px" }}>
            <button
              onClick={() => selectedTrack && handlePublish(selectedTrack)}
              style={{
                padding: "12px 24px",
                backgroundColor: "#7CA05C",
                color: "white",
                border: "none",
                fontSize: "16px",
              }}
            >
              ✓ Publish Track
            </button>
            <button
              onClick={() => selectedTrack && handleReject(selectedTrack)}
              style={{
                padding: "12px 24px",
                backgroundColor: "#D94F3A",
                color: "white",
                border: "none",
                fontSize: "16px",
              }}
            >
              ✗ Reject Track
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#F4EAD5" }}>
      <div style={{ display: "flex", padding: "10px", gap: "10px", alignItems: "center", borderBottom: "1px solid #2B2118" }}>
        <h2 style={{ margin: 0, fontSize: "20px" }}>Track Moderation</h2>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ padding: "8px 16px" }}>
          Close
        </button>
      </div>

      <div style={{ flex: 1, padding: "20px", overflowY: "auto" }}>
        {loading ? (
          <p>Loading...</p>
        ) : pendingTracks.length === 0 ? (
          <p style={{ color: "#6E5F48" }}>No pending tracks to review</p>
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {pendingTracks.map((track) => (
              <div
                key={track.track_id}
                style={{
                  padding: "15px",
                  backgroundColor: "white",
                  borderRadius: "4px",
                  border: "1px solid #2B2118",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <p style={{ margin: "0 0 5px 0", fontWeight: "bold" }}>Track ID: {track.track_id.slice(0, 8)}...</p>
                  <p style={{ margin: 0, fontSize: "12px", color: "#6E5F48" }}>{track.message}</p>
                </div>
                <button
                  onClick={() => handleViewTrack(track.track_id)}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#2B2118",
                    color: "white",
                    border: "none",
                  }}
                >
                  Review
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
