# Layer 3 Snapshot Tests - Complete Guide

## Overview

Layer 3 rendering snapshot tests isolate **rendering regressions** from **physics changes** by using a replay driver that pushes pre-computed positions into the renderer. This means:

- Physics changes → update fixture → no snapshot changes needed
- Rendering changes → baseline images need updating
- Both changes can be tested independently

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Playwright Test (e2e/snapshot.spec.ts)                      │
│   ↓                                                         │
│ Screenshot at checkpoint ticks → PNG                        │
│   ↓                                                         │
│ pixelmatch diff against baseline (0.04 tolerance, 300px max)│
└─────────────────────────────────────────────────────────────┘
                            ↑
                            │
┌─────────────────────────────────────────────────────────────┐
│ Fixture Page (apps/web/snapshot-test.html)                 │
│   ↓                                                         │
│ createRenderer() + createReplayDriver(fixture)              │
│   ↓                                                         │
│ renderCheckpoint(tick) → draws canvas                      │
└─────────────────────────────────────────────────────────────┘
                            ↑
                            │
┌─────────────────────────────────────────────────────────────┐
│ Fixture JSON (fixtures/snapshot-fixture.json)               │
│   - track definition                                       │
│   - wheelDraw (simplified polygon)                          │
│   - frames[] at ticks [0, 30, 120, 300]                    │
│     - wheel position/angle                                  │
│     - chassis position/angle                                │
│     - rearWheel position/angle                              │
└─────────────────────────────────────────────────────────────┘
```

## Files

| File | Purpose |
|------|---------|
| `e2e/snapshot.spec.ts` | Test runner with pixelmatch diff |
| `apps/web/snapshot-test.html` | Fixture page that loads renderer + replay driver |
| `fixtures/snapshot-fixture.json` | Pre-computed physics frames |
| `packages/engine-core/src/replay-driver.ts` | Replay driver implementation |
| `packages/engine-core/scripts/gen-snapshot-fixture.ts` | Fixture generation script |
| `e2e/snapshots/*.png` | Baseline images |
| `e2e/snapshots/*.diff.png` | Diff images (on failure) |

## Running Tests

### Method 1: Docker Compose (Recommended)

```bash
# Test against existing baselines
pnpm snap:docker

# Generate new baselines
pnpm snap:docker:update

# Or directly with docker-compose
docker-compose -f docker-compose.snapshot.yml run --rm snapshot-test
SNAPSHOT_UPDATE=1 docker-compose -f docker-compose.snapshot.yml run --rm snapshot-test
```

### Method 2: Justfile

```bash
just snap-verify    # Test against existing baselines
just snap-update    # Generate new baselines
```

### Method 3: Shell Script

```bash
./scripts/snap-test.sh
UPDATE=1 ./scripts/snap-test.sh
```

### Method 4: Direct Playwright (Not Recommended)

```bash
# Will likely fail due to font rendering differences
pnpm test:snapshot
UPDATE=1 pnpm test:snapshot:update
```

## Workflow Scenarios

### Scenario 1: Physics Change

When physics constants change (gravity, motor speed, etc.):

1. The replay fixture needs updating:
   ```bash
   pnpm regen-snapshot-fixture
   ```

2. Baseline images should NOT change (rendering is isolated)

3. Commit: `fixtures/snapshot-fixture.json` + physics code

### Scenario 2: Rendering Change

When visual output changes (colors, layout, rendering order):

1. Make the rendering change

2. Generate new baselines:
   ```bash
   pnpm snap:docker:update
   ```

3. Review the new images in `e2e/snapshots/`

4. Commit: rendering code + baseline images

### Scenario 3: Both Physics and Rendering

When changes affect both:

1. Update fixture: `pnpm regen-snapshot-fixture`
2. Generate baselines: `pnpm snap:docker:update`
3. Review images
4. Commit: all three together

## Test Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Checkpoint ticks | 0, 30, 120, 300, finish | Start, early race, mid race, late race, finish |
| Tolerance | 0.04 (4%) | Allows anti-aliasing variations |
| Max diff area | 300px | Catches structural breaks, ignores minor jitter |
| Canvas size | 390×844 | iPhone 14 baseline |
| Reduced motion | Yes | Disables confetti, particles |

## Container Environment

Tests run in `ghcr.io/drawrace/ci-snap:2026-04-21`:

- **Base**: Debian 13
- **Fonts**: Playwright-bundled only (no system font variance)
- **Browser**: Chromium headless
- **CSS**: `@font-face` with `font-display: block`
- **Media query**: `prefers-reduced-motion: reduce` always active

This ensures **deterministic font rendering** across different CI runners and developer machines.

## Troubleshooting

### Tests fail locally but pass in CI

**Cause**: Font rendering differences

**Solution**: Run tests in the containerized environment:
```bash
pnpm snap:docker
```

### All checkpoints fail with large diffs

**Cause**: Renderer structure change or broken fixture

**Solution**:
1. Verify fixture loads: Check browser console for errors
2. Regenerate fixture: `pnpm regen-snapshot-fixture`
3. Check renderer hasn't fundamentally changed (e.g., coordinate system)

### Specific checkpoint fails

**Cause**: Rendering regression at that tick

**Solution**:
1. Review the diff image (attached to test output)
2. If intentional: update baseline for that checkpoint only
3. If not: debug the rendering code

### "Target page, context or browser has been closed"

**Cause**: Missing system libraries for Chromium

**Solution**: Use containerized test environment (see Running Tests above)

## CI Integration

In `drawrace-ci` Argo WorkflowTemplate:

```yaml
- name: render-snap
  template: step
  dependencies: [build]
  arguments: { parameters: [{name: cmd, value: "pnpm test:snapshot"}] }
```

This runs after the build step and blocks merge on snapshot failures.

## References

- Plan §Testing 4: Layer 3 — Rendering Snapshot Tests
- `e2e/snapshots/README.md` - Quick reference
- `packages/engine-core/src/replay-driver.ts` - Replay driver implementation
