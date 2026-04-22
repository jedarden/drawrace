import type { RaceSnapshot, TrackDef, SimBody } from "@drawrace/engine-core";
import type { DrawResult } from "@drawrace/engine-core";

const PPM = 30; // pixelsPerMeter

interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  track: TrackDef,
  wheelDraw: DrawResult
) {
  const ctx = canvas.getContext("2d")!;
  const width = canvas.width;
  const height = canvas.height;
  ctx.imageSmoothingEnabled = true;

  const camera: Camera = { x: 0, y: 0, width, height };

  // Pre-compute terrain screen points (Y-flip: negate for screen)
  const terrainScreenPts = track.terrain.map(([x, y]) => ({
    wx: x,
    wy: y,
  }));

  // Pre-build wheel Path2D (local coordinates, in pixels, Y-flipped)
  const wheelPath = new Path2D();
  const verts = wheelDraw.vertices;
  if (verts.length > 0) {
    wheelPath.moveTo(verts[0].x * PPM, -verts[0].y * PPM);
    for (let i = 1; i < verts.length; i++) {
      wheelPath.lineTo(verts[i].x * PPM, -verts[i].y * PPM);
    }
    wheelPath.closePath();
  }

  function worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    return {
      sx: wx * PPM - camera.x,
      sy: -wy * PPM - camera.y, // Y-flip for screen coordinates
    };
  }

  function updateCamera(playerX: number, playerY: number) {
    const targetSX = playerX * PPM - width * 0.35;
    const targetSY = -playerY * PPM - height * 0.6;
    camera.x += (targetSX - camera.x) * 0.08;
    camera.y += (targetSY - camera.y) * 0.05;
  }

  function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "#C9DDE8");
    grad.addColorStop(1, "#F4EAD5");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  function drawFarHills() {
    ctx.fillStyle = "#8BA9BA";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.35);
    const offset = -(camera.x * 0.1) % width;
    for (let i = -1; i <= 2; i++) {
      const baseX = offset + i * (width / 2);
      ctx.lineTo(baseX + width * 0.1, height * 0.28);
      ctx.lineTo(baseX + width * 0.25, height * 0.22);
      ctx.lineTo(baseX + width * 0.4, height * 0.3);
      ctx.lineTo(baseX + width * 0.5, height * 0.25);
      ctx.lineTo(baseX + width * 0.5, height * 0.35);
    }
    ctx.lineTo(width, height * 0.35);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
  }

  function drawNearHills() {
    ctx.fillStyle = "#A9BFAB";
    ctx.beginPath();
    ctx.moveTo(0, height * 0.45);
    const offset = -(camera.x * 0.3) % width;
    for (let i = -1; i <= 2; i++) {
      const baseX = offset + i * (width / 2);
      ctx.lineTo(baseX + width * 0.05, height * 0.4);
      ctx.lineTo(baseX + width * 0.15, height * 0.35);
      ctx.lineTo(baseX + width * 0.3, height * 0.42);
      ctx.lineTo(baseX + width * 0.4, height * 0.38);
      ctx.lineTo(baseX + width * 0.5, height * 0.45);
    }
    ctx.lineTo(width, height * 0.45);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
  }

  function drawTerrain() {
    const pts = terrainScreenPts.map((p) => worldToScreen(p.wx, p.wy));

    // Fill band: close to screen bottom
    ctx.fillStyle = "#E5D3B0";
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].sx, pts[i].sy);
    }
    ctx.lineTo(pts[pts.length - 1].sx, height + 10);
    ctx.lineTo(pts[0].sx, height + 10);
    ctx.closePath();
    ctx.fill();

    // Ink top edge
    ctx.strokeStyle = "#2B2118";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].sx, pts[i].sy);
    }
    ctx.stroke();

    // Grass strip (just above terrain line)
    ctx.strokeStyle = "#7CA05C";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy - 2);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].sx, pts[i].sy - 2);
    }
    ctx.stroke();
  }

  function drawFinishLine() {
    let finishTerrainY = track.terrain[0][1];
    for (let i = 0; i < track.terrain.length - 1; i++) {
      const ax = track.terrain[i][0];
      const bx = track.terrain[i + 1][0];
      if (ax <= track.finish.pos[0] && track.finish.pos[0] <= bx) {
        const t = (track.finish.pos[0] - ax) / (bx - ax);
        finishTerrainY = track.terrain[i][1] + t * (track.terrain[i + 1][1] - track.terrain[i][1]);
        break;
      }
    }
    const topSy = worldToScreen(track.finish.pos[0], finishTerrainY + 4).sy;
    const botSy = worldToScreen(track.finish.pos[0], finishTerrainY).sy;
    const { sx } = worldToScreen(track.finish.pos[0], finishTerrainY);

    ctx.strokeStyle = "#D94F3A";
    ctx.lineWidth = 4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, topSy);
    ctx.lineTo(sx, botSy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawWheel(body: SimBody, path: Path2D, fillStyle: string, alpha: number) {
    const { sx, sy } = worldToScreen(body.x, body.y);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.rotate(-body.angle); // negate angle for screen Y-flip

    ctx.fillStyle = fillStyle;
    ctx.fill(path);
    ctx.strokeStyle = "#2B2118";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.stroke(path);

    ctx.restore();
  }

  function drawRearWheel(body: SimBody, alpha: number) {
    const { sx, sy } = worldToScreen(body.x, body.y);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.rotate(-body.angle);

    ctx.fillStyle = alpha < 1 ? "#8896A3" : "#2B2118";
    ctx.beginPath();
    ctx.arc(0, 0, REAR_WHEEL_RADIUS * PPM, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawChassis(body: SimBody, alpha: number) {
    const { sx, sy } = worldToScreen(body.x, body.y);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.rotate(-body.angle); // Y-flip

    const bw = 1.2 * PPM;
    const bh = 0.4 * PPM;

    // Body
    ctx.fillStyle = alpha < 1 ? "#8896A3" : "#FBF4E3";
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    // Ink outline
    ctx.strokeStyle = "#2B2118";
    ctx.lineWidth = 2;
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);

    // Window + driver (player car only)
    if (alpha >= 1) {
      ctx.fillStyle = "rgba(111, 168, 201, 0.4)";
      ctx.fillRect(-bw * 0.15, -bh / 2 + 2, bw * 0.35, bh - 6);

      ctx.fillStyle = "#2B2118";
      ctx.beginPath();
      ctx.ellipse(bw * 0.05, -bh * 0.1, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Lower shadow strip
    ctx.fillStyle = alpha < 1 ? "rgba(0,0,0,0.1)" : "#E9DEC3";
    ctx.fillRect(-bw / 2, bh / 2 - 4, bw, 4);

    ctx.restore();
  }

  function drawHUD(elapsedMs: number) {
    const totalSec = elapsedMs / 1000;
    const min = Math.floor(totalSec / 60);
    const sec = Math.floor(totalSec % 60);
    const ms = Math.floor((totalSec * 1000) % 1000);

    const timeStr = `${min}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = "#2B2118";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(timeStr, 16, 16);

    // Progress bar
    const playerWX = (camera.x + width * 0.35) / PPM;
    const progress = Math.min(1, playerWX / track.finish.pos[0]);
    const barW = width - 32;
    const barH = 6;
    const barY = 44;

    ctx.fillStyle = "rgba(43, 33, 24, 0.2)";
    ctx.fillRect(16, barY, barW, barH);

    ctx.fillStyle = "#D94F3A";
    ctx.fillRect(16, barY, barW * progress, barH);

    ctx.restore();
  }

  const REAR_WHEEL_RADIUS = 0.35;

  return function render(snapshot: RaceSnapshot, ghosts: Array<{ snapshot: RaceSnapshot; wheelPath: Path2D }>) {
    updateCamera(snapshot.wheel.x, snapshot.wheel.y);

    drawSky();
    drawFarHills();
    drawNearHills();
    drawTerrain();
    drawFinishLine();

    // Ghosts
    for (const ghost of ghosts) {
      drawWheel(ghost.snapshot.wheel, ghost.wheelPath, "#8896A3", 0.6);
      drawChassis(ghost.snapshot.chassis, 0.6);
      drawRearWheel(ghost.snapshot.rearWheel, 0.6);
    }

    // Player
    drawRearWheel(snapshot.rearWheel, 1);
    drawWheel(snapshot.wheel, wheelPath, "#D94F3A", 1);
    drawChassis(snapshot.chassis, 1);

    drawHUD(snapshot.elapsedMs);
  };
}

export function createGhostWheelPath(vertices: Array<{ x: number; y: number }>): Path2D {
  const path = new Path2D();
  if (vertices.length > 0) {
    path.moveTo(vertices[0].x * PPM, -vertices[0].y * PPM);
    for (let i = 1; i < vertices.length; i++) {
      path.lineTo(vertices[i].x * PPM, -vertices[i].y * PPM);
    }
    path.closePath();
  }
  return path;
}
