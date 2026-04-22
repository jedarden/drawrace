#!/bin/bash
# DrawRace Marathon Launcher
#
# Runs the central marathon-coding skill in a dedicated tmux session against
# this repo. Each iteration reads .marathon/instruction.md and invokes
# headless claude-code to make incremental progress on the plan.
#
# Usage:
#   ./.marathon/start.sh                  # default session name "drawrace"
#   ./.marathon/start.sh <session-name>   # custom session name
#   ./.marathon/start.sh <session> glm5   # use GLM-5 via ZAI proxy (cheap mode)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
MARATHON_SKILL="/home/coding/claude-config/skills/marathon-coding"
INSTRUCTION_FILE="$SCRIPT_DIR/instruction.md"
LOG_DIR="$SCRIPT_DIR/logs"
SESSION_NAME="${1:-drawrace}"
MODE="${2:-default}"  # default = normal claude; glm5 = use ZAI proxy

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

mkdir -p "$LOG_DIR"

# Build the loop command that runs inside tmux
LOOP_CMD="cd '$REPO_DIR'"

if [ "$MODE" = "glm5" ]; then
    echo "Mode: GLM-5 via ZAI proxy (cost-optimized)"
    LOOP_CMD="$LOOP_CMD && \
        export ANTHROPIC_BASE_URL='http://zai-proxy-hub.tail1b1987.ts.net:8080' && \
        export ANTHROPIC_AUTH_TOKEN='proxy-handles-auth' && \
        export ANTHROPIC_DEFAULT_OPUS_MODEL='glm-5' && \
        export ANTHROPIC_DEFAULT_SONNET_MODEL='glm-5' && \
        export ANTHROPIC_DEFAULT_HAIKU_MODEL='glm-5' && \
        export API_TIMEOUT_MS='600000' && \
        export DISABLE_AUTOUPDATER=1 && \
        export DISABLE_TELEMETRY=1"
else
    echo "Mode: default (system claude-code settings)"
fi

LOOP_CMD="$LOOP_CMD && '$MARATHON_SKILL/launcher.sh' \
    --prompt '$INSTRUCTION_FILE' \
    --delay 10 \
    --log-dir '$LOG_DIR'"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║               DrawRace Marathon Coding Session               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Repo:        $REPO_DIR"
echo "  Instruction: $INSTRUCTION_FILE"
echo "  Session:     $SESSION_NAME"
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
