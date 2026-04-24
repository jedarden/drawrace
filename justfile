# DrawRace justfile commands
# See https://github.com/casey/just

# Run Layer 3 snapshot tests in the pinned CI container
# This ensures deterministic font rendering and cross-platform consistency
snap:
    docker run --rm -it \
        -v {{cwd() }}:/work \
        -w /work \
        -e SNAPSHOT_UPDATE={{env_var_or_default("SNAPSHOT_UPDATE", "")}} \
        ghcr.io/drawrace/ci-snap:2026-04-24 \
        sh -c "pnpm install && pnpm test:snapshot"

# Run snapshot tests in update mode (generates new baselines)
snap-update:
    SNAPSHOT_UPDATE=1 just snap

# Run snapshot tests against existing baselines
snap-verify:
    just snap

# Build the project
build:
    pnpm build

# Run all unit tests
test:
    pnpm test

# Run e2e tests (requires functional Playwright environment)
test-e2e:
    pnpm test:e2e

# Lint code
lint:
    pnpm lint

# Type check
typecheck:
    pnpm -r exec tsc --noEmit

# Generate snapshot fixture from physics simulation
gen-fixture:
    npx tsx packages/engine-core/scripts/gen-snapshot-fixture.ts

# Regenerate physics golden files (requires manual review)
regen-golden:
    pnpm regen-golden

# Install dependencies
install:
    pnpm install

# Clean build artifacts
clean:
    rm -rf node_modules apps/*/node_modules packages/*/node_modules
    rm -rf apps/*/dist packages/*/dist
    rm -rf playwright-report test-results
