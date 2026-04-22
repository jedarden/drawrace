# Ghost/Replay Multiplayer for a Drawing-Path Racing Game

Research compiled 2026-04-21. Covers implementation patterns, data formats, storage
backends, leaderboard mechanics, ghost matchmaking, reference games, and a recommended
architecture for a static-site mobile web game.

---

## 1. How Ghost/Replay Data Is Recorded and Replayed

### What a "ghost" actually is

A ghost is a silent, collision-free playback of a previous run. The player races alongside
it but cannot interact with it physically. The ghost must reproduce the original run
faithfully enough that the time it finishes matches (or closely approximates) the recorded
finishing time.

### Two families of data to capture

**Controller/input state** — what the player did each frame:
- In a drawing-path racing game the "input" is the drawn path itself (a time-stamped
  polyline of (x, y) points) plus the velocity at each point (encoding braking/acceleration
  via drawing speed).
- For traditional steering games: throttle, brake, steering angle, gear.

**Physics/world state** — what the simulation produced:
- Position (x, y, z or x, y for 2D)
- Orientation / heading angle
- Speed / velocity vector
- Wheel rotation, suspension, slip angle (3D sims only)
- Checkpoint timestamps (for validation and interpolation anchoring)

### Sampling rate

Games typically record at 30–60 Hz. Because most inputs change slowly, delta encoding
(storing only changes from the previous sample) cuts file size dramatically. For a
drawing game the path is recorded once at draw time, so there is no per-frame recording
during playback — the path is the entire input.

### Interpolation during playback

When replaying at a different rate than recording, or when the playback update rate
differs, the engine interpolates between stored keyframes. Catmull-Rom splines work well
for smooth positional curves. Linear interpolation between compressed keyframes with
error-threshold pruning (Douglas-Peucker or iterative bisection) can cut point counts
by 60–70% with no visible degradation.

---

## 2. Deterministic vs. Recorded Replay — Tradeoffs

### Deterministic (input-only) replay

**How it works:** Record only the initial state (RNG seed, starting conditions) plus the
sequence of player inputs. At replay time, re-run the full physics simulation from scratch.
The same inputs must produce identical outputs every time.

**Advantages:**
- Extremely compact. A complete Mario Kart Wii ghost is ~2 KB of compressed input data.
- Trivially validated — the finishing time is a computed result, not a stored claim.

**Disadvantages:**
- Any non-determinism (floating-point variation across browsers, OS, CPU, physics engine
  version, timing jitter) causes divergence. Even a tiny positional error compounds into
  a completely different collision response.
- Game code changes invalidate all previously recorded ghosts. Updating physics or
  geometry breaks replays from older versions.
- Very difficult to implement correctly in JavaScript in a browser because JS engines
  do not guarantee identical float results across architectures or optimization passes.

**Verdict for a mobile web game:** High risk. Browser JS physics is rarely deterministic
across Chrome/Safari/Firefox or iOS/Android. Avoid unless the physics engine is
bit-reproducible by design.

### State-snapshot (recorded) replay

**How it works:** Store sampled positions, orientations, and speeds at regular intervals.
At replay time, interpolate between samples to drive the ghost entity.

**Advantages:**
- Immune to physics non-determinism — the ghost always follows the recorded trajectory.
- Survives game updates; old replays remain valid.
- Simpler to implement: a ghost is just an entity driven by a time-indexed position curve.

**Disadvantages:**
- Larger files than input-only. Raw, uncompressed: ~30 bytes/frame × 1800 frames (60-second
  run at 30 Hz) = 54 KB before compression. After delta + zlib compression typically
  5–15 KB.
- Does not naturally reconstruct exact physics (wheels, suspension) — only the trajectory.
  For a 2D drawing-path game this is irrelevant.

**Verdict for a mobile web game:** This is the right approach. For a drawing-path game the
entire "replay" is actually the drawn path (a compact polyline captured once) plus the
resulting time-stamped trajectory output. The snapshot sizes are very manageable.

### Hybrid approach (drawing-path specific)

Because the player draws a fixed path before the race starts, this game has a natural
third option:

1. **Store the drawn path** — the polyline of (x, y, t) points where t is the drawing
   timestamp (encodes speed at each point).
2. **Store checkpoint splits** — the times at which the car passed each checkpoint.
3. Re-run the same lightweight path-following physics at replay time to reconstruct
   the trajectory.

