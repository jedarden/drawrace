# DrawRace — Feature Notes & Design Document

## Overview

DrawRace is a mobile-first web racing game where players draw their own wheel shape with a finger. The drawn shape becomes the literal physics geometry driving the racer. A perfect circle rolls smoothly; a lopsided blob bounces and lurches. The core loop is: draw a better wheel, get a faster time, climb the leaderboard, race smarter ghosts.

---

## Platform & Deployment

**Target platforms:** iOS Safari 16+, Android Chrome 110+. No native app — full PWA.

**Architecture:** Fully static. All game logic runs client-side. The only server-side surface is a lightweight serverless function (Cloudflare Workers or Netlify Functions) for leaderboard reads/writes and ghost replay storage. No persistent server process.

**Deployment:** Cloudflare Pages. The static build deploys on push to `main`. The leaderboard API and ghost storage run as Cloudflare Workers backed by Cloudflare KV (ghost replays) and D1 (leaderboard entries). This keeps the entire stack within one vendor with a generous free tier.

**PWA requirements:**
- Service Worker caches the game bundle, track assets, and the top N ghost replays for offline play
- Web App Manifest enables Add to Home Screen with a standalone display mode
- No splash screen — first paint must be under 2 seconds on a mid-range Android (Snapdragon 665 class)

---

## Drawing Mechanic

### UX Flow

The game has three screens in sequence:

1. **Draw Screen** — Player draws the wheel shape before the race begins
2. **Race Screen** — Racer runs the track; ghost racers run simultaneously
3. **Result Screen** — Time, rank delta, leaderboard preview, option to retry

There is no mid-race redraw. The wheel is committed when the player lifts their finger and taps "Race." This creates a deliberate moment of commitment and makes each attempt feel consequential.

### Drawing Input

- Canvas-based freehand input using the Pointer Events API (handles both touch and mouse)
- Stroke is captured as an ordered sequence of (x, y) points sampled at ~60fps via `pointermove`
- Points are automatically closed by connecting the last point back to the first when the player lifts
- A minimum stroke length (~150px of total travel) is required before the Race button activates — prevents submitting a dot or a scratch

### Shape Processing

After the stroke is lifted:

1. **Simplification:** Douglas-Peucker algorithm reduces the raw point cloud to a manageable polygon (target: 12–24 vertices). This controls physics complexity and replay payload size.
2. **Centering:** The polygon is translated so its centroid sits at the origin. The centroid becomes the axle point.
3. **Preview render:** The processed polygon is drawn in the canvas with a filled style so the player sees exactly what they committed before hitting Race.
4. **Physics body construction:** The polygon vertices are passed directly to the physics engine as a custom convex (or decomposed concave) rigid body.

### Physics Engine

Matter.js or Planck.js (Box2D port) — both are well-tested for 2D web games and have acceptable bundle sizes (~150–200KB gzipped). Planck.js is preferred because Box2D's convex decomposition (via `b2PolygonShape`) handles irregular shapes more robustly.

If the polygon is concave, decompose it into convex sub-shapes using the POLY-DECOMP library before passing to the physics engine.

**Axle attachment:** The car body attaches to the wheel's centroid via a revolute joint with a motor. Motor applies constant torque; wheel shape determines actual forward progress.

**Physics parameters (starting values, tunable):**
- Wheel density: 1.0
- Wheel friction: 0.8 (against terrain)
- Wheel restitution: 0.3 (bounciness)
- Motor max torque: 40 N·m
- Motor speed: 8 rad/s

### What Makes Wheels Behave Differently

| Shape | Behavior |
|---|---|
| Near-perfect circle | Smooth, fast, minimal energy loss |
| Slightly oval | Mild oscillation, still competitive |
| Triangle | Strong rhythmic bounce, slower but controllable |
| Star / spiky | Chaotic, high bounce, very slow |
| Crescent / concave blob | Unpredictable, tips car body |
| Tiny circle (small drawing) | Low clearance, gets stuck on bumps |
| Huge circle (large drawing) | Good clearance, slower acceleration due to inertia |

Size of the drawn circle matters — larger wheels clear obstacles more easily but carry more rotational inertia. This is a second axis of skill beyond shape.

---

## Multiplayer via Ghost Replays

### Design Rationale

