#!/bin/bash
# DrawRace Marathon Launcher — GLM-5-Turbo via ZAI Proxy
#
# Runs the central marathon-coding skill in a dedicated tmux session against
# this repo. Each iteration reads .marathon/instruction.md and invokes
# headless claude-code routed through the ZAI MCP proxy.
#
# Model choice: GLM-5-Turbo.
#   The previous run used glm-5.1. With Claude Code 2.1.119 + the ZAI proxy,
#   every glm-5.1 request returns HTTP 422 "body: Field required" — the
#   proxy's handler accepts Claude Code's request shape for glm-5-turbo and
#   glm-4.7 but rejects glm-5.1 (opus-class) requests. A direct claude --print
#   test against glm-5-turbo succeeds, so we ship on turbo until the proxy
#   handler catches up. Off-peak through April, glm-5-turbo is 1x cost on the
#   ZAI Max plan.
#
# Usage:
#   ./.marathon/start.sh                  # default session name "drawrace"
#   ./.marathon/start.sh <session-name>   # custom session name

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
MARATHON_SKILL="/home/coding/claude-config/skills/marathon-coding"
INSTRUCTION_FILE="$SCRIPT_DIR/instruction.md"
LOG_DIR="$SCRIPT_DIR/logs"
SESSION_NAME="${1:-drawrace}"

# ZAI proxy endpoint (same HTTPS MCP endpoint NEEDLE uses)
ZAI_BASE_URL="https://zai-proxy-mcp-ardenone-hub-ts.ardenone.com:8444"

# Sanity checks
if ! command -v tmux >/dev/null 2>&1; then
    echo "Error: tmux not installed" >&2
    exit 1
fi

if [ ! -x "$MARATHON_SKILL/launcher.sh" ]; then
    echo "Error: marathon-coding launcher not found at $MARATHON_SKILL/launcher.sh" >&2
    exit 1
fi

if [ ! -f "$INSTRUCTION_FILE" ]; then
    echo "Error: instruction file missing: $INSTRUCTION_FILE" >&2
    exit 1
fi

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
    echo "Session '$SESSION_NAME' already exists."
    echo "  Attach: tmux attach -t $SESSION_NAME"
    echo "  Kill:   tmux kill-session -t $SESSION_NAME"
    exit 1
fi

# Pre-flight: confirm ZAI proxy is reachable so we don't launch into a
# loop that will just emit connection errors every iteration.
if ! curl -sk --max-time 8 -o /dev/null -w "%{http_code}" "$ZAI_BASE_URL/health" | grep -q '^2'; then
    echo "Error: ZAI proxy at $ZAI_BASE_URL is not reachable." >&2
    echo "       (glm-5-turbo routing would fail; aborting before launch.)" >&2
    echo "       Check Tailscale + proxy pod on ardenone-hub." >&2
    exit 1
fi

mkdir -p "$LOG_DIR"

# Build the loop command that runs inside tmux.
#
# Env var set mirrors NEEDLE's claude-code-glm-5-turbo agent:
# (see ~/.needle/agents/claude-code-glm-5-turbo.yaml)
#   - NODE_TLS_REJECT_UNAUTHORIZED=0 — proxy uses a self-signed cert
#   - ANTHROPIC_BASE_URL points at the ZAI MCP proxy (not anthropic.com)
#   - ANTHROPIC_AUTH_TOKEN is a sentinel; proxy handles real auth
#   - ANTHROPIC_MODEL + the three DEFAULT_*_MODEL overrides + subagent model
#     all pin to glm-5-turbo so every model tier the CLI references resolves
#     to GLM-5.1 rather than a real Claude model.
#   - `unset CLAUDECODE` avoids nested-session detection when this script
#     is itself launched from a Claude Code terminal.
LOOP_CMD="cd '$REPO_DIR' && \
    unset CLAUDECODE && \
    export NODE_TLS_REJECT_UNAUTHORIZED=0 && \
    export ANTHROPIC_BASE_URL='$ZAI_BASE_URL' && \
    export ANTHROPIC_AUTH_TOKEN='proxy-handles-auth' && \
    export ANTHROPIC_MODEL='glm-5-turbo' && \
    export ANTHROPIC_DEFAULT_OPUS_MODEL='glm-5-turbo' && \
    export ANTHROPIC_DEFAULT_SONNET_MODEL='glm-5-turbo' && \
    export ANTHROPIC_DEFAULT_HAIKU_MODEL='glm-5-turbo' && \
    export CLAUDE_CODE_SUBAGENT_MODEL='glm-5-turbo' && \
    export API_TIMEOUT_MS='900000' && \
    export DISABLE_AUTOUPDATER=1 && \
    export DISABLE_TELEMETRY=1 && \
    '$MARATHON_SKILL/launcher.sh' \
        --prompt '$INSTRUCTION_FILE' \
        --delay 10 \
        --log-dir '$LOG_DIR'"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║          DrawRace Marathon — claude-code @ GLM-5.1           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Repo:        $REPO_DIR"
echo "  Instruction: $INSTRUCTION_FILE"
echo "  Session:     $SESSION_NAME"
echo "  Model:       glm-5-turbo (all tiers — opus, sonnet, haiku, subagent)"
echo "  Proxy:       $ZAI_BASE_URL"
echo "  Logs:        $LOG_DIR"
echo ""

tmux new-session -d -s "$SESSION_NAME" -c "$REPO_DIR"
tmux send-keys -t "$SESSION_NAME" "$LOOP_CMD" Enter

echo "Marathon running in tmux session: $SESSION_NAME"
echo ""
echo "  Attach:  tmux attach -t $SESSION_NAME"
echo "  Detach:  Ctrl+B, D (while attached)"
echo "  Stop:    tmux kill-session -t $SESSION_NAME"
echo "  Logs:    ls $LOG_DIR/"