This is effectively deterministic replay but with a single, static "input" (the path)
rather than continuous frame-by-frame inputs. Because the physics is purely path-following
(not open-loop steering), determinism is achievable: the same path + same physics code
= same trajectory. The key requirement is that the physics step must be framerate-
independent (fixed timestep integration).

---

## 3. Storing and Serving Replay Data from a Static Site

### Data size budget

For a drawing-path race of 30–90 seconds:

| Component | Raw | Compressed (gzip/zstd) |
|---|---|---|
| Drawn path (200–500 points × 12 bytes) | 2.4–6 KB | 1–3 KB |
| Trajectory snapshots (30 Hz × 60 s × 8 bytes) | 14.4 KB | 3–6 KB |
| Metadata (player ID, time, track ID, timestamp) | < 0.5 KB | < 0.5 KB |
| **Total per ghost** | **~20 KB raw** | **~5–8 KB compressed** |

At 1000 ghost records: 5–8 MB compressed. This is trivially storable and servable.

### Option A: localStorage / IndexedDB (local-only ghosts)

- Store personal best ghosts locally. Works entirely offline with no backend.
- `localStorage`: 5–10 MB limit, synchronous (blocks main thread). Fine for < 50 ghosts.
- `IndexedDB`: async, 50 MB+ limit, stores Uint8Array directly. Preferred for larger
  collections or when storing binary-encoded ghosts.
- **Limitation:** Ghosts are device-local. No leaderboard, no social racing.
- **Use for:** personal best ghost shown immediately on retry without any network call.

### Option B: GitHub Gist as a backend (zero cost, low scale)

- Create a private Gist (JSON) that holds the leaderboard and top ghost references.
- Use the GitHub REST API (authenticated with a scoped token stored in a Cloudflare
  Worker secret) to read/write the Gist.
- **Pros:** Free forever, no infrastructure.
- **Cons:** Rate-limited (5000 req/h for authenticated calls, 60/h unauthenticated).
  Not suitable for concurrent writes — last-writer-wins with no atomic operations.
  Not viable beyond prototype scale.
- **Use for:** Early prototype / personal project only.

### Option C: Cloudflare Pages + Workers + R2 + KV (recommended free tier)

This is the strongest free-tier option for a static-site game with real-scale ghost racing.

**Components:**

| Service | Role | Free tier |
|---|---|---|
| Cloudflare Pages | Host static game assets | Unlimited requests, 500 builds/month |
| Cloudflare Workers | Leaderboard API, ghost upload/download | 100,000 req/day free |
| Cloudflare KV | Leaderboard data (top-N per track) | 100K reads/day, 1K writes/day free |
| Cloudflare R2 | Ghost replay binary blobs | 10 GB storage, 1M Class-A ops/month free, zero egress |

**Data flow:**
- Player finishes a run → client POSTs `{score, path_blob}` to a Cloudflare Worker.
- Worker validates the score (plausibility check vs. track length/time bounds).
- Worker writes ghost blob to R2 (`ghosts/{track_id}/{player_id}/{timestamp}.bin`).
- Worker updates the KV leaderboard entry for the track (top-N list with ghost R2 keys).
- Client GETs leaderboard from KV; downloads selected ghost blobs from R2 via public URL.

**Scalability:** 100K free Worker requests/day = ~1 req per second sustained, which is
more than adequate for an indie mobile web game. KV write limits (1K/day free) are the
tightest constraint — overcome by batching leaderboard writes or upgrading to paid ($5/month
unlocks 1M writes/day).

**R2 cost at scale:** 10 GB free = ~1.25 million ghost files at 8 KB each. Well beyond
any realistic indie game scale. Zero egress fees mean serving ghost blobs to players
is free regardless of traffic.

### Option D: Supabase free tier

- Full Postgres + Auth + Storage + Realtime.
- Free tier: 500 MB database, 1 GB file storage, 50,000 MAUs, 2 active projects.
- Projects **pause after 1 week of inactivity** — fatal for a game that might have gaps
  in play between updates.
- Requires more setup than Cloudflare (Row Level Security, auth flows).
- **Use if:** you want a relational schema (player profiles, social features, friends)
  and are willing to manage pausing/unpausing or pay $25/month Pro.

### Option E: Dedicated leaderboard SaaS

- **CheddaBoards** — free, open-source, built on Internet Computer, includes anti-cheat
  controls and server-side validation rules. No server maintenance.
