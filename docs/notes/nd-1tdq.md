---
name: nd-1tdq
description: Plan.md alignment verification — all items already corrected
metadata:
  type: project
---

# Plan.md Alignment Verification — nd-1tdq

## Task

Update stale plan.md sections to match shipped reality (single docs-alignment pass).

## Verification Summary

All five acceptance criteria items were verified as **already complete** on 2026-07-04. No changes required to plan.md or docs/status/project-status.md.

## Item-by-Item Verification

### 1. ✅ §Gameplay & Physics 3 (Wheel hot-swap) — COMPLETE

**Original issue:** The bullet "Rear axle untouched. Only the drawn front wheel swaps. The rear cartoon-circle wheel (plan §Graphics 5) is permanent." directly contradicted the AWD twin-wheel swap spec.

**Current state (lines 273-310):**
- Line 273: "**Both wheels use the drawn polygon (AWD).**"
- Line 275: "Both wheel wells hold a copy of the same polygon... The car is effectively AWD"
- Line 283: "**Wheel hot-swap procedure (mid-race redraw, twin-wheel)**"
- Lines 287-307: Pseudocode shows `for axle in [chassis.frontAxle, chassis.rearAxle]: // both wheels swap together`
- No contradictory bullet found.

### 2. ✅ §Gameplay & Physics 7 and §Roadmap 'v1 Cut Line' — COMPLETE

**Original issue:** Claims of "v1 ships with exactly one track" needed updating to reflect three shipped tracks and implemented features.

**Current state:**
- **§Gameplay & Physics 7 (line 491-492):** "**v1 shipped with three tracks** (`apps/web/public/tracks/hills-01.json`, `apps/web/public/tracks/canyon-02.json`, `apps/web/public/tracks/dunes-03.json`, wired into `apps/web/src/App.tsx`)."
- **§Post-v1 progression outline (lines 493-508):** All items marked with ✅ **SHIPPED 2026-04** or ✅ **SHIPPED 2026-05** status notes:
  - Daily challenge — SHIPPED 2026-04
  - Community track editor + moderation — SHIPPED
  - Recovery phrase — SHIPPED
  - Cosmetic wheel trails — SHIPPED 2026-04
  - Real-time live racing service — SHIPPED 2026-05
- **§v1 Cut Line (lines 2931-2942):** Updated with shipped status markers.
- **§Post-v1 Backlog (lines 2945-2956):** All items either shipped or marked as future work.

### 3. ✅ §Roadmap Phase 1 'Status (2026-04-24)' note — COMPLETE

**Original issue:** Note claimed mid-race redraw epic was pending.

**Current state (line 2854):**
```
> **Status (2026-07-02):** Phase 1 complete with full mid-race redraw functionality. The mid-race redraw epic (drawrace-vgn.8) shipped and closed 2026-04-24 (see PROGRESS.md 'Mid-Race Wheel Redraw Pass (drawrace-vgn.8) — CLOSED'), bringing AWD twin-wheel hot-swap, zone-based terrain, and surface types to v1. All Phase 1 deliverables verified via phone-smoke on real Pixel 6 hardware.
```

### 4. ✅ Domain placeholders — COMPLETE

**Original issue:** Add note mapping `drawrace.example` placeholders to actual domains.

**Current state (lines 51-53):**
```
**Domain names (note on placeholders vs. actuals):** This plan uses `drawrace.example` as a generic placeholder for documentation. The actual deployed domains are:
- Frontend (PWA): `drawrace.pages.dev` (Cloudflare Pages) — see `apps/web/wrangler.toml`
- API (backend): `api-drawrace.ardenone.com` (Rackspace Spot cluster via Traefik ingress) — see `k8s/ingress.yaml`
```

### 5. ✅ docs/status/project-status.md — COMPLETE

**Current state:** The file already has a superseded notice at the top (lines 1-10):
```
**⚠️ SUPERSEDED DOCUMENT:** This status document is dated 2026-04-23 and contains information that has been superseded by later developments. For current project status, see `PROGRESS.md` at the repo root.

**Known inaccuracies in this document:**
- Claims "no real-time multiplayer" — live racing service shipped (crates/live)
- Claims "no wheel constraints" — progression system shipped
- Claims "single track only" — three tracks shipped (hills-01.json, canyon-02.json, dunes-03.json)
- Lists PRNG as mulberry32 — code uses sfc32 (packages/engine-core/src/prng.ts)
```

## Conclusion

All five items from the acceptance criteria were already addressed in a prior update. The plan.md file accurately reflects the shipped state of DrawRace v1, including:
- AWD twin-wheel hot-swap mechanics
- Three shipped tracks
- Implemented post-v1 features (daily challenge, community tracks, recovery phrase, wheel trails, live racing)
- Domain name mappings
- Proper status references

No file changes required for this task.

## Verification Performed

- Grepped for "Rear axle untouched", "v1 ships with exactly one track", "single track only", "Status (2026-04-24)" — no stale content found
- Read relevant sections: Gameplay & Physics 3, Gameplay & Physics 7, Roadmap Phase 1, v1 Cut Line, Post-v1 Backlog, Domain names section, Overview
- Verified docs/status/project-status.md superseded notice
- Cross-referenced against PROGRESS.md for current implementation status