Real-time multiplayer requires always-online infrastructure and adds latency-sensitive networking complexity that conflicts with the offline-play requirement. Ghost/replay multiplayer gives the same competitive feel with none of those constraints.

### How Ghosts Work

A **ghost** is a recorded replay of a previous player's run. It stores:
- The wheel polygon (vertex list)
- A time-series of car body positions and angles (sampled at 10fps — sufficient for smooth playback interpolation)
- The final completion time
- A player display name (anonymous by default, optional custom name)

Ghosts are replayed deterministically from stored positions — they do not re-simulate physics. This means a ghost always looks exactly as it did when recorded, regardless of physics engine version changes.

### Matchmaking

When a player completes a run and posts their time, the server assigns them a **rank bucket**. The ghosts served for their next race are drawn from the bucket immediately above their current rank. Concretely:

- Rank buckets are percentile-based: top 1%, top 5%, top 20%, top 50%, bottom 50%
- A new player (no posted time yet) races the median ghost — the 50th percentile run
- After posting a time, they race the bucket just above wherever they placed
- The top bucket races itself (top 1% races other top 1% times)

This means improvement is always visible: beating a ghost is proof you moved up a tier.

**Ghost count per race:** 3 ghosts maximum. More than 3 creates visual noise and is hard to read on a small screen. Ghosts are shown in a desaturated/transparent style to distinguish them from the player's racer.

### Offline Ghost Cache

The Service Worker caches the last-fetched ghost set (up to 5 replays) in IndexedDB. If the player has no network connection, they race the cached ghosts. If the cache is empty (first-ever offline launch), a set of 3 hand-authored "tutorial ghosts" is bundled with the game assets — these are pre-recorded runs using simple near-circle shapes.

---

## Leaderboard

### Data Model

Each leaderboard entry stores:
- Player ID (UUID generated client-side, stored in `localStorage` — no auth)
- Display name (optional, max 20 chars, profanity-filtered server-side)
- Completion time (milliseconds)
- Track ID (leaderboard is per-track)
- Wheel thumbnail (PNG, 64×64, generated client-side from the polygon before submission)
- Timestamp

### Display

The leaderboard screen shows:
- Player's current rank (highlighted)
- 5 rows above and 5 rows below their rank (contextual window, not the global top-10 by default)
- A "Top 10" tab that switches to the global top
- Each row: rank number, display name, time (formatted as `m:ss.mmm`), wheel thumbnail

The wheel thumbnail is the key visual differentiator. Players can see at a glance that the #1 ranked player drew a rounder wheel. This makes the skill feedback loop legible without explanation.

### Submission

Time submission happens automatically on race completion. The payload is signed with a lightweight HMAC using a client-embedded secret — this is not strong anti-cheat, but it raises the bar above trivially forged POST requests. Serious anti-cheat is out of scope for v1.

---

## Track Design

### v1 Track

One track for launch. A single well-designed track is better than three mediocre tracks. The track should:
- Be approximately 30–45 seconds to complete with a good wheel
- Include a mix of flat road, gentle hills, a bump cluster, and one steep ramp
- End with a visible finish line (checkered flag)
- Have a visible start line where all racers begin

Track geometry is stored as a static array of terrain points (polyline). No procedural generation for v1.

### Camera

Side-scrolling camera follows the player's racer horizontally. Camera never tilts — the horizon stays flat. Vertical camera adjusts smoothly to keep the racer centered when climbing hills.

Ghost racers are rendered wherever they are in world-space relative to the camera — they may be ahead of or behind the player's racer on screen, creating a dynamic sense of competition.

---

## Visual Style

**Aesthetic:** Loose sketch/cartoon. Everything looks hand-drawn — intentionally rough lines, slightly wobbly outlines. This is thematically consistent with the drawing mechanic and reads as charming rather than unfinished.

**Color palette:** Warm paper/cream background, dark ink outlines, 3–4 accent colors for the car body, wheels, and UI. Ghost racers render in a cool blue/gray with reduced opacity.

**Rendering:** HTML5 Canvas 2D API. WebGL is not required — the game has low polygon counts and no shader effects. Canvas 2D is simpler to implement, has universal mobile support, and performs adequately for this use case.

**Animations:**
- Wheel rotates based on actual angular velocity from physics
- Car body tilts/pitches based on physics body angle
- Particle dust puffs kick off the rear wheel when accelerating
- Finish line has a brief celebration animation (confetti burst, time display)