- **Momento Leaderboards** — serverless, pay-per-use, purpose-built leaderboard APIs.
- **LootLocker / GameSparks / PlayFab** — full game backends with ghost/replay storage;
  overkill for a static site but have generous free tiers.

---

## 4. Leaderboard Mechanics for Static Sites

### Score definition for a drawing-path racing game

The primary score metric is **completion time** (lower = better). Secondary metrics can
include:
- Smoothness score (variance of velocity along the path — penalizes jerky drawings)
- Line efficiency (drawn path length vs. track minimum path length)
- Checkpoint splits (for partial ranking and ghost anchoring)

### Leaderboard structure

```
track_leaderboard:{track_id} → [
  { rank, player_id, display_name, time_ms, ghost_r2_key, submitted_at },
  ...  // top 100 entries
]
```

Store as a JSON array in KV, updated atomically by the Worker on each new submission.
Use Cloudflare Durable Objects instead of KV if you need strong consistency (prevents
two simultaneous submissions from racing and corrupting the leaderboard).

### Score validation (lightweight anti-cheat)

Without a server running the full simulation, perfect validation is impossible. Practical
mitigations:

1. **Time bounds check:** Minimum possible time for a track (based on track length ÷ max
   speed). Reject submissions faster than the physical limit.
2. **Path plausibility:** Verify the submitted path starts/ends at the correct positions
   and passes through checkpoint regions.
3. **Checkpoint consistency:** Computed splits must be monotonically increasing and sum
   to the claimed total time within a small epsilon.
4. **Rate limiting:** Workers can enforce per-IP submission rate limits via KV.
5. **Replay verification (optional):** Store the path blob; re-run the simulation server-
   side (Cloudflare Worker can run lightweight JS physics) and compare the computed time
   against the claimed time. This is the strongest approach and feasible because a
   drawing-path simulation is computationally cheap.

---

## 5. Matching Players with Appropriately-Skilled Ghosts

### The goal

The ghost should feel like a meaningful challenge — not so slow the player laps it
trivially, not so fast it's demoralizing. Research on "optimal challenge" (flow theory)
suggests a ghost 5–15% faster than the player's current personal best is ideal for
engagement.

### Approach A: Rank-tier bucketing

Divide the leaderboard into percentile bands:

| Tier | Leaderboard percentile | Ghost target |
|---|---|---|
| Beginner | 75th–100th (slowest times) | Show 60th-percentile ghost |
| Intermediate | 40th–75th | Show 30th-percentile ghost |
| Advanced | 15th–40th | Show 10th-percentile ghost |
| Elite | 0–15th | Show top-5 ghost or WR ghost |

Player tier is determined by their current personal best relative to the global
distribution for that track.

### Approach B: Personal-best relative targeting

Without requiring the player to be on the leaderboard at all:
1. Player finishes a run with time T.
2. Query: "find me a ghost whose time is between 0.85T and 0.95T" (5–15% faster).
3. KV leaderboard is pre-indexed by time; binary search for the nearest ghost in range.

This is purely time-based and requires no ELO computation. It naturally adapts as the
player improves.

### Approach C: ELO-style rating

Full ELO is overkill for ghost racing (ELO requires win/loss outcomes between specific
opponents). A simplified version:
- Assign each player a "skill score" = weighted average of their best times across
  multiple tracks, normalized against the global distribution per track.
- Match the player to ghosts within ±100 skill points.
- Update skill score after each run.

ELO is more useful if the game expands to head-to-head real-time racing. For async ghost
racing, percentile-based targeting is simpler and equally effective.

### Ghost progression curve (recommended for this game)

Because "better wheel drawings = faster runs," the ghost difficulty should scale with
drawing quality:

1. **First run:** Show the 75th-percentile ghost (deliberately easy — the ghost is a
   poor artist too).
2. **Each subsequent run:** If the player beats the current ghost, advance to the next
   percentile tier. If the player loses, stay at the same tier or regress one tier.
3. **Milestone ghosts:** At specific leaderboard positions (top 50%, top 25%, top 10%,
   top 1%), show a "named" ghost — a featured player's run — to create social moments.
4. **Personal ghost:** Always show the player's own previous-best ghost in addition to
   the leaderboard ghost, so they race both themselves and the community.

---

## 6. Reference Games That Do Ghost Racing Well

### TrackMania (Nadeo)

The gold standard for ghost racing in a competitive context.
- Ghost data stored in binary `.gbx` (GameBox) container: chunk-based, zlib-compressed,
  includes input sequence + positional samples for visual smoothness.
