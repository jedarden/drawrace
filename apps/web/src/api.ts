import { getApiUrl, isOnline } from "./api-config.js";
import { getPlayerUuid } from "./player-identity.js";
import { computeHmac } from "./hmac.js";
import { encodeGhostBlob, decodeGhostBlobVertices } from "./ghost-blob.js";
import { putCachedGhost, getCachedGhost } from "./ghost-cache.js";
import type { Point } from "@drawrace/engine-core";

export interface MatchmakeGhost {
  ghost_id: string;
  time_ms: number;
  name: string;
  url: string;
}

export interface MatchmakeResponse {
  track_id: number;
  player_bucket: string;
  target_bucket: string;
  ghosts: MatchmakeGhost[];
  shadow_ghost: MatchmakeGhost | null;
  expires_at: string;
}

export interface GhostData {
  id: string;
  name: string;
  wheelVertices: Array<{ x: number; y: number }>;
  finishTimeMs: number;
  seed: number;
}

export interface SubmissionVerdict {
  status: "pending_validation" | "accepted" | "rejected";
  ghost_id?: string;
  time_ms?: number;
  rank?: number;
  bucket?: string;
  is_pb?: boolean;
  reason?: string;
}

const MATCHMAKE_SEED = 0xcafe;

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries: number,
  baseMs: number,
  isRetryable: (err: unknown) => boolean = () => true,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const jitter = Math.random() * baseMs * 0.3;
      const delay = baseMs * Math.pow(2, attempt) + jitter;
      await sleep(delay);
    }
  }
}

function isTransientHttp(resp: Response): boolean {
  return resp.status >= 500 || resp.status === 429;
}

export async function fetchGhosts(trackId: number): Promise<GhostData[]> {
  const apiUrl = getApiUrl();
  const playerUuid = getPlayerUuid();

  if (!apiUrl) {
    return fetchBundledGhosts();
  }

  try {
    const url = `${apiUrl}/v1/matchmake/${trackId}?player_uuid=${playerUuid}`;
    const resp = await retryWithBackoff(
      () => fetch(url),
      2,
      500,
      (err) => {
        if (err instanceof Response) return isTransientHttp(err);
        return true;
      },
    );
    if (!resp.ok) {
      return fetchBundledGhosts();
    }
    const data: MatchmakeResponse = await resp.json();
    const allGhosts = [...data.ghosts];
    if (data.shadow_ghost) {
      allGhosts.push(data.shadow_ghost);
    }

    const resolved: GhostData[] = [];
    for (const g of allGhosts.slice(0, 3)) {
      try {
        const vertices = await fetchAndCacheGhost(g);
        resolved.push({
          id: g.ghost_id,
          name: g.name,
          wheelVertices: vertices,
          finishTimeMs: g.time_ms,
          seed: MATCHMAKE_SEED,
        });
      } catch {
        // Skip ghosts that fail to download
      }
    }

    if (resolved.length > 0) {
      return resolved;
    }
    return fetchBundledGhosts();
  } catch {
    return fetchBundledGhosts();
  }
}

async function fetchAndCacheGhost(g: MatchmakeGhost): Promise<Array<{ x: number; y: number }>> {
  // Try IndexedDB cache first
  const cached = await getCachedGhost(g.ghost_id);
  if (cached) {
    return decodeGhostBlobVertices(cached.blob);
  }

  // Download from presigned URL with retry
  const resp = await retryWithBackoff(
    async () => {
      const r = await fetch(g.url);
      if (!r.ok && isTransientHttp(r)) throw new Error(`ghost download failed: ${r.status}`);
      return r;
    },
    2,
    400,
  );
  if (!resp.ok) throw new Error(`ghost download failed: ${resp.status}`);
  const blob = await resp.arrayBuffer();

  // Cache it
  await putCachedGhost({
    ghost_id: g.ghost_id,
    blob,
    time_ms: g.time_ms,
    name: g.name,
    fetched_at: Date.now(),
  });

  return decodeGhostBlobVertices(blob);
}

async function fetchBundledGhosts(): Promise<GhostData[]> {
  const [g1, g2, g3] = await Promise.all([
    fetch("/ghosts/ghost-dev-001.json").then((r) => r.json()),
    fetch("/ghosts/ghost-dev-002.json").then((r) => r.json()),
    fetch("/ghosts/ghost-dev-003.json").then((r) => r.json()),
  ]);
  return [g1, g2, g3];
}

export interface SubmitInput {
  trackId: number;
  finishTimeMs: number;
  wheelVertices: Array<{ x: number; y: number }>;
  rawStrokePoints: Array<Point & { t: number }>;
}

export async function submitGhost(input: SubmitInput): Promise<string | null> {
  const apiUrl = getApiUrl();
  if (!apiUrl) return null;

  const playerUuid = getPlayerUuid();
  const blob = encodeGhostBlob({
    trackId: input.trackId,
    finishTimeMs: input.finishTimeMs,
    playerUuid,
    wheelVertices: input.wheelVertices,
    rawStrokePoints: input.rawStrokePoints,
  });

  const hmac = await computeHmac(blob);

  const resp = await retryWithBackoff(
    async () => {
      const r = await fetch(`${apiUrl}/v1/submissions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-DrawRace-Track": String(input.trackId),
          "X-DrawRace-Player": playerUuid,
          "X-DrawRace-ClientHMAC": hmac,
        },
        body: blob,
      });
      if (isTransientHttp(r)) throw new Error(`transient: ${r.status}`);
      return r;
    },
    2,
    600,
  );

  if (resp.status !== 202) return null;

  const data = await resp.json();
  return data.submission_id;
}

export async function pollVerdict(submissionId: string): Promise<SubmissionVerdict | null> {
  const apiUrl = getApiUrl();
  if (!apiUrl) return null;

  const playerUuid = getPlayerUuid();

  const resp = await fetch(`${apiUrl}/v1/submissions/${submissionId}`, {
    headers: {
      "X-DrawRace-Player": playerUuid,
    },
  });

  if (resp.status === 404) {
    return { status: "pending_validation" };
  }
  if (!resp.ok) return null;

  return resp.json();
}

export async function waitForVerdict(
  submissionId: string,
  onProgress?: (v: SubmissionVerdict) => void,
): Promise<SubmissionVerdict | null> {
  const delays = [500, 1000, 2000, 2000, 2000, 4000, 4000, 4000];
  for (const delay of delays) {
    await sleep(delay);
    const verdict = await pollVerdict(submissionId);
    if (!verdict) continue;
    onProgress?.(verdict);
    if (verdict.status !== "pending_validation") return verdict;
  }
  return { status: "pending_validation" };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function submitFeedback(
  category: "bug" | "feature" | "other",
  body: string,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  const apiUrl = getApiUrl();
  if (!apiUrl) return false;

  const playerUuid = getPlayerUuid();

  try {
    const resp = await fetch(`${apiUrl}/v1/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-DrawRace-Player": playerUuid,
      },
      body: JSON.stringify({ category, body, metadata }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export { isOnline };
