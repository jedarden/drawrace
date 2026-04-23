# Layer 3 Rendering Snapshot Tests

This directory contains baseline images for rendering snapshot tests.

## Purpose

Layer 3 tests isolate rendering regressions from physics by using a **replay driver** that pushes pre-computed positions into the renderer. This means a physics change doesn't cause a cascade of snapshot failures.

## Test Design

- **Fixture page**: `apps/web/snapshot-test.html` loads a minimal renderer with replay driver
- **Replay data**: `fixtures/snapshot-fixture.json` contains pre-computed physics frames
- **Checkpoint ticks**: 0, 30, 120, 300, finish (capturing key race moments)
- **Diff tolerance**: 0.04 (4% per-pixel), 300px max diff area

The generous tolerance accommodates:
- Sub-pixel rendering differences
- Font rendering variations
- Minor anti-aliasing differences

While catching structural breaks like missing elements, wrong colors, or layout shifts.

## Running Tests

### Local (Not Recommended)

Snapshot tests require the pinned CI container for deterministic font rendering:

```bash
# Using justfile (recommended)
just snap-update    # Generate new baselines
just snap-verify    # Test against existing baselines

# Using shell script
./scripts/snap-test.sh
UPDATE=1 ./scripts/snap-test.sh
```

### Direct Playwright (Will Fail on Most Systems)

```bash
# This will likely fail due to font rendering differences
pnpm test:snapshot
UPDATE=1 pnpm test:snapshot:update
```

## Container Environment

Tests run in `ghcr.io/drawrace/ci-snap:2026-04-21`:
- Debian 13 base
- Playwright-bundled fonts only
- No system fonts that vary by distro
- `@font-face` with `font-display: block`
- `prefers-reduced-motion: reduce` for deterministic output

## Generating New Baselines

1. Make intentional rendering changes
2. Run: `UPDATE=1 just snap` or `just snap-update`
3. Review the generated images in `e2e/snapshots/`
4. Commit the baselines alongside the code change

## Test Failures

When CI reports a snapshot mismatch:

1. **Review the diff image** (attached to test output)
2. **Check if the change is intentional**:
   - If yes: run `just snap-update` locally and commit the new baseline
   - If no: fix the rendering regression
3. **Physics changes should NOT cause snapshot failures**:
   - The replay driver uses pre-computed positions
   - Re-generate fixture with `npx tsx packages/engine-core/scripts/gen-snapshot-fixture.ts`

## CI Integration

The `drawrace-ci` Argo workflow runs `render-snap` after the build step:
```yaml
- name: render-snap
  template: step
  dependencies: [build]
  arguments: { parameters: [{name: cmd, value: "pnpm test:snapshot"}] }
```

## Files

- `e2e/snapshot.spec.ts` - Test implementation with pixelmatch
- `apps/web/snapshot-test.html` - Fixture page
- `packages/engine-core/src/replay-driver.ts` - Replay driver logic
- `packages/engine-core/scripts/gen-snapshot-fixture.ts` - Fixture generator
- `e2e/snapshots/*.png` - Baseline images (generated)
- `e2e/snapshots/*.diff.png` - Diff images (on failure, generated)

## References

- Plan §Testing 4: Layer 3 — Rendering Snapshot Tests
- Plan §Gameplay & Physics 6: Deterministic Simulation
- Plan §Multiplayer & Backend 8: Anti-cheat / Server-side Re-simulation
