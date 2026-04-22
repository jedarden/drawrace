import http from "k6/http";
import { check, sleep } from "k6";
import { hmac } from "k6/crypto";

// k6 chaos test — run this alongside a pod-killer that randomly deletes
// drawrace-api pods during the test. The client's retry-with-backoff should
// keep the failure rate below threshold even with pods being killed.
//
// Run: k6 run -e API=https://api-staging.drawrace.example load/chaos.js
// Simultaneously: kubectl delete pod -l app=drawrace-api -n drawrace-staging

export const options = {
  scenarios: {
    chaos: {
      executor: "constant-arrival-rate",
      rate: 500,
      timeUnit: "1s",
      duration: "5m",
      preAllocatedVUs: 100,
      maxVUs: 500,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    http_req_duration: ["p(99)<3000"],
  },
};

const API = __ENV.API || "https://api-staging.drawrace.example";
const HMAC_KEY = __ENV.HMAC_KEY || "drawrace-dev-key-2026";

function makeGhostBlob() {
  const vertexCount = 12;
  const pointCount = 20;
  const totalSize = 36 + 1 + vertexCount * 4 + 1 + pointCount * 6 + 1;
  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  bytes[0] = 0x44; bytes[1] = 0x52; bytes[2] = 0x47; bytes[3] = 0x48;
  offset = 4;
  view.setUint8(offset, 1); offset += 1;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint8(offset, 0x02); offset += 1; // ephemeral
  const finishTime = 28000 + Math.floor(Math.random() * 7000);
  view.setUint32(offset, finishTime, true); offset += 4;
  const nowMs = Date.now();
  view.setUint32(offset, nowMs & 0xffffffff, true);
  view.setUint32(offset + 4, Math.floor(nowMs / 0x100000000), true);
  offset += 8;
  for (let i = 0; i < 16; i++) bytes[offset + i] = Math.floor(Math.random() * 256);
  offset += 16;
  view.setUint8(offset, vertexCount); offset += 1;
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount;
    view.setInt16(offset, Math.round(Math.cos(angle) * 40 * 100), true); offset += 2;
    view.setInt16(offset, Math.round(Math.sin(angle) * 40 * 100), true); offset += 2;
  }
  view.setUint8(offset, pointCount); offset += 1;
  for (let i = 0; i < pointCount; i++) {
    view.setInt16(offset, Math.floor(Math.random() * 200) - 100, true); offset += 2;
    view.setInt16(offset, Math.floor(Math.random() * 200) - 100, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
  }
  view.setUint8(offset, 0);
  return bytes.buffer;
}

export default function () {
  const blob = makeGhostBlob();
  const signature = hmac("sha256", HMAC_KEY, blob, "hex");
  const headers = {
    "Content-Type": "application/octet-stream",
    "X-DrawRace-Track": "1",
    "X-DrawRace-ClientHMAC": signature,
  };

  const r = http.post(`${API}/v1/submissions`, blob, { headers });
  check(r, {
    "status 2xx": (x) => x.status >= 200 && x.status < 300,
  });
  sleep(0.05);
}
