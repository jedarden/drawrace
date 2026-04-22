# DrawRace — Marathon Coding Instruction

You are the sole implementation agent for **DrawRace**, a mobile-first wheel-drawing racing PWA. Each iteration, you pick up where the last left off and make concrete, committed progress toward a shippable v1.

## Authoritative Sources

- **Plan:** `/home/coding/drawrace/docs/plan/plan.md` — the consolidated implementation plan. It is the source of truth for architecture, physics, backend, graphics, testing, roadmap, and all the gap-fix decisions from five rounds of review. Read it.
- **Supporting notes:** `/home/coding/drawrace/docs/notes/features.md` (original design feel)
- **Research:** `/home/coding/drawrace/docs/research/*.md` (prior art, touch-drawing ergonomics, ghost-replay patterns, layout research)
- **Environment conventions:** `/home/coding/CLAUDE.md` — kubectl access, ArgoCD, Argo Workflows, beads, ADB/Pixel 6 setup
- **GitHub remote:** `https://github.com/jedarden/drawrace` (push approved on every iteration)

## Working Directory

`/home/coding/drawrace`

## Beads Tracking

Use `br` (beads_rust) at `~/.local/bin/br` for phase/task tracking. On first iteration if `.beads/` does not exist:

1. Run `br init` in the repo root.
2. Create a **genesis bead** (`br create --type genesis`) titled `Genesis: DrawRace Implementation` with body referencing `docs/plan/plan.md` and a progress checklist for Phases 0–5 (see Roadmap & Delivery Plan section of plan.md).
3. Create one **epic bead per phase** that blocks the genesis bead. Use the phase exit criteria from `plan.md` as the bead's acceptance criteria.
4. Inside each epic, decompose into task-level beads as you actually start the phase — do not pre-plan every task.

On every subsequent iteration: `br list --status open --no-pager` first to see the work queue, pick the next ready (unblocked) bead, move it to `in_progress`, work it, close it when done.

If `br` reports `database disk image is malformed`, run `br doctor --repair` once; if that fails, `rm .beads/beads.db && br sync --import` to rebuild from the JSONL. Never trust `br doctor` alone — cross-check with `sqlite3 .beads/beads.db "PRAGMA integrity_check;"` if suspicious.

## Phase Discipline

Work the phases in order. Do not skip ahead.

- **Phase 0 — Foundation** (start here): pnpm workspace monorepo with `apps/web`, `packages/engine-core`, `packages/bot`, `crates/api`, `crates/validator`. Seeded PRNG (sfc32), injected clock, fixed 1/60s timestep, Planck.js loaded. Lint rule banning `Math.random` / real-time APIs in engine code. Vitest running Layer 1 (unit) + Layer 2 (physics golden) in <1 minute. `PHYSICS_VERSION` constant + golden regeneration script. Minimal Argo `drawrace-ci` WorkflowTemplate in `declarative-config`. **Exit criteria:** pure-Node test reproduces identical `streamHash` 100/100 runs; `Math.random` in engine code fails lint.

- **Phase 1 — Playable MVP** (only after Phase 0 exit criteria pass): `apps/web` Vite+React, draw pipeline → physics → single race vs 3 bundled tutorial ghosts, canvas-2D renderer with scene layers, track `hills-01` authored, Result Screen + Retry, Service Worker shell cache, PWA installable. **Exit criteria:** install PWA on a Pixel 6, draw a circle, finish a race.

- **Phase 2 — Backend & Multiplayer**, **Phase 3 — Polish**, **Phase 4 — Beta**, **Phase 5 — Launch**: see plan.md. Don't scope-creep past the v1 cut line in the roadmap.

## Per-Iteration Workflow

1. `cd /home/coding/drawrace && git pull --ff-only` (sync with origin).
2. `br list --status open --no-pager` — see the work queue. On very first iteration, bootstrap beads per the section above.
3. Pick the next unblocked bead in the current phase. `br update <id> --status in_progress --assignee marathon`.
4. Do the work. Write code. Run the relevant tests.
5. Run the linters/tests the phase requires (`pnpm lint`, `pnpm vitest run`, `cargo test -p <crate>` etc. depending on scope).
6. `git add <specific paths> && git commit -m "<scope>: <what changed>"`. Include the bead ID in the commit trailer (`Closes: bd-XXX`).
7. `git push origin main`.
8. `br update <id> --status closed` (or keep open with a progress note if not done).
9. If you completed all beads in a phase, update the genesis bead's progress checklist and close the phase's epic.
10. **End the iteration.** Do not start a second bead. The marathon loop will re-invoke you after the iteration delay — a clean exit lets logs flush.

## Constraints (binding)

Taken from plan.md's "Key Constraints" — these are non-negotiable.

- **JS bundle ≤ 400KB gzipped** (initial payload). `size-limit` enforces.
- **Determinism:** `Math.random()` banned in engine code (lint-enforced); all time via injected clock; fixed 1/60s timestep; iteration counts `(8, 3)`.
- **No K8s Jobs/CronJobs** — long-running Deployments with internal loops only.
- **No GitHub Actions** — Argo Workflows only.
- **Never apply k8s manifests directly** — GitOps via ArgoCD only. K8s manifests live in `jedarden/declarative-config`, not in this repo.
- **Physics immutability by default.** Any intentional physics change bumps `PHYSICS_VERSION`, requires regenerating goldens by hand, and a matching server rollout before client ships.
- **Never force-push.** Never skip hooks (`--no-verify`). Never run destructive git operations.

## Quality Bar

- **No TODOs left in code.** If a sub-task can't be finished this iteration, spawn a bead for it and leave a test or comment that will fail loudly if someone forgets.
- **No scaffolding without substance.** A commit that only adds empty files is not valid progress. Write the actual function + its test.
- **Tests pass before commit.** Run them. Don't assume.
- **One bead per iteration.** Iterations are cheap; bundling three beads makes the log hard to review.

## What NOT to Do

- Don't add features beyond what the plan specifies (no "while I'm here" additions).
- Don't touch `docs/plan/plan.md` — it's frozen. If you find a real gap, open a bead titled `plan-gap: <short description>` and move on.
- Don't install cluster resources or touch ArgoCD. All of that lives in `jedarden/declarative-config` and is added in Phase 2 via a separate PR there.
- Don't set up GitHub Actions.
- Don't run the v1 physics engine in anything other than Planck.js (no Matter.js, no rapier2d).

## Success Criteria Per Iteration

- Working directory is clean after your commit (no uncommitted changes).
- `main` is pushed to origin and CI is green (or there is no CI for this phase yet).
- One bead transitioned to `closed` (or a clearly-noted progress update).
- `docs/plan/plan.md` unchanged.

---

When in doubt, re-read the relevant section of `plan.md` and follow it. The plan was built from the gameplay-physics spec through the roadmap to resolve 53 gaps over 5 review rounds — trust it.
