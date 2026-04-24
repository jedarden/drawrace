# ci-snap: Pinned container for Layer 3 snapshot tests
# Ensures font / antialias rendering consistency across CI and local runs
#
# Tag convention: ghcr.io/drawrace/ci-snap:<date>

FROM debian:bookworm-slim-20250410

LABEL org.opencontainers.image.title="DrawRace CI Snapshot Container"
LABEL org.opencontainers.image.description="Pinned environment for rendering snapshot tests (Playwright + webfonts)"
LABEL org.opencontainers.image.created="2026-04-24"

# ── System deps for Playwright Chromium ──────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnspr4 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libxshmfence1 \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# ── Project webfonts (Caveat + Patrick Hand SC) ─────────────────────────────
# Pre-installed as system fonts so Chromium rendering is deterministic even
# if @font-face loading timing varies across runs.
RUN mkdir -p /usr/local/share/fonts/drawrace && \
    curl -fsSL -o /usr/local/share/fonts/drawrace/Caveat-Regular.ttf \
      "https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf" && \
    curl -fsSL -o /usr/local/share/fonts/drawrace/PatrickHandSC-Regular.ttf \
      "https://github.com/google/fonts/raw/main/ofl/patrickhandsc/PatrickHandSC-Regular.ttf" && \
    fc-cache -f

# ── Node.js 22 ──────────────────────────────────────────────────────────────
ENV NODE_VERSION=22
RUN apt-get update && apt-get install -y --no-install-recommends curl gnupg ca-certificates && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# ── pnpm (pinned to match project) ──────────────────────────────────────────
ENV PNPM_VERSION=10.33.1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# ── Playwright 1.59.1 with pre-installed Chromium ───────────────────────────
ENV PLAYWRIGHT_VERSION=1.59.1
RUN npm install -g playwright-core@${PLAYWRIGHT_VERSION} && \
    npx playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium && \
    rm -rf /root/.npm/_cacache

WORKDIR /work

CMD ["/bin/bash"]
