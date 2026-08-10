import { PHYSICS_VERSION } from "@drawrace/engine-core";
import type { Point } from "@drawrace/engine-core";
import { isEphemeral } from "./player-identity.js";

export interface WheelSwap {
  swapTick: number;
  vertices: Array<{ x: number; y: number }>;
}

export interface GhostBlobInput {
  trackId: number;
  finishTimeMs: number;
  playerUuid: string;
  wheels: WheelSwap[];
  rawStrokePoints: Array<Point & { t: number }>;
}

export function encodeGhostBlob(input: GhostBlobInput): ArrayBuffer {
  const {
    trackId,
    finishTimeMs,
    playerUuid,
    wheels,
    rawStrokePoints,
  } = input;

  const wheelCount = wheels.length;
  const pointCount = Math.min(rawStrokePoints.length, 255);

  // Calculate total size
  const headerSize = 36;
  const wheelCountSize = 1;
  let wheelsSize = 0;
  for (const w of wheels) {
    wheelsSize += 4 + 1 + w.vertices.length * 4; // swap_tick + vertex_count + vertices
  }
  const strokeSize = 1 + pointCount * 6;
  const checkpointSize = 1; // 0 checkpoints
  const totalSize = headerSize + wheelCountSize + wheelsSize + strokeSize + checkpointSize;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  // Magic "DRGH"
  bytes[0] = 0x44; // D
  bytes[1] = 0x52; // R
  bytes[2] = 0x47; // G
  bytes[3] = 0x48; // H
  offset = 4;

  // version (PHYSICS_VERSION)
  view.setUint8(offset, PHYSICS_VERSION);
  offset += 1;

  // track_id (uint16 LE)
  view.setUint16(offset, trackId, true);
  offset += 2;

  // flags (uint8) — bit 0x02 = ephemeral (do-not-persist)
  const flags = isEphemeral() ? 0x02 : 0x00;
  view.setUint8(offset, flags);
  offset += 1;

  // finish_time_ms (uint32 LE)
  view.setUint32(offset, finishTimeMs, true);
  offset += 4;

  // submitted_at (int64 LE) — unix millis
  const now = Date.now();
  view.setBigInt64(offset, BigInt(now), true);
  offset += 8;

  // player_uuid (16 raw bytes)
  const uuidBytes = parseUuidBytes(playerUuid);
  for (let i = 0; i < 16; i++) {
    bytes[offset + i] = uuidBytes[i];
  }
  offset += 16;

  // wheel_count (uint8)
  view.setUint8(offset, wheelCount);
  offset += 1;

  // wheels[] — per wheel: swap_tick uint32, vertex_count uint8, int16 x,y × vertex_count
  for (const w of wheels) {
    view.setUint32(offset, w.swapTick, true);
    offset += 4;

    view.setUint8(offset, w.vertices.length);
    offset += 1;

    for (const v of w.vertices) {
      view.setInt16(offset, Math.round(v.x * 100), true);
      offset += 2;
      view.setInt16(offset, Math.round(v.y * 100), true);
      offset += 2;
    }
  }

  // point_count (uint8)
  view.setUint8(offset, pointCount);
  offset += 1;

  // stroke_points — delta-encoded: int16 dx, int16 dy, uint16 dt_ms
  let prevX = 0;
  let prevY = 0;
  let prevT = 0;
  for (let i = 0; i < pointCount; i++) {
    const p = rawStrokePoints[i];
    const dx = Math.round((p.x - prevX) * 100);
    const dy = Math.round((p.y - prevY) * 100);
    const dt = Math.round(p.t - prevT);
    view.setInt16(offset, Math.max(-32768, Math.min(32767, dx)), true);
    offset += 2;
    view.setInt16(offset, Math.max(-32768, Math.min(32767, dy)), true);
    offset += 2;
    view.setUint16(offset, Math.min(65535, dt), true);
    offset += 2;
    prevX = p.x;
    prevY = p.y;
    prevT = p.t;
  }

  // checkpoint_count = 0
  view.setUint8(offset, 0);

  return buf;
}

export function decodeGhostBlobVertices(blob: ArrayBuffer): Array<{ x: number; y: number }> {
  const view = new DataView(blob);
  let offset = 36; // skip header

  const wheelCount = view.getUint8(offset);
  offset += 1;

  if (wheelCount === 0) return [];

  // Read first wheel's vertices
  const swapTick = view.getUint32(offset, true);
  offset += 4;
  void swapTick;

  const vertexCount = view.getUint8(offset);
  offset += 1;

  const vertices: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < vertexCount; i++) {
    const x = view.getInt16(offset, true) / 100;
    offset += 2;
    const y = view.getInt16(offset, true) / 100;
    offset += 2;
    vertices.push({ x, y });
  }

  return vertices;
}

export function decodeGhostBlobFinishTime(blob: ArrayBuffer): number {
  const view = new DataView(blob);
  return view.getUint32(8, true);
}

