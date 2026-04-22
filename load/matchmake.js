import http from "k6/http";
import { check, sleep } from "k6";
import { uuidv4 } from "https://jslib.k6.io/k6-utils/1.4.0/index.js";

// k6 load test for DrawRace GET /v1/matchmake and GET /v1/leaderboard
// Run: k6 run -e API=https://api.drawrace.ardenone.com load/matchmake.js

export const options = {
  scenarios: {
    read_traffic: {
      executor: "ramping-arrival-rate",
      startRate: 20,
      timeUnit: "1s",
      preAllocatedVUs: 100,
      maxVUs: 500,
      stages: [
        { target: 100, duration: "2m" },
        { target: 500, duration: "2m" },
        { target: 500, duration: "3m" },
        { target: 0, duration: "1m" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<300", "p(99)<800"],
  },
};

const API = __ENV.API || "https://api.drawrace.ardenone.com";

export default function () {
  // Each VU uses a unique player UUID per iteration
  const playerUuid = uuidv4();
  const trackId = 1;

  // Matchmake — the primary read path before each race
  const mmResp = http.get(`${API}/v1/matchmake/${trackId}?player_uuid=${playerUuid}`);
  check(mmResp, {
    "matchmake 200": (r) => r.status === 200,
    "has ghosts": (r) => {
      if (r.status !== 200) return false;
      const body = r.json();
      return Array.isArray(body.ghosts) && body.ghosts.length > 0;
    },
  });

  // Leaderboard context — viewed after races
  const lbResp = http.get(
    `${API}/v1/leaderboard/${trackId}/context?player_uuid=${playerUuid}&window=5`,
  );
  check(lbResp, {
    "leaderboard 200": (r) => r.status === 200,
  });

  sleep(0.05);
}
