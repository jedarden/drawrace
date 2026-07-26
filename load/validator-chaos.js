import http from "k6/http";
import { check, sleep } from "k6";
import { hmac } from "k6/crypto";

// k6 chaos test for the validator pod-kill scenario (plan.md §Testing 9, the
// *second* chaos job — the first kills an api pod and is handled by chaos.js).
//
// Generates NON-ephemeral submissions so they are LPUSHed onto the
// `drawrace:validate` Redis list and consumed by the drawrace-validator pod
// (BRPOP). Each enqueued submission is logged as `TRACKED_SUBMISSION <id>
// <player_uuid>` so the bash orchestrator (validator-chaos-test.sh) can poll
// every one to a terminal verdict and assert none were lost or duplicated
// after the validator pod is killed and a replacement comes up.
//
// Run: k6 run -e API=https://api-drawrace.ardenone.com load/validator-chaos.js
// Orchestrator: load/validator-chaos-test.sh (drives the pod kill + drain check)
//
// Why the physics version is read dynamically: the api rejects any submission
// whose blob version byte != the live validator's PHYSICS_VERSION with a
// synchronous 409 PHYSICS_VERSION_MISMATCH (crates/api .../submissions.rs).
// A 409 never enters the queue, so it would defeat a validator-drain test.
// Reading the version from /v1/health keeps this resilient to version drift.

export const options = {
  scenarios: {
    validator_chaos: {
      executor: "constant-arrival-rate",
      // ~18 submissions/min total. Spread across PLAYER_UUIDS_POOL below, each
      // UUID sees ~2/min — well under the api's 20/min per-UUID submit limit
      // (SUBMIT_RATE_LIMIT_MAX) and the 60/min per-UUID poll limit, so the
      // orchestrator's status polls never trip rate limiting.
      rate: 18,
      timeUnit: "1m",
      duration: __ENV.CHAOS_DURATION || "150s",
      preAllocatedVUs: 8,
      maxVUs: 12,
    },
  },
  // No k6 thresholds: the bash orchestrator is the sole pass/fail authority
  // (it asserts the queue drains with no loss/duplication). A k6 threshold
  // violation would otherwise mask the real assertion with a non-zero exit.
};

const API = __ENV.API || "https://api-drawrace.ardenone.com";
const HMAC_KEY = __ENV.HMAC_KEY || "drawrace-dev-key-2026";
const TRACK_ID = 1;

// Deterministic pool of valid v4-format UUIDs. The 16 raw bytes (uuidBytes)
// are baked into the blob; the string form (uuidString) is sent as the
// X-DrawRace-Player header. The api requires blob.player_uuid == header
// (submissions.rs), so the two must correspond exactly.
const PLAYER_UUIDS_POOL = 10;

function uuidBytes(i) {
  // Valid v4: version nibble (0x40) at byte[6], variant nibble (0x80) at byte[8].
  // Differs only in byte[0] and byte[15] so each pool member is distinct.
  return [
    i, 0, 0, 0, // time_low
    0, 0, // time_mid
    0x40, 0, // version + time_hi
    0x80, 0, // variant + clock_seq
    0, 0, 0, 0, 0, i, // node
  ];
}

function uuidString(i) {
  const hex = uuidBytes(i).map((x) => x.toString(16).padStart(2, "0")).join("");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20, 32)
  );
}

export function setup() {
  let physicsVersion = parseInt(__ENV.PHYSICS_VERSION || "8", 10);
  try {
    const r = http.get(`${API}/v1/health`);
    const v = r.json("validator.physics_version");
    if (typeof v === "number" && v > 0 && v <= 255) {
      physicsVersion = v;
    } else {
      console.warn(
        `could not read validator.physics_version from /v1/health (got ${JSON.stringify(
          v
        )}); falling back to PHYSICS_VERSION=${physicsVersion}`
      );
    }
  } catch (e) {
    console.warn(
      `/v1/health unreachable (${e}); falling back to PHYSICS_VERSION=${physicsVersion}`
    );
  }
  console.log(`USING_PHYSICS_VERSION ${physicsVersion}`);
  return { physicsVersion };
}

