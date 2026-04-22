import { PHYSICS_VERSION } from "@drawrace/engine-core";
import type { Point } from "@drawrace/engine-core";

export interface GhostBlobInput {
  trackId: number;
  finishTimeMs: number;
  playerUuid: string;
  wheelVertices: Array<{ x: number; y: number }>;
  rawStrokePoints: Array<Point & { t: number }>;
}

export function encodeGhostBlob(input: GhostBlobInput): ArrayBuffer {
  const {
    trackId,
    finishTimeMs,
    playerUuid,
    wheelVertices,
    rawStrokePoints,
  } = input;

  const vertexCount = wheelVertices.length;
  const pointCount = Math.min(rawStrokePoints.length, 255);

  // Calculate total size
  const headerSize = 36;
  const polySize = 1 + vertexCount * 4;
  const strokeSize = 1 + pointCount * 6;
  const checkpointSize = 1; // 0 checkpoints
  const totalSize = headerSize + polySize + strokeSize + checkpointSize;

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

  // flags (uint8) = 0
  view.setUint8(offset, 0);
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

  // vertex_count (uint8)
  view.setUint8(offset, vertexCount);
  offset += 1;

  // polygon_vertices — int16 x, y in 1/100 px units
  for (const v of wheelVertices) {
    view.setInt16(offset, Math.round(v.x * 100), true);
    offset += 2;
    view.setInt16(offset, Math.round(v.y * 100), true);
    offset += 2;
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

function parseUuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
