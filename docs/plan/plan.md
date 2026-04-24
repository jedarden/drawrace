# DrawRace — Implementation Plan

Consolidated implementation plan for DrawRace, a mobile-first wheel-drawing racing PWA. This single document supersedes the per-file split previously in `docs/plan/`.

**Contents**

1. [Overview](#overview)
2. [Gameplay & Physics](#gameplay--physics)
3. [Multiplayer & Backend Architecture](#multiplayer--backend-architecture)
4. [Graphics & User Experience](#graphics--user-experience)
5. [Automated Testing Strategy](#automated-testing-strategy)
6. [Roadmap & Delivery Plan](#roadmap--delivery-plan)

---

## Overview

### Source Material

This plan synthesizes the following inputs (kept for reference):

- `../notes/features.md` — original design doc (authoritative on scope and feel)
- `../research/draw-wheel-prior-art.md` — competitive landscape
- `../research/touch-drawing-input.md` — mobile drawing ergonomics
- `../research/ghost-replay-multiplayer.md` — async multiplayer patterns
- `../research/2d5-layout-visuals.md` — layout and visual research

### Executive Summary

**What it is.** A mobile web game where the player draws a wheel shape with their finger. The drawn polygon becomes the literal 2D physics geometry of a race car wheel. The car rolls down a side-scrolling track against 3 ghost racers (recorded runs from other players). The core loop is draw → race → result → retry; the skill ceiling is shape optimization for a given track.

**Platform.** iOS Safari 16+, Android Chrome 110+. PWA, installable, offline-playable. No native apps.

**Architecture.**
- **Frontend:** static bundle on **Cloudflare Pages**, <400KB gzipped JS, Canvas 2D rendering, Planck.js physics, Service Worker + IndexedDB for offline ghost cache.
- **Backend:** on the existing **Rackspace Spot** Kubernetes footprint (namespace on `iad-acb` or peer cluster, managed by ArgoCD from `rs-manager`). Two Deployments:
  - `drawrace-api` (Rust/axum) — HTTP edge for submissions, leaderboard, matchmaking.
  - `drawrace-validator` — re-simulates submitted ghosts against the track using the same physics WASM module the client runs, for anti-cheat and cross-version drift detection.
- **Storage:** CloudNativePG Postgres (leaderboard), Garage S3 on `ardenone-hub` (ghost blobs), Redis (hot bucket caches + validator queue).
- **CI/CD:** Argo Workflows on `iad-ci`, manifests in `jedarden/declarative-config`, images on Docker Hub (`ronaldraygun/drawrace-*`), TLS via cert-manager + Let's Encrypt, secrets via sealed-secrets. GitHub Actions remains disabled per convention.

**Multiplayer model.** Ghost replays only in v1. Real players never see each other live, but always race against 3 ghosts one rank bucket above their PB — "improvement is visible." Ghost blobs are ~1–2KB (path-only; re-simulated both client and server).

**Deterministic physics is the keystone.** The engine runs at a fixed `1/60 s` timestep with `(8, 3)` solver iterations and a seeded PRNG — identical on client, validator, and test harness. This unlocks:
- Bit-exact ghost replays without storing per-frame positions.
- Server-side replay verification (anti-cheat + cross-version drift alarm).
- Golden-file regression testing for gameplay itself (§Testing).

**Test strategy.** Nine layers; the load-bearing ones are headless deterministic physics (Layer 2) and server-side replay verification (Layer 6), both of which exploit determinism to turn "did gameplay change?" from a subjective question into a numeric one. PR CI runs in <10 minutes on Argo Workflows.

**Visual identity.** Loose hand-drawn sketch on warm paper (cream `#F4EAD5` background, warm-black ink `#2B2118`, racer red `#D94F3A`). The drawn wheel feels native to the world because the world is drawn too.

### Topology at a Glance

```
Player phone
    │
    ▼
Cloudflare Pages (static HTML/JS/WASM/assets)
    │         ┌──────────────────────────────────────────────┐
    │         │ api.drawrace.example (CNAME → cluster)       │
    ▼         ▼
Browser PWA ──► Rackspace Spot ingress (Traefik + cert-manager)
                        │
                        ▼
                drawrace-api (axum, Rust, 2+ replicas)
                ├── Redis (hot cache + validator queue)
                ├── Postgres / CloudNativePG (leaderboard)
                └── Garage S3 (ghost blobs, via Tailscale)
                        ▲
                        │ BRPOP
                drawrace-validator (1–2 replicas)
                 (loads physics WASM, re-sims submissions)

Argo Workflows on iad-ci builds images → Docker Hub →
ArgoCD on rs-manager syncs manifests from declarative-config → spot cluster
```

### Key Constraints (binding)

- **JS bundle ≤ 400KB gzipped** (initial payload). Every dependency choice is checked against this.
- **First Contentful Paint < 2s on 4G**, Snapdragon 665 class.
- **60fps target on Pixel 6 / iPhone 12**, 30fps floor on Snapdragon 665.
- **Determinism is non-negotiable.** `Math.random()` is banned in game code (lint-enforced); all time via injected clock; fixed physics timestep.
- **No K8s Jobs/CronJobs** (CLAUDE.md convention). Long-running Deployments with internal loops only.
- **No GitHub Actions** (CLAUDE.md convention). Argo Workflows only.
- **Never apply k8s manifests directly** (CLAUDE.md convention). GitOps via ArgoCD only.
- **Physics immutability by default.** Any intentional physics change bumps `PHYSICS_VERSION`, requires regenerating goldens by hand, and a matching server rollout before client ships.

### Critical Path to Launch

See [Roadmap & Delivery Plan](#roadmap--delivery-plan) for the phased plan. In short:

1. **Phase 0 (1–2 wks):** Workspace scaffolding, engine-core extracted as a pure package, determinism harness in place. This must come first — every other layer depends on it.
2. **Phase 1 (2–3 wks):** Drawing pipeline + single offline race against bundled tutorial ghosts. No backend yet. Ship to `dev.drawrace.example` (Cloudflare Pages preview).
3. **Phase 2 (2 wks):** Backend on Rackspace Spot: api + validator + storage. Submit/fetch ghosts over real HTTP. Matchmaking against seed ghosts.
4. **Phase 3 (1–2 wks):** Visual polish pass (wobble, parallax, confetti, sound), accessibility audit, perf pass on Redmi 9-class devices.
5. **Phase 4 (1 wk):** Beta with ~30 invited players to seed the leaderboard, anti-cheat dry-run, load test.
6. **Phase 5 (0.5 wk):** Public launch — Cloudflare Pages production, DNS cutover, announcement.

Total estimated wall-clock for a two-person team: **~10 weeks**.

---

## Gameplay & Physics

This section specifies the runtime behavior of DrawRace: how the game turns a finger-drawn polygon into a physics body, how that body interacts with the track, and the numerical parameters that govern the feel of a run. The goal is to give implementers enough detail to build a deterministic, performant, mobile-first draw-to-race loop without re-deriving the design from first principles.

### 1. Core Game Loop

A single attempt is a strict three-phase state machine: **Draw → Race → Result**. There is no mid-race redraw; the wheel is committed on the transition into Race. This deliberate commitment is the core skill tension of the game.

| Phase | Typical Duration | Player Input | State Held |
|---|---|---|---|
| Draw | 3–15s (median ~7s) | Single continuous stroke on canvas | Raw point array, centroid, committed polygon |
| Race | 30–45s on v1 track; DNF at 2× track-best | None (spectate) | Physics world, ghost playbacks, timer |
| Result | Until player taps Retry / Leaderboard | Tap only | Final time, rank delta, replay buffer |

Hard timing constraints:

- **Draw-to-Race handoff**: shape simplification + convex decomposition + physics body construction must complete in **< 100ms** on a Snapdragon 665. Over that budget, the transition feels laggy. If processing overruns, show the "building wheel…" animation and hide the seam.
- **Race countdown**: 3-2-1-GO. Motor is disabled until GO, but the wheel is already in the world under gravity — the car settles visually during the countdown, which doubles as a tell for wheel quality.
- **DNF timeout**: `2 × currentTrackBest`, clamped to a minimum of 90s so a slow first global time doesn't cut off slow wheels too early. **DNF runs are never submitted** — the client drops them at the `Result → submit` boundary; no ghost blob is generated, no network call is made. This keeps the binary layout in §Multiplayer 5 outcome-agnostic (no DNF flag or outcome enum is needed) and means every ghost on the server is, by construction, a real finish.
- **Result dwell**: no auto-advance. The rank delta is the dopamine; give the player time to absorb it.

### 2. Wheel-Drawing Input Pipeline

Input is captured via the Pointer Events API on a full-width square canvas (~75vw in portrait). The canvas uses `touch-action: none`, `setPointerCapture` on pointerdown, and `desynchronized: true` on the 2D context. Target sampling is whatever the device provides (60–120 Hz); we reconstruct missed samples via `getCoalescedEvents()`.

**Sampling & buffering**

- Raw points are pushed into an append-only array keyed off `pointerId`. Only the first active pointer is accepted — second-finger input is ignored (no multi-touch shapes).
- The visible stroke is rendered each rAF tick using the midpoint quadratic Bézier technique on a transparent top canvas. The committed-path canvas below is left alone until `pointerup`.
- Coordinates are stored in **CSS pixels** relative to the canvas top-left, not clientX/Y, so the pipeline is resolution-independent. We never read `offsetX`/`offsetY` during the hot path (forces layout).

**Minimum stroke length**

Total stroke travel is accumulated as Euclidean distance between consecutive raw samples. The Race button remains disabled until `totalTravel ≥ 150 CSS pixels` AND the stroke has at least 20 raw samples. This rejects accidental dots and micro-taps.

**Closure logic**

On pointerup, test distance from the last sample to the first sample. The threshold scales with the bounding-box diagonal of the stroke so that small drawings have a proportionally tighter closure requirement:

```
closureThreshold = clamp(0.15 * bboxDiagonal, 20px, 60px)
if distance(last, first) < closureThreshold:
    snap: append a copy of first as the last vertex
else:
    force-close: append a copy of first anyway, but flag isOpenLoop = true
```

We always close the polygon — an "open" stroke is still treated as a closed shape by connecting the endpoints, but `isOpenLoop = true` causes the draw preview to show a dashed closure segment so the player sees the auto-close before committing.

**Simplification (Douglas-Peucker)**

We run `simplify-js` with `highQuality: true` (pure RDP, no radial prepass). Tolerance is adaptive to the stroke's scale:

```
tolerance = clamp(0.008 * bboxDiagonal, 1.5, 5.0)  // CSS pixels
simplified = simplify(rawPoints, tolerance, /* highQuality */ true)
```

The 0.8%-of-diagonal tolerance produces 12–24 vertices for typical wheel-sized drawings. A hard vertex cap of **32** is enforced after simplification — if still over, tolerance is doubled and we re-simplify (max 3 passes). A floor of 8 vertices protects against degenerate over-simplification of tiny strokes.

**Centroid & axle placement**

The axle is the area-weighted centroid of the simplified polygon, not the bounding-box center. We then translate the polygon so the centroid sits at (0,0) in body-local coordinates. This guarantees the wheel rotates around its true center of area, which is what makes a rough-but-balanced shape feel fair while a lopsided shape wobbles.

**Pseudocode — full draw pipeline**

```
on pointerdown(e):
    canvas.setPointerCapture(e.pointerId)
    activePointerId = e.pointerId
    rawPoints = [(e.x, e.y)]
    totalTravel = 0

on pointermove(e):
    if e.pointerId != activePointerId: return
    for p in e.getCoalescedEvents() or [e]:
        prev = rawPoints[-1]
        d = hypot(p.x - prev.x, p.y - prev.y)
        if d < 1.0: continue              // dedupe sub-pixel jitter
        totalTravel += d
        rawPoints.append((p.x, p.y))
    scheduleRender()                      // coalesce into rAF

on pointerup(e):
    if totalTravel < 150 or len(rawPoints) < 20:
        reset(); return
    closed = closeLoop(rawPoints)          // appends first point, sets flag
    bbox = computeBBox(closed)
    tol = clamp(0.008 * bbox.diagonal, 1.5, 5.0)
    simplified = simplify(closed, tol, highQuality=true)
    for i in 0..2:
        if len(simplified) <= 32: break
        tol *= 2
        simplified = simplify(closed, tol, highQuality=true)
    if len(simplified) < 8:
        reject("stroke too simple"); return
    c = areaCentroid(simplified)
    bodyLocal = [(p.x - c.x, p.y - c.y) for p in simplified]
    enableRaceButton(polygon=bodyLocal, axle=(c.x, c.y))
```

### 3. Shape-to-Physics Translation

**Engine choice: Planck.js.** The features doc's leaning toward Planck is correct, and the research doc's lean toward Matter.js is a tooling-DX argument, not a fidelity one. Reasons:

- Planck exposes a real `WheelJoint` with separate spring/damping/motor semantics — Matter.js approximates wheels with a `Constraint`, which under our load of lopsided polygons produces mushy, inconsistent bounce behavior.
- Planck's fixed-timestep world stepper plus determinism guarantees (no internal RNG) are first-class. Matter has known non-determinism across builds.
- Planck's bundle is larger (~200KB vs ~87KB), but we already budget a single physics dep. The remaining 400KB JS budget absorbs it.

We pay the cost of wiring poly-decomp-es ourselves — Matter's auto-integration was the main DX argument for Matter and we lose it. Acceptable.

**Convex vs concave handling**

Planck's `b2PolygonShape` requires a **convex polygon with ≤ 8 vertices per fixture**. We always route through decomposition rather than branching on convexity — it's cheaper to decompose a trivially-convex shape (returns one piece) than to maintain two codepaths.

```
verts = ensureCCW(bodyLocal)              // poly-decomp-es makeCCW
pieces = quickDecomp(verts)               // array of convex sub-polygons
if len(pieces) > 8:                       // cap for pathological concavity
    pieces = simplifyAndRetry(verts, aggressiveTolerance)
for piece in pieces:
    if len(piece) > 8:
        piece = fanTriangulate(piece)     // split into ≤8-vertex convex pieces
    body.createFixture(PolygonShape(piece), density=1.0, friction=0.8, restitution=0.3)
```

**Vertex & fixture caps**

- Max **32 vertices** pre-decomposition (enforced during simplification above).
- Max **8 convex sub-pieces** post-decomposition. Beyond that we re-simplify with a doubled tolerance; the player gets a slightly blobbier wheel, which is a fair penalty for drawing a pathological shape.
- Max **8 vertices per piece** (Planck's hard limit); over-wide pieces get fan-triangulated into triangles, which all satisfy the cap.

**Density, mass, and inertia**

Density is constant at `1.0 kg/m²` (world units are meters; 1m = 30px, per the research doc). Mass and rotational inertia are computed by Planck from the fixture set — we do not override them. This means **drawing bigger genuinely adds mass and rotational inertia**, which is exactly the design intent (big wheels clear obstacles but accelerate slower).

The chassis is a fixed rectangle, density 2.0, mass ≈ 4× typical wheel mass, so the wheel-to-chassis mass ratio stays in a stable regime regardless of wheel size. We clamp the effective wheel radius to `[0.3m, 1.5m]` post-normalization to bound the range.

### 4. Physics Tuning Knobs

Starting values, chosen to make a near-perfect circle win but not trivially. All values are editable via a debug overlay in dev builds; production ships with the table below baked in.

| Parameter | Starting Value | Range | Rationale |
|---|---|---|---|
| `world.gravity.y` | `10.0 m/s²` | `8.0 – 12.0` | Slightly above Earth; sharpens bounce-to-settle cadence for readable gameplay |
| Fixed timestep | `1/60 s` | fixed | See §Gameplay & Physics 6 |
| Velocity iterations | `8` | `6 – 10` | Planck default; handles our lopsided contact well |
| Position iterations | `3` | `2 – 4` | Planck default |
| Wheel density | `1.0 kg/m²` | `0.5 – 2.0` | Mass scales with drawn area; baseline at 1.0 |
| Wheel friction | `0.8` | `0.5 – 1.0` | High enough to grip, low enough that angular shapes still slip satisfyingly on flats |
| Wheel restitution | `0.3` | `0.1 – 0.5` | Lopsided shapes already bounce from geometry; adding restitution compounds chaos |
| Terrain friction | `0.9` | `0.7 – 1.0` | Slightly higher than wheel so contact behavior is wheel-dominated |
| Terrain restitution | `0.0` | `0.0 – 0.1` | Ground does not bounce — all bounce comes from the wheel's angularity |
| Motor `maxTorque` | `40 N·m` | `20 – 80` | Low enough that a triangle stalls on steep ramps, high enough that a circle clears them |
| Motor `motorSpeed` | `8 rad/s` | `4 – 15` | ~76 RPM target free-spin; tuned so a 0.5m circle is near top speed on flat |
| Suspension (WheelJoint) `frequencyHz` | `4.0` | `2.0 – 8.0` | Soft-ish ride; allows the car body to pitch on ramps for visual flavor |
| Suspension `dampingRatio` | `0.7` | `0.3 – 1.0` | Slightly under-damped — one rebound on landings, then settles |
| Max wheel angular velocity | `20 rad/s` | clamp | Prevents runaway spin after a ramp launch |

The table has two "feel levers" designers should touch first if playtesting comes back wrong: **motor maxTorque** (stall vs power) and **suspension frequencyHz** (chassis pitch responsiveness). The friction and restitution values are load-bearing for shape differentiation and should move last.

### 5. Track Design Format

Tracks are static JSON assets under `/public/tracks/`. The game reads a track manifest at boot and lazy-loads the selected track. No code change is required to add a track.

```json
{
  "id": "hills-01",
  "numeric_id": 1,
  "name": "Scribble Slope",
  "version": 1,
  "world": {
    "gravity": [0.0, 10.0],
    "pixelsPerMeter": 30
  },
  "camera": {
    "followAxis": "x",
    "deadzone": [120, 80],
    "maxZoomOut": 1.0
  },
  "terrain": [
    [0.0, 0.0], [5.0, 0.0], [8.0, -0.5], [12.0, -0.5],
    [15.0, -2.0], [20.0, -2.0], [22.0, 0.0], [40.0, 0.0]
  ],
  "obstacles": [
    { "type": "box",   "pos": [18.0, -2.3], "size": [0.6, 0.6], "angle": 0.0, "friction": 0.8 },
    { "type": "circle","pos": [25.0,  0.4], "radius": 0.4, "friction": 0.6 }
  ],
  "ramps": [
    { "polyline": [[30.0, 0.0], [34.0, -2.5], [36.0, -2.5]], "friction": 0.9 }
  ],
  "start":  { "pos": [1.5, -1.5], "facing": 1 },
  "finish": { "pos": [39.0, -1.5], "width": 0.2 },
  "hazards": [
    { "type": "pit", "x_range": [26.0, 27.5], "depthMeters": 3.0 }
  ],
  "metadata": {
    "targetTimeSeconds": 35,
    "tutorialGhosts": ["ghost-dev-001", "ghost-dev-002", "ghost-dev-003"]
  }
}
```

**Rules for track authors:**

- `terrain` is a single left-to-right polyline in meters (world units). The loader builds a Planck chain shape along it. Points must be strictly increasing in X for the v1 engine (no overhangs).
- Y increases downward in screen space but we render with negative-Y-up; the authoring tool handles the flip. Y < 0 is above the start line.
- `start.pos` is where the chassis spawns; the wheel is placed beneath it at the normalized wheel radius.
- `finish.pos.x` is the trigger; crossing it right-to-left does not count.
- `obstacles`, `ramps`, and `hazards` are optional arrays. Hazard type `pit` is a trigger region that ends the race as DNF.
- Every track declares a stable `numeric_id` (uint16) assigned at track authoring time; it is the identifier used on the wire (submission header, ghost blob `track_id`, leaderboard URLs). The string `id` is a human-readable slug used for filenames and in-repo references only. Numeric IDs are never re-used.

Adding a new track is: drop a JSON file, add its id to `tracks/manifest.json`, record a handful of seed ghost replays, ship.

### 6. Deterministic Simulation

Determinism is non-negotiable for three reasons: **ghost replay re-simulation for anti-cheat verification, frame-rate-independent fairness across devices, and debuggability**.

**Fixed timestep**

Physics runs at exactly `1/60 s` regardless of display refresh rate. Rendering uses a fixed-step accumulator:

```
const DT = 1/60
let acc = 0
function frame(nowMs):
    const frameDt = min((nowMs - lastMs)/1000, 0.25)   // cap to prevent spiral of death
    acc += frameDt
    while acc >= DT:
        world.step(DT, 8, 3)                           // Planck: (dt, velIter, posIter)
        simTick += 1
        acc -= DT
    const alpha = acc / DT
    render(interpolate(prevState, currentState, alpha))
```

Interpolation is render-only; it never feeds back into the sim. On 120Hz devices we render twice per sim step, on 30Hz devices we step twice per render — the simulation never sees the display rate.

**Seeded PRNG**

All randomness routes through a single seeded PRNG (`sfc32` or `mulberry32`, ~10 lines, deterministic across JS engines). The seed for a run is derived from `hash(trackId, playerId, runIndex)`. Particle puffs, any cosmetic jitter, and any future procedural element all draw from this stream. `Math.random()` is banned in game code — a lint rule flags it.

**What this buys us:**

- **Ghost fidelity**: v1 stores **path-only** ghosts (seed + wheel polygon + drawn stroke + track_id + finish_time) and replays them by re-simulating on both client and server. The older "sampled positions at 10Hz" design is stale — determinism makes re-sim the cheaper, smaller, drift-proof default from day one.
- **Anti-cheat**: the server can re-run a submitted run at low priority and compare the produced time against the claimed time. Mismatch = rejected.
- **Bug reports**: a failed run is reproducible from `(seed, trackId, polygon)` alone.

### 7. Difficulty & Progression

**v1 ships with exactly one track.** Player skill expression is entirely in the wheel shape space, and the rank bucket matchmaking provides the progression signal. Shipping one polished track beats shipping three half-tuned ones.

**Post-v1 progression outline** (design space, not v1 work):

- **Track unlocks** gated on relative performance (not raw time): "complete the first track within 50% of track-best to unlock track 2." This keeps the gate fair for slow devices and slow players.
- **Daily challenge** seeded from the UTC date: a known track with a modifier (e.g. reduced gravity, ice terrain friction `0.1`, higher chassis mass). Daily leaderboard is separate.
- **Wheel constraints** as opt-in modifiers — these are the most game-native progression hook:
  - *Single-stroke-under-N-points*: enforce `simplified.length ≤ 10` on submission. Rewards drawing skill.
  - *Diameter-capped*: enforce bounding-box diameter ≤ Xpx pre-normalization. Rewards choosing a small wheel (low inertia, low clearance).
  - *Symmetry-scored*: compute a reflective-symmetry score on the polygon; bonus points for >0.9.
  - *Convex-only*: reject shapes where `quickDecomp` returns > 1 piece. Forces rounder drawings.
- **Cosmetic wheel trails** unlockable by total distance raced — separates "grinding" progression from "skill" progression so the daily challenge stays pure.

None of these require new physics, only new evaluators on the polygon post-simplification. That's the point of locking down shape processing now.

### 8. Edge Cases

The draw pipeline must survive everything a frustrated thumb can do. Explicit handling:

| Case | Detection | Behavior |
|---|---|---|
| Tiny stroke (dot, scratch) | `totalTravel < 150px` or `len < 20` | Race button stays disabled; silent (no error toast) |
| Self-intersecting polygon | Sweep-line intersection test after simplification | Accept: poly-decomp-es handles it; mark `hasSelfIntersection = true` for telemetry |
| Extreme concavity | `quickDecomp` returns > 8 pieces | Doubled tolerance retry; if still > 8, accept 8 pieces and drop the rest closest-to-centroid |
| Degenerate / collinear points | Polygon area < `1e-4` m² after centroid calc | Reject: show "draw a shape, not a line" hint; retain stroke so player can add to it |
| Drawing off-canvas | Pointer Events via `setPointerCapture` continue firing; we clamp coordinates to canvas bounds | Stroke continues along the clamped edge — intentional "rail" behavior, predictable |
| Player lifts and redraws (before pressing Race) | Clear button, or any new pointerdown | New pointerdown on a committed-but-not-raced canvas clears and restarts the stroke |
| Pointer cancelled mid-stroke (OS gesture, call) | `pointercancel` event | Treat exactly like pointerup but only if `totalTravel ≥ 150`; otherwise reset silently |
| Second finger mid-stroke | `e.pointerId != activePointerId` | Ignore secondary pointer completely; do not abort the primary stroke |
| Exact-duplicate consecutive points | Per-event `d < 1.0` filter | Dropped at ingest — prevents zero-length edges in decomposition |
| Polygon winding reversed | `ensureCCW` is unconditional | poly-decomp-es `makeCCW` flips if needed before decomp |
| Wheel spawns overlapping terrain | Start position asserted above terrain at track load time | If overlap detected (fixture load check), bail with dev-mode assertion; in prod, lift spawn by 0.5m |

### 9. Performance Budget

Target device is **Snapdragon 665 / Redmi 9-class** at **30fps minimum**; 60fps on Pixel 6+ / iPhone 12+. The physics step rate is 60Hz regardless — render interpolation absorbs the render-rate delta.

**Per-frame budget on Snapdragon 665 (33.3ms @ 30fps)**

| Slice | Budget | Notes |
|---|---|---|
| Physics step (1 × 1/60 @ 30fps render → 2 steps/frame) | 8 ms | 2 × 4ms steps at 8/3 iterations on an 8-fixture wheel + chassis + ~100 terrain segments |
| Canvas 2D render | 12 ms | Chassis + wheel polygon + 3 ghosts + terrain + HUD |
| Ghost re-sim (3 ghosts stepped in the same world tick as the player) | 2 ms | Each ghost is a lightweight Planck body + replayed input; no render-side LERP needed |
| Input / event loop / misc | 3 ms | |
| Headroom | 8 ms | Absorbs GC pauses and OS jitter |

**Hard caps:**

- **Physics step**: 60Hz fixed. Never dynamic. On devices where a single step exceeds 10ms we fall back to 30Hz sim + interpolation (documented in features.md as the low-end fallback).
- **Wheel vertex count**: 32 pre-decomp, 8 × 8 = 64 post-decomp, enforced in the pipeline above.
- **Terrain edge count**: 200 segments per track. v1 track uses ~100.
- **Ghost count**: 3 concurrent. Low-end-device fallback drops to 1.
- **Particle count**: capped at 40 active; disabled entirely when frame time > 25ms for 60 consecutive frames.

**Allocations**

The hot path (per-frame) allocates zero objects. Point buffers, Planck transforms, and render scratch arrays are pooled at boot. This matters on Android Chrome where GC pauses can spike to 20ms on low-end devices — one such pause turns a 33ms frame into a visible hitch.

**Bundle cost against the 400KB gzipped JS target**: Planck ~60KB gzipped, poly-decomp-es ~3KB, simplify-js ~1KB, perfect-freehand ~2KB (optional), app code ~100KB, rendering glue ~30KB — comfortable under budget.

### Physics versioning

`PHYSICS_VERSION` is the linchpin that ties the client, validator, goldens, and stored ghosts to a single numeric truth. This subsection formalizes its lifecycle so the many references to it (§Overview, §Gameplay 4 & 6, §Testing 3 & 7, §Roadmap risk register) all mean the same thing.

- **(a) Declaration.** The constant lives in `packages/engine-core/src/version.ts` exported as `export const PHYSICS_VERSION: number`. It is also baked into the compiled `engine-core.wasm` artifact — the WASM module exports a `physics_version()` function whose return value is verified against the TS constant at boot, and the artifact's content hash is derived from the bytes that include that constant. Client bundle and validator image both pin the same artifact by hash.
- **(b) On-the-wire identity.** The ghost blob's `version` byte at offset 4 (§Multiplayer 5) is a **combined format+physics version**: since v1 there is one monotonically increasing integer covering both the binary layout and the physics semantics. No separate `physics_version` field is added — the existing byte carries the full meaning. A bump to `PHYSICS_VERSION` is always a bump to the blob's `version` byte.
- **(c) Ingress rejection.** The `drawrace-api` pod reads `version` from every incoming submission and compares it against the validator's currently-deployed `PHYSICS_VERSION`. Mismatch → `409 PHYSICS_VERSION_MISMATCH` with the expected value in the body, so the client can surface "update the game" and refuse to submit.
- **(d) Historical ghosts.** Every stored ghost row carries its origin `version` in Postgres (`ghosts.physics_version SMALLINT NOT NULL CHECK (physics_version BETWEEN 0 AND 255)` — SMALLINT is the narrowest Postgres integer type that fits, and the CHECK pins the domain to the uint8 wire cap so the DB can never hold a value the blob format can't encode). After a bump, older ghosts are either (i) re-simmed lazily on first read by a validator pod running a pinned older WASM artifact loaded by hash, or (ii) tagged `is_legacy = true` and suppressed from matchmaking and leaderboards. v1 policy is (ii) — simpler, and a fresh global time table per physics version is honest to the player.
- **(e) Rollout order.** Client and validator must never disagree on `PHYSICS_VERSION` in production. The `drawrace-build` Argo workflow enforces this: the validator image is built and deployed to the api namespace first (with a readiness probe that exposes the running `physics_version()`), and the Cloudflare Pages publish step for the client bundle is gated on a check that the live validator reports the same version the client bundle was built against. If the gate fails, the Pages promote is blocked — the client never ships ahead of the server.

---

## Multiplayer & Backend Architecture

DrawRace's v1 multiplayer is asynchronous: players race ghosts — recorded playbacks of other runs — rather than live opponents. The frontend remains a static PWA on Cloudflare Pages; the backend moves off Cloudflare Workers/KV/R2 and onto the existing Rackspace Spot Kubernetes footprint (`iad-ci` / `iad-acb` class workload clusters, managed from `rs-manager`). The design below keeps the v1 scope tight while leaving a clean seam for real-time multiplayer later.

---

### 1. High-level Topology

```
                        ┌─────────────────────────────┐
                        │  Mobile Browser (PWA)       │
                        │  - Canvas 2D + Planck.js    │
                        │  - Service Worker           │
                        │  - IndexedDB ghost cache    │
                        └──────────────┬──────────────┘
                                       │ HTTPS
                ┌──────────────────────┼──────────────────────┐
                │ Cloudflare edge      │                      │
                │  - Pages (static)    │  /api/* pass-through │
                │  - CDN cache         │  (rules + WAF)       │
                │  - optional Worker   │                      │
                │    for response      │                      │
                │    transform/cache   │                      │
                └──────────────────────┼──────────────────────┘
                                       │ HTTPS (api.drawrace…)
                                       ▼
                 ┌───────────────────────────────────────────┐
                 │ Rackspace Spot cluster (iad-acb or peer)  │
                 │   Ingress (Traefik) + cert-manager LE     │
                 │            │                              │
                 │            ▼                              │
                 │   drawrace-api (axum, Rust)  ⇄ Redis       │
                 │        │        │        │               │
                 │        ▼        ▼        ▼               │
                 │ ghost-store  leaderboard  matchmaker      │
                 │ (S3 client)  (Postgres)   (Redis ZSET)    │
                 │        │        │                         │
                 │        ▼        ▼                         │
                 │   Garage S3    CloudNativePG              │
                 │ (ardenone-hub) (in-cluster, Longhorn PVC) │
                 └───────────────────────────────────────────┘
                                       ▲
                                       │ Tailscale (private)
                 ┌───────────────────────────────────────────┐
                 │ ardenone-hub Garage (S3) — backups        │
                 │ argocd-rs-manager — GitOps                │
                 │ iad-ci Argo Workflows — image builds      │
                 └───────────────────────────────────────────┘
```

The browser only ever talks to Cloudflare. A DNS record `api.drawrace.example` is CNAME'd to the Rackspace Spot cluster's public ingress (orange-cloud off so WebSockets and streaming work cleanly later), giving us TLS at both hops. Cloudflare still fronts `/` for static assets; `api.*` is a distinct hostname routed straight to the origin.

**API DNS policy (IP trust path):**
- `api.drawrace.example` is **DNS-only at Cloudflare (orange-cloud OFF)**. Requests hit Traefik on the Rackspace Spot cluster directly over the public internet; there is no Cloudflare proxy, no WAF, and no CDN on this vhost.
- Traefik therefore sees the **actual client IP as the request remote address** — no `X-Forwarded-For` unwrapping, no `CF-Connecting-IP` indirection, no trusted-proxy config needed.
- axum reads the rate-limit key from `ConnectInfo<SocketAddr>` (the TCP peer address). It **never trusts `X-Forwarded-For` / `X-Real-IP` / `CF-Connecting-IP` headers on this vhost**, because no trusted proxy is in front of it — those headers are attacker-controlled input here and are ignored.
- The static frontend `drawrace.example` remains **orange-cloud ON** for CDN + WAF; it serves only immutable static assets and does not need the real client IP.

---

### 2. Why Rackspace Spot over Cloudflare Workers

The research doc recommends Workers+KV+R2. That is correct at zero scale and wrong at the scale we already pay for.

- **Sunk cost.** `rs-manager`, `iad-ci`, ArgoCD, cert-manager, sealed-secrets, Argo Workflows, Docker Hub `ronaldraygun/*`, and the Garage S3 on `ardenone-hub` all exist. An additional namespace on a spot cluster is effectively free; a new Cloudflare account is new blast radius.
- **Cost at scale.** KV writes cap at 1k/day free, then tiered pricing; R2 Class-A ops and Workers invocations add up once the leaderboard or anti-cheat re-sim gets chatty. Spot instances are pennies per vCPU-hour, and Garage egress on the Tailscale/Hetzner side is flat.
- **Runtime.** Server-side replay validation (§Multiplayer & Backend 8) wants Rust or Go compiled once, not JS re-parsed per Worker isolate. We want the same Planck.js physics as the client, compiled to WASM and loaded into a native host — trivial on Kubernetes, painful inside Workers' 10ms CPU budget.
- **Long-lived sockets.** v2 real-time multiplayer needs WebSockets with ≥30s lifetimes, room state, and authoritative sim tick. Workers Durable Objects can do this but are a different programming model. A pod with a websocket handler keeps one programming model across v1 and v2.
- **Private networking.** The pod can reach Garage over Tailscale, ArgoCD for self-inspection, and the internal metrics collector without any public egress. No per-request secret management dance.

Tradeoff accepted: cold starts are nonzero (~1s pod boot on spot), and spot preemption happens. §Multiplayer & Backend 12 addresses this — for an async ghost-racing workload, a few seconds of unavailability is a non-event.

---

### 3. Service Decomposition

One repo, one binary, multiple logical services. Over-splitting an MVP creates more pods than problems-to-solve.

| Service | Responsibility | Shape |
|---|---|---|
| `drawrace-api` | HTTP edge: submit, leaderboard reads, ghost fetch URLs | axum handler, stateless |
| `drawrace-ghost-store` | Persist/retrieve ghost blobs in Garage S3 | library module inside api |
| `drawrace-leaderboard` | Postgres-backed ordered scores, percentile queries | library module |
| `drawrace-matchmaker` | Pick N ghosts for a player given their PB | library module; Redis ZSET for hot percentile cache |
| `drawrace-validator` | Re-sim a submitted ghost against the track, verify time | separate **Deployment** — CPU-heavy, isolated scaling |

**Language: Rust + axum.** Rationale: the physics re-sim is the hot path. Planck.js compiles cleanly to WASM, and Rust + `wasmtime` embeds the exact same compiled module the browser uses — we get bit-identical re-simulation for free. Rust also gives us tight control over allocation for the binary ghost format (§Multiplayer & Backend 5) and `sqlx` for Postgres.

Go would be the fallback if the team prefers it — we'd lose the "share the physics WASM module" trick and do a Go port of the path follower instead. Not worth it.

Two Deployments, not five:
- `drawrace-api` — 2 replicas, public, fronts everything.
- `drawrace-validator` — 1–2 replicas, internal ClusterIP, pulls submissions off a Redis list and writes verdicts back. No K8s Jobs (per convention); it's a long-running Deployment with an internal `while let Some(job) = queue.pop().await` loop. Alongside the queue worker, the validator exposes **two HTTP ports** on its pod. Port **8080** serves `GET /internal/version` (see §Multiplayer & Backend 7) — used both by the api pod's readiness-cache poll and by the `wait-validator-live` Argo step (§Multiplayer & Backend 10); this port is restricted by NetworkPolicy to pods labeled `app=drawrace-api` in the same namespace. Port **8081** serves `GET /healthz` only — a kubelet-safe handler that returns `200 {"ok": true}` (no version, no hash, no submission state) and carries the Deployment's `readinessProbe`. The 8081 handler is intentionally unrestricted because kubelet→pod readiness-probe traffic originates from the node's host network namespace, and whether NetworkPolicy is enforced on that path is CNI-dependent (Calico generally allows it, Cilium is configurable, Rackspace Spot's CNI is unspecified) — splitting the surface avoids the CNI-specific gotcha. Neither port is exposed through Traefik and neither has a public route. Both `containerPort: 8080` and `containerPort: 8081` are declared on the validator Deployment, the `readinessProbe` targets 8081, and the namespace-scoped `NetworkPolicy` (`networkpolicy.yaml` in the manifest set, §Multiplayer & Backend 10) covers only 8080.

---

### 4. Storage

| Concern | Choice | Why |
|---|---|---|
| Ghost blobs | **Garage S3 on `ardenone-hub`** via S3 API | Already exists, already backed by Storage Box, private over Tailscale, zero egress. Bucket `drawrace-ghosts`, keys `ghosts/{track_id}/{player_id}/{ghost_id}.bin`. |
| Leaderboard & player registry | **Postgres (CloudNativePG)** with Longhorn PVC | Ordered scans, `LIMIT/OFFSET` windows, percentile via `percent_rank()`, `ON CONFLICT` for PB-only retention. SQLite+Litestream was tempting but the leaderboard is the one piece that genuinely needs concurrent writes. |
| Hot leaderboard cache | **Redis** (single replica, ephemeral) | ZSET per track; sub-ms top-N and rank lookups. Populated lazily from Postgres; a cold miss is fine. |
| Job queue (validator) | **Redis list** | Same Redis; one `LPUSH drawrace:validate {submission_id}`, validator `BRPOP`s. |
| Anti-abuse state | **Redis** with TTLs | Per-IP submission counters, per-device-UUID name claim rate limits. |
| Submission inflight | **Redis** keys with TTL | `submission:<id>:inflight = "<player_uuid>"` (the owning player's UUID, not a literal sentinel) written by `POST /v1/submissions` synchronously before returning 202, TTL 60 s. Consulted by `GET /v1/submissions/{id}` **only after** the Postgres lookup misses; the poll handler MUST compare the stored UUID to the request's `X-DrawRace-Player` header and return `404` on mismatch (same enumeration-safe collapse as the Postgres-miss branch — see §Multiplayer & Backend 7 poll spec). On match the handler answers `200 {status: pending_validation}`, so any api replica still resolves correctly during the Postgres replication-lag window — eliminates the 404-race immediately after submit. The validator never deletes this key; it expires naturally. |

Why not Turso / SQLite + Litestream: the leaderboard's hot write path is ~10–100 writes/minute at real scale and `UPDATE … WHERE time_ms > NEW.time_ms` semantics read cleanly in Postgres. CloudNativePG on Longhorn with a nightly dump shipped to Garage is operationally smaller than juggling Litestream restores across spot preemption.

---

### 5. Ghost Replay Format

Per the research doc, we store **path only** — the wheel polygon plus the pre-race drawn stroke is the entire "input." The server re-simulates to produce the trajectory when validating and the client re-simulates for playback. This keeps blobs tiny and immune to trajectory drift.

Binary layout, little-endian:

```
Offset  Size  Field              Notes
------  ----  -----------------  ----------------------------------------
0       4     magic              "DRGH"
4       1     version            combined format+physics version; equals PHYSICS_VERSION since v1 (see §Gameplay — Physics versioning). The Postgres `ghosts.physics_version` column is `SMALLINT NOT NULL CHECK (physics_version BETWEEN 0 AND 255)` to match the wire cap.
5       2     track_id           uint16
7       1     flags              bit0=zstd, bit1=ephemeral (do-not-persist), other bits reserved
8       4     finish_time_ms     uint32 (re-sim must match ±tolerance)
12      8     submitted_at       int64 unix millis
20      16    player_uuid        raw 128-bit
36      1     vertex_count       uint8 (8..32 after simplification; typical 12..24)
37      ...   polygon_vertices   int16 x,y (1/100 px units) × vertex_count
...     1     point_count        uint8 (up to 255, DP-simplified)
...     ...   stroke_points      the player's DRAWING stroke (finger path used
                                  to deterministically reconstruct the wheel
                                  polygon); NOT a race trajectory.
                                  delta-encoded: int16 dx, int16 dy,
                                  uint16 dt_ms × point_count
...     1     checkpoint_count   uint8
...     ...   checkpoint_splits  uint32 ms × checkpoint_count
```

The HMAC is transmitted in the `X-DrawRace-ClientHMAC` request header at submission time and computed over the entire blob bytes (magic through checkpoint_splits, inclusive). The blob itself contains no HMAC — stored ghosts are authenticated only at ingestion, after which server-side re-simulation (Layer 3) is the sole integrity check.

Expected size for a 24-vertex polygon, 200-point stroke, 5 checkpoints: `64 + 48 + 1200 + 20 ≈ 1.3 KB` raw. After compression typically 0.8–1.1 KB. Wheel thumbnails are rendered on demand from the polygon (§Graphics 4 / 9.5 / 9.6) — no thumbnail blob is stored.

**Compression: zstd level 3.** The research doc evaluates gzip / zstd / brotli; zstd wins on decompression speed (important on mid-range Android) at similar ratios to gzip-9, and `ruzstd` / WASM `zstd-wasm` both work in-browser. We apply zstd at the storage layer, not per-field — simpler, and the HMAC is over the pre-compression bytes.

---

### 6. Matchmaking

Rank buckets are computed nightly (and lazily on write-through) from Postgres:

```sql
-- materialized view, refreshed on a 5-minute tick in drawrace-api
CREATE MATERIALIZED VIEW leaderboard_buckets AS
SELECT track_id, ghost_id, player_uuid, time_ms,
       percent_rank() OVER (PARTITION BY track_id ORDER BY time_ms ASC) AS pr
  FROM ghosts WHERE is_pb = true;
```

Bucket assignment (mirrors features.md):

| Bucket | Percentile (lower = faster) |
|---|---|
| `elite` | pr ≤ 0.01 |
| `advanced` | 0.01 < pr ≤ 0.05 |
| `skilled` | 0.05 < pr ≤ 0.20 |
| `mid` | 0.20 < pr ≤ 0.50 |
| `novice` | pr > 0.50 |

**Per-race selection** (3 ghosts):

1. Let `B_player` = player's current bucket (from their PB). New player: `B_player = novice`.
2. Target bucket `B_target` = one tier faster than `B_player`, clamped at `elite` (elite races elite).
3. Pull 3 random ghosts from `B_target` using `ORDER BY random() LIMIT 3` — or, hot path, `ZRANDMEMBER` over the pre-built Redis ZSET `lb:{track}:{bucket}`.
4. If `B_target` has < 3 ghosts, fill with the next-faster bucket. If nothing available, fall back to the **seed pool** — ~30 dev-recorded runs bundled into the `drawrace-api` image under `/seeds/track_1/` and loaded into Postgres on startup if missing.
5. Always include the player's own PB ghost as a 4th "shadow" ghost in the response — the client may choose to render it per Clustertruck lesson.

Seed ghosts keep bucket variety survivable at launch (and in the worst case, tutorial ghosts bundled in the PWA itself cover cold-start offline).

---

### 7. Leaderboard API

Base URL: `https://api.drawrace.example`. All responses JSON, ghost blobs binary.

```
POST   /v1/submissions
GET    /v1/submissions/{submission_id}  → verdict poll (202 pending / final state)
GET    /v1/leaderboard/{track_id}/top?limit=10
GET    /v1/leaderboard/{track_id}/context?player_uuid={uuid}&window=5
GET    /v1/ghosts/{ghost_id}            → 302 → presigned Garage URL
GET    /v1/matchmake/{track_id}?player_uuid={uuid}
POST   /v1/names                        → claim a display name
GET    /v1/health                       → liveness for k8s
GET    /v1/metrics                      → Prometheus scrape
```

#### Submit a run

```http
POST /v1/submissions
Content-Type: application/octet-stream
X-DrawRace-Track: 1
X-DrawRace-Player: 550e8400-e29b-41d4-a716-446655440000
X-DrawRace-ClientHMAC: 9f3c…

<ghost blob bytes, §Multiplayer & Backend 5>
```

Response: `202 Accepted`

Validation is asynchronous — clients poll `GET /v1/submissions/{id}` (below) for the verdict. The 202 body deliberately contains **no** rank, bucket, or any other derived score data — at 202 time the `finish_time_ms` is still a client claim (forgeable) and the submission may yet be rejected by re-simulation. Exposing a "preliminary" rank here would mean showing (and then retracting) a score for runs that never actually made the board.

```json
{
  "submission_id": "01HY...",
  "status": "pending_validation",
  "poll_url": "/v1/submissions/01HY..."
}
```

The client MUST NOT display any rank/bucket for this run until polling returns `status: accepted`. The Result screen (§Graphics & UX 9.5) shows the finish time locally while the rank row displays a skeleton/loading indicator until the poll succeeds; on rejection the skeleton is replaced with a short "Time not accepted" message (no score change).

##### Poll the verdict

```http
GET /v1/submissions/01HY...
X-DrawRace-Player: 550e8400-e29b-41d4-a716-446655440000
```

**Auth & ownership.** The request MUST carry `X-DrawRace-Player: <uuid>` matching the submission's owning player UUID. On mismatch the api returns `403 Forbidden`. If the submission ID is unknown to the api, it returns `404 Not Found` — the api does **not** distinguish "never existed" from "exists but belongs to another player"; both collapse to 404 so attackers cannot enumerate valid submission IDs by probing for 403s.

**404 grace window (submission-not-yet-ingested).** For the first **5 seconds** after the `POST /v1/submissions` returned 202, a `404` on the poll is expected-normal (inter-replica replication lag, pending DB write, etc.) and clients MUST retry with backoff `500 ms → 1 s → 2 s` capped at the 5 s window. After 5 s, a `404` is authoritative — the submission either never existed or does not belong to the requesting player UUID. Server-side, the api eliminates the replication-lag window via Redis: the POST handler synchronously writes `SETEX submission:<id>:inflight 60 "<player_uuid>"` (the owning player's UUID, used later by the poll handler to enforce ownership during the inflight window — see §Multiplayer & Backend 4) before returning 202.

**Poll lookup order.** The poll handler checks **Postgres first**. If a row for `{submission_id}` exists with `status IN ('accepted', 'rejected')`, the handler enforces ownership against `X-DrawRace-Player` (404 on mismatch, per the Auth & ownership rule above) and then returns that row's verdict. Otherwise, the handler checks the Redis inflight key. If the key is absent, it returns `404`. If the key is present, the handler compares its value (the owning player's UUID, written by the POST handler — see §Multiplayer & Backend 4) to the request's `X-DrawRace-Player` header: on mismatch it returns `404` (same enumeration-safe collapse as the Postgres-miss branch — attackers cannot distinguish "exists but belongs to another player" from "never existed"); on match it returns `200 {status: "pending_validation"}`. This ordering means a fast verdict is seen as soon as it lands in Postgres — the validator never needs to explicitly `DEL` the inflight key, so a validator crash between verdict-write and key-delete cannot mask a finalized submission. The inflight key only matters during the brief window between POST returning 202 and the validator picking up the job, and during any Postgres replication lag for pending rows.

The 60 s TTL is a safety floor in case the validator is temporarily unreachable or the queue is backed up; it is not the mechanism by which a completed verdict becomes visible (Postgres is). Longer pending windows — legitimately possible during validator restart, queue backpressure, or a re-enqueue — are covered by the client's 2×backoff polling (up to 5 s between polls, per the poll-cadence spec), not by extending the TTL. The key is left to expire naturally.

**Status values.**
- `pending_validation` — re-simulation not yet complete. The api returns `200 OK` with this body (not `202`; the 202 semantics belong only to the original POST). Clients should poll.
- `accepted` — final. Body includes `ghost_id`, `time_ms`, `rank`, `bucket`, `is_pb`.
- `rejected` — final. Body includes a machine-readable `reason` string (e.g. `replay_mismatch`, `physics_version_skew`, `malformed_blob`). No leaderboard row exists for this submission.

Accepted response:
```json
{
  "status": "accepted",
  "ghost_id": "g_01HYABC…",
  "time_ms": 28441,
  "rank": 46,
  "bucket": "mid",
  "is_pb": true
}
```

Rejected response:
```json
{
  "status": "rejected",
  "reason": "replay_mismatch"
}
```

**Rate limit.** Polling is capped at **60 requests/minute per player UUID**, enforced via the same Redis `INCR` + `EXPIRE` primitive used for submit/matchmake, under a new `poll` namespace (`rl:poll:<uuid>`). Over-limit responses return `429 Too Many Requests` with `Retry-After`. This budget forces clients to use a sensible backoff (the reference client uses 500 ms → 1 s → 2 s → 4 s capped at 4 s, which stays well under the limit); it is not meant to be hit in normal play.

#### Contextual window (the main leaderboard view)

```http
GET /v1/leaderboard/1/context?player_uuid=550e8400-…&window=5
```
```json
{
  "track_id": 1,
  "player_rank": 47,
  "entries": [
    {"rank": 42, "name": "spinwright",  "time_ms": 26110, "ghost_id": "g_…", "thumb_url": "…"},
    {"rank": 43, "name": "wobbles",     "time_ms": 26540, "ghost_id": "g_…"},
    {"rank": 47, "name": "you",         "time_ms": 28441, "ghost_id": "g_…", "is_self": true},
    {"rank": 52, "name": "GhostUser_3", "time_ms": 31020, "ghost_id": "g_…"}
  ]
}
```

#### Matchmake

```http
GET /v1/matchmake/1?player_uuid=550e8400-…
```
```json
{
  "track_id": 1,
  "player_bucket": "mid",
  "target_bucket": "skilled",
  "ghosts": [
    {"ghost_id": "g_…", "time_ms": 25110, "name": "spinwright",  "url": "https://…/g_…bin"},
    {"ghost_id": "g_…", "time_ms": 25480, "name": "wobbles",     "url": "https://…/g_…bin"},
    {"ghost_id": "g_…", "time_ms": 25990, "name": "ace",         "url": "https://…/g_…bin"}
  ],
  "shadow_ghost":   {"ghost_id": "g_…", "time_ms": 28441, "name": "you", "url": "…"},
  "expires_at": "2026-04-21T20:12:00Z"
}
```

`url` fields are 5-minute presigned Garage S3 URLs — the client downloads blobs directly, bypassing the api pod.

`shadow_ghost` is a **nullable, always-present field** — the key is always emitted. Its value is `null` for players with no recorded PB on the track, and an object `{ghost_id, time_ms, name, url}` otherwise. OpenAPI schema: `nullable: true`, `required: [shadow_ghost]`. This disambiguates "field-omitted vs explicit-null" for generators (which treat the two very differently) and gives clients a single branch to check (`response.shadow_ghost === null`). The client must treat `null` as "race against the 3 ghosts only" — this is the documented first-run path, not an error.

For illustration, a first-time player's matchmake response:
```json
{
  "track_id": 1,
  "player_bucket": "mid",
  "target_bucket": "skilled",
  "ghosts": [ /* 3 ghosts, same shape as above */ ],
  "shadow_ghost": null,
  "expires_at": "2026-04-21T20:12:00Z"
}
```

#### Health

`GET /v1/health` is the api's public liveness/readiness surface. It also proxies the validator's running physics version so clients (for the SW version-skew rule, §Multiplayer & Backend 14) and CI (for `wait-validator-live`, §Multiplayer & Backend 10) don't need any other endpoint to detect rollout state.

Internally the api pod polls the validator's ClusterIP endpoint `GET /internal/version` (unauthenticated, not exposed via ingress) every 10s and caches the response. The validator's endpoint returns:

```json
{
  "physics_version": 3,
  "engine_core_wasm_sha256": "ab12cd34…",
  "started_at": "2026-04-22T14:02:11Z"
}
```

`GET /v1/health` on the api then returns:

```json
{
  "api":       { "ok": true, "version": "3.a1b2c3d" },
  "validator": { "physics_version": 3, "engine_core_wasm_sha256": "ab12cd34…", "ok": true, "age_seconds": 4 }
}
```

`validator.age_seconds` is the integer seconds since the api pod last successfully polled `/internal/version`. Clients (SW version-skew rule, §Multiplayer & Backend 14) use this to disregard particularly stale values — cached entries older than 60 s are treated as unavailable regardless of `ok`. When the validator is unreachable for more than 30 s, the cached `validator` object is served with `"ok": false` and the existing `physics_version`/`engine_core_wasm_sha256` from the last successful poll (so clients don't flap into forced reloads on a blip); `age_seconds` keeps incrementing while `ok` is false.

**`GET /v1/health/ready` readiness contract.** Wired to the pod's `readinessProbe`. Two-phase behavior designed to break the cold-start deadlock between api and validator:

- **Boot grace period (first 120 s after api process start).** Returns `200` if EITHER (a) the api has successfully polled the validator at least once since startup, OR (b) the 120 s grace window has not yet elapsed. During the grace window when no successful poll has occurred yet, the api logs a WARN every 10 s (`readiness: in grace period, validator not yet reachable`) so operators see the state. This lets a fresh cluster converge — the api Service admits traffic as soon as the api pod is up, the api polls the validator on its ClusterIP, the validator becomes reachable, and `wait-validator-live` (which polls through the public ingress → api → cached validator state) starts seeing fresh responses.
- **Post-grace steady state.** Once the api has successfully polled the validator at least once, `/v1/health/ready` returns `200` on all subsequent requests **regardless of cache age or subsequent `validator.ok` flapping**. The staleness path is informational only (surfaced via `age_seconds` in `/v1/health`) and is not readiness-gating. Rationale: once the api has proven it can reach the validator, a transient validator outage should not remove api pods from the Service — `POST /v1/submissions` keeps enqueueing work into Redis, so runs are never dropped; they simply wait in the queue until the validator is back.
- **Failure mode.** If the 120 s grace elapses with zero successful polls, `/v1/health/ready` returns `503`. At this point the api pod is genuinely broken (wrong Service name, NetworkPolicy misconfiguration, validator crash-looping from the start) and should be taken out of rotation so Kubernetes can restart it or the operator can intervene.

Submissions are never gated on readiness — `POST /v1/submissions` keeps accepting and enqueueing into Redis even while `/v1/health/ready` returns 503, so a slow or restarting validator never loses user runs.

---

### 8. Anti-cheat / Submission Validation

Three layers, cheapest first:

**Layer 1 — HMAC (public anti-casual-forgery token, NOT a secret).** The PWA ships with a `CLIENT_SHARED_KEY` baked into the bundle and inlined at build time. Be honest about what this is: **any key that ships in a public JS bundle is public the moment the PWA loads** — `curl https://drawrace.example/app.js | grep` recovers it in one line. This is not a sealed-secret; it is not authentication; it is not a trust anchor. The key is stored in the repo as a normal build-time constant — the Postgres password, S3 credentials, and server-side HMAC-signing keys all remain sealed-secrets, but this one deliberately does not.

What the HMAC actually buys: it forces CURL-based spam from scripts to do one extra step (HMAC the body with a rotating key) instead of being a one-liner. That raises the floor above "trivially forged POST requests" and nothing more. Client HMACs the ghost blob (SHA-256); server rejects missing or mismatched HMACs as **malformed input (400)**, not **unauthorized (401)**.

**Key rotation.** A new `CLIENT_SHARED_KEY` is generated per frontend release and baked into that Pages build. The server accepts both the current and previous release's key for a 24h grace window so in-flight PWAs on a stale bundle keep working through a deploy. The api and the Pages build consume the key from a single `drawrace-client-key` ConfigMap:

```
drawrace-client-key ConfigMap:
  current:     <hex32>
  previous:    <hex32>
  rotated_at:  <RFC3339 timestamp>
```

The api accepts requests signed with EITHER `current` or `previous` while `now() - rotated_at < 24h`; after 24h it accepts only `current`. The `rotate-client-key` job runs only when `branch == main` AND `republish_only != true` — PR preview builds and rollback (republish) builds do NOT rotate. PR preview builds read `drawrace-client-key.current` from the ConfigMap at build time and embed it without rotating; they publish to the Pages `pr-<n>` preview slot and exercise the production api with the current public key (since the key is public anti-casual-forgery housekeeping, not a secret — see paragraph above — sharing it with previews is fine and lets PRs test against real prod state). On a genuine main-branch release, `rotate-client-key` writes `previous=<old_current>, current=<new_random_hex>, rotated_at=now()` to the ConfigMap via a single `kubectl apply`; the build then embeds the new `current` into the PWA and publishes to Pages.

**First-deploy bootstrap.** The initial `drawrace-client-key` ConfigMap shipped in `jedarden/declarative-config` is manifest-born with `current: <16-byte random hex baked at manifest-write time>`, `previous: ""`, and `rotated_at: "1970-01-01T00:00:00Z"`. ArgoCD seeds this ConfigMap at cluster install time with the bootstrap values; the first `rotate-client-key` run on main promotes the seed to `previous` and writes a fresh `current`. Because the ConfigMap is annotated with `argocd.argoproj.io/compare-options: IgnoreExtraneous` and `argocd.argoproj.io/sync-options: Replace=false` (see §Multiplayer & Backend 10 `configmap.yaml`), ArgoCD's 3-minute selfHeal loop does NOT revert the mutation — without those annotations, selfHeal would race the job and restore the seed values, breaking signature verification for every installed client. On the first main-branch build, `rotate-client-key` finds `previous == ""` (equivalently `rotated_at <= unix_epoch`) and treats this as a first-run promotion: it still performs `previous = current; current = <new_random_hex>; rotated_at = now()`. The api's verifier MUST ignore `previous` when it equals the empty string explicitly (string equality check, not HMAC-comparison against zero-length input — an HMAC over an empty key is a valid SHA-256 output that an attacker could pre-compute). Verification function:

```
fn verify_hmac(body, sig, cfg) -> bool:
    if hmac_sha256(cfg.current, body) == sig: return true
    if cfg.previous != "" and (now() - cfg.rotated_at) < 24h and
       hmac_sha256(cfg.previous, body) == sig: return true
    return false
```

**Rollback procedure:** re-trigger `drawrace-build` against the target git ref with `republish_only=true`. The step skips rotation; the old bundle is republished embedded with the CURRENT production key, so existing installed clients continue to verify. This is the standard recovery path for both intra-24h and post-24h rollbacks (post-24h rollbacks on prior schemes would permanently break older bundles; this design keeps every bundle signing-compatible with the latest rotation, because the rolled-back bundle is freshly re-baked against whatever `current` is live at rollback time).

Failure modes: (a) if a rollback is attempted by a normal (non-`republish_only`) re-run, the key would rotate again and extend (not resolve) the incident — operators must use `republish_only=true`; (b) if rotation crashes mid-way, the ConfigMap still has a consistent state because `rotate-client-key` writes atomically (single `kubectl apply` of the full manifest, not successive field patches), so no partial-update window exists where `current` is new but `previous` still holds the pre-old value.

**Where the real anti-forgery weight lives.** Layer 3 (deterministic server-side re-simulation, §Multiplayer & Backend 8 below) and the per-UUID / per-IP rate limits (Layer 2) are what actually stop forged submissions. A cheater who extracts the public key still has to produce a ghost blob whose re-sim finish tick matches the claimed time within ±2 ticks — which is exactly as hard as beating the game legitimately. Layer 1 is housekeeping; Layer 3 is the gate.

**Layer 2 — Structural checks** (synchronous, in `drawrace-api`):
- Path plausibility: polygon is closed, 8–32 vertices, all within the draw-canvas bounds.
- `finish_time_ms` ≥ floor-time-for-track (track length / max-possible-wheel-speed, computed once per track).
- Server rejects any submission with `finish_time_ms == 0` or `finish_time_ms > 2 × max(global_best_ms, 90_000)` for the submission's track_id. `global_best_ms` is the MIN of `ghosts.time_ms` for that track (cached 60s in Redis); freshly-launched tracks default to the 90s floor until the first accepted run is recorded. DNF runs should never reach the server in the first place (client drops them at the Result → submit boundary per §Gameplay 1), so a submission in this range is either a bug or a forgery.
- Checkpoint splits monotonic, in-range, sum ≈ finish time.
- Per-player-UUID submission rate limit: 20/min via Redis `INCR` + `EXPIRE`. Per-IP limits are keyed off the TCP remote address (see §Multiplayer 1 "API DNS policy"); `X-Forwarded-For` / `CF-Connecting-IP` are not trusted on the `api.*` vhost. In staging only (`DRAWRACE_ENV=staging`), an allowlist env var `DRAWRACE_RATE_LIMIT_BYPASS_CIDR` (comma-separated list of CIDRs; e.g., the k6 runner's egress) skips per-IP limits. The bypass is never read in production (`DRAWRACE_ENV=production`); the deployment manifest hardcodes `DRAWRACE_ENV` from the namespace (`drawrace` → production, `drawrace-staging` → staging).
- If `flags & 0x02` (ephemeral) is set, the submission is validated structurally (re-sim still runs for telemetry) but never persisted to Postgres or Garage; the server responds `204 No Content`. This is the storage path used by private-browsing clients (see §Graphics & UX 13 First-run identity flow).

**Layer 3 — Deterministic re-simulation** (asynchronous, in `drawrace-validator`):

The physics is path-following plus Planck.js rigid-body for the wheel. We compile `planck-js` to WASM **exactly once** — the resulting `engine-core.wasm` artifact is content-hashed and is the single source of truth for physics on both sides: the browser instantiates it via `WebAssembly.instantiateStreaming`, and the Rust validator embeds the *same bytes* via `wasmtime::Module::from_file`. No Rust `rapier2d` port, no parallel native build — one compiled module, one float-behavior surface, one content hash that gates deploys (see §Physics versioning at the end of §Gameplay). The validator:

1. Decodes the ghost blob.
2. Loads the track's terrain polyline (versioned, hashed).
3. Loads the polygon as a `b2PolygonShape` / decomposed convex set.
4. Runs a fixed-step simulation (`1/60 s` step, `8` velocity / `3` position iterations — identical to the client per §Gameplay 4 & 6) until finish line or 2× timeout.
5. Compares computed finish tick to claimed finish tick. Accept if `|serverFinishTicks − clientFinishTicks| ≤ 2 ticks` (≈33 ms at the `1/60 s` step — this is the single canonical replay tolerance, also enforced by §Testing 7). Tolerance is expressed in ticks, not milliseconds, so it stays deterministic across any future timestep change.

Divergence > tolerance → `status: rejected`, no leaderboard entry, the submission is kept for abuse analysis. A player's rejection rate exceeding 20% on a 50-run rolling window triggers shadowban (their submissions are accepted locally, never surfaced to others).

Determinism trick: the browser and validator both load the *same* compiled WASM module by content hash, so float behavior matches. If it ever drifts, we widen the gate to `≤ 15 ticks` (≈250 ms) combined with path-shape identity — the drawn polygon alone is 99% of the difficulty signal.

---

### 9. Authentication

**No accounts in v1.** Each device generates a UUIDv4 on first launch, stored in `localStorage` under `drawrace.player_uuid`. All API calls carry this UUID.

**Display names** are claim-on-first-use:

```
POST /v1/names
{ "player_uuid": "550e8400-…", "name": "spinwright" }
```

Server behavior:
- `names` table: `UNIQUE (name_lowercase)`, `UNIQUE (player_uuid)`.
- First POST with a free name wins. Subsequent POSTs from the *same* UUID can change the name once per 24h.
- Profanity filter (regex list + `rustrict` crate) applied server-side.
- Rate limit: 3 name attempts per UUID per hour, 10 per IP per hour, via Redis (per-IP limits are keyed off the TCP remote address; see §Multiplayer 1 "API DNS policy").
- Lost UUID = lost name. That's the intended cost of no-auth; users who care get an opt-in "recovery phrase" feature post-v1 (show a 4-word BIP39 chunk, let them paste on another device).

No cookies, no OAuth, no sessions. The UUID *is* the identity.

---

### 10. Deployment

Manifests live in `jedarden/declarative-config` under `k8s/iad-acb/drawrace/` (or whichever spot workload cluster we target; manifests are cluster-agnostic via kustomize overlays). ArgoCD `Application` registered on `rs-manager` (or `ardenone-manager` depending on where the drawrace cluster is registered):

```yaml
# k8s/rs-manager/applications/drawrace.yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: drawrace
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/jedarden/declarative-config
    path: k8s/iad-acb/drawrace
    targetRevision: main
  destination:
    name: iad-acb
    namespace: drawrace
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: [CreateNamespace=true]
```

Under `k8s/iad-acb/drawrace/`:
- `namespace.yaml`
- `api-deployment.yaml` (2 replicas, topologySpreadConstraints across nodes)
- `validator-deployment.yaml` (1 replica, HPA to 3 on queue depth; pod declares `containerPort: 8080` for `/internal/version` and `containerPort: 8081` for `/healthz`; `readinessProbe` is `httpGet: {path: /healthz, port: 8081}` so kubelet never traverses the NetworkPolicy-restricted port)
- `redis.yaml` (single replica, `emptyDir` — ephemeral is fine, hot cache)
- `postgres-cluster.yaml` (CloudNativePG `Cluster`, 1 instance for v1, PVC on Longhorn, `backup` block shipping base backups to Garage `drawrace-pg-backups/`)
- `configmap.yaml` — `drawrace-client-key` ConfigMap (public HMAC current+previous+rotated_at; rotated per release, never secret — see Layer 1 in §Multiplayer & Backend 8). Annotated with `argocd.argoproj.io/compare-options: IgnoreExtraneous` and `argocd.argoproj.io/sync-options: Replace=false`. The manifest ships only the shape + initial seed values; ongoing `data` mutations made by the `rotate-client-key` Argo job are NOT reverted by ArgoCD selfHeal. The annotations themselves ARE still reconciled, so dropping them from git re-enables drift detection if desired.
- `ingress.yaml` (Traefik IngressRoute, `api.drawrace.example`)
- `certificate.yaml` (cert-manager, `letsencrypt-prod` ClusterIssuer)
- `sealed-secrets.yaml` (Postgres superuser password, S3 creds, Cloudflare Pages API token)
- `servicemonitor.yaml` (Prometheus scrape)
- `networkpolicy.yaml` — two rules, namespace-scoped to `drawrace`:
  1. **Deny-all ingress** to pods matching `app=drawrace-validator` by default (empty `ingress:` list with `podSelector: matchLabels: app: drawrace-validator`).
  2. **Allow ingress to port 8080** on `drawrace-validator` pods only from pods labeled `app=drawrace-api` in the same namespace (`from.podSelector.matchLabels.app: drawrace-api`, `ports: [{port: 8080, protocol: TCP}]`). This covers the api pod's `/internal/version` readiness-cache poll. The Redis-queue path needs no ingress rule (the validator pulls from Redis; Redis itself sits on a separate Service). The `wait-validator-live` Argo step (§Multiplayer & Backend 10) polls through the public ingress → api → cached validator state, so it does NOT need direct network access to the validator and is correctly excluded by this policy.

  Port **8081** is deliberately NOT covered by this policy. 8081 carries only a kubelet-safe `/healthz` handler returning `200 {"ok": true}` (no version, no hash, no submission state) — the readiness probe path. Because kubelet→pod readiness traffic originates from the node's host network namespace and NetworkPolicy enforcement on that path is CNI-dependent (Calico generally yes, Cilium configurable, Rackspace Spot's CNI unspecified), the policy MUST NOT fence 8081. The handler's response carries no information worth restricting, so leaving 8081 open cluster-wide is safe by construction.

**CI-side RBAC** — alongside the WorkflowTemplate, `jedarden/declarative-config` also ships `k8s/iad-ci/argo-workflows/drawrace-submitter-rbac.yaml`. This file defines (a) a `ServiceAccount` named `argo-workflow-submitter` in the `argo-workflows` namespace, (b) a namespace-scoped `Role` granting verbs `create,get,list` on resource `workflows` in `apiGroup: argoproj.io`, and (c) a `RoleBinding` binding the Role to the SA. The `drawrace-build` WorkflowTemplate runs in the `argo-workflows` namespace on `iad-ci`; the `submit-drawrace-ci` step's pod assumes the `argo-workflow-submitter` SA, which has the narrow RBAC needed to create downstream Workflow resources in the same namespace. The SA lives on `iad-ci` (alongside the Argo workflow-controller) rather than in the `drawrace` namespace on `iad-acb` because the submitter pod runs wherever `drawrace-build` runs — which is `iad-ci`.

**Frontend deployment (Cloudflare Pages) — via drawrace-build's wrangler-pages step**

The `drawrace-build` WorkflowTemplate includes a `wrangler-pages` step that builds `@drawrace/web` and deploys via wrangler to Cloudflare Pages. This runs as part of the build DAG rather than delegating to the shared `website-build` template, because it needs to coordinate with `rotate-client-key` and `wait-validator-live` (see DAG ordering above).

Existing secrets already present on `iad-ci` (no action required):
- `drawrace-cloudflare` → `api-token` — Pages deploy token (scoped to Account: Cloudflare Pages:Edit only)
- `drawrace-cloudflare` → `account-id` — Cloudflare account ID
- `github-webhook-secret` → `token` — repo clone auth

Cloudflare account: `e26f015c7ba47a6ad6219385e77072b7`

**One-time bootstrap** (before first CI run):
```bash
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=e26f015c7ba47a6ad6219385e77072b7 \
  npx wrangler pages project create drawrace --production-branch=main
```
This creates the Pages project. Subsequent deploys are fully automated via the `wrangler-pages` step in `drawrace-build`.

**Argo Events sensor** — add `k8s/iad-ci/argo-events/drawrace-sensor.yml` to `jedarden/declarative-config`, modelled after the existing `website-build-sensor.yml`, pointing at the `jedarden/drawrace` GitHub webhook. On `push` to any branch, the sensor submits a `drawrace-build` Workflow with the parameters above. On `main` it deploys to production; on PR branches wrangler automatically creates a preview URL under `*.drawrace.pages.dev`.

**Build CI pipeline** — `drawrace-build` WorkflowTemplate in `jedarden/declarative-config` at `k8s/iad-ci/argo-workflows/drawrace-build.yaml`, handling the full CI pipeline: Rust lint/test, JS lint/test/size-limit, Docker builds (Kaniko), manifest promotion, client-key rotation, validator live-check, Pages deploy, and downstream CI trigger:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: drawrace-build
  namespace: argo-workflows
  labels:
    app: drawrace-build
spec:
  entrypoint: build
  serviceAccountName: argo-workflow
  arguments:
    parameters:
      - name: repo
        value: jedarden/drawrace
      - name: branch
        value: main
      - name: tag
        value: ""
      - name: republish_only
        # When "true", skip rotate-client-key, docker builds, bump-manifest,
        # and wait-validator-live; re-publish the Pages bundle at the
        # checked-out git ref with the CURRENT production ConfigMap key.
        # This is the rollback path.
        value: "false"
  volumes:
    - name: docker-config
      secret:
        secretName: docker-hub-registry
        items:
          - key: .dockerconfigjson
            path: config.json
  templates:
    # ── Top-level DAG ────────────────────────────────────────────────────────
    # DAG form (not steps:) so that pages-publish is auto-skipped when
    # wait-validator-live fails — Argo treats a skipped dep as satisfied,
    # but a failed dep propagates failure to dependents.
    - name: build
      dag:
        tasks:
          - name: checkout
            template: git-checkout

          - name: rotate-client-key
            template: rotate-client-key
            dependencies: [checkout]
            when: "'{{workflow.parameters.branch}}' == 'main' && '{{workflow.parameters.republish_only}}' != 'true'"

          - name: lint-api
            template: cargo-lint
            dependencies: [checkout]
            arguments:
              parameters:
                - name: crate
                  value: api
          - name: lint-validator
            template: cargo-lint
            dependencies: [checkout]
            arguments:
              parameters:
                - name: crate
                  value: validator
          - name: lint-js
            template: pnpm-ci-step
            dependencies: [checkout]
            arguments:
              parameters:
                - name: command
                  value: pnpm install --frozen-lockfile && pnpm lint

          - name: test-api
            template: cargo-test
            dependencies: [checkout]
            arguments:
              parameters:
                - name: crate
                  value: api
          - name: test-validator
            template: cargo-test
            dependencies: [checkout]
            arguments:
              parameters:
                - name: crate
                  value: validator
          - name: test-js
            template: pnpm-ci-step
            dependencies: [checkout]
            arguments:
              parameters:
                - name: command
                  value: pnpm install --frozen-lockfile && pnpm vitest run

          - name: size-limit
            template: pnpm-ci-step
            dependencies: [checkout]
            arguments:
              parameters:
                - name: command
                  value: pnpm install --frozen-lockfile && pnpm build && npx size-limit

          - name: build-api
            template: docker-build
            dependencies: [lint-api, test-api, test-js, lint-js]
            when: "'{{workflow.parameters.branch}}' == 'main' && '{{workflow.parameters.republish_only}}' != 'true'"
            arguments:
              parameters:
                - name: binary
                  value: drawrace-api
                - name: image
                  value: ronaldraygun/drawrace-api

          - name: build-validator
            template: docker-build
            dependencies: [lint-validator, test-validator, test-js, lint-js]
            when: "'{{workflow.parameters.branch}}' == 'main' && '{{workflow.parameters.republish_only}}' != 'true'"
            arguments:
              parameters:
                - name: binary
                  value: drawrace-validator
                - name: image
                  value: ronaldraygun/drawrace-validator

          - name: bump-manifest
            template: update-declarative-config
            dependencies: [build-api, build-validator]
            when: "'{{workflow.parameters.branch}}' == 'main' && '{{workflow.parameters.republish_only}}' != 'true'"
            arguments:
              parameters:
                - name: path
                  value: k8s/iad-acb/drawrace

          - name: read-expected-physics-version
            template: read-expected-physics-version
            dependencies: [checkout]
            when: "'{{workflow.parameters.branch}}' == 'main' && '{{workflow.parameters.republish_only}}' != 'true'"

          - name: wait-validator-live
            template: wait-validator-live
            dependencies: [bump-manifest, read-expected-physics-version]
            when: "'{{workflow.parameters.branch}}' == 'main' && '{{workflow.parameters.republish_only}}' != 'true'"
            arguments:
              parameters:
                - name: expected-physics-version
                  value: "{{tasks.read-expected-physics-version.outputs.parameters.physics_version}}"

          - name: pages-publish
            template: wrangler-pages
            dependencies: [rotate-client-key, wait-validator-live]
            arguments:
              parameters:
                - name: project
                  value: drawrace
                - name: branch
                  value: "{{workflow.parameters.branch}}"

          - name: trigger-ci
            template: submit-drawrace-ci
            dependencies: [pages-publish]
            when: "'{{workflow.parameters.branch}}' == 'main' && '{{workflow.parameters.republish_only}}' != 'true'"
            arguments:
              parameters:
                - name: preview-url
                  value: "{{tasks.pages-publish.outputs.parameters.preview-url}}"
                - name: ref
                  value: "{{workflow.parameters.branch}}"

    # ── git-checkout ─────────────────────────────────────────────────────────
    - name: git-checkout
      activeDeadlineSeconds: 300
      container:
        image: alpine/git:2.43.0
        command: [sh, -c]
        args:
          - |
            set -e
            git clone --depth 1 --branch "{{workflow.parameters.branch}}" \
              "https://x-access-token:${GH_TOKEN}@github.com/{{workflow.parameters.repo}}.git" \
              /workspace
        env:
          - name: GH_TOKEN
            valueFrom:
              secretKeyRef:
                name: github-webhook-secret
                key: token
        volumeMounts:
          - name: workspace
            mountPath: /workspace
        resources:
          requests:
            cpu: 200m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
      volumeClaimTemplates:
        - metadata:
            name: workspace
          spec:
            accessModes: [ReadWriteOnce]
            resources:
              requests:
                storage: 4Gi
      outputs:
        artifacts:
          - name: workspace
            path: /workspace

    # ── rotate-client-key ────────────────────────────────────────────────────
    # Atomically writes previous=<old_current>, current=<new_random_hex>,
    # rotated_at=now() to the drawrace-client-key ConfigMap.  Runs only on
    # main-branch, non-republish builds.  On first-run (previous == ""),
    # still promotes current -> previous; the api verifier treats empty
    # previous as "ignore".
    - name: rotate-client-key
      container:
        image: bitnami/kubectl:1.29
        command: [bash, -lc]
        args:
          - |
            set -euo pipefail
            OLD=$(kubectl -n drawrace get configmap drawrace-client-key -o jsonpath='{.data.current}')
            NEW=$(openssl rand -hex 16)
            NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
            kubectl -n drawrace apply -f - <<EOF
            apiVersion: v1
            kind: ConfigMap
            metadata:
              name: drawrace-client-key
              namespace: drawrace
            data:
              current: "$NEW"
              previous: "$OLD"
              rotated_at: "$NOW"
            EOF

    # ── read-expected-physics-version ────────────────────────────────────────
    # Extracts PHYSICS_VERSION from packages/engine-core/src/version.ts.
    # The webhook dispatcher runs before checkout, so the workflow must
    # extract the version itself.
    - name: read-expected-physics-version
      container:
        image: alpine:3.19
        command: [sh, -c]
        args:
          - |
            set -eu
            V=$(grep -oE 'PHYSICS_VERSION *= *[0-9]+' /workspace/packages/engine-core/src/version.ts | grep -oE '[0-9]+$')
            if [ -z "$V" ]; then
              echo "failed to extract PHYSICS_VERSION from packages/engine-core/src/version.ts" >&2
              exit 1
            fi
            echo -n "$V" > /tmp/physics_version
        volumeMounts:
          - name: workspace
            mountPath: /workspace
      outputs:
        parameters:
          - name: physics_version
            valueFrom: { path: /tmp/physics_version }

    # ── wait-validator-live ──────────────────────────────────────────────────
    # Polls the prod api's /v1/health until the validator reports the same
    # physics_version the client bundle was built against.  On timeout the
    # workflow fails and pages-publish never runs — the last-good client
    # stays live in production.
    - name: wait-validator-live
      inputs:
        parameters:
          - name: expected-physics-version
          - name: health-url
            value: "https://api.drawrace.ardenone.com/v1/health"
          - name: timeout-seconds
            value: "1200"
          - name: poll-interval-seconds
            value: "10"
      container:
        image: curlimages/curl:latest
        command: [sh, -c]
        args:
          - |
            set -euo pipefail
            want="{{inputs.parameters.expected-physics-version}}"
            url="{{inputs.parameters.health-url}}"
            deadline=$(( $(date +%s) + {{inputs.parameters.timeout-seconds}} ))
            until [ "$(curl -sf "$url" | jq -r '.validator.physics_version // empty')" = "$want" ]; do
              if [ "$(date +%s)" -ge "$deadline" ]; then
                echo "timeout: validator never reported physics_version=$want"
                curl -sf "$url" | jq . || true
                exit 1
              fi
              sleep {{inputs.parameters.poll-interval-seconds}}
            done
            echo "validator live at physics_version=$want"

    # ── wrangler-pages ───────────────────────────────────────────────────────
    - name: wrangler-pages
      inputs:
        parameters:
          - name: project
          - name: branch
      container:
        image: node:20-alpine
        command: [sh, -c]
        args:
          - |
            set -euo pipefail
            apk add --no-cache git
            npm install -g pnpm@10 wrangler
            cd /workspace
            pnpm install --frozen-lockfile
            pnpm --filter @drawrace/web build
            URL=$(wrangler pages deploy apps/web/dist \
                    --project-name={{inputs.parameters.project}} \
                    --branch={{inputs.parameters.branch}} \
                  | tee /dev/stderr \
                  | grep -Eo 'https://[^ ]+\.pages\.dev' \
                  | tail -n1)
            echo -n "$URL" > /tmp/preview_url
        env:
          - name: CLOUDFLARE_API_TOKEN
            valueFrom:
              secretKeyRef:
                name: drawrace-cloudflare
                key: api-token
          - name: CLOUDFLARE_ACCOUNT_ID
            valueFrom:
              secretKeyRef:
                name: drawrace-cloudflare
                key: account-id
        volumeMounts:
          - name: workspace
            mountPath: /workspace
      outputs:
        parameters:
          - name: preview-url
            valueFrom: { path: /tmp/preview_url }

    # ── submit-drawrace-ci ───────────────────────────────────────────────────
    # Submits a drawrace-ci Workflow via `argo submit --from workflowtemplate/…`
    # so the child workflow inherits the template's full DAG. The preview-url
    # is passed as a top-level workflow parameter.
    - name: submit-drawrace-ci
      inputs:
        parameters:
          - name: preview-url
          - name: ref
      serviceAccountName: argo-workflow-submitter
      container:
        image: ghcr.io/drawrace/ci-snap:2026-04-21
        command: [bash, -lc]
        args:
          - |
            set -euo pipefail
            argo submit \
              --from workflowtemplate/drawrace-ci \
              -n argo-workflows \
              --parameter preview-url="{{inputs.parameters.preview-url}}" \
              --parameter ref="{{inputs.parameters.ref}}" \
              --parameter mode=release \
              --wait=false

    # ── update-declarative-config ────────────────────────────────────────────
    - name: update-declarative-config
      inputs:
        parameters:
          - name: path
      container:
        image: alpine/git:2.43.0
        command: [sh, -c]
        args:
          - |
            set -ex
            git clone --depth 1 "https://x-access-token:${GH_TOKEN}@github.com/jedarden/declarative-config" /tmp/dc
            cd /tmp/dc
            # Update image tags in the declarative-config path
            echo "ronaldraygun/drawrace-api:latest" > {{inputs.parameters.path}}/images.txt
            echo "ronaldraygun/drawrace-validator:latest" >> {{inputs.parameters.path}}/images.txt
            git config user.name "DrawRace CI"
            git config user.email "ci@drawrace.ardenone.com"
            git add {{inputs.parameters.path}}/images.txt
            git diff --cached --quiet || git commit -m "drawrace: update images"
            git push
        env:
          - name: GH_TOKEN
            valueFrom:
              secretKeyRef:
                name: github-webhook-secret
                key: token

    # ── cargo-lint ───────────────────────────────────────────────────────────
    - name: cargo-lint
      inputs:
        parameters:
          - name: crate
      activeDeadlineSeconds: 600
      container:
        image: rust:1.85-slim
        command: [bash, -c]
        args:
          - |
            set -e
            apt-get update -qq && apt-get install -y -qq pkg-config libssl-dev >/dev/null 2>&1
            cd /workspace/crates/{{inputs.parameters.crate}}
            cargo fmt --all -- --check
            cargo clippy --all-targets -- -D warnings
        volumeMounts:
          - name: workspace
            mountPath: /workspace
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi

    # ── cargo-test ───────────────────────────────────────────────────────────
    - name: cargo-test
      inputs:
        parameters:
          - name: crate
      activeDeadlineSeconds: 600
      container:
        image: rust:1.85-slim
        command: [bash, -c]
        args:
          - |
            set -e
            apt-get update -qq && apt-get install -y -qq pkg-config libssl-dev >/dev/null 2>&1
            cd /workspace
            export CARGO_TARGET_DIR=/workspace/target-test
            cargo test -p drawrace-{{inputs.parameters.crate}}
        volumeMounts:
          - name: workspace
            mountPath: /workspace
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi

    # ── pnpm-ci-step ─────────────────────────────────────────────────────────
    - name: pnpm-ci-step
      inputs:
        parameters:
          - name: command
      activeDeadlineSeconds: 600
      container:
        image: node:20-alpine
        command: [sh, -c]
        args:
          - |
            set -e
            corepack enable
            cd /workspace
            {{inputs.parameters.command}}
        volumeMounts:
          - name: workspace
            mountPath: /workspace
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi

    # ── docker-build (Kaniko) ────────────────────────────────────────────────
    - name: docker-build
      inputs:
        parameters:
          - name: binary
          - name: image
      retryStrategy:
        limit: "2"
        retryPolicy: OnError
        backoff:
          duration: 30s
          factor: "2"
      activeDeadlineSeconds: 1800
      container:
        image: gcr.io/kaniko-project/executor:latest
        args:
          - --context=git://github.com/{{workflow.parameters.repo}}.git#refs/heads/{{workflow.parameters.branch}}
          - --dockerfile=Dockerfile.{{inputs.parameters.binary}}
          - --destination={{inputs.parameters.image}}:latest
          - --cache=true
          - --cache-repo=ronaldraygun/cache
          - --snapshot-mode=redo
          - --use-new-run=true
        env:
          - name: GIT_TOKEN
            valueFrom:
              secretKeyRef:
                name: github-webhook-secret
                key: token
        volumeMounts:
          - name: docker-config
            mountPath: /kaniko/.docker
        resources:
          requests:
            cpu: 1000m
            memory: 2Gi
          limits:
            cpu: 4000m
            memory: 4Gi
```
Triggered by a webhook from the drawrace repo (existing pattern). GitHub Actions stays off, per convention. The webhook passes `branch=main` on push-to-main and `branch=pr-<number>` on PR synchronize events, plus `republish_only=true` when an operator triggers a rollback re-publish.

- **PR preview builds** (`branch == pr-<n>`): only `checkout`, lint/test/size-limit, and `pages-publish` (to preview slot `pr-<n>`) execute. The `when:` gates on `rotate-client-key`, `build-api`, `build-validator`, `bump-manifest`, `wait-validator-live`, and `trigger-ci` suppress rotation, image pushes, manifest promotion, the live-version check, and the post-publish CI kick-off. PR previews read the production ConfigMap's `current` at `pages-publish` build time and embed it unmodified; they never mutate production state. PR CI runs independently of `drawrace-build` — triggered directly by the PR webhook — with its `preview-url` parameter left empty (phone-smoke skips when `preview-url == ""`).
- **Main-branch releases** (`branch == main && republish_only == false`): every DAG node runs. Lint and test gates run first; `rotate-client-key` advances the ConfigMap; `build-api` and `build-validator` produce Docker images (Kaniko); `bump-manifest` updates declarative-config; `wait-validator-live` blocks until ArgoCD has synced the validator Deployment and its `/internal/version` endpoint reports the freshly built `physics_version` (see §Multiplayer & Backend 3 and 7 for the endpoint contracts); `pages-publish` only then ships the client bundle; `trigger-ci` submits a `drawrace-ci` Workflow against the fresh preview URL so the phone-smoke step runs on the live production bundle.
- **Rollback republish** (`branch == main && republish_only == true`): `rotate-client-key`, `build-api`, `build-validator`, `bump-manifest`, `wait-validator-live`, and `trigger-ci` are skipped. `pages-publish` runs against the checked-out git ref, reading the current (un-rotated) ConfigMap key and re-publishing the old bundle. Existing installed clients keep verifying because the live `current` hasn't changed. The phone-smoke pass is not re-run because the re-published bundle is byte-identical to a prior main-branch release that already passed CI.

**Ordering promise.** Because the top-level template is a DAG (not a sequential `steps:` list), Argo's dependency-resolution skips a task whose dependency failed. If `wait-validator-live` times out on a main-branch release, the workflow is marked Failed and `pages-publish` does not execute — the prior Pages production build remains live. Operators drain the validator deployment issue first, then re-trigger `drawrace-build` (with `republish_only=false` to retry the full rollout, or `republish_only=true` to revert to a known-good ref while the validator is fixed).

The `preview-url` output of `pages-publish` is consumed by `drawrace-ci` (§Testing 11) for the phone-smoke step. The wiring is: `pages-publish` emits `outputs.parameters.preview-url`; `trigger-ci` reads that output and submits a fresh `drawrace-ci` Workflow via `argo submit --from workflowtemplate/drawrace-ci --parameter preview-url=<url>`, which the child workflow receives as its top-level `preview-url` parameter and forwards into `phone-smoke`'s `cmd`. Argo DAGs cannot reference a sibling workflow's outputs through `{{tasks.*}}`, so the parent-submits-child pattern is load-bearing — not cosmetic.

---

### 10a. Cloudflare Pages Bootstrap (one-time setup)

> **Current state (as of Phase 1 completion):** `apps/web/dist/` is built and passing all tests locally. No Cloudflare Pages project exists yet. This section is the authoritative checklist to stand it up before the CI pipeline is wired in Phase 2.

#### Prerequisites

- `CLOUDFLARE_API_TOKEN` in the environment — scoped to **Account: Cloudflare Pages:Edit** only (no DNS, no Workers, no zone access). Store as a sealed-secret in `declarative-config` for CI use; set locally via `.env` or shell export for the one-time bootstrap commands below.
- `wrangler` available — already a dev-dependency via the monorepo (`npx wrangler`).

#### Step 1 — Add `wrangler.toml` to `apps/web/`

```toml
# apps/web/wrangler.toml
name = "drawrace"
compatibility_date = "2024-09-23"
pages_build_output_dir = "dist"
```

No Workers, no KV bindings, no D1 — the frontend is purely static. The `pages_build_output_dir` tells wrangler where Vite writes its output.

#### Step 2 — Add a deploy script to `apps/web/package.json`

```json
"scripts": {
  "deploy": "wrangler pages deploy dist/ --project-name=drawrace --branch=main",
  "deploy:preview": "wrangler pages deploy dist/ --project-name=drawrace"
}
```

`deploy` targets the production branch; `deploy:preview` lets wrangler auto-assign a preview URL (used by CI for PR branches).

#### Step 3 — Create the Pages project (one-time, manual)

```bash
export CLOUDFLARE_API_TOKEN=<token>
cd apps/web
npx wrangler pages project create drawrace --production-branch=main
```

This registers the project in Cloudflare. Subsequent deploys push to it via the token.

#### Step 4 — First manual deploy (Phase 1 handoff)

```bash
# From repo root — build then deploy
pnpm --filter apps/web run build
cd apps/web
npx wrangler pages deploy dist/ --project-name=drawrace --branch=main
```

This gets the Phase 1 MVP live immediately, before the Argo CI pipeline exists. The URL will be `drawrace.pages.dev` (or a custom domain once DNS is configured).

#### Step 5 — Custom domain (Phase 4+)

Once a domain is chosen (e.g. `drawrace.jedarden.com` or `drawrace.gg`):

1. Add the domain in the Cloudflare Pages dashboard under the project's **Custom Domains** tab.
2. Cloudflare handles the TLS certificate automatically.
3. Update the `api.*` CNAME in the same zone to point at the Rackspace Spot ingress (orange-cloud OFF — see §Multiplayer & Backend 1).

#### Step 6 — Wire into CI (Phase 2)

Once the `CLOUDFLARE_API_TOKEN` sealed-secret is committed to `declarative-config` and the `drawrace-build` WorkflowTemplate is in place, the manual deploy steps above are replaced by the `wrangler-pages` template step in the Argo DAG (§Multiplayer & Backend 10). The sealed-secret mounts the token as `CLOUDFLARE_API_TOKEN` in the `ci-wrangler` pod's environment. From that point, every push to `main` triggers a full CI pipeline deploy and manual deploys are no longer needed.

#### Environment variable summary

| Variable | Where set | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Local shell (bootstrap); sealed-secret (CI) | Authenticates wrangler for deploys |
| `DRAWRACE_API_URL` | Vite build env (`VITE_API_URL`) | Points the frontend at the correct backend host per environment |

The `VITE_API_URL` is baked at build time by Vite (only `VITE_`-prefixed vars are embedded). PR preview builds use a staging api URL; main-branch builds use the production api URL. Set these as **Pages environment variables** in the Cloudflare dashboard (Settings → Environment variables), not in `wrangler.toml` — keeping them out of source control.

---

### 11. Observability

- **Metrics** — axum `/metrics` endpoint via `metrics-exporter-prometheus`. Standard histograms: `drawrace_http_request_duration_seconds{route,method,status}`, `drawrace_validator_resim_duration_seconds`, `drawrace_submissions_total{outcome}`, `drawrace_ghost_blob_bytes`, `drawrace_matchmake_bucket_miss_total`. Scraped by whatever Prometheus stack the cluster runs (kube-prometheus-stack convention).
- **Logs** — `tracing` + `tracing-subscriber` with JSON formatter to stdout. Fields: `ts, level, target, span, player_uuid, submission_id, track_id, duration_ms`. Collected by the cluster's existing log shipper (Loki/Grafana on `ardenone-manager` or equivalent).
- **Traces** — OpenTelemetry via `tracing-opentelemetry`, exporting OTLP/gRPC to the cluster's collector if one exists; otherwise off by default with a single env-var flip to enable. Span on each HTTP handler, child span on Postgres query, child span on S3 put/get, child span on validator re-sim step.
- **Dashboards** — one Grafana dashboard pinned to the drawrace folder: submission rate, rejection rate, validator queue depth, p95 re-sim duration, leaderboard read QPS, ghost blob storage growth.
- **Alerts** — rejection rate > 10% over 10 min, validator queue depth > 100 for > 5 min, `api` pod unavailable for > 2 min, Postgres connection failures.

---

### 12. Scaling & Cost on Spot

Rackspace Spot preempts with ~90s notice. For this workload that's fine:

- **`drawrace-api`**: 2 replicas minimum, `podAntiAffinity: requiredDuringScheduling` on hostname, `topologySpreadConstraints` across zones. HPA on CPU (target 60%) scales 2 → 8. Stateless — preemption = kill, reschedule, done. `terminationGracePeriodSeconds: 30` + a `preStop` hook that sets readiness=false and drains inflight requests.
- **`drawrace-validator`**: single replica is acceptable; the queue smooths out preemption. Submissions sit in Redis for minutes without user impact — the client treats validation as async and polls once or twice.
- **Redis**: ephemeral. Preemption = cold cache, re-warmed from Postgres within seconds. If cold misses become a problem, switch to a 2-replica Sentinel setup, still cheap.
- **Postgres (CloudNativePG)**: the one stateful piece. Longhorn PVC with 3 replicas across spot nodes survives single-node preemption. Nightly logical dump + WAL archiving to Garage gives a worst-case RPO of ~5 minutes for data we'd mostly be fine losing.
- **Garage S3**: lives on `ardenone-hub` (non-spot VPS). Ghost blobs are safe regardless of spot preemption.

Cost back-of-envelope: 2× `api` @ 200m CPU / 256Mi, 1× validator @ 500m / 512Mi, 1× redis @ 100m / 128Mi, 1× Postgres @ 500m / 1Gi. Total ~1.5 vCPU / 2Gi. Fits in a single spot node with headroom; on a typical Rackspace Spot bid this is single-digit dollars per month.

Why spot is fine here: DrawRace has no real-time users-waiting-for-a-packet SLA. A submission that takes 10 seconds instead of 200ms is still instantaneous from a player's "watch the result screen" perspective. The PWA caches the last ghost set in IndexedDB — a full backend outage degrades to "play against your cached ghosts for a few minutes," which is exactly the offline mode we already ship.

---

### 13. Future Real-time Multiplayer Path

The architecture is already most of the way there:

1. **Add `drawrace-live`** — a new Deployment, axum + `tokio-tungstenite`, handling WebSocket connections. Shares the same binary crate as `drawrace-api` for auth, names, leaderboard reads.
2. **Sticky sessions via rooms, not LB.** Each race is a room keyed by `race_id`. A lightweight router (Redis `HSET race:{id} pod {pod_ip}`) pins a room to one pod. Clients reconnect to the same pod via a `race_url` the matchmaker hands them. No cookie-based sticky LB required; the room-to-pod map is explicit state.
3. **Authoritative sim.** The pod runs the same WASM physics module the client uses, at 30 Hz fixed step. Each tick: pod receives client wheel-polygon submissions during the draw phase; at GO, pod runs the master simulation; each tick broadcasts `{racer_id, x, y, angle, t}` for 2–8 racers in the room. ~200 bytes per racer per tick × 30 Hz × 8 racers = ~50 KB/s per room — trivial.
4. **State sync rate: 20–30 Hz** with client-side interpolation between received snapshots (same rendering path the ghost system already uses — a live opponent is a ghost whose path is being streamed).
5. **Reconnect semantics.** Rooms persist in Redis for 15s after disconnect; clients can reconnect with their `player_uuid` and resume.
6. **Matchmaking upgrade.** The existing matchmaker gains a "live" mode: instead of returning 3 ghosts, it returns a `race_url` and puts the player in a waiting pool partitioned by bucket. After a timeout (say 8s), fill empty slots with ghosts from the same bucket — so the lobby never stalls. The same bucket taxonomy used by ghost matchmaking carries over unchanged.
7. **Spot caveat.** Live racing is the one piece that cares about preemption. Mitigation: longer grace period (60s), drain open rooms before terminating, and for real scale we pin `drawrace-live` to an on-demand node pool while keeping everything else on spot. That's a scheduling change, not an architecture change.

The v1 ghost system thus becomes the v2 "AI opponents / backfill" system, the binary replay format doubles as a live snapshot frame, and the physics WASM module that validates submissions is the same module that arbitrates live races. Nothing in v1 needs to be thrown away to support v2.

---

### 14. Service Worker & offline cache

The PWA calls itself "offline-playable" (§Overview) and §Testing 5 Layer 4 exercises `offline mid-race falls back to cached ghosts`. This subsection pins down exactly what's cached, how the SW updates, and what lives in IndexedDB.

**`BUILD_ID` definition.** `BUILD_ID = {PHYSICS_VERSION}.{git_short_sha}` (e.g. `3.a1b2c3d`), injected into the bundle at build time by the `pages-publish` step. The leading integer is the `PHYSICS_VERSION` constant from `packages/engine-core/src/version.ts` (source of truth: §Gameplay & Physics — Physics versioning); the trailing segment is the 7-char short SHA of the build commit. UI-only or backend-only changes bump **only** the `git_short_sha` half, so the SW gets a clean cache-bust without dragging physics semantics along; intentional physics changes bump the integer. Two invariants follow: (a) a `BUILD_ID` change *alone* never forces a mid-race reload — that's reserved for `PHYSICS_VERSION` mismatches against the live validator, so physics-safe UI rollouts don't interrupt players; (b) the `engine-core.wasm` content hash is a function of `PHYSICS_VERSION` plus compilation inputs only, so UI-only `BUILD_ID` bumps leave the WASM artifact's hash (and therefore the matching validator image digest) untouched.

**SW strategy per route:**
- `/` and app shell (HTML / JS / WASM / CSS / fonts / sprite atlas): `CacheFirst` against a versioned cache name `drawrace-shell-v{BUILD_ID}`. On `activate`, any cache whose name doesn't match the current `BUILD_ID` is pruned.
- `/api/v1/matchmake/*`: `NetworkFirst` with a 3s timeout; on timeout or offline, falls back to the last-good cached matchmake response for that track.
- `/ghosts/<id>.bin` (Garage presigned URL or api proxy): `CacheFirst`, treated as immutable — ghost blobs are content-addressed and never mutate, so they're kept in CacheStorage keyed by `ghost_id` with no revalidation.
- `/api/v1/submissions` and `/api/v1/leaderboard/*`: bypass the SW entirely (`fetch` passes straight to network); always live, never cached.

**IndexedDB schema.** One database `drawrace` at version 1, three object stores:
- `ghosts` (keyPath `ghost_id`): blob bytes + metadata + `fetched_at`. LRU-evicted when total size > 20 MB (≈10k ghosts at 2 KB each per §Multiplayer 5).
- `runs` (keyPath `run_id`): pending submissions that failed to upload (offline at race time). Flushed opportunistically when the SW detects reconnection via the Background Sync API where supported, and on the next foreground load everywhere else.
- `meta` (keyPath `k`): single-row settings — `player_uuid`, last-known matchmake target, audio toggle, haptics toggle, and similar small state.

**Update strategy.** `skipWaiting: false`. A new SW installs in the background and takes over on the **next navigation**, never mid-race. This prevents a half-loaded bundle replacing the running one while the player is drawing or racing.

**Version skew rule.** The SW forces a reload on next navigation **only** when ALL of the following hold: (a) the cached `/v1/health` response reports `validator.ok == true`; (b) the cached `validator.physics_version` differs from the client's `PHYSICS_VERSION`; (c) the mismatch has persisted across at least **two consecutive health polls spaced ≥15 s apart** (debounce — in practice: two consecutive polls on the 30 s cadence, so ~30 s apart; faster intervals are allowed during foreground-resume backfill). The SW polls `/v1/health` every **30 seconds** while the document is foregrounded; polling is suspended (and the last response ignored) while the tab is backgrounded. On foreground resume, the SW issues a fresh poll immediately and waits for the next 30 s tick before the second confirming poll — so a version skew is detected in 30–45 s typical / 60 s worst case. The `age_seconds > 60` threshold guards against the api's 30 s cache compounding with a missed tick: a skew observed only via a cache entry older than a full poll cycle is not trusted. If `validator.ok == false`, the SW **defers the decision** — it keeps running the current bundle and retries the poll in 30 s (a restarting validator briefly serving `ok: false` with a stale cached version, per §Multiplayer & Backend 7, must not cause spurious reloads). If `validator.age_seconds > 60`, the SW treats the cached value as unavailable (same path as `ok: false`). This is the backstop for the rollout ordering spec — a client on a stale physics bundle can't submit runs that will fail re-sim — but it is deliberately conservative: false-positive reloads mid-session are worse than a delayed one.

**Offline play.** With a cold IDB, the PWA still ships with **3 bundled tutorial ghosts** as static assets (per §Roadmap Phase 1), so the first-ever race works without network. The first online race populates IDB from `/v1/matchmake`; from that point, the player can race against the last-fetched ghost set indefinitely without network.

**Test hook.** `warmCache(page)` — referenced by §Testing 5 Layer 4 — navigates the page, awaits `navigator.serviceWorker.ready`, issues one `/v1/matchmake` call and downloads the three ghost blobs it returns, then returns. Subsequent `page.goto()` under `context.setOffline(true)` hits the warmed shell + matchmake + ghost caches. The helper's contract is defined alongside `drawShape` in §Testing 5.

---

## Graphics & User Experience

### 1. Art Direction

DrawRace commits fully to a **loose, hand-sketched aesthetic on warm paper**. Everything on screen — wheel, car, terrain, HUD chrome — looks like it was drawn with a felt-tip pen on a sheet of cream-colored sketchbook paper. This reads as charming (not unfinished) and, critically, it makes the player's drawn wheel feel *native* to the world rather than a foreign geometric object pasted onto a polished racer.

Design rules that fall out of this choice:
- **Ink over color.** Every shape has a bold dark outline. Fills are secondary.
- **No gradients on gameplay objects.** Only the sky gets a soft gradient.
- **Slight imperfection on every line.** Strokes are 2–3px with ±0.5px width jitter, `lineCap: 'round'`, `lineJoin: 'round'`.
- **Cream page, never pure white.** Pure white flares on OLED phones and kills the paper feel instantly.

#### Palette

```
PRIMARY (ink)         #2B2118   near-black, warm brown-black — feels like fountain-pen ink, not CSS black
BACKGROUND (paper)    #F4EAD5   warm cream — the "page" the whole world lives on
                                chosen high enough L* to feel like paper, low enough chroma to not glow
SURFACE (panel)       #FBF4E3   lighter cream for UI cards / result panels; sits on the page
----------------------------------------------------------------------------------------------
ACCENT 1 (racer red)  #D94F3A   player wheel default fill + "Race!" CTA
                                warm red pops against cream without vibrating; high contrast with ink
ACCENT 2 (sky blue)   #6FA8C9   distant hills, sky base; dusty, not saturated — keeps backgrounds quiet
ACCENT 3 (grass)      #7CA05C   sage-green top-edge strip of terrain; muted so red wheel still wins
ACCENT 4 (highlight)  #E8B64C   finish line, confetti, "personal best" highlights — warm mustard
----------------------------------------------------------------------------------------------
GHOST                 #8896A3   desaturated blue-gray; at 60% alpha reads as translucent pencil
DANGER / DNF          #A13A2E   darker variant of accent 1; for timeout screens, never for gameplay
MUTED (secondary text)#6E5F48   warm gray-brown on cream — keeps hierarchy without black-on-white harshness
```

**Reasoning per color:**
- `#2B2118` instead of pure black: pure black on cream looks like print, not ink. The slight warmth ties the outlines to the paper.
- `#F4EAD5` as the canvas: WCAG-viable, avoids OLED white flare, and harmonizes with ink and accent red. A purer off-white (`#FAF6EC`) was rejected — not enough "pageness."
- One **red** accent (not orange): orange reads as UI chrome to mobile players ("tap me"). Red reads as a character / mascot color. The wheel is the hero.
- Sky and grass are **intentionally desaturated** (C* < 30). The whole palette is built around "the wheel and CTA are the only saturated things." This is the same discipline Scribble Rider uses to make the drawn object pop.
- The ghost color is deliberately cool/blue-gray so desaturation does *not* confuse ghosts with terrain (warm) or the player (red). Cool vs. warm is the strongest perceptual separator.

### 2. Rendering Stack Choice — Canvas 2D for v1

**Recommendation: Canvas 2D, single context, `desynchronized: true` on the drawing canvas only.**

The game's rendering budget is trivially met by Canvas 2D:
- Terrain: one `fill()` + one `stroke()` per visible chunk (≤4 chunks on screen).
- Player wheel: one cached `Path2D` drawn with transform.
- Ghosts: 3 × same operation at reduced alpha.
- Car chassis: one sprite or Path2D.
- Parallax: 3–5 `drawImage` calls on pre-rendered `ImageBitmap`s.
- Particles: pool of ≤64 circles.

Total draw calls per frame: ~25–40. This is an order of magnitude below Canvas 2D's breaking point on a Snapdragon 665.

**Why not PixiJS (WebGL):**
- +~200KB to bundle; we're targeting <400KB total gzip.
- No texture batching win with this few sprites.
- The hand-drawn aesthetic explicitly *does not want* shaders.

**Why not WebGPU:**
- iOS Safari support is still catching up in 2026; gating on it breaks the "works on any phone" promise.
- Nothing in the design calls for compute shaders.

**Migration trigger:** switch to PixiJS if (a) we add >1000 simultaneous particles for a crash mode, (b) we add 5+ ghosts with full-path stroke rendering, or (c) frame time on target devices consistently exceeds 14ms with Canvas 2D. Keep physics and scene graph renderer-agnostic (Pixi is a drop-in for the draw calls; nothing else changes).

### 3. Scene Composition — Layered Rendering

Single `<canvas>` element, multiple logical layers composited in one render pass:

| z | Layer | Contents | Scroll | Render cost | Redraw freq |
|---|-------|----------|--------|-------------|-------------|
| 0 | Sky | Static gradient fill (paper-cream at horizon → dusty sky-blue at top) | 0 | <0.2ms | Once per camera chunk |
| 1 | Far hills | Low-detail silhouette `ImageBitmap`, sage/blue-gray | 0.1× | 0.3ms | Per frame (tile + offset) |
| 2 | Mid hills | Bushier silhouette, slightly darker | 0.3× | 0.3ms | Per frame |
| 3 | Terrain | Active chunks (Path2D): filled cream-tan + ink top edge + cross-hatch | 1.0× | 0.8ms | Cached per chunk |
| 4 | Ghosts | 3× ghost sprites + wheel paths, 60% alpha | 1.0× | 0.4ms | Per frame |
| 5 | Player | Chassis sprite + drawn wheel Path2D + dust particles behind | 1.0× | 0.4ms | Per frame |
| 6 | FX overlay | Impact flashes, confetti | 1.0× | <0.3ms | Per frame (mostly empty) |
| 7 | HUD | Timer, rank, progress bar, pause | Screen-fixed | 0.3ms | Only on value change → offscreen canvas blit |

Player is intentionally above ghosts: ghosts never occlude the hero when they overtake. Particles sit *behind* the player so dust doesn't obscure the wheel shape — that shape is the whole point of the game.

### 4. Wheel Rendering — Stylized but Physics-Exact

The physics body uses the simplified + decomposed polygon (12–24 verts, convex pieces). The **rendered wheel must visually match the physics polygon exactly** — otherwise players lose trust when they bounce off "empty air."

Approach: render from the same vertex array used for physics. Layer three passes:

1. **Base fill.** Flat `#D94F3A` (or player choice, future). Single `fill()` on the Path2D.
2. **Ink outline.** 2.5px stroke in `#2B2118`, `lineJoin: 'round'`. Single `stroke()`.
3. **Wobble decoration.** A *second, purely decorative* stroke drawn outside the physics polygon using slight perturbation — see algorithm below. This is the only cosmetic deviation.

#### Wobble algorithm (preserves collision accuracy)

The key: **perturb only the cosmetic second stroke, never the vertex array handed to Planck.**

```
// Runs once, when the player commits the wheel (not per frame — perf + stability)
cosmeticPath = new Path2D()
seed = hash(playerID + drawTimestamp)         // deterministic per wheel
rng = mulberry32(seed)
for each edge (v_i, v_{i+1}) in physicsPolygon:
    insert 2 midpoints along edge
    for each midpoint m:
        n = outward normal at m
        offset = (rng() - 0.5) * 1.4          // ±0.7px perpendicular jitter
        m' = m + n * offset
    append v_i, midpoints, v_{i+1} to cosmeticPath using quadraticCurveTo
closePath
```

Result: a slightly rough, "inked" outline that visibly breathes around the true geometry by <1px — well inside a typical finger-drawn stroke width — while collisions remain computed from the exact simplified polygon. A subtle inner shadow (`ctx.shadowBlur = 3`, `shadowOffsetY = 2`, drawn once into an off-screen canvas and blitted) fakes a tiny bit of paper depth without per-frame shadow cost.

Rotation is driven each frame by `body.angle`:
```
ctx.save(); ctx.translate(body.x, body.y); ctx.rotate(body.angle); ctx.drawPath(cached); ctx.restore();
```

### 5. Car Body Design

One fixed chassis for v1 — no customization burden. It's a **small, boxy cartoon wagon**: silhouette roughly 96×54px on a 3x display.

- Body fill `#FBF4E3` (same as UI surface — reads as "off-white bodywork on the page").
- Window cut-out with a subtle sky tint `#6FA8C9` at 40% alpha.
- Driver: a single oval head + grinning mouth stamp, 2px ink outline. Cartoon cue that this is *not* serious racing.
- Two **wheel wells**: the front well holds the drawn wheel; the rear well holds a plain cartoon circle wheel (fixed). This asymmetry is deliberate — the player's creation sits at the front where the camera reads it first.
- A thin darker strip (`#E9DEC3`) along the lower 6px of the body suggests a side panel / chassis shadow: enough implied 3D lift to not look like it's lying flat on the page.

#### Joint and tilt

- Chassis is a single rectangular Planck body (per the §Gameplay 3 engine commitment — no Matter.js anywhere in the stack).
- Front axle: Planck `WheelJoint` between chassis front-well point and player wheel centroid, with suspension spring/damping and a motor applying torque. Matches the `WheelJoint` parameters pinned in §Gameplay 4.
- Rear axle: Planck `RevoluteJoint` to a plain circle body (fixed cartoon wheel — no suspension needed on a wheel the player can't change).
- The chassis tilts naturally as physics dictate — when the front wheel rides up a hill the chassis pitches back, the driver leans, and the rear dust particles kick harder. No scripted animation; it's all emergent from the physics body angle.

Rendering: sprite drawn with `ctx.rotate(chassis.angle)` around the chassis center of mass. One sprite = one `drawImage` per frame.

### 6. Terrain Rendering

Terrain is a polyline (points every 20–30px) stored as static track data. Rendered as three passes per visible chunk, cached into a `Path2D` on chunk creation:

1. **Fill band.** Close the polyline to screen bottom, fill with a warm tan (`#E5D3B0`). Single draw call.
2. **Cross-hatching.** A pre-rendered 256×256 `ImageBitmap` of sparse pen cross-hatches (diagonal 20°, 0.6 alpha ink) clipped to the terrain fill. Gives "dirt under the line" feel without per-line draws.
3. **Ink top edge.** A 3px stroke of the polyline with a slight width modulation (alternate 2.5/3.5px every ~80px) — mimics variable pen pressure. Color `#2B2118`.
4. **Grass strip.** 4px sage (`#7CA05C`) line drawn just above the ink edge, with small tuft sprites stamped every 60–120px (jittered positions, seeded per-chunk).

#### Parallax

| Layer | Scroll | Color | Content |
|-------|--------|-------|---------|
| Sky gradient | 0 | `#F4EAD5` → `#C9DDE8` | Vertical gradient, filled once |
| Far hills | 0.1× | `#8BA9BA` silhouette | One rough wobbly silhouette sprite tiled |
| Near hills | 0.3× | `#A9BFAB` silhouette | Slightly bushier, with tiny tree bumps |
| Terrain | 1.0× | (above) | Active chunks |

No blur filters at runtime (mobile perf killer). Atmospheric haze is baked into each layer's color at authoring time.

### 7. Ghost Rendering

Each ghost is replayed by re-simulating from the stored polygon + seed using the shared Planck WASM module; the client runs the ghost sim in the same world tick as its own race. No positions are stored or streamed — the ghost body's transform is read straight off the re-simulated world each frame and rendered:
- Draw the ghost's wheel Path2D and a *pre-rendered monochrome copy* of the chassis sprite.
- **Color:** tinted `#8896A3` (cool blue-gray) via a pre-tinted `ImageBitmap`, not per-frame `globalCompositeOperation` (which is expensive on iOS).
- **Opacity:** `globalAlpha = 0.6`.
- **Silhouette simplification:** the ghost's wheel uses the simplified polygon without the wobble pass — a cleaner, less detailed line suggests "memory of a run." Internal detail (driver face, window tint) is omitted.
- **Z-order:** always drawn beneath the player layer. Never above — even when a ghost is 50m ahead, the player reads their own position instantly.
- **Name tag:** small floating label at 70% alpha above the ghost, 12px typography, only shown if the ghost is on-screen and within 300px of the player.

When multiple ghosts overlap, we do *not* stack their alphas — each ghost is drawn to a shared off-screen "ghost layer" canvas that is blitted at 0.6α once. This keeps the "faded" look consistent whether there's 1 ghost or 3.

### 8. Animations

All motion curves via `requestAnimationFrame` + explicit easing; never CSS animations on canvas elements.

| Animation | Trigger | Duration | Curve | Notes |
|-----------|---------|----------|-------|-------|
| Wheel rotation | `body.angularVelocity` | continuous | n/a (physics-driven) | Set `ctx.rotate(body.angle)` each frame |
| Chassis pitch | `chassis.angle` | continuous | n/a | Physics-driven |
| Dust puffs | Wheel-ground contact + speed > 2 m/s | 400ms life | `easeOutQuad` on opacity, linear on y | Circle, 6–14px, `#D6C09A`, pool of 64 |
| Contact ink-flash | Collision impulse > threshold | 80ms | `easeOutExpo` fade | 12px ink-blot sprite, at contact point |
| Countdown 3-2-1-GO | Race start | 3s | `easeOutBack` (scale in) + `easeInCubic` (fade out) | 96pt numerals, center-screen, pulses with 1Hz heartbeat |
| Finish confetti | Cross finish line | 1.2s | Particle physics (gravity 800 px/s²) | 40 particles, palette of 4 accents, rotate random |
| Wheel commit | Player taps Race | 500ms | `easeOutBack` scale to axle | Drawn polygon morphs/shrinks from preview panel to car front wheel |
| Camera look-ahead | Velocity > threshold | smooth | spring (k=8, d=1.2) | Offset x by 15% screen width in travel direction |

Dust particle budget: pool size 64, typical active 12–20, max 32. Each is an opaque circle with a single radial gradient pre-baked into a 16×16 `ImageBitmap` — zero per-frame gradient allocation.

### 9. Screen Flow & Layouts

All layouts assume **portrait 390×844 CSS px baseline (iPhone 14 class)**, safe-area insets respected via `env(safe-area-inset-*)`. Touch targets never below 44×44 CSS px.

#### 9.1 Splash / Home

```
┌─────────────────────────────┐  ← status bar + notch area (safe inset top ≥ 44)
│                             │
│       D R A W R A C E       │  ← 48pt display, hand-drawn logo with wobble
│       draw a wheel.         │  ← 16pt, muted
│       race the ghosts.      │
│                             │
│      ┌─────────────┐        │
│      │             │        │  ← animated demo: a wobbly wheel rolling
│      │    [demo]   │        │     across a tiny strip of terrain, looped
│      │             │        │
│      └─────────────┘        │
│                             │
│   ┌───────────────────┐     │
│   │      R A C E      │     │  ← 56px tall CTA (button fill #D94F3A, label in ink #2B2118, 18pt Caveat 600, ink border)
│   └───────────────────┘     │
│   ┌─────────┬─────────┐     │
│   │ Leader  │Settings │     │  ← secondary buttons, 48px tall
│   └─────────┴─────────┘     │
│                             │
└─────────────────────────────┘  ← safe inset bottom ≥ 34
```

#### 9.2 Draw Screen (the hero screen)

```
┌─────────────────────────────┐
│ ←  Countryside       (?)    │  ← back + track + help; 44×44 each
│   Draw your wheel           │  ← 20pt heading
│                             │
│ ╭───────────────────────╮   │
│ │                       │   │
│ │                       │   │  ← square canvas, ~92vw wide,
│ │   [drawing canvas]    │   │     CENTERED in vertical-thumb zone
│ │                       │   │     (top of canvas ~30% down screen)
│ │                       │   │
│ ╰───────────────────────╯   │
│                             │
│     [ clear ]    [ race → ] │  ← thumb-row buttons, 56px tall
│                             │
└─────────────────────────────┘
```

Annotations: canvas sits 30–85% vertical so a right-thumb draw arc is comfortable. Clear/Race buttons are in the *bottom 15%* but with 24px padding above the home-indicator area to avoid iOS swipe-up conflict.

#### 9.3 Countdown overlay (drawn over Race Screen, before motor engages)

Full-screen translucent `#F4EAD5` at 80% over the paused race scene, huge numeral center-screen scaling in/out.

#### 9.4 Race HUD

```
┌─────────────────────────────┐
│ 0:12.4    ━━━━●━━━━   #47   │  ← timer | progress | rank, 16pt HUD, 70% alpha
│                             │
│    [ghost blue]             │
│        [ghost blue]         │
│              [PLAYER RED]   │
│ ~~~~~~~~~~~~~~~~~~~~~~~~~~  │  ← terrain
│                             │
└─────────────────────────────┘
```

No bottom controls — race is autonomous. Tap anywhere for pause (top-left pause appears).

#### 9.5 Result Screen

```
┌─────────────────────────────┐
│        0 : 28 . 4 4 1        │  ← 44pt, mustard highlight if PB
│        rank #47  ▲ 12        │  ← 16pt
│                             │
│       ╭──────────╮          │
│       │  wheel   │          │  ← 96×96 thumbnail of drawn shape
│       │   img    │          │
│       ╰──────────╯          │
│                             │
│  You beat  GhostUser_3  0:31│
│  Lost to   GhostUser_1  0:24│
│                             │
│  ┌──────────┐ ┌──────────┐  │
│  │Leaderbrd │ │Try Again │  │
│  └──────────┘ └──────────┘  │
└─────────────────────────────┘
```

Wheel thumbnails are rendered on demand from the ghost blob's polygon — no thumbnail blob is stored. The **Try Again** CTA matches the Home screen's RACE button styling (button fill `#D94F3A`, label in ink `#2B2118`, 18pt Caveat 600, ink border); the **Leaderbrd** button uses the standard secondary style (cream surface, ink label, ink border).

**Rank row loading state.** Per §Multiplayer & Backend 7, the `POST /v1/submissions` 202 response carries no preliminary rank — the rank row (`rank #47 ▲ 12` in the wireframe above) is rendered as a shimmering skeleton placeholder (same ink-on-cream palette, `~110px` wide, `~16pt` tall to match the eventual content) while the client polls `GET /v1/submissions/{id}`. The finish time on the line above renders immediately from the local simulation and does not wait on the poll. On `status: accepted` the skeleton resolves into the real `rank #NN ▲ delta` string; on `status: rejected` it is replaced with a muted italic `Time not accepted` label (no numerals, no arrow, no score change) and the "You beat / Lost to" comparison lines are suppressed. Polling backoff is 500 ms → 1 s → 2 s → 4 s cap, well inside the 60/min per-UUID budget.

#### 9.6 Leaderboard

Scrollable list, sticky "your row" highlighted with cream surface + mustard left border. Each row 64px tall: rank, name, time, wheel thumbnail. Tab switcher "Around You / Top 10" at top. Wheel thumbnails are rendered on demand from the ghost blob's polygon — no thumbnail blob is stored.

#### 9.7 Settings

Plain list of toggles: Sound, Haptics, Reduced Motion, Display Name, Clear Data. Single-column, 56px rows.

### 10. Touch Ergonomics

Per the touch-drawing-input research: portrait one-handed, right-thumb dominant.

- **Canvas placement:** center of the screen vertically, spanning the natural thumb arc (30%–85% from top). A right-thumb pivoting at the bottom-right corner sweeps the canvas comfortably.
- **Bottom 24px:** reserved buffer above `safe-area-inset-bottom`. Never put a tappable element there — it conflicts with iOS home-indicator swipe and Android gesture nav.
- **Top 44px:** safe zone above the canvas for back/title/help. Header chrome must not descend into the draw area.
- **Full `touch-action: none`** on the canvas element; `setPointerCapture` on pointerdown. `getCoalescedEvents()` used in pointermove for smooth fast strokes. `desynchronized: true` on the drawing canvas to shave a frame of latency.
- **Closure detection:** when the user lifts their finger within 40px (scaled by DPR) of the start, snap-close and flash the polygon in sage green for 120ms — confirms commitment non-verbally.
- **Draw hints:** first-launch-only, a subtle looping ghost-finger tracing a rough circle on the canvas, 40% opacity, disappears the instant the first `pointerdown` fires.

### 11. Typography

**Primary typeface:** **Caveat** (Google Fonts, Open Font License). A legible handwritten face with good small-size rendering — unlike more ornamental scripts, it holds up at 12pt on a 3x display. Variable weight 400–700.

**Secondary typeface (HUD numerals, times):** **Patrick Hand SC** — small caps with even widths, monospace-ish digits. Used for timers where legibility-at-a-glance matters more than decoration.

**Fallback stack:**
```
font-family: "Caveat", "Patrick Hand", "Comic Sans MS", cursive, system-ui, sans-serif;
```

Comic Sans is in the fallback deliberately — it is the only universally preinstalled hand-ish font. Better than landing on Arial if the webfont fails.

**Sizes (CSS px on baseline device):**
- Display (logo, finish time): 44–48pt, Caveat 700
- H1 (screen titles): 24pt, Caveat 600
- H2 / section: 20pt, Caveat 600
- Body: 16pt, Caveat 400 — minimum readable size for running text
- Meta / captions: 14pt, Caveat 400, `#6E5F48` (muted)
- HUD numerals (timer, rank): 16pt, Patrick Hand 400, tabular
- Button labels: 18pt, Caveat 600

Line-height 1.3 everywhere. Letter-spacing +0.01em on body to counter Caveat's natural tightness.

Fonts are subset to Latin-basic + digits + common punctuation; woff2 total < 40KB; preloaded via `<link rel="preload" as="font" crossorigin>` in the document head.

### 12. Accessibility

**Contrast (WCAG AA, against `#F4EAD5` cream background):**
- `#2B2118` ink: ratio ~14:1 — exceeds AAA for all text sizes.
- `#6E5F48` muted: ratio ~5.2:1 — passes AA for normal body text.
- `#D94F3A` accent on cream: ratio ~4.6:1 — passes AA for large text (18pt+) and UI components. **Button CTAs invert this:** button labels are rendered in ink `#2B2118` on the red fill, not red on cream. Ink-on-red is ~14:1 (red's luminance ≈40% is close to cream's, so the ink/red ratio is close to ink/cream) and sidesteps the ambiguity that Caveat's smaller x-height creates for the WCAG "18pt large text" heuristic at 18pt Caveat 600. Red-on-cream usage is kept for **large display accents** only — personal-best flourishes, badges, 44pt+ display numerals — where the size comfortably clears AA on its own.
- `#7CA05C` sage on cream: ratio ~2.9:1 — **fails** AA for text. Used only for decorative grass / non-informational elements. Never carries meaning alone.
- Ghost color `#8896A3`: ratio ~3.3:1 — acceptable for decorative gameplay object; ghost names are drawn with an ink stroke behind them for readability.

**Motion-reduced mode** (`prefers-reduced-motion: reduce`):
- Parallax layers scroll at 1.0× (flat).
- Dust particles replaced with a single static puff sprite that fades over 200ms.
- Camera shake on impacts disabled.
- Countdown numerals cross-fade instead of spring-scale.
- Confetti replaced with a static burst image that fades.
- `prefers-reduced-motion` is also respected in menu transitions (cross-fade, no slide).

**Haptics** (Vibration API + iOS Haptic via `navigator.vibrate` / `TapticEngine` where available):
- On stroke-closure detection: 10ms light tap.
- On tapping Race: 20ms medium.
- On crossing finish line: 40-20-40 pattern (celebration).
- On DNF/timeout: single 80ms dull tap.
- Off by default in settings; toggleable. No haptics at all if `prefers-reduced-motion`.

**Screen reader / ARIA (non-game UI):**
- Menu buttons have proper `aria-label`s ("Start race", "View leaderboard").
- The game canvas itself carries `role="application"` + `aria-label="Drawing canvas: use your finger to draw a wheel shape"` so VoiceOver doesn't try to traverse stroke geometry.
- Result screen is a live region (`aria-live="polite"`) announcing time and rank change.
- Leaderboard is a semantic `<table>` under the hood with visual CSS styling.

### 13. Loading & First Impression

**No spinners.** The initial bundle (physics + renderer + drawing code + fonts, gzip) is under 400KB. On 4G this lands in ~1.5s.

**First 2 seconds on cold load:**
1. **0–200ms:** Cloudflare Pages serves the HTML + inlined critical CSS. The page paints the cream background (`#F4EAD5`) immediately. No white flash.
2. **200–600ms:** The logo renders in a system-font fallback (Comic Sans / cursive) — already in the final position. The "RACE" CTA is visible but disabled.
3. **600–1400ms:** Caveat webfont swaps in (via `font-display: swap`), physics engine finishes parsing. The demo wheel animation begins looping.
4. **1400–2000ms:** CTA enables with a brief pulse. The player can tap Race.

If any asset takes >500ms beyond target, a **static** 3px-tall progress bar appears under the logo (no animated spinner). It fills left to right in ink.

**Add-to-Home-Screen:**
- App icon: 512×512 PNG, the DrawRace logo wheel (a wobbly inked circle) on the cream square. Masked variant for Android adaptive icons with 20% safe padding.
- Splash: iOS launch images at standard sizes, each simply the cream background + centered logo + tagline — matches the first paint exactly so the handoff is seamless.
- Manifest: `display: standalone`, `theme_color: #F4EAD5`, `background_color: #F4EAD5`, `orientation: portrait`.

**First-run identity flow** (the concrete shape of the `player_uuid` contract in §Multiplayer 9):

1. On first app boot, before the splash animation finishes, the app checks `localStorage['drawrace.player_uuid']`. If absent and localStorage is writable, it generates a v4 via `crypto.randomUUID()` and persists it.
2. If localStorage is **unavailable** (Safari Private Browsing, Lockdown Mode, storage-quota errors), the app falls back to a session-only UUID held in memory and shows a small banner on the splash: "Private browsing detected — scores won't save." All API calls still work, but the submit path sets the ghost blob `flags` bit `0x02` (ephemeral); the server validates and returns `204 No Content` without persisting, so private tabs can't pollute the leaderboard. Name claims from ephemeral sessions are similarly rejected with `204`.
3. Name claim is **deferred.** The first race is playable anonymously as `GhostUser_<last 4 of UUID>`. The name-claim UI appears from the Result Screen's "claim a name" chip after the first finish, and from Settings at any time thereafter.
4. A newly-generated UUID is registered **lazily** on first submission — there is no `POST /v1/players` step. The server creates the row on the first `POST /v1/submissions` it sees from an unknown UUID.

### 14. Sound Design

Off by default — respects phones usually being silenced, and sidesteps the iOS Safari autoplay gate. When the user flips Sound on in Settings, sounds are unlocked inside that tap's user-gesture context.

**Design:**
- **Engine rumble:** a 1.2-second looping low-frequency hum. Playback rate modulated by motor angular velocity (`audio.playbackRate = 0.7 + wheelRPM/maxRPM * 0.8`). Gives a satisfying sense that the drawn wheel *is* the engine — a chattery triangle wheel sounds chattery.
- **Bounce/thud:** single-shot sample, triggered on collisions above an impulse threshold. Pitch-shifted slightly per event (±15%) to avoid monotony.
- **Tire-drawn-in-ink whoosh:** soft, played on the wheel-commit animation (§Graphics & UX 8).
- **Finish fanfare:** a tiny 1.5-second orchestral sting in a kazoo/ukulele register — fits the paper aesthetic, not a triumphant brass fanfare.
- **Countdown ticks:** three beeps plus a higher "GO" tone.
- **UI taps:** soft paper "tick" — only plays on primary CTAs.

**File format:** **Opus in `.webm`** primary, with **AAC in `.mp4`** fallback for older iOS. Opus gives superior quality per byte; Safari supports it from iOS 17 onward (fine for our targets).

**Audio budget:** total ≤ 120KB across all sounds. Engine loop ≤ 40KB, others ≤ 10KB each. Loaded lazily on first Sound-On tap, never blocks first paint.

### 15. Asset Pipeline

**Hybrid: procedural-first, with a tiny sprite atlas for baked details.**

**Procedural (rendered in Canvas 2D at runtime):**
- Terrain fill + ink top edge + grass strip (drawn from polyline data)
- Player wheel (drawn from vertex array)
- Ghost wheel/body (drawn from stored replay geometry)
- HUD shapes (timer pill, progress bar, buttons — all Path2D)
- Countdown numerals (rendered text)
- Dust particles (circles, possibly a single pre-rendered 16×16 bitmap)

Benefits: nothing to pack, nothing to version, infinitely crisp on any DPR.

**Baked sprites (one atlas, ≤256KB PNG, 2048×1024):**
- Car chassis (120×90 source, 2× variant)
- Far hills silhouette (1024×256)
- Near hills silhouette (1024×256)
- Cross-hatch tile (256×256, tileable)
- Grass tuft variants (4 × 48×48)
- Confetti pieces (8 × 24×24)
- Ink splatter FX (6 × 64×64)
- Logo wheel (512×512, also used for the app icon — single source)

Authored in **SVG** (Inkscape or Affinity Designer) so the sketch look is vector-native. A small Node build script rasterizes SVGs → PNG + packs with `spritesmith` or `free-tex-packer-cli` into a single atlas + JSON frame map. The atlas is loaded once via `createImageBitmap()` at startup; every sprite in the game is one `drawImage(atlas, sx, sy, sw, sh, dx, dy, dw, dh)` call.

**Bundle math (gzip):**
- JS (physics + game + drawing libs): ~280KB
- Fonts (Caveat + Patrick Hand, subset): ~40KB
- Sprite atlas PNG: ~60KB (flat colors compress extremely well)
- Audio (lazy, not counted in initial bundle): ~100KB

**Total initial payload:** under 400KB gzipped, hitting our PWA first-paint target with meaningful headroom for future polish without touching the rendering layer.

---

## Automated Testing Strategy

### 1. Testing Philosophy

DrawRace is dominated by a single high-risk surface: **the gameplay loop where a drawn polygon becomes physics geometry that rolls down a track**. Every other surface (leaderboard, ghost cache, result screen) is tractable with conventional web testing; the wheel itself is not. Three properties make gameplay regression uniquely hard:

1. **Non-determinism by default.** Matter.js/Planck.js use floating-point accumulation, wall-clock timesteps, and internal RNG (island solver tie-breaking, contact manifold ordering). Running the same "draw a circle and race" twice will produce finish times that differ by tens of milliseconds. Any naive assertion is flaky.
2. **Subjective feel.** A wheel that "feels bouncy" is not directly assertable. We have to proxy feel via measurable derivatives: finish time, peak vertical velocity, contact count per second, angular-velocity variance.
3. **Integration-heavy.** The canvas input pipeline (pointer → raw points → Douglas-Peucker → centroid → POLY-DECOMP → physics body) has seven stages. A bug at stage 3 may only surface as a 5% slower wheel at stage 7. Unit tests on any single stage will not catch it.

The entire strategy is unlocked by **one architectural commitment**: the physics and shape-processing core must be pure, deterministic, and runnable in Node. Given a fixed timestep, a seeded RNG, and a monkey-patched `performance.now()`, the same input polygon must produce the same finish time, bit-for-bit, on every run, on every platform, across releases until we intentionally bump the physics version. That single property turns gameplay testing from "subjective QA" into a numeric regression problem.

### 2. Layer 1 — Unit Tests (Vitest)

Scope: pure helper modules with no DOM, no canvas, no physics. Target **95% line coverage, 100% branch coverage on geometry/crypto**. These run in <5 seconds and are the first gate.

Targets:
- **Douglas-Peucker** (`src/shape/simplify.ts`): monotonicity (higher epsilon → fewer points), idempotence on already-simplified input, endpoints always preserved, closed-ring handling.
- **Centroid** (`src/shape/centroid.ts`): analytic check against unit square (0.5, 0.5), regular polygon centroid equals circumcenter, degenerate colinear input returns midpoint.
- **Polygon area** (signed, for winding detection): CW negative / CCW positive, self-intersecting polygon returns well-defined value (we assert the shoelace formula result, not a "correct" area).
- **Convex decomposition** wrapper around POLY-DECOMP: concave L-shape produces exactly 2 pieces, star-5 produces ≤8 pieces, already-convex input returns one piece (the input).
- **HMAC signing** (`src/net/sign.ts`): known-answer test against an RFC 2202 vector, tampered payload fails verify, timestamp skew rejection.
- **Bucket assignment** (`src/rank/bucket.ts`): percentile edges (0%, 1%, 5%, 20%, 50%, 100%), empty leaderboard returns "median" sentinel, single-entry leaderboard always top bucket.

```ts
// src/shape/centroid.test.ts
import { describe, it, expect } from "vitest";
import { centroid } from "./centroid";

describe("centroid", () => {
  it("unit square centered at (0.5, 0.5)", () => {
    const c = centroid([[0,0],[1,0],[1,1],[0,1]]);
    expect(c[0]).toBeCloseTo(0.5, 12);
    expect(c[1]).toBeCloseTo(0.5, 12);
  });
  it("translates to origin identity", () => {
    const poly = [[10,10],[20,10],[15,20]];
    const c = centroid(poly);
    const recentered = poly.map(([x,y]) => [x-c[0], y-c[1]] as [number,number]);
    expect(centroid(recentered)[0]).toBeCloseTo(0, 12);
  });
});
```

### 3. Layer 2 — Headless Deterministic Physics Simulation

This is the load-bearing layer. We extract a `packages/engine-core/` workspace that contains: the physics world bootstrap, the track (as a plain data array), the car body + motor + revolute joint, and a tick loop. It has **zero DOM imports**. All randomness routes through an injected `Rng` interface; all time routes through an injected `Clock`.

Determinism checklist enforced by a single `createHeadlessRace()` factory:
- `World.step(1/60, 8, 3)` called exactly N times — matches the client timestep and iteration counts pinned in §Gameplay 4 & 6; never `requestAnimationFrame`, never wall clock.
- Planck's `Math.random` shim replaced with a seeded xorshift32.
- Solver iteration counts pinned; `world.setContinuousPhysics(true)` pinned.
- `process.hrtime.bigint()` never called from engine code; the injected clock returns integer ticks.

#### Golden-file approach

Under `packages/engine-core/golden/` we check in a JSON table: `{ wheel: <polygon>, track: "v1", finishTicks: <int>, finalX: <float>, hash: <sha256 of positions@10Hz> }`. The test loads a named wheel, runs the sim, and asserts:
- `finishTicks` exactly matches (determinism must be bit-exact);
- a SHA256 of the position stream matches.

If a test fails we print **both** the stored and observed values and, critically, the **per-second delta curve** so a human can see whether it's a 1-tick slip or a structural change.

#### Reference wheel library

We seed 24+ wheels covering the behavioral matrix from features.md:

| ID | Family | Params | Expected |
|---|---|---|---|
| `circ-32-r40` | 32-gon circle | r=40 | ~24.5s |
| `circ-32-r20` | tiny circle | r=20 | ~38s, sometimes stalls on bump |
| `circ-32-r80` | huge circle | r=80 | ~27s |
| `oval-slim` | ellipse | a=50 b=30 | ~26s |
| `oval-fat` | ellipse | a=40 b=55 | ~25s |
| `tri-equi-40` | equilateral | side=60 | ~34s |
| `square-40` | square | side=60 | ~31s |
| `star-5-sharp` | 5-point star | inner=15 outer=45 | ~45s |
| `star-5-soft` | rounded star | inner=30 outer=45 | ~32s |
| `crescent-a` | concave crescent | preset | DNF on steep ramp |
| `blob-self-intx-1` | self-intersecting noise | seed=1 | finishes, ~35s |
| `regression-2026-03-12` | captured bug repro | — | 29.8s (must not regress) |
| ... (12 more) | | | |

```ts
// packages/engine-core/test/golden.test.ts
import golden from "../golden/wheels.json";
import { runHeadless } from "../src/headless";

for (const entry of golden) {
  test(`golden ${entry.id}`, () => {
    const res = runHeadless({ wheel: entry.wheel, track: entry.track, seed: 1 });
    expect(res.finishTicks).toBe(entry.finishTicks);
    expect(res.streamHash).toBe(entry.hash);
  });
}
```

Intentional physics tuning follows a **two-commit workflow**: (1) bump a `PHYSICS_VERSION` constant, (2) regenerate `golden/wheels.json` with a dedicated script, requiring a human to eyeball the diff. CI refuses to regenerate goldens automatically.

Runtime target: **<45 seconds** for all 24 wheels on one core. Trivially parallel across cores.

### 4. Layer 3 — Rendering Snapshot Tests

Playwright in headless Chromium drives a minimal fixture page that imports the real renderer but with engine-core swapped to a **replay driver**: it pushes pre-computed positions (from a Layer 2 run) into the renderer tick-by-tick. This isolates render regressions from physics regressions.

At deterministic ticks (0, 30, 120, 300, finish) we `page.screenshot({ clip: canvasRect, animations: 'disabled' })` and diff against PNGs in `snapshots/` with **pixelmatch at 0.04 tolerance, 300px max diff area** (cartoon line jitter demands a generous tolerance but a small absolute-area cap catches structural breakage).

Font rendering is a notorious cross-platform diff source. We pin:
- A single CI container image (`ghcr.io/drawrace/ci-snap:2026-04-21`, Debian 13 + Playwright-bundled fonts only).
- `@font-face` with `font-display: block` and a bundled WOFF2 for all in-game text.
- A `prefers-reduced-motion: reduce` CSS block applied in snapshot mode to disable confetti.

Local devs do not run snapshot tests by default; they run inside the pinned container via `just snap`.

### 5. Layer 4 — Input Simulation / E2E (Playwright)

Playwright drives the production PWA build served from `dist/` via `wrangler pages dev` (mirrors Cloudflare Pages locally). The test strategy uses **real Pointer Events** dispatched through `page.mouse` / `CDP Input.dispatchTouchEvent` so we exercise the full capture → simplify → decompose → physics pipeline.

> Note: Playwright's touch dispatch runs against desktop Chromium. Real-hardware touch quirks — sampling-rate variance, OLED color, iOS PointerEvents differences — are covered in Layer 9 (§Testing 10), not here. Layer 4 is for fast, deterministic, pipeline-level coverage; Layer 9 is for the real phone.

A `drawShape(page, pathFn)` helper walks a parametric path and fires `pointerdown / pointermove× / pointerup`:

```ts
test("draw circle → race completes within 30s", async ({ page }) => {
  await page.goto("/?seed=1&track=v1");
  await drawShape(page, circlePath({ cx: 200, cy: 200, r: 80, samples: 120 }));
  await expect(page.getByRole("button", { name: "Race!" })).toBeEnabled();
  await page.getByRole("button", { name: "Race!" }).click();
  const timeText = await page.getByTestId("result-time").textContent({ timeout: 60_000 });
  const ms = parseTime(timeText!);
  expect(ms).toBeGreaterThan(22_000);
  expect(ms).toBeLessThan(30_000);
});

test("tiny dot → Race stays disabled", async ({ page }) => {
  await page.goto("/");
  await drawShape(page, dotPath({ x: 100, y: 100 }));
  await expect(page.getByRole("button", { name: "Race!" })).toBeDisabled();
});

test("self-intersecting blob does not crash", async ({ page }) => {
  page.on("pageerror", e => { throw e; });
  await drawShape(page, figureEight());
  await page.getByRole("button", { name: "Race!" }).click();
  await expect(page.getByTestId("result-time")).toBeVisible({ timeout: 60_000 });
});

test("ghosts render from mocked API", async ({ page }) => {
  await page.route("**/api/ghosts*", r => r.fulfill({ json: fixtures.threeGhosts }));
  await drawShape(page, circlePath({ r: 60 }));
  await page.getByRole("button", { name: "Race!" }).click();
  await expect(page.locator("[data-ghost-id]")).toHaveCount(3);
});

test("offline mid-race falls back to cached ghosts", async ({ page, context }) => {
  await page.goto("/"); await warmCache(page);
  await context.setOffline(true);
  await drawShape(page, circlePath({ r: 60 }));
  await page.getByRole("button", { name: "Race!" }).click();
  await expect(page.getByTestId("result-time")).toBeVisible({ timeout: 60_000 });
});
```

The URL `?seed=1` is a production-safe test hook: when present, the app injects the deterministic RNG and clock used in Layer 2. Without the query param, production behaves normally.

### 6. Layer 5 — Backend Contract Tests

The **Rust/axum backend** is run locally via `docker compose up` against local Postgres, Redis, and a MinIO S3 stub (proxying for Garage). A contract suite (Vitest + `undici`, or `cargo test` against the same image) exercises:

- **Golden request/response pairs** under `contracts/` — `POST /v1/submissions` with a known payload produces a byte-for-byte response (minus the server timestamp, which is stubbed via `X-Test-Clock` header only honored when `DRAWRACE_ENV=test`). The 202 body is asserted to contain **exactly** the three keys `submission_id`, `status` (= `"pending_validation"`), `poll_url` — no `preliminary_rank`, no `preliminary_bucket`, no other fields. Extra keys fail the test.
- **Poll lifecycle & ownership** — `POST /v1/submissions` with player A, then `GET /v1/submissions/{id}` without `X-DrawRace-Player` returns 403; with A's UUID returns 200 + `pending_validation` (or `accepted`/`rejected` once the validator has run); with B's UUID returns 404 (NOT 403 — the enumeration-safe branch). An unknown submission ID with any UUID returns 404. A rejected submission returns a body with exactly `{status, reason}`.
- **HMAC roundtrip**: sign client-side with the public test key, server accepts; flip one byte, server **400s** (malformed request, not 401 unauthorized). This test validates **input rejection**, not authentication — the HMAC key is public (see §Multiplayer 8 Layer 1) and carries no trust; the test only asserts the server refuses to store a payload whose own integrity check fails.
- **Ghost integrity**: `POST` a ghost, `GET` it back, assert polygon and position stream are byte-identical (base64 equality). This verifies the binary format (§Multiplayer & Backend 5) roundtrips cleanly through the S3 layer.
- **Bucket assignment**: submit 100 seeded times, verify the `bucket` field on the 101st submission.
- **Matchmake empty-bucket fallback**: seed a DB with 0 ghosts in the target bucket and assert `GET /v1/matchmake/{track_id}` returns 3 ghosts drawn from the next-faster bucket; with all higher buckets empty, assert it falls back to the bundled seed pool (§Multiplayer 6). This pins the full fallback chain, not just the happy path.
- **Shadow ghost inclusion**: given a player with a recorded PB on the track, assert the response includes a `shadow_ghost` field whose `ghost_id` equals the player's PB ghost; given a player with no PB, assert the response key `shadow_ghost` is **present** and its value is **exactly `null`** (`response.shadow_ghost === null`, not `undefined`, not a missing key). The OpenAPI spec must declare `shadow_ghost` as `nullable: true` and `required`, and the contract test fails if the schema regresses to field-omission.

These tests double as the OpenAPI conformance gate — we generate the schema from axum route handlers (via `utoipa` or equivalent) and fail CI if the golden response does not conform.

### 7. Layer 6 — Replay Verification

When a client submits a ghost, the `drawrace-validator` pod re-runs the same deterministic engine-core (compiled to WASM and loaded into Rust via `wasmtime`) against the submitted wheel polygon and asserts `|serverFinishTicks − clientFinishTicks| ≤ 2 ticks`. On mismatch the submission is rejected with `422 REPLAY_MISMATCH`.

This gives us three things for the price of one:
1. **Anti-cheat**: forged times are caught at the door.
2. **Cross-version regression canary**: if a client ships with physics v12 but the server is pinned at v11, every submission mismatches. CI asserts that the validator's bundled engine-core SHA equals the currently-deployed client's engine-core SHA before a Pages deploy is allowed to promote.
3. **Physics immutability enforcement**: any unintentional engine change is loud and immediate.

A dedicated test crate (`crates/validator/tests/replay.rs`) runs 200 pre-recorded real-player ghosts through the verifier every commit; any divergence fails CI.

### 8. Layer 7 — Performance Budget Tests

Headless Chromium with CDP `Emulation.setCPUThrottlingRate: 6` to approximate Snapdragon 665. The perf harness:
- Replays a fixed wheel against the v1 track.
- Collects frame timings via `PerformanceObserver('frame')` and CDP tracing.
- Reports median, p95, and worst-10-frame durations.

Budgets (on the pinned CI container, desktop Xeon, 6× throttled):
- Median frame time ≤ 12 ms.
- p95 ≤ 20 ms.
- No single frame > 50 ms during steady-state (start-of-race JIT spikes excluded via a 120-tick warmup).
- Bundle size budgets enforced by `size-limit`: main ≤ 400 KB gzipped, engine-core ≤ 220 KB.

Failures block PR merge. Budgets are tracked over time (see §Testing 14).

### 9. Layer 8 — Load & Chaos

**k6** against the staging Rackspace Spot deployment (`api-staging.drawrace.example`):

```js
import http from "k6/http";
import { check } from "k6";
export const options = {
  scenarios: {
    submissions: { executor: "ramping-arrival-rate", startRate: 50,
      timeUnit: "1s", preAllocatedVUs: 200, maxVUs: 2000,
      stages: [{ target: 2000, duration: "2m" }, { target: 2000, duration: "5m" }] },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<400", "p(99)<1200"],
  },
};
export default function () {
  const payload = fixtures.randomGhostBinary();
  const r = http.post(`${__ENV.API}/v1/submissions`, payload, {
    headers: { "Content-Type": "application/octet-stream", "X-DrawRace-ClientHMAC": signForLoad(payload) },
  });
  check(r, { "202 Accepted": x => x.status === 202 });
}
```

Targets: 10k concurrent submissions, p99 < 1.2s, error rate < 1%. Runs nightly against staging; never on PRs. The k6 runner's egress IP (or its /32) is listed in `DRAWRACE_RATE_LIMIT_BYPASS_CIDR` on staging — without this, the ramp to 2000 RPS would trip per-IP limits on the first second.

**Chaos**: Rackspace Spot can preempt nodes (~90s notice). A nightly job randomly deletes one `drawrace-api` pod while k6 runs 500 RPS and asserts the client's retry-with-backoff keeps `http_req_failed < 0.5%`. A second chaos job kills the single `drawrace-validator` pod and asserts the queue drains cleanly once a new pod comes up.

### 10. Layer 9 — Device Matrix Smoke

DrawRace is mobile-first, so a real-device gate exists on every PR — not just pre-release. We get there in two tiers:

#### 10.1 Primary: self-hosted Pixel 6 over ADB (per-PR)

A Google Pixel 6 is permanently wired into the CI host via ADB over Tailscale (`100.88.10.113`, see CLAUDE.md § "ADB — Pixel 6 Remote Control"). This is the **first-class mobile target** — it runs on every PR, costs nothing per minute, and exercises the real Android Chrome stack rather than a desktop emulation.

What the phone job does, in Argo Workflows (`drawrace-mobile-smoke` step, runs in parallel with `e2e`):

1. **Health-check the link.** `adb-check` on the CI pod; if it reports "port may have changed", the step fails with an actionable message (a human reconnects via `adb-connect <port>`). The port-persistence file lives at `~/.adb_last_port` on the CI runner's persistent volume.
2. **Install the preview build.** Open Chrome to the PR's Cloudflare Pages preview URL via deep link — `adb shell am start -a android.intent.action.VIEW -d "<preview-url>?seed=1&track=v1" com.android.chrome`.
3. **Drive the game.** A `mobile-bot` script (shares the same parametric-wheel code as `@drawrace/bot`, §Testing 13) translates drawing paths into `adb shell input swipe` / `input tap` sequences on the real 1080×2400 canvas. UI coordinates are resolved at runtime via `uiautomator dump` + an XML parse (CLAUDE.md has the recipe) so the script does not break on layout tweaks.
4. **Assert by screenshot + OCR.** `adb shell screencap -p` is read with the Read tool / pixelmatch; the result screen's time/rank text is OCRed (Tesseract) and asserted within known bounds. We do **not** pixel-diff the full canvas here — that's Layer 3's job in a pinned container. The phone asserts *semantic* outcomes: "result screen appeared", "time is between 22–30s", "no `chrome://crash` interstitial".
5. **Capture perf telemetry.** During the race, the bot polls `adb shell dumpsys gfxinfo com.android.chrome framestats` every second; median + p95 frame times are pushed to Prometheus alongside the Layer 7 numbers. This is the only frame-timing measurement that comes from an actual phone GPU.
6. **Serialize access.** The phone is a singleton — the Argo step acquires a Redis `SETNX drawrace:phone:lock` with a 3-minute TTL before it starts, and releases on exit. Concurrent PRs queue behind the lock; the step budget is 2 min so worst-case wait is bounded.

Coverage scenarios on the phone (keep it tight — serialized access is the bottleneck):

| Scenario | What it proves |
|---|---|
| Draw seeded circle → race → result screen | End-to-end pipeline works on real Android touch input |
| Draw tiny dot → Race button stays disabled | Input rejection works on real hardware sampling |
| Airplane-mode mid-race | Service worker + offline ghost cache degrades gracefully |
| PWA install flow (`Add to Home Screen`) | Manifest + icons + launch behavior (frequently regressed) |
| Prefers-reduced-motion via system accessibility toggle | Reduced-motion code path on a real OS toggle, not a media-query mock |

Screenshots and UI dumps from every failed step are uploaded as Argo artifacts so a human can see exactly what the phone saw without reproducing locally.

**Why this is load-bearing:** Playwright's "mobile emulation" fakes viewport + user-agent but uses desktop Chromium, desktop touch dispatch, and desktop GPU. iOS Safari and real Android Chrome PointerEvents / touch-action / `font-display` / OLED color rendering all behave differently enough to have bitten previous mobile web projects. Having a real device in the critical path catches those at PR time, not at beta time.

#### 10.2 Secondary: BrowserStack App Automate (pre-release)

One phone catches Android regressions; we still need iOS Safari and a low-end floor. **BrowserStack App Automate** (pay-as-you-go, Playwright integration) runs on release candidates only — never on per-PR CI, to keep the minute budget sane.

| Device | OS | Browser | Why |
|---|---|---|---|
| iPhone 12 | iOS 17 | Safari | Target mid-iOS |
| iPhone 15 Pro | iOS 18 | Safari | Latest iOS, ProMotion |
| Pixel 6 | Android 14 | Chrome | Cross-check against the self-hosted unit |
| Redmi 9 | Android 12 | Chrome | Low-end SD665 floor (the 30fps target device) |
| Galaxy S23 | Android 14 | Samsung Internet | Non-Chromium quirks |

Per release, each device runs the same scripted smoke the self-hosted Pixel 6 runs. Failure on two+ devices blocks release; single-device failure opens a triage bead. The Pixel 6 row is a deliberate duplicate — if BrowserStack's Pixel 6 diverges from our self-hosted Pixel 6, that's a BrowserStack-environment bug and we trust our phone.

### 11. CI Pipeline (Argo Workflows, iad-ci)

Single WorkflowTemplate `drawrace-ci` in jedarden/declarative-config, synced to iad-ci by ArgoCD. DAG:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: WorkflowTemplate
metadata:
  name: drawrace-ci
  namespace: argo-workflows
  labels:
    app: drawrace-ci
spec:
  # ── Top-level parameters ────────────────────────────────────────────────────
  arguments:
    parameters:
      - name: ref
        value: main
      - name: mode
        # pr | nightly | release
        value: pr
      - name: preview-url
        # Injected by drawrace-build's trigger-ci step after Pages publish.
        # Empty on manual/local runs; phone-smoke step is skipped when empty.
        value: ""

  entrypoint: ci

  templates:
    # ── CI DAG ─────────────────────────────────────────────────────────────────
    - name: ci
      dag:
        tasks:
          - name: lint
            template: step
            arguments:
              parameters:
                - {name: cmd, value: "pnpm lint"}

          - name: unit
            template: step
            dependencies: [lint]
            arguments:
              parameters:
                - {name: cmd, value: "pnpm vitest run --coverage"}

          - name: physics-golden
            template: step
            dependencies: [unit]
            arguments:
              parameters:
                - {name: cmd, value: "pnpm -F engine-core test:golden"}

          - name: replay-verify
            template: step
            dependencies: [unit]
            arguments:
              parameters:
                - {name: cmd, value: "cargo test -p drawrace-validator --test replay"}

          - name: build
            template: step
            dependencies: [physics-golden]
            arguments:
              parameters:
                - {name: cmd, value: "pnpm build"}

          - name: render-snap
            template: snap-step
            dependencies: [build]
            arguments:
              parameters:
                - {name: cmd, value: "pnpm test:snapshot"}

          - name: e2e
            template: step
            dependencies: [build]
            arguments:
              parameters:
                - {name: cmd, value: "pnpm test:e2e"}

          - name: backend-contract
            template: step
            dependencies: [build]
            arguments:
              parameters:
                - {name: cmd, value: "pnpm test:contract"}

          - name: perf
            template: step
            dependencies: [build]
            arguments:
              parameters:
                - {name: cmd, value: "pnpm test:perf"}

          # phone-smoke: serialized via mutex, runs only when a preview URL is available
          - name: phone-smoke
            template: phone-smoke
            dependencies: [build]
            when: "'{{workflow.parameters.preview-url}}' != ''"
            arguments:
              parameters:
                - name: preview-url
                  value: "{{workflow.parameters.preview-url}}"

          - name: load
            template: step
            dependencies: [e2e]
            when: "'{{workflow.parameters.mode}}' == 'nightly'"
            arguments:
              parameters:
                - {name: cmd, value: "k6 run load/submit.js"}

          - name: device-matrix
            template: step
            dependencies: [e2e]
            when: "'{{workflow.parameters.mode}}' == 'release'"
            arguments:
              parameters:
                - {name: cmd, value: "pnpm test:devices"}

    # ── Generic step template ───────────────────────────────────────────────
    - name: step
      inputs:
        parameters:
          - name: cmd
      activeDeadlineSeconds: 600
      container:
        image: ghcr.io/drawrace/ci-snap:2026-04-21
        command: [bash, -lc, "{{inputs.parameters.cmd}}"]
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi
        volumeMounts:
          - name: workspace
            mountPath: /workspace
      volumes:
        - name: workspace
          emptyDir: {}

    # ── Snapshot step template (pinned image for deterministic rendering) ───
    - name: snap-step
      inputs:
        parameters:
          - name: cmd
      activeDeadlineSeconds: 600
      container:
        image: ghcr.io/drawrace/ci-snap:2026-04-24
        command: [bash, -lc, "{{inputs.parameters.cmd}}"]
        resources:
          requests:
            cpu: 500m
            memory: 512Mi
          limits:
            cpu: 2000m
            memory: 2Gi
        volumeMounts:
          - name: workspace
            mountPath: /workspace
      volumes:
        - name: workspace
          emptyDir: {}

    # ── Phone-smoke template ────────────────────────────────────────────────
    # Serialized via mutex so concurrent PRs queue rather than fight over the
    # single Pixel 6.  ADB_SERVER_SOCKET points at the adb-relay service which
    # bridges the CI pod to the persistent ADB server on the coding host.
    - name: phone-smoke
      inputs:
        parameters:
          - name: preview-url
      activeDeadlineSeconds: 300
      # Serialize access to the Pixel 6 — concurrent PRs queue behind this mutex
      synchronization:
        mutex:
          name: drawrace-phone
      container:
        image: ghcr.io/drawrace/ci-phone:2026-04-21
        command: [bash, -lc]
        args:
          - |
            set -euo pipefail
            # Verify ADB is reachable before spending time on the run
            adb-check
            # Run the smoke against the provided preview URL
            # --skip-build: dist is already published to Cloudflare Pages
            PHONE_SMOKE_URL="{{inputs.parameters.preview-url}}" \
              bash e2e/phone-smoke/run.sh --skip-build
        env:
          - name: ADB_SERVER_SOCKET
            value: "tcp:adb-relay.tailnet:5037"
        resources:
          requests:
            cpu: 200m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        volumeMounts:
          - name: workspace
            mountPath: /workspace
      # Upload screenshots on failure so engineers can see what the phone saw
      outputs:
        artifacts:
          - name: phone-smoke-screenshots
            path: /workspace/e2e/phone-smoke/artifacts
            archive:
              tar: {}
            # s3 destination configured by the Argo controller's artifact repo
```

**PR wall-clock budget: <10 minutes.** Measured slice (parallelism=6): lint 30s / unit 90s / physics-golden 45s / build 90s / render-snap 150s / e2e 240s / contract 90s / perf 180s / phone-smoke ~120s (serialized, runs in parallel with other post-build steps) → ~7 min critical path. Nightly adds load (7m); release adds device-matrix (~12m).

### 12. Flaky Test Policy

1. **Determinism is a hard requirement.** No test may use `Date.now()`, `Math.random()`, `setTimeout` with a real clock, or `requestAnimationFrame` bound to wall time. A lint rule (`no-restricted-globals`) enforces this in test files.
2. **Retry budget: one.** Playwright `retries: 1` in CI, `0` locally. A test that passes on retry logs a `flake` event to the metrics pipeline; more than 3 flakes in 7 days auto-opens a quarantine bead.
3. **Quarantine flow.** Flaky tests get a `.flaky` filename suffix and run in a separate Argo task that does not block merge. They must be fixed or deleted within 14 days; a bot closes stale quarantines by deleting the test.
4. **No sleep.** No `page.waitForTimeout`. Always wait on an assertion or a signal (`waitForResponse`, `waitForFunction`).
5. **Seeded everything.** Every test begins with `seed=1` unless it explicitly tests randomness, in which case it loops over seeds 1–32.

### 13. Gameplay Bot Harness

A reusable `@drawrace/bot` package exposing:

```ts
export interface BotRun {
  shape: Polygon;        // parametric or explicit
  track: TrackId;
  seed: number;
}
export interface BotResult {
  finishTicks: number;
  finishMs: number;
  finalX: number;
  dnf: boolean;
  rankDelta: number;     // vs provided ghost set
  positionStream: Position[];
}
export async function runBot(r: BotRun, ghosts?: Ghost[]): Promise<BotResult>;
export function parametricWheel(kind: "circle"|"oval"|"star"|"blob", params: Record<string, number>): Polygon;
```

Used by:
- **Regression tests** (Layer 2): `runBot` is the single entry point.
- **ML-driven tuning**: an evolutionary search (CMA-ES) over `parametricWheel("blob", …)` params minimizes `finishMs`. The best-ever shape on track v1 is checked into `reference-champion.json`; if a player submits a time faster than the champion by >2%, the submission is quarantined for human review. This is a cheap, impossible-to-gradient-descend-against anti-cheat baseline.
- **Exploratory testing**: fuzz with 10k random polygons per nightly run, flag any combination that DNFs unexpectedly, crashes, or triggers `console.error`.

### 14. Metrics & Dashboards

All metrics flow to the existing Grafana on ardenone-cluster via a Prometheus pushgateway at the end of each Argo workflow.

| Metric | Source | Alert |
|---|---|---|
| `drawrace_coverage_lines` | Vitest | < 80% fails PR |
| `drawrace_flake_rate_7d` | Argo + test reporter | > 2% pages on-call |
| `drawrace_physics_golden_max_delta_ticks` | Layer 2 | > 0 fails PR (must be bit-exact) |
| `drawrace_physics_champion_ms{track="v1"}` | Bot harness nightly | Tracks floor, no alert |
| `drawrace_ci_duration_seconds{stage=*}` | Argo | p95 > 600s on PR pages |
| `drawrace_bundle_size_gz_bytes` | size-limit | > 400KB fails PR |
| `drawrace_perf_frame_p95_ms` | Layer 7 | > 20ms fails PR; trend visible |
| `drawrace_replay_mismatch_rate` | validator logs | > 0.1% pages on-call (indicates client/server physics drift) |

A single Grafana dashboard `DrawRace / Quality` panels: CI runtime trend, flake heatmap by test, physics-golden delta over time, champion-time floor per track, perf budget headroom. That dashboard is the one-stop view for "is the game healthy to ship right now."

---

The arc is: Layers 1–2 catch **99% of bugs in <1 minute**; Layers 3–6 catch integration regressions before a user sees them; Layers 7–9 protect performance and scale; Layer 6's replay verifier is the keystone that makes physics changes a first-class, reviewable event rather than a silent gameplay-altering drift.

---

## Roadmap & Delivery Plan

A phased plan that trades speed for safety up front: the determinism harness (Phase 0) must land first because every downstream phase leans on it. Nothing ships to real users until Phase 4.

Estimated wall-clock for a two-person team: **~10 weeks**. Solo: ~16 weeks.

---

### Phase 0 — Foundation (1–2 weeks)

**Goal:** a minimal repo with the determinism commitment encoded in code and CI.

Deliverables:
- Monorepo (`pnpm` workspaces) with packages: `apps/web`, `packages/engine-core`, `packages/bot`, `crates/api`, `crates/validator`.
- `engine-core` exports `createHeadlessRace({ seed, track, wheel })` — no DOM, no canvas, takes polygon + track JSON, returns `{ finishTicks, finalX, streamHash }`.
- Seeded PRNG (`sfc32`), injected clock, fixed 1/60s timestep wired.
- Lint rule banning `Math.random` and real-timer APIs in engine code.
- Vitest running **Layer 1** (unit) and **Layer 2** (physics golden) in <1min.
- Minimal Argo WorkflowTemplate `drawrace-ci` in `declarative-config`, runs lint + unit + physics-golden on push.
- `PHYSICS_VERSION` constant + regeneration script for `golden/wheels.json`.

**Exit criteria:** a pure-Node test can reproduce an identical `streamHash` 100/100 runs. Any `Math.random` call fails lint.

---

### Phase 1 — Playable MVP (2–3 weeks)

**Goal:** a human can draw a wheel and race a bundled ghost, entirely offline, on their phone.

Deliverables:
- `apps/web` Vite + React (or Solid — both fit the 400KB budget; React if team familiarity wins).
- Draw Screen: pointer capture → Douglas-Peucker → centroid → decomposition → preview render.
- Physics integration: Planck.js loaded, wheel attaches to a chassis via revolute joint + motor.
- Canvas 2D renderer with scene layers (§Graphics & UX 3): sky gradient, single parallax hill, terrain polyline with ink edge, chassis sprite, wheel Path2D.
- v1 track JSON authored: `hills-01`, ~40s target. Single track ships.
- 3 hand-authored tutorial ghosts bundled as assets (recorded via a dev tool that saves ghost blobs from runs).
- Result Screen with time, basic "beat ghost" feedback, Retry.
- Service Worker caching shell + assets. Web App Manifest. Installable on iOS and Android.
- Cloudflare Pages project bootstrapped (`wrangler pages project create drawrace`) and `drawrace-sensor` added to `declarative-config` to trigger `website-build` on push to `jedarden/drawrace`. No new secrets needed — `cloudflare-pages-secret` and `github-webhook-secret` already exist on `iad-ci`. Production domain parked; preview URL live at `drawrace.pages.dev`. See §Multiplayer & Backend 10 for full setup.

**Exit criteria:** install PWA on a Pixel 6; draw a circle; finish the race; see a finish time; retry. 60fps on Pixel 6; 30fps on a Redmi 9 class device (the targeted floor). `drawrace.pages.dev` resolves and serves the PWA.

> **Status (2026-04-22):** Code complete — all Phase 1 deliverables built and tests passing. Cloudflare Pages project not yet stood up; follow §Multiplayer & Backend 10a to deploy.

---

### Phase 2 — Backend & Multiplayer (2 weeks)

**Goal:** submit ghosts, fetch 3 ghosts per race via matchmaking, leaderboard works.

Deliverables:
- `crates/api` (axum): `/v1/submissions`, `/v1/leaderboard/*`, `/v1/ghosts/*`, `/v1/matchmake/*`, `/v1/names`, `/v1/health`, `/v1/metrics`.
- `crates/validator`: pulls jobs from Redis, loads engine-core WASM (via `wasmtime`), re-sims and writes verdict. Long-running loop (no K8s Job).
- Postgres schema + migrations (sqlx): `players`, `ghosts`, `submissions`, `names`. Materialized view `leaderboard_buckets`.
- Garage S3 bucket `drawrace-ghosts` on `ardenone-hub`, credentials via sealed-secret, client configured via IRSA-equivalent (or static secret — pragmatic).
- Redis deployment in-cluster (ephemeral).
- Argo `WorkflowTemplate` `drawrace-build` in declarative-config (buildx → push → manifest bump).
- ArgoCD `Application` for drawrace in `declarative-config/k8s/rs-manager/applications/`, pointed at `k8s/iad-acb/drawrace/`.
- TLS via cert-manager + `letsencrypt-prod`; DNS record `api.drawrace.example` pointing at the cluster's Tailscale-accessible ingress.
- Frontend swaps bundled ghosts for API fetch; IndexedDB cache retained as fallback.
- Seed pool: 20–30 dev-recorded ghosts committed to the validator image under `/seeds/track_1/` and loaded on startup if the DB is empty.

**Exit criteria:** two test accounts can submit, see each other on the leaderboard, and race each other's ghosts. Validator rejects a forged submission with a tampered HMAC. Full pipeline (git push → ArgoCD sync → running on spot cluster) works without manual intervention.

---

### Phase 3 — Polish (1–2 weeks)

**Goal:** the game looks and feels like §Graphics & UX describes.

Deliverables:
- Wobble cosmetic stroke on the wheel (§Graphics & UX 4).
- Parallax background layers with authored SVG hill silhouettes.
- Cross-hatch terrain fill, grass strip with tuft sprites.
- Dust particle system, countdown animation, finish-line confetti.
- Caveat + Patrick Hand webfonts subsetted and preloaded.
- Accessibility pass: WCAG AA contrast audit, `prefers-reduced-motion` pathway, haptics, ARIA on non-game UI.
- Optional sound pack (opus+aac); off by default; settings toggle.
- Low-end device fallbacks wired: particle disable at 25ms frame time, ghost-count drop to 1 at 33ms, 30Hz sim fallback.
- Full Playwright E2E suite (Layer 4): the 5+ scenarios in §Testing 5.
- Snapshot tests (Layer 3) with pinned container image.
- Perf budget tests (Layer 7) enforced in CI.

**Exit criteria:** visual comparison against §Graphics & UX shows parity. WCAG AA audit passes. Redmi 9 sustains 30fps for a full race. CI green with all 9 layers exercised (load + device matrix nightly-only).

---

### Phase 4 — Beta (1 week)

**Goal:** 20–40 invited testers produce enough real data to validate matchmaking and surface anti-cheat edge cases.

Deliverables:
- `beta.drawrace.example` on Cloudflare Pages production; `api.drawrace.example` on spot cluster.
- Invite link + short landing page.
- Feedback channel (Google Form or a simple `/feedback` endpoint logging to Postgres).
- Replay-mismatch dashboard green; alerts wired to me@jedcabanero.com.
- Load test (Layer 8) run against staging during beta; results reviewed.
- Chaos test: kill an api pod mid-session; verify client retry behavior in real-world conditions.
- Bucket seeding: take top-30 real beta times as the initial seed pool for launch.

**Exit criteria:** 0 crash reports in last 48h of beta. Replay-mismatch rate < 0.5% (expected; real physics drift bugs would surface here). No WCAG regressions. Load test passes thresholds.

---

### Phase 5 — Launch (0.5 week)

**Goal:** DrawRace is live at `drawrace.example`.

Deliverables:
- DNS cutover: `drawrace.example` → Cloudflare Pages production.
- PWA install instructions on the landing page.
- Blog post / HN announce (optional).
- Monitoring baselines recorded (QPS, submission rate, bucket distribution).
- Post-launch watch shift: human-on-call for 48h post-launch (alerts already in place from Phase 3).

**Exit criteria:** public URL resolves, install flow works on iOS Safari + Android Chrome, the first dozen public submissions propagate into the leaderboard, no P0/P1 alerts in first 24h.

---

### v1 Cut Line (explicit non-goals)

Items explicitly **out** of v1 — do not scope-creep:
- Multiple tracks (one track launches; track 2 is the first post-v1 feature).
- Accounts, login, password, email.
- Real-time multiplayer (architecture is ready; feature is not v1).
- Custom car bodies / cosmetics.
- Paid features, IAP, ads.
- Desktop-first UX (desktop works but is not actively designed for).
- Leaderboard friends / social features.
- Wheel-shape constraints (single-stroke mode, convex-only mode) — post-v1 progression hooks.

---

### Post-v1 Backlog (prioritized)

1. **Track 2 + track rotation UI.** Data-only addition per §Gameplay & Physics 5 schema.
2. **Daily challenge.** Same track, modifier + separate leaderboard; seeded from UTC date.
3. **Wheel constraints mode.** Convex-only, vertex-capped, diameter-capped.
4. *(Removed — replay-as-input is already v1. Ghost blobs store `(seed, polygon, stroke, track_id, finish_time)` and both client and server re-simulate.)*
5. **Real-time live racing.** Per §Multiplayer & Backend 13. New `drawrace-live` Deployment on on-demand node pool.
6. **Recovery phrase** for cross-device identity without accounts.
7. **Track editor.** Web-based polyline editor; community tracks.
8. **Cosmetic wheel trails.** Unlockable by total distance raced.
9. **Native app wrappers** (optional): Capacitor or Expo over the same PWA. Only if install-friction data shows PWA install rates are poor.

---

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Planck.js WASM float drift across platforms | Medium | High | Replay tolerance `≤ 2 ticks` (≈33 ms at `1/60 s`, §Multiplayer & Backend 8); widen to `≤ 15 ticks` + shape-identity fallback if needed |
| Bundle exceeds 400KB | Medium | Medium | size-limit PR gate; Planck bundle is the main risk — tree-shake hard, lazy-load validator unused features |
| Rackspace Spot preemption during beta | High | Low | 2+ api replicas, HPA, client retries; already expected and handled |
| iOS Safari PointerEvents quirks | Medium | High | Early real-device testing in Phase 1; fallback to Touch Events if needed |
| Low-end Android GC pauses spoil frame budget | Medium | Medium | Zero-alloc hot path (§Gameplay & Physics 9); 30Hz fallback; particle disable |
| Matchmaking empty-bucket at launch | High (known) | Medium | Seed pool (§Multiplayer & Backend 6) and Phase 4 beta times seeded into production |
| Self-inflicted physics drift from "small tuning tweak" | Medium | High | `PHYSICS_VERSION` + manual golden regeneration (§Gameplay & Physics, §Testing) |

---

### Success Metrics (measurable)

Tracked from launch day on the `DrawRace / Quality` Grafana dashboard:

- **D1 retention ≥ 40%** — users who return the day after install. (Measured by `player_uuid` seen in submissions on day+1.)
- **Median session = 3+ runs.** Players draw more than once.
- **Replay-mismatch rate < 0.5%.** Anti-cheat and physics drift are both under control.
- **P95 API latency < 400ms.** Submission UX stays instant.
- **Bucket distribution within 10% of design percentiles.** Matchmaking is working.
- **Zero P0/P1 incidents in first 30 days.**