- Community leaderboards (trackmania.exchange) host millions of ghost files.
- Players can load any leaderboard ghost as a rival.
- Medal system (Bronze/Silver/Gold/Author) provides built-in difficulty tiers.
- **Key lesson:** Named medal ghosts give players concrete targets beyond just rank numbers.

### Mario Kart series (Nintendo)

- Wii RKG format: header + compressed input sequence (2 bytes per input: state + duration).
  Pure deterministic replay. Works because the game engine is fixed and the platform
  (Wii hardware) is deterministic.
- Staff ghosts (easy) vs. Expert Staff ghosts (very fast) provide progressive difficulty.
- **Key lesson:** Two ghost tiers per track (normal + expert) doubles the meaningful
  progression without complexity.

### DrawRace / DrawRace 2 (RedLynx)

The closest reference to this game's concept.
- Player draws a path; car follows the path, using drawing speed to control car speed.
- Ghost system: race against your own ghost (local) or global top ghosts (server-backed).
- Ghost data is essentially the drawn path + timing — compact, naturally replay-compatible
  because the "input" is a static asset.
- **Key lesson:** In a drawing-path game, the ghost IS the drawn path. Store the path,
  not a trajectory recording.

### Clustertruck (Landfall Games)

- Ghosts pulled directly from the leaderboard; you race against the top players' runs.
- Ghosts shown as translucent truck entities following recorded paths.
- **Key lesson:** Showing multiple ghosts simultaneously (top 3, your PB, a friend's
  run) is more engaging than a single ghost.

### Gran Turismo series (Polyphony Digital)

