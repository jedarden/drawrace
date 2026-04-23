import type { RaceSnapshot, TrackDef, SimBody } from "@drawrace/engine-core";
import type { DrawResult } from "@drawrace/engine-core";
import type { ParticleSystem } from "./Particles.js";

const PPM = 30;

const reducedMotion =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Deterministic PRNG for cosmetic effects (mulberry32)
function mulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fnvHash(input: string | number): number {
  const str = String(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Pre-rendered assets (created once)
let crossHatchPattern: CanvasPattern | null = null;
const tuftSprites: HTMLCanvasElement[] = [];
let assetsPreloaded = false;

export async function preloadAssets(): Promise<void> {
  if (assetsPreloaded) return;
  // Actual asset creation deferred to first createRenderer call where we have a ctx.
  // This async stub satisfies callers that await preloadAssets().
  assetsPreloaded = true;
}

function ensureAssets(ctx: CanvasRenderingContext2D): void {
  if (crossHatchPattern !== null || tuftSprites.length > 0) return;

  // Cross-hatch pattern (256x256)
  const patCanvas = document.createElement("canvas");
  patCanvas.width = 256;
  patCanvas.height = 256;
  const pctx = patCanvas.getContext("2d")!;
  pctx.strokeStyle = "rgba(43, 33, 24, 0.06)";
  pctx.lineWidth = 1;
  pctx.lineCap = "round";
  for (let i = -256; i < 512; i += 12) {
    pctx.beginPath();
    pctx.moveTo(i, 256);
    pctx.lineTo(i + 256 * Math.tan((20 * Math.PI) / 180), 0);
    pctx.stroke();
  }
  for (let i = -256; i < 512; i += 18) {
    pctx.beginPath();
    pctx.moveTo(i, 0);
    pctx.lineTo(i + 256 * Math.tan((25 * Math.PI) / 180), 256);
    pctx.stroke();
  }
  try {
    crossHatchPattern = ctx.createPattern(patCanvas, "repeat");
  } catch {
    crossHatchPattern = null;
  }

  // Grass tuft sprites (4 deterministic variants)
  const tuftRng = mulberry32(12345);
  for (let v = 0; v < 4; v++) {
    const tc = document.createElement("canvas");
    tc.width = 16;
    tc.height = 24;
    const tctx = tc.getContext("2d")!;
    tctx.strokeStyle = "#7CA05C";
    tctx.lineWidth = 1.5;
    tctx.lineCap = "round";
    const blades = 2 + Math.floor(tuftRng() * 2);
    for (let b = 0; b < blades; b++) {
      const bx = 4 + tuftRng() * 8;
      const lean = (tuftRng() - 0.5) * 6;
      tctx.beginPath();
      tctx.moveTo(bx, 24);
      tctx.quadraticCurveTo(bx + lean * 0.5, 12, bx + lean, 2 + tuftRng() * 4);
      tctx.stroke();
    }
    tuftSprites.push(tc);
  }
}

interface Camera {
  x: number;
  y: number;
  width: number;
  height: number;
}

function buildWobblePath(
  vertices: Array<{ x: number; y: number }>,
  seed: number
): Path2D {
  const path = new Path2D();
  if (vertices.length < 3) return path;

  const rng = mulberry32(seed);
  const n = vertices.length;

  path.moveTo(vertices[0].x * PPM, -vertices[0].y * PPM);

  for (let i = 0; i < n; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % n];

    const cx = curr.x * PPM;
    const cy = -curr.y * PPM;
    const nx = next.x * PPM;
    const ny = -next.y * PPM;

    const ex = nx - cx;
    const ey = ny - cy;
    const len = Math.hypot(ex, ey);
    if (len < 0.01) continue;

    // Outward normal
    const nnx = -ey / len;
    const nny = ex / len;

    // Two midpoints with perpendicular jitter
    for (let m = 1; m <= 2; m++) {
      const t = m / 3;
      const mx = cx + ex * t;
      const my = cy + ey * t;
      const offset = (rng() - 0.5) * 1.4; // ±0.7px
      const mx2 = mx + nnx * offset;
      const my2 = my + nny * offset;
      const cpx = mx2 + (rng() - 0.5) * 0.6;
      const cpy = my2 + (rng() - 0.5) * 0.6;
      path.quadraticCurveTo(cpx, cpy, mx2, my2);
    }

    path.lineTo(nx, ny);
  }

  path.closePath();
  return path;
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

  ensureAssets(ctx);

  const camera: Camera = { x: 0, y: 0, width, height };

  const terrainScreenPts = track.terrain.map(([x, y]) => ({
    wx: x,
    wy: y,
  }));

  // Physics-accurate wheel Path2D
  const wheelPath = new Path2D();
  const verts = wheelDraw.vertices;
  if (verts.length > 0) {
    wheelPath.moveTo(verts[0].x * PPM, -verts[0].y * PPM);
    for (let i = 1; i < verts.length; i++) {
      wheelPath.lineTo(verts[i].x * PPM, -verts[i].y * PPM);
    }
    wheelPath.closePath();
  }

  // Wobble cosmetic stroke (§Graphics & UX 4)
  const wobblePath = buildWobblePath(verts, fnvHash("wobble"));

  // Pre-compute grass tuft positions (seeded, deterministic)
  const tuftPositions: Array<{ wx: number; wy: number; spriteIdx: number }> = [];
  {
    const rng = mulberry32(fnvHash("grass-tufts"));
    for (let i = 0; i < terrainScreenPts.length - 1; i++) {
      const ax = terrainScreenPts[i].wx;
      const bx = terrainScreenPts[i + 1].wx;
      const ay = terrainScreenPts[i].wy;
      const by = terrainScreenPts[i + 1].wy;
      const segLen = Math.hypot(bx - ax, by - ay);
      const spacing = 2.0 + rng() * 1.5;
      let d = spacing * rng();
      while (d < segLen) {
        const t = d / segLen;
        tuftPositions.push({
          wx: ax + (bx - ax) * t,
          wy: ay + (by - ay) * t,
          spriteIdx: Math.floor(rng() * 4),
        });
        d += spacing + rng() * 1.0;
      }
    }
  }

  function worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
    return {
      sx: wx * PPM - camera.x,
      sy: -wy * PPM - camera.y,
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
    const parallaxFar = reducedMotion ? 1.0 : 0.1;
    const offset = -(camera.x * parallaxFar) % width;
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
    const parallaxNear = reducedMotion ? 1.0 : 0.3;
    const offset = -(camera.x * parallaxNear) % width;
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

    // Fill band
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

    // Cross-hatch overlay clipped to terrain
    if (crossHatchPattern) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pts[0].sx, pts[0].sy);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].sx, pts[i].sy);
      }
      ctx.lineTo(pts[pts.length - 1].sx, height + 10);
      ctx.lineTo(pts[0].sx, height + 10);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = crossHatchPattern;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }

    // Grass strip
    ctx.strokeStyle = "#7CA05C";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy - 2);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].sx, pts[i].sy - 2);
    }
    ctx.stroke();

    // Grass tufts (deterministic positions)
    for (const tuft of tuftPositions) {
      const { sx, sy } = worldToScreen(tuft.wx, tuft.wy);
      if (sx < -20 || sx > width + 20) continue;
      const sprite = tuftSprites[tuft.spriteIdx];
      if (sprite) {
        ctx.drawImage(sprite, sx - 8, sy - 22, 16, 24);
      }
    }

    // Ink top edge with variable-width modulation (2.5/3.5px alternating ~80px)
    ctx.strokeStyle = "#2B2118";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let accumulatedX = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const segLen = Math.hypot(pts[i + 1].sx - pts[i].sx, pts[i + 1].sy - pts[i].sy);
      ctx.lineWidth = Math.floor(accumulatedX / 80) % 2 === 0 ? 2.5 : 3.5;
      ctx.beginPath();
      ctx.moveTo(pts[i].sx, pts[i].sy);
      ctx.lineTo(pts[i + 1].sx, pts[i + 1].sy);
      ctx.stroke();
      accumulatedX += segLen;
    }
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

    // Checkered pattern
    const lineLen = botSy - topSy;
    const checkSize = 6;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx - 4, topSy, 8, lineLen);
    ctx.clip();
    for (let row = 0; row < Math.ceil(lineLen / checkSize); row++) {
      for (let col = 0; col < 2; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? "#F4EAD5" : "#2B2118";
        ctx.fillRect(sx - 4 + col * checkSize, topSy + row * checkSize, checkSize, checkSize);
      }
    }
    ctx.restore();

    // Highlight border
    ctx.strokeStyle = "#E8B64C";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx - 5, topSy - 1, 10, lineLen + 2);
  }

  function drawWheel(body: SimBody, path: Path2D, cosmeticPath: Path2D | null, fillStyle: string, alpha: number) {
    const { sx, sy } = worldToScreen(body.x, body.y);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.rotate(-body.angle);

    // Base fill
    ctx.fillStyle = fillStyle;
    ctx.fill(path);

    // Ink outline
    ctx.strokeStyle = "#2B2118";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(path);

    // Wobble decorative stroke (player only, not in reduced-motion)
    if (cosmeticPath && !reducedMotion) {
      ctx.strokeStyle = "rgba(43, 33, 24, 0.35)";
      ctx.lineWidth = 1.2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke(cosmeticPath);
    }

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
    ctx.rotate(-body.angle);

    const bw = 1.2 * PPM;
    const bh = 0.4 * PPM;

    ctx.fillStyle = alpha < 1 ? "#8896A3" : "#FBF4E3";
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    ctx.strokeStyle = "#2B2118";
    ctx.lineWidth = 2;
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);

    if (alpha >= 1) {
      ctx.fillStyle = "rgba(111, 168, 201, 0.4)";
      ctx.fillRect(-bw * 0.15, -bh / 2 + 2, bw * 0.35, bh - 6);

      ctx.fillStyle = "#2B2118";
      ctx.beginPath();
      ctx.ellipse(bw * 0.05, -bh * 0.1, 5, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Grinning mouth
      ctx.strokeStyle = "#2B2118";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(bw * 0.05, -bh * 0.02, 3, 0, Math.PI);
      ctx.stroke();
    }

    ctx.fillStyle = alpha < 1 ? "rgba(0,0,0,0.1)" : "#E9DEC3";
    ctx.fillRect(-bw / 2, bh / 2 - 4, bw, 4);

    ctx.restore();
  }

  let countdownStartTime = 0;
  let lastCountdownVal = -1;

  function drawCountdown(countdown: number, tickMs: number) {
    if (countdown < 0) return;
    const text = countdown === 0 ? "GO!" : String(countdown);

    // Track when each new countdown number appears for animation
    if (countdown !== lastCountdownVal) {
      lastCountdownVal = countdown;
      countdownStartTime = tickMs;
    }

    const age = tickMs - countdownStartTime;
    const maxAge = 1000;

    // easeOutBack spring scale-in
    let scale = 1;
    if (!reducedMotion) {
      const t = Math.min(1, age / 300);
      const c1 = 1.70158;
      const c3 = c1 + 1;
      scale = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }

    // easeInCubic fade-out in last 200ms
    let alpha = 0.9;
    if (!reducedMotion && age > maxAge - 200) {
      const fadeT = (age - (maxAge - 200)) / 200;
      alpha = 0.9 * (1 - fadeT * fadeT * fadeT);
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = countdown === 0 ? "#D94F3A" : "#2B2118";
    ctx.font = `bold ${Math.round(96 * scale)}px "Caveat", "Patrick Hand SC", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.translate(width / 2, height / 2);
    ctx.shadowColor = "rgba(43, 33, 24, 0.2)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 4;
    ctx.fillText(text, 0, 0);
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
    ctx.font = 'bold 20px "Patrick Hand SC", monospace';
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(timeStr, 16, 16);

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

  // Camera shake state
  let shakeAmount = 0;
  let shakeDecay = 0.9;

  return function render(
    snapshot: RaceSnapshot,
    ghosts: Array<{ snapshot: RaceSnapshot; wheelPath: Path2D; name?: string }>,
    particles: ParticleSystem,
    countdown?: number
  ) {
    updateCamera(snapshot.wheel.x, snapshot.wheel.y);

    ctx.save();
    // Camera shake
    if (shakeAmount > 0.5 && !reducedMotion) {
      const sx = (Math.random() - 0.5) * shakeAmount;
      const sy = (Math.random() - 0.5) * shakeAmount;
      ctx.translate(sx, sy);
      shakeAmount *= shakeDecay;
    } else {
      shakeAmount = 0;
    }

    drawSky();
    drawFarHills();
    drawNearHills();
    drawTerrain();
    drawFinishLine();

    // Dust particles behind player (layer 5, behind wheel)
    particles.renderDust(ctx);

    // Ghosts (layer 4)
    for (const ghost of ghosts) {
      drawWheel(ghost.snapshot.wheel, ghost.wheelPath, null, "#8896A3", 0.6);
      drawChassis(ghost.snapshot.chassis, 0.6);
      drawRearWheel(ghost.snapshot.rearWheel, 0.6);

      // Ghost name tag (floating label above)
      if (ghost.name) {
        const gsx = ghost.snapshot.wheel.x * PPM - camera.x;
        const gsy = -ghost.snapshot.wheel.y * PPM - camera.y;
        if (gsx > -50 && gsx < width + 50 && gsy > -50 && gsy < height + 50) {
          ctx.save();
          ctx.globalAlpha = 0.7;
          ctx.fillStyle = "#2B2118";
          ctx.font = '14px "Caveat", system-ui, sans-serif';
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(ghost.name, gsx, gsy - 30);
          ctx.restore();
        }
      }
    }

    // Player (layer 5)
    drawRearWheel(snapshot.rearWheel, 1);
    drawWheel(snapshot.wheel, wheelPath, wobblePath, "#D94F3A", 1);
    drawChassis(snapshot.chassis, 1);

    // Confetti / FX overlay (layer 6)
    particles.renderConfetti(ctx);

    // HUD (layer 7)
    drawHUD(snapshot.elapsedMs);

    // Countdown overlay
    if (countdown !== undefined && countdown >= 0) {
      drawCountdown(countdown, snapshot.elapsedMs);
    }

    ctx.restore();
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
