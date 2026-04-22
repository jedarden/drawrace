import http from "k6/http";
import { check, sleep } from "k6";
import { hmac } from "k6/crypto";

// k6 load test for DrawRace POST /v1/submissions
// Run: k6 run -e API=https://api.drawrace.ardenone.com load/submit.js
// Staging with rate-limit bypass: ensure runner IP is in DRAWRACE_RATE_LIMIT_BYPASS_CIDR

export const options = {
  scenarios: {
    submissions: {
      executor: "ramping-arrival-rate",
      startRate: 50,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 2000,
      stages: [
        { target: 200, duration: "2m" },
        { target: 2000, duration: "2m" },
        { target: 2000, duration: "5m" },
        { target: 0, duration: "1m" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<400", "p(99)<1200"],
  },
};

const API = __ENV.API || "https://api.drawrace.ardenone.com";
const HMAC_KEY = __ENV.HMAC_KEY || "drawrace-dev-key-2026";

function makeGhostBlob() {
  const vertexCount = 12;
  const pointCount = 20;

  const totalSize = 36 + 1 + vertexCount * 4 + 1 + pointCount * 6 + 1;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  // Magic "DRGH"
  bytes[0] = 0x44;
  bytes[1] = 0x52;
  bytes[2] = 0x47;
  bytes[3] = 0x48;
  offset = 4;

  // version = 1 (PHYSICS_VERSION)
  view.setUint8(offset, 1);
  offset += 1;

  // track_id = 1 (uint16 LE)
  view.setUint16(offset, 1, true);
  offset += 2;

  // flags = 0x02 (ephemeral — don't persist to leaderboard)
  view.setUint8(offset, 0x02);
  offset += 1;

  // finish_time_ms = 28000-35000 (uint32 LE)
  const finishTime = 28000 + Math.floor(Math.random() * 7000);
  view.setUint32(offset, finishTime, true);
  offset += 4;

  // submitted_at (int64 LE)
  const nowMs = Date.now();
  view.setUint32(offset, nowMs & 0xffffffff, true);
  view.setUint32(offset + 4, Math.floor(nowMs / 0x100000000), true);
  offset += 8;

  // player_uuid (16 random bytes)
  for (let i = 0; i < 16; i++) {
    bytes[offset + i] = Math.floor(Math.random() * 256);
  }
  offset += 16;

  // vertex_count
  view.setUint8(offset, vertexCount);
  offset += 1;

  // polygon vertices — approximate circle
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount;
    const x = Math.round(Math.cos(angle) * 40 * 100);
    const y = Math.round(Math.sin(angle) * 40 * 100);
    view.setInt16(offset, x, true);
    offset += 2;
    view.setInt16(offset, y, true);
    offset += 2;
  }

  // point_count
  view.setUint8(offset, pointCount);
  offset += 1;

  // stroke points — delta-encoded
  for (let i = 0; i < pointCount; i++) {
    const dx = Math.floor(Math.random() * 200) - 100;
    const dy = Math.floor(Math.random() * 200) - 100;
    view.setInt16(offset, dx, true);
    offset += 2;
    view.setInt16(offset, dy, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
  }

  // checkpoint_count = 0
  view.setUint8(offset, 0);

  return bytes.buffer;
}

function hmacSign(body) {
  return hmac("sha256", HMAC_KEY, body, "hex");
}

export default function () {
  const blob = makeGhostBlob();
  const signature = hmacSign(blob);

  const headers = {
    "Content-Type": "application/octet-stream",
    "X-DrawRace-Track": "1",
    "X-DrawRace-ClientHMAC": signature,
  };

  const r = http.post(`${API}/v1/submissions`, blob, { headers });

  check(r, {
    "status 2xx": (x) => x.status >= 200 && x.status < 300,
  });

  sleep(0.1);
}