**No loading spinners.** Assets are small enough that any loading state resolves before the player would notice. If an asset takes >500ms, show a static progress bar — no animated spinner.

---

## UX Flow Detail

### Draw Screen

```
┌─────────────────────────────────┐
│  [Track name]          [Help ?] │
│                                 │
│   Draw your wheel below         │
│                                 │
│  ┌───────────────────────────┐  │
│  │                           │  │
│  │    [drawing canvas]       │  │
│  │                           │  │
│  │                           │  │
│  └───────────────────────────┘  │
│                                 │
│     [Clear]     [Race! →]       │
└─────────────────────────────────┘
```

- Canvas is square, ~75vw on phones in portrait
- Clear button resets to blank canvas; no undo — the drawing is meant to feel committed
- Race button is inactive (grayed) until minimum stroke length is met
- A subtle animated hint on first launch shows a finger tracing a circle — disappears after first stroke begins

### Race Screen

```
┌─────────────────────────────────┐
│  Rank #47    [Time: 0:12.4]     │
│                                 │
│ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ │
│         [ghost racers visible]  │
│       [player racer]            │
│ ─────────────────────────────── │  ← terrain
└─────────────────────────────────┘
```

- No controls during the race — the racer drives itself, propelled by the physics engine
- The player watches their wheel perform
- A countdown (3–2–1–GO!) plays before the motor engages
- Race ends when the car crosses the finish line or after a timeout (2× the current fastest time); timeout is a DNF

### Result Screen

```
┌─────────────────────────────────┐
│  Your time: 0:28.441            │
│  Rank: #47  (▲12 from #59)      │
│                                 │
│  [Your wheel thumbnail]         │
│                                 │
│  You beat:  GhostUser_3 (0:31)  │
│  Lost to:   GhostUser_1 (0:24)  │
│                                 │
│  [Leaderboard]   [Try Again]    │
└─────────────────────────────────┘
```

- Rank delta is shown prominently — this is the core feedback signal
- "Try Again" goes back to the Draw Screen with the canvas pre-populated with the previous stroke (so the player can reference it while drawing an improved version — or clear and start fresh)
- "Leaderboard" opens the contextual rank window

---

## Accessibility & Performance

**Performance targets:**
- 60fps physics + render on iPhone 12 and Pixel 6
- 30fps minimum on Snapdragon 665 (e.g., Redmi 9)
- First Contentful Paint < 2s on 4G
- Total JS bundle < 400KB gzipped (game + physics engine + rendering)

**Accessibility:**
- All interactive UI elements have touch targets ≥ 44×44px
- Color choices pass WCAG AA contrast on the background color
- No audio required for gameplay — all feedback is visual (no penalty for silent mode, which is default on many phones)
- Optional sound effects (engine rumble, bounce, finish fanfare) toggled in settings; off by default

**Low-end device fallbacks:**
- Reduce ghost count to 1 on devices where frame time exceeds 33ms
- Disable particle effects on devices where frame time exceeds 25ms
- Physics step rate drops from 60Hz to 30Hz if needed, with rendering interpolation to maintain visual smoothness

---

## Out of Scope for v1

- Account creation / authentication — UUID in localStorage is sufficient
- Multiple tracks — one track at launch
- Custom car body designs — one fixed car body
- Real-time multiplayer — ghost system covers the competitive loop
- Paid features / IAP
- Desktop browser optimization — mobile is the primary target; desktop should work but is not actively designed for

---

## Open Questions (Deferred)

- **Concave wheel decomposition edge cases:** What happens if the player draws a shape so irregular that decomposition produces >10 convex sub-shapes? Cap at 8 sub-shapes and simplify aggressively, accepting some shape distortion.
- **Ghost storage cost at scale:** Cloudflare KV is cheap but not free at very high volume. If ghosts grow beyond 10MB per track, implement TTL-based eviction: only keep ghosts from the last 30 days per rank bucket.
- **Replay pre-population:** At launch the leaderboard is empty. Seed with 20–30 developer-recorded runs across the rank distribution before going live.
- **Track expansion post-v1:** Design the track format so new tracks are data-only additions (terrain point arrays + metadata JSON), requiring no code changes to ship.