export function decodeGhostBlobWheels(blob: ArrayBuffer): Array<{ swapTick: number; vertices: Array<{ x: number; y: number }> }> {
  const view = new DataView(blob);
  const bytes = new Uint8Array(blob);
  let offset = 36; // skip header

  const wheelCount = view.getUint8(offset);
  offset += 1;

  const wheels: Array<{ swapTick: number; vertices: Array<{ x: number; y: number }> }> = [];

  for (let i = 0; i < wheelCount; i++) {
    const swapTick = view.getUint32(offset, true);
    offset += 4;

    const vertexCount = view.getUint8(offset);
    offset += 1;

    const vertices: Array<{ x: number; y: number }> = [];
    for (let j = 0; j < vertexCount; j++) {
      const x = view.getInt16(offset, true) / 100;
      offset += 2;
      const y = view.getInt16(offset, true) / 100;
      offset += 2;
      vertices.push({ x, y });
    }

    wheels.push({ swapTick, vertices });
  }

  return wheels;
}

function parseUuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ── Ghost Share Link Encoding (no raw stroke points, base64url) ─────────────

export interface GhostShareInput {
  trackId: number;
  finishTimeMs: number;
  seed: number;
  wheels: WheelSwap[];
}

/**
 * Encodes a ghost for URL sharing (omit cosmetic stroke points to keep link short).
 * Returns a base64url-encoded string suitable for ?ghost= URL parameter.
 */
export function encodeGhostForShare(input: GhostShareInput): string {
  const { trackId, finishTimeMs, seed, wheels } = input;
  const wheelCount = wheels.length;

  // Calculate size: magic(4) + version(1) + track_id(2) + flags(1) + finish_time(4) + seed(4) + wheel_count(1) + wheels
  let wheelsSize = 0;
  for (const w of wheels) {
    wheelsSize += 4 + 1 + w.vertices.length * 4; // swap_tick + vertex_count + vertices
  }
  const totalSize = 17 + wheelsSize; // 4+1+2+1+4+4+1 = 17 byte header, plus wheels data

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  // Magic "DRGH"
  bytes[0] = 0x44; // D
  bytes[1] = 0x52; // R
  bytes[2] = 0x47; // G
  bytes[3] = 0x48; // H
  offset = 4;

  // version (PHYSICS_VERSION)
  view.setUint8(offset, PHYSICS_VERSION);
  offset += 1;

  // track_id (uint16 LE)
  view.setUint16(offset, trackId, true);
  offset += 2;

  // flags (uint8) — none for share links
  view.setUint8(offset, 0);
  offset += 1;

  // finish_time_ms (uint32 LE)
  view.setUint32(offset, finishTimeMs, true);
  offset += 4;

  // seed (uint32 LE) — race seed for deterministic replay
  view.setUint32(offset, seed >>> 0, true);
  offset += 4;

  // wheel_count (uint8)
  view.setUint8(offset, wheelCount);
  offset += 1;

  // wheels[] — per wheel: swap_tick uint32, vertex_count uint8, int16 x,y × vertex_count
  for (const w of wheels) {
    view.setUint32(offset, w.swapTick, true);
    offset += 4;

    view.setUint8(offset, w.vertices.length);
    offset += 1;

    for (const v of w.vertices) {
      view.setInt16(offset, Math.round(v.x * 100), true);
      offset += 2;
      view.setInt16(offset, Math.round(v.y * 100), true);
      offset += 2;
    }
  }

  // Convert to base64url (URL-safe, no padding)
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Decodes a ghost from URL share link format.
 * Returns null if invalid or version mismatch.
 */
export function decodeGhostForShare(encoded: string): {
  trackId: number;
  finishTimeMs: number;
  seed: number;
  wheels: Array<{ swapTick: number; vertices: Array<{ x: number; y: number }> }>;
  physicsVersion: number;
} | null {
  try {
    // Convert from base64url
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const view = new DataView(bytes.buffer);
    let offset = 0;

    // Check magic
    if (bytes[0] !== 0x44 || bytes[1] !== 0x52 || bytes[2] !== 0x47 || bytes[3] !== 0x48) {
      return null;
    }
    offset = 4;

    // version
    const physicsVersion = view.getUint8(offset);
    offset += 1;

    // track_id
    const trackId = view.getUint16(offset, true);
    offset += 2;

    // flags (skip)
    offset += 1;

    // finish_time_ms
    const finishTimeMs = view.getUint32(offset, true);
    offset += 4;

    // seed
    const seed = view.getUint32(offset, true);
    offset += 4;

    // wheel_count
    const wheelCount = view.getUint8(offset);
    offset += 1;

    const wheels: Array<{ swapTick: number; vertices: Array<{ x: number; y: number }> }> = [];

    for (let i = 0; i < wheelCount; i++) {
      const swapTick = view.getUint32(offset, true);
      offset += 4;

      const vertexCount = view.getUint8(offset);
      offset += 1;

      const vertices: Array<{ x: number; y: number }> = [];
      for (let j = 0; j < vertexCount; j++) {
        const x = view.getInt16(offset, true) / 100;
        offset += 2;
        const y = view.getInt16(offset, true) / 100;
        offset += 2;
        vertices.push({ x, y });
      }

      wheels.push({ swapTick, vertices });
    }

    return { trackId, finishTimeMs, seed, wheels, physicsVersion };
  } catch {
    return null;
  }
}