- Full physics state snapshots at high frequency, stored in replay files.
- Leaderboard ghosts selectable by any world rank position.
- **Key lesson:** Letting players choose which rank ghost to race against (e.g., "race
  the 50th-place ghost") gives agency.

---

## 7. Data Size Considerations and Compression

### Raw data for a drawing-path ghost

A drawing-path ghost has an unusual structure: the "input" (the path) is recorded once,
not per-frame. This makes it inherently compact.

**Path data:**
- 200 points (modest detail) × (2 bytes x + 2 bytes y + 4 bytes timestamp_ms) = 1,600 bytes
- 500 points (high detail) × 8 bytes = 4,000 bytes

**Trajectory output (for smooth ghost rendering):**
- 30 Hz × 60 seconds = 1,800 samples × (4 bytes x + 4 bytes y + 2 bytes angle + 2 bytes speed) = 21,600 bytes
- After delta encoding (most samples differ slightly from previous): ~30–40% of raw = 6,500–8,600 bytes
- After gzip: ~3,000–5,000 bytes

**Total per ghost (path + trajectory + metadata):**
- Uncompressed: ~26 KB worst case
- Compressed (gzip level 6): ~5–9 KB
- At zstd level 3: ~4–7 KB (faster decompression than gzip, important on mobile)

### If storing only the drawn path (hybrid approach)

If the client re-runs the physics simulation from the path at display time:
- Total ghost = path data only = **1.6–4 KB uncompressed, ~0.5–1.5 KB compressed**
- Tradeoff: client must run the physics simulation at load time (adds ~50–200ms on mobile)
- Strongly recommended for this game. The physics is simple path-following, not full
  vehicle simulation.

### Compression techniques

| Technique | Savings | Complexity |
|---|---|---|
| Delta encoding (store differences between samples) | 40–60% | Low |
| Quantization (reduce float precision to 16-bit fixed point) | 50% | Low |
| Douglas-Peucker path simplification (remove collinear points) | 60–80% on paths | Low |
| gzip / zlib | 40–70% on top of above | Trivial (built into browser) |
| zstd | 45–75%, faster decompression | Requires WASM or native module |
| MessagePack binary encoding vs JSON | 20–40% smaller than JSON | Low (npm package) |

**Recommended stack:** Delta-encode + quantize to 16-bit fixed-point → gzip. Achieves
5–8 KB per ghost with < 10 lines of implementation code.

### Storage math at scale

| Scale | Ghost count | R2 storage needed |
|---|---|---|
| 100 players, 5 tracks, top 20 each | 100 × 5 | 5 MB |
| 10,000 players, 20 tracks, top 100 each | 2,000 | 16 MB |
| 100,000 players, 50 tracks, top 200 each | 10,000 | 80 MB |

Even at 100,000 players, 80 MB is within R2's free tier (10 GB). Ghost racing is
extraordinarily storage-efficient compared to video or audio.

---

## 8. Recommended Architecture for This Game

### Design principles

1. **Path-only ghost storage** — store the drawn path polyline, not a trajectory recording.
   The client re-simulates the ghost run from the path, ensuring perfect sync with the
   live simulation.
2. **Static site + Cloudflare Workers edge API** — no always-on server, no cold starts
   on Workers.
3. **Percentile-based ghost selection** — simple, effective, requires no ELO bookkeeping.
4. **Progressive difficulty** — ghost tier advances as the player beats each level.
5. **Local-first** — personal best ghost works offline via IndexedDB, cloud ghosts
   are an enhancement.

### System diagram

```
[Browser: Static Game on CF Pages]
        |
        |--- IndexedDB (local PB ghost) ---- stored path polyline + splits
        |
        |--- CF Worker /api/leaderboard ----> CF KV (leaderboard JSON per track)
        |                                        |
        |--- CF Worker /api/ghost/upload ------> CF R2 (ghost .bin blobs)
        |
        |--- CF Worker /api/ghost/download <---- CF R2 (ghost .bin blobs)
```

### Ghost blob format (binary, ~2–4 KB per ghost)

```
Header (16 bytes):
  magic[4]       = "DRGH"
  version[1]     = 1
  track_id[2]    = uint16
  finish_time[4] = uint32 (milliseconds)
  point_count[2] = uint16
  flags[1]       = compression bitmask
  reserved[2]    = 0

Path points (8 bytes each, delta-encoded):
  dx[2]          = int16 (delta x from previous point, 1/100 px units)
  dy[2]          = int16 (delta y from previous point)
  dt[4]          = uint32 (delta time from previous point, microseconds)

Checkpoint splits (variable):
  checkpoint_count[1]
  split_time[4] × N    (milliseconds from start)
```

Total for 300-point path: 16 + (300 × 8) + (5 × 4) = 2,436 bytes raw.
After gzip: ~900–1,400 bytes.

### API surface (Cloudflare Workers)

```
GET  /api/leaderboard/{track_id}
  → { entries: [{rank, player_id, name, time_ms, ghost_key}], updated_at }

POST /api/ghost/submit
  body: { track_id, player_id, name, time_ms, ghost_blob_b64, splits[] }
  → { accepted: bool, rank: int, ghost_url: string }
  (Worker validates, uploads to R2, updates KV leaderboard)

GET  /api/ghost/{track_id}/{ghost_key}
  → redirect to R2 public URL (or stream blob directly)
```

### Ghost selection logic (client-side)

```js
function selectGhostForPlayer(leaderboard, playerPB) {
  const entries = leaderboard.entries; // sorted ascending by time_ms
  const n = entries.length;

  if (!playerPB) {
    // First run: show 75th percentile ghost
    return entries[Math.floor(n * 0.75)];
  }

  // Target: ghost that is 5–15% faster than player's PB
  const targetMin = playerPB * 0.85;
  const targetMax = playerPB * 0.95;

  // Binary search for nearest ghost in range
  const candidates = entries.filter(e =>
    e.time_ms >= targetMin && e.time_ms <= targetMax
  );

  if (candidates.length > 0) {
    // Pick the ghost closest to 10% faster
    const target = playerPB * 0.90;
    return candidates.reduce((a, b) =>
      Math.abs(a.time_ms - target) < Math.abs(b.time_ms - target) ? a : b
    );
  }

  // Fallback: nearest ghost faster than PB
  const faster = entries.filter(e => e.time_ms < playerPB);
  return faster.length > 0 ? faster[faster.length - 1] : entries[0];
}
```

### Ghost playback (client-side)

```js
class GhostRunner {
  constructor(pathPoints) {
    // pathPoints: [{x, y, t}] from ghost blob
    this.path = pathPoints;
    this.sim = new PathFollowingSimulation(pathPoints); // same sim used for live play
  }

  update(raceTimeMs) {
    // Advance simulation to raceTimeMs
    this.sim.seekTo(raceTimeMs);
    return { x: this.sim.x, y: this.sim.y, angle: this.sim.angle };
  }
}
```

Because the ghost uses the same `PathFollowingSimulation` as the live player, the ghost
is guaranteed to follow the exact same physics — no drift, no interpolation artifacts.

### Progression system

```
Track difficulty tiers (per track):
  Tier 0: No ghost (first ever attempt)
  Tier 1: 75th-percentile ghost  ("Sketchy" badge)
  Tier 2: 50th-percentile ghost  ("Decent" badge)
  Tier 3: 25th-percentile ghost  ("Sharp" badge)
  Tier 4: 10th-percentile ghost  ("Masterwork" badge)
  Tier 5: Top-5 ghost            ("Legend" badge)
  Tier 6: WR ghost               ("Ghost of Perfection" badge)

Tier advancement: Beat current ghost → advance one tier.
Tier regression: Optional (losing 3× at same tier drops one tier, to avoid frustration loops).
```

### Implementation phasing

**Phase 1 (MVP, no backend):**
- Local ghost only (IndexedDB).
- Player races their own personal best ghost.
- No leaderboard.

**Phase 2 (Cloudflare backend):**
- Deploy CF Worker + KV for leaderboard.
- Deploy R2 for ghost blob storage.
- Submit and download top-N ghosts per track.
- Ghost selection by percentile.

**Phase 3 (Social features):**
- Named player ghosts with avatars/display names.
- Friend ghosts (race a specific player's ghost by ID).
- Milestone ghosts (featured community runs).
- Daily/weekly challenge ghost (same ghost for all players globally that day).

---

## Sources

- [Developing Your Own Replay System — Game Developer](https://www.gamedeveloper.com/programming/developing-your-own-replay-system)
- [Implementing a replay system in Unity — Game Developer](https://www.gamedeveloper.com/programming/implementing-a-replay-system-in-unity-and-how-i-d-do-it-differently-next-time)
- [The story of the non-deterministic Replay — Gemserk Blog](https://blog.gemserk.com/2016/09/26/the-story-of-the-non-deterministic-replay/)
- [Unity Ghost Replay System (GitHub)](https://github.com/Kamikaze-Kiwi/Unity-Ghost-Replay-System)
- [GBX file format — Mania Tech Wiki](https://wiki.xaseco.org/wiki/GBX)
- [gbx-net library (GitHub)](https://github.com/BigBang1112/gbx-net)
- [TMInterface — Extracting inputs from replays](https://donadigo.com/tminterface/input-extraction)
- [RKG (Mario Kart File Format) — Custom Mario Kart Wiki](https://wiki.tockdom.com/wiki/RKG_(File_Format))
- [Racing Ghost — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/Main/RacingGhost)
- [DrawRace 2 — Wikipedia](https://en.wikipedia.org/wiki/DrawRace_2)
- [Snapshot Interpolation — Gaffer On Games](https://gafferongames.com/post/snapshot_interpolation/)
- [Compressing Skeletal Animation Data — Riot Games](https://technology.riotgames.com/news/compressing-skeletal-animation-data)
- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Workers KV Limits](https://developers.cloudflare.com/kv/platform/limits/)
- [Stop Using Databases for Small Static Sites — Use Cloudflare Workers + KV](https://dev.to/franklinhyriol/stop-using-databases-for-small-static-sites-use-cloudflare-workers-kv-instead-43fg)
- [Supabase Pricing 2026](https://uibakery.io/blog/supabase-pricing)
- [Free & Open-Source Leaderboard APIs for Games — LEADR](https://www.leadr.gg/blog/free-open-source-leaderboard-api-for-games)
- [Game in a Month: Serverless Leaderboards — DEV Community](https://dev.to/miketalbot/game-in-a-month-serverless-leaderboards-16pd)
- [CheddaBoards — Serverless leaderboards for web games](https://cheddaboards.com/)
- [6 Ways to Slow Down Cheaters with Server-Side Validation](https://3e8.io/2016/slowdown-cheaters-with-server-side-validation/)
- [MessagePack — msgpack.org](https://msgpack.org/index.html)
- [Data Storage — Games on the Web Roadmap (W3C)](https://w3c.github.io/web-roadmaps/games/storage.html)
- [Race Against Specific Ghosts — TrackMania plugin (GitHub)](https://github.com/malonnnn/RaceAgainstSpecificGhosts)
- [Ghosts From Leaderboard — GTPlanet Forum](https://www.gtplanet.net/forum/threads/ghosts-from-leaderboard.388384/)
- [How to Race Against Leaderboard Ghosts — TrackMania Turbo PSNProfiles](https://forum.psnprofiles.com/topic/172494-how-to-race-against-leaderboard-ghosts/)
