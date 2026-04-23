# DrawRace Testing Documentation

This directory contains documentation for DrawRace's automated testing strategy, as specified in `plan.md` §Testing.

## Test Layers

| Layer | Name | Tool | Purpose |
|-------|------|------|---------|
| 1 | Unit Tests | Vitest | Pure helper modules, 95%+ coverage |
| 2 | Headless Physics | Node.js | Deterministic simulation, golden files |
| 3 | Rendering Snapshots | Playwright | Visual regression isolation |
| 4 | Input / E2E | Playwright | Full draw→race pipeline |
| 5 | Backend Contract | Vitest/cargo | API golden pairs, OpenAPI conformance |
| 6 | Replay Verification | Rust/wasmtime | Anti-cheat, cross-version drift |
| 7 | Performance Budget | CDP | Frame time, bundle size |
| 8 | Load & Chaos | k6 | Scale, spot preemption |
| 9 | Device Matrix | ADB/BrowserStack | Real-device smoke |

## Documentation

- **[snapshot-tests.md](./snapshot-tests.md)** - Layer 3 rendering snapshot tests
- **[layer-2-physics.md](./layer-2-physics.md)** - Layer 2 headless deterministic physics
- **[layer-4-e2e.md](./layer-4-e2e.md)** - Layer 4 input simulation and E2E
- **[layer-5-contract.md](./layer-5-contract.md)** - Layer 5 backend contract tests
- **[layer-6-replay.md](./layer-6-replay.md)** - Layer 6 replay verification
- **[layer-7-perf.md](./layer-7-perf.md)** - Layer 7 performance budgets
- **[layer-8-load.md](./layer-8-load.md)** - Layer 8 load and chaos testing

## Running Tests

### All Tests
```bash
pnpm test                    # Unit tests (Layer 1)
pnpm test:e2e                # E2E tests (Layer 4)
pnpm test:snapshot           # Snapshot tests (Layer 3, requires Docker)
pnpm test:contract           # Backend contract tests (Layer 5)
cargo test -p validator      # Replay verification (Layer 6)
pnpm test:perf              # Performance budgets (Layer 7)
k6 run load/submit.js       # Load test (Layer 8)
pnpm test:phone             # Device smoke (Layer 9)
```

### Individual Layers
```bash
# Layer 2: Physics golden files
pnpm -F engine-core test:golden

# Layer 3: Rendering snapshots (Docker)
docker compose -f docker-compose.snapshot.yml run --rm snapshot-test

# Layer 5: Backend contract (requires Docker services)
docker compose -f docker-compose.test.yml up --abort-on-container-exit
```

## CI Pipeline

The `drawrace-ci` workflow (see `plan.md` §Testing 11) runs tests in a DAG:

```
lint → unit → physics-golden → build → render-snap → e2e → backend-contract → perf
                                                    ↓
                                              phone-smoke (if preview-url)
```

Target: **<10 minutes** wall-clock on PR.

## Test Philosophy

From `plan.md` §Testing 1:

> DrawRace is dominated by a single high-risk surface: **the gameplay loop where a drawn polygon becomes physics geometry that rolls down a track**.
>
> The entire strategy is unlocked by **one architectural commitment**: the physics and shape-processing core must be pure, deterministic, and runnable in Node. Given a fixed timestep, a seeded RNG, and a monkey-patched `performance.now()`, the same input polygon must produce the same finish time, bit-for-bit, on every run.

This commitment enables:
- **Layer 2 golden files**: Bit-exact physics assertions
- **Layer 3 snapshots**: Rendering isolated from physics
- **Layer 6 replay verification**: Server-side anti-cheat

## Flaky Test Policy

1. **Determinism is a hard requirement** - lint rule bans `Math.random()` and real-time APIs
2. **Retry budget: one** (`retries: 1` in CI)
3. **Quarantine flow** - Flaky tests get `.flaky` suffix and separate CI task
4. **No sleep** - Wait on assertions or signals, never `page.waitForTimeout`
5. **Seeded everything** - Tests default to `seed=1`

See `plan.md` §Testing 12 for full policy.
