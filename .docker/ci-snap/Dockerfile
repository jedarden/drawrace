# ci-snap: Pinned container for Layer 3 snapshot tests
# This ensures font rendering consistency across CI runs
FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="DrawRace CI Snapshot Container"
LABEL org.opencontainers.image.description="Pinned environment for rendering snapshot tests"
LABEL org.opencontainers.image.created="2024-04-11"

# Install runtime dependencies for Playwright's Chromium
RUN apt-get update && apt-get install -y \
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
    && rm -rf /var/lib/apt/lists/*

# Install Node.js and pnpm
ENV NODE_VERSION=22
RUN apt-get update && apt-get install -y curl gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /work

# This is a test-only container, no entrypoint needed
CMD ["/bin/bash"]
