#!/usr/bin/env bash
# Ralph loop runner using OpenCode CLI (GitHub Copilot)
set -euo pipefail

# Resolve script directory and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Configuration - paths relative to SCRIPT_DIR for prompts, REPO_ROOT for execution
PLAN_FILE="$SCRIPT_DIR/IMPLEMENTATION_PLAN.md"
LOG_DIR="$SCRIPT_DIR/logs"
MODEL="github-copilot/claude-opus-4.5"

# Determine prompt file based on mode
MODE="build"
WORK_SCOPE=""
PROMPT_FILE="$SCRIPT_DIR/PROMPT_build.md"
MAX_ITERATIONS=0  # 0 = unlimited

if [[ "${1:-}" == "plan" ]]; then
    MODE="plan"
    PROMPT_FILE="$SCRIPT_DIR/PROMPT_plan.md"
    MAX_ITERATIONS=${2:-0}
elif [[ "${1:-}" == "plan-work" ]]; then
    MODE="plan-work"
    PROMPT_FILE="$SCRIPT_DIR/PROMPT_plan_work.md"
    WORK_SCOPE="${2:-}"
    MAX_ITERATIONS=${3:-0}
    if [[ -z "$WORK_SCOPE" ]]; then
        echo "Error: plan-work requires a scope description"
        echo "Usage: ./loopopencode.sh plan-work \"description of work scope\""
        exit 1
    fi
elif [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    MAX_ITERATIONS=$1
fi

mkdir -p "$LOG_DIR"

count_remaining() {
    grep -c '^- \[ \]' "$PLAN_FILE" 2>/dev/null || echo 0
}

count_completed() {
    grep -c '^- \[x\]' "$PLAN_FILE" 2>/dev/null || echo 0
}

count_blocked() {
    grep -c 'Blocked:' "$PLAN_FILE" 2>/dev/null || echo 0
}

# Verify files exist
if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "Error: $PROMPT_FILE not found"
    exit 1
fi

if [[ ! -f "$PLAN_FILE" ]]; then
    echo "Error: $PLAN_FILE not found"
    exit 1
fi

# Header
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Ralph Loop (OpenCode)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Mode:   $MODE"
echo "  Model:  $MODEL"
echo "  Root:   $REPO_ROOT"
echo "  Prompt: $PROMPT_FILE"
echo "  Plan:   $PLAN_FILE"
[[ "$MAX_ITERATIONS" -gt 0 ]] && echo "  Max:    $MAX_ITERATIONS iterations"
[[ "$MAX_ITERATIONS" -eq 0 ]] && echo "  Max:    unlimited"
[[ -n "$WORK_SCOPE" ]] && echo "  Scope:  $WORK_SCOPE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

iteration=0
while true; do
    iteration=$((iteration + 1))
    remaining=$(count_remaining)
    completed=$(count_completed)
    timestamp=$(date +%Y%m%d-%H%M%S)
    log_file="$LOG_DIR/opencode-${iteration}-${timestamp}.log"

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Iteration $iteration | Remaining: $remaining | Completed: $completed"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    if [[ "$remaining" -eq 0 ]]; then
        echo "All tasks complete!"
        break
    fi

    if [[ "$MAX_ITERATIONS" -gt 0 ]] && [[ "$iteration" -gt "$MAX_ITERATIONS" ]]; then
        echo "Max iterations ($MAX_ITERATIONS) reached. $remaining tasks remaining."
        exit 1
    fi

    # Build prompt with scope substitution for plan-work mode
    if [[ "$MODE" == "plan-work" ]]; then
        export WORK_SCOPE
        prompt_content=$(envsubst < "$PROMPT_FILE")
    else
        prompt_content=$(cat "$PROMPT_FILE")
    fi

    # Run OpenCode CLI from repo root
    echo "Running OpenCode CLI from $REPO_ROOT..."
    pushd "$REPO_ROOT" > /dev/null
    if opencode run -m "$MODEL" "$prompt_content" 2>&1 | tee "$log_file"; then
        echo "OpenCode completed successfully"
    else
        echo "OpenCode exited with error, checking if progress was made..."
    fi
    popd > /dev/null

    # Check progress
    new_remaining=$(count_remaining)
    if [[ "$new_remaining" -eq "$remaining" ]]; then
        echo "No progress made this iteration. Check $log_file"
        echo "Waiting 10s before retry..."
        sleep 10
    else
        echo "Progress: $remaining -> $new_remaining tasks"
    fi

    # Auto-commit if enabled (from repo root)
    if [[ "${RALPH_AUTOCOMMIT:-0}" == "1" ]] && [[ "$MODE" == "build" ]]; then
        if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
            msg="ralph: iteration $iteration (opencode)"
            echo "Committing: $msg"
            git -C "$REPO_ROOT" add -A && git -C "$REPO_ROOT" commit -m "$msg" || echo "Commit failed"
        fi
    fi

    sleep 2
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Total iterations: $iteration"
echo "  Tasks completed:  $(count_completed)"
echo "  Tasks blocked:    $(count_blocked)"
echo "  Logs:             $LOG_DIR/"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