// Build a structurally-valid current-format ghost blob (crates/api .../blob.rs).
// Single wheel (swap_tick 0), 12-vertex circle, non-ephemeral (flags 0x00).
function makeGhostBlob(playerIdx, physicsVersion) {
  const vertexCount = 12;
  const pointCount = 20;
  const checkpointCount = 0;

  const totalSize =
    36 + // header
    1 + // wheel_count
    (4 + 1 + vertexCount * 4) + // one wheel: swap_tick + vertex_count + vertices
    1 + // point_count
    pointCount * 6 + // stroke points
    1; // checkpoint_count (0 checkpoints)

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 0;

  // magic "DRGH"
  bytes[0] = 0x44;
  bytes[1] = 0x52;
  bytes[2] = 0x47;
  bytes[3] = 0x48;
  offset = 4;

  // version (must match live validator.physics_version)
  view.setUint8(offset, physicsVersion);
  offset += 1;

  // track_id u16 LE
  view.setUint16(offset, TRACK_ID, true);
  offset += 2;

  // flags = 0x00 (non-ephemeral: persist + enqueue to validator queue)
  view.setUint8(offset, 0x00);
  offset += 1;

  // finish_time_ms u32 LE — plausible finish for track 1 (within floor..2×best)
  const finishTime = 28000 + ((playerIdx * 137) % 7000);
  view.setUint32(offset, finishTime, true);
  offset += 4;

  // submitted_at i64 LE (unix millis)
  const nowMs = Date.now();
  view.setUint32(offset, nowMs & 0xffffffff, true);
  view.setUint32(offset + 4, Math.floor(nowMs / 0x100000000), true);
  offset += 8;

  // player_uuid (16 bytes) — must equal X-DrawRace-Player header
  const uuid = uuidBytes(playerIdx);
  for (let i = 0; i < 16; i++) bytes[offset + i] = uuid[i];
  offset += 16;

  // wheel_count = 1
  view.setUint8(offset, 1);
  offset += 1;

  // wheel[0]: swap_tick u32 LE = 0 (initial wheel)
  view.setUint32(offset, 0, true);
  offset += 4;

  // vertex_count
  view.setUint8(offset, vertexCount);
  offset += 1;

  // polygon vertices — approximate circle (i16 x, i16 y, 1/100 px units)
  for (let i = 0; i < vertexCount; i++) {
    const angle = (2 * Math.PI * i) / vertexCount;
    view.setInt16(offset, Math.round(Math.cos(angle) * 40 * 100), true);
    offset += 2;
    view.setInt16(offset, Math.round(Math.sin(angle) * 40 * 100), true);
    offset += 2;
  }

  // point_count
  view.setUint8(offset, pointCount);
  offset += 1;

  // stroke points — delta-encoded (i16 dx, i16 dy, u16 dt)
  for (let i = 0; i < pointCount; i++) {
    view.setInt16(offset, (i * 7) % 200 - 100, true);
    offset += 2;
    view.setInt16(offset, (i * 13) % 200 - 100, true);
    offset += 2;
    view.setUint16(offset, 16, true);
    offset += 2;
  }

  // checkpoint_count = 0
  view.setUint8(offset, checkpointCount);

  return bytes.buffer;
}

export default function (data) {
  const playerIdx = ((__VU - 1) % PLAYER_UUIDS_POOL) + 1;
  const playerUuid = uuidString(playerIdx);

  const blob = makeGhostBlob(playerIdx, data.physicsVersion);
  const signature = hmac("sha256", HMAC_KEY, blob, "hex");
  const headers = {
    "Content-Type": "application/octet-stream",
    "X-DrawRace-Track": String(TRACK_ID),
    "X-DrawRace-Player": playerUuid,
    "X-DrawRace-ClientHMAC": signature,
  };

  const r = http.post(`${API}/v1/submissions`, blob, { headers });

  const ok = check(r, {
    "202 Accepted": (x) => x.status === 202,
  });

  // Only track submissions that were actually enqueued (202). A 429 (rate
  // limit), 400 (malformed), or 409 (physics version skew) never entered the
  // queue and so must not be counted toward the no-loss assertion.
  if (ok && r.status === 202) {
    const body = r.json();
    const submissionId = body && body.submission_id;
    if (submissionId) {
      // Parsed by validator-chaos-test.sh: "TRACKED_SUBMISSION <id> <uuid>"
      console.log(`TRACKED_SUBMISSION ${submissionId} ${playerUuid}`);
    }
  } else if (r.status === 429) {
    console.warn(`submit rate-limited (429) for ${playerUuid}; not tracked`);
  } else {
    console.warn(`submit non-202 status=${r.status} for ${playerUuid}; not tracked`);
  }

  sleep(0.2);
}
