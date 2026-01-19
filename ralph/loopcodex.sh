#!/bin/bash
# Usage: ./loopcodex.sh [mode] [max_iterations]
# Examples:
#   ./loopcodex.sh                        # Build mode, unlimited iterations
#   ./loopcodex.sh 20                     # Build mode, max 20 iterations
#   ./loopcodex.sh plan                   # Plan mode, unlimited iterations
#   ./loopcodex.sh plan 5                 # Plan mode, max 5 iterations
#   ./loopcodex.sh plan-work "scope"      # Scoped planning for work branch
#   ./loopcodex.sh plan-work "scope" 3    # Scoped planning, max 3 iterations

# Colors for output
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

# Filter function to extract readable output from Codex JSONL
filter_output() {
    while IFS= read -r line; do
        [[ -z "$line" ]] && continue

        # Validate JSON before parsing
        if ! echo "$line" | jq -e . >/dev/null 2>&1; then
            continue
        fi

        type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)

        case "$type" in
            "thread.started")
                echo -e "${DIM}🔧 Session initialized${NC}"
                ;;
            "item.started"|"item.completed")
                item_type=$(echo "$line" | jq -r '.item.type // empty' 2>/dev/null)
                case "$item_type" in
                    "agent_message")
                        if [[ "$type" == "item.completed" ]]; then
                            text=$(echo "$line" | jq -r '.item.text // empty' 2>/dev/null | tr '\n' ' ' | head -c 120)
                            if [[ -n "$text" ]]; then
                                echo -e "${CYAN}▸${NC} ${text}..."
                            fi
                        fi
                        ;;
                    "command_execution")
                        if [[ "$type" == "item.started" ]]; then
                            cmd=$(echo "$line" | jq -r '.item.command // empty' 2>/dev/null | head -c 80)
                            [[ -n "$cmd" ]] && echo -e "${YELLOW}⚡ Running${NC} ${DIM}${cmd}${NC}"
                        fi
                        ;;
                    "file_change")
                        if [[ "$type" == "item.completed" ]]; then
                            file=$(echo "$line" | jq -r '.item.path // .item.file_path // .item.file // empty' 2>/dev/null | xargs basename 2>/dev/null | head -1)
                            [[ -n "$file" ]] && echo -e "${GREEN}✏️  Editing${NC} $file"
                        fi
                        ;;
                    "mcp_tool_call"|"tool_call")
                        if [[ "$type" == "item.started" ]]; then
                            tool=$(echo "$line" | jq -r '.item.tool // .item.name // empty' 2>/dev/null | head -c 50)
                            [[ -n "$tool" ]] && echo -e "${DIM}🔧 ${tool}${NC}"
                        fi
                        ;;
                    "web_search")
                        if [[ "$type" == "item.started" ]]; then
                            query=$(echo "$line" | jq -r '.item.query // empty' 2>/dev/null | head -c 50)
                            [[ -n "$query" ]] && echo -e "${DIM}🔍 Searching${NC} ${query}"
                        fi
                        ;;
                    "plan_update")
                        if [[ "$type" == "item.completed" ]]; then
                            echo -e "${CYAN}📋 Updating plan${NC}"
                        fi
                        ;;
                    "reasoning")
                        ;;
                    *)
                        if [[ "$type" == "item.completed" && -n "$item_type" ]]; then
                            echo -e "${DIM}🔧 ${item_type}${NC}"
                        fi
                        ;;
                esac
                ;;
            "turn.completed")
                in_tokens=$(echo "$line" | jq -r '.usage.input_tokens // 0' 2>/dev/null)
                out_tokens=$(echo "$line" | jq -r '.usage.output_tokens // 0' 2>/dev/null)
                total_tokens=$(echo "$line" | jq -r '.usage.total_tokens // empty' 2>/dev/null)
                if [[ -z "$total_tokens" || "$total_tokens" == "null" ]]; then
                    total_tokens=$((in_tokens + out_tokens))
                fi
                if [[ -n "$total_tokens" && "$total_tokens" != "0" ]]; then
                    echo -e "${DIM}📊 Tokens: in=${in_tokens} out=${out_tokens} total=${total_tokens}${NC}"
                fi
                ;;
            "turn.failed"|"error")
                msg=$(echo "$line" | jq -r '.error.message // .message // empty' 2>/dev/null | head -c 200)
                [[ -n "$msg" ]] && echo -e "${RED}✗ Error: ${msg}${NC}"
                ;;
        esac
    done
}

# Resolve script directory for prompt paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
WORK_SCOPE=""
if [ "$1" = "plan" ]; then
    # Plan mode
    MODE="plan"
    PROMPT_FILE="$SCRIPT_DIR/PROMPT_plan.md"
    MAX_ITERATIONS=${2:-0}
elif [ "$1" = "plan-work" ]; then
    # Scoped plan mode for work branches
    MODE="plan-work"
    PROMPT_FILE="$SCRIPT_DIR/PROMPT_plan_work.md"
    WORK_SCOPE="$2"
    MAX_ITERATIONS=${3:-0}
    if [ -z "$WORK_SCOPE" ]; then
        echo -e "${RED}✗ Error: plan-work requires a scope description${NC}"
        echo -e "${DIM}Usage: ./loopcodex.sh plan-work \"description of work scope\"${NC}"
        exit 1
    fi
elif [[ "$1" =~ ^[0-9]+$ ]]; then
    # Build mode with max iterations
    MODE="build"
    PROMPT_FILE="$SCRIPT_DIR/PROMPT_build.md"
    MAX_ITERATIONS=$1
else
    # Build mode, unlimited (no arguments or invalid input)
    MODE="build"
    PROMPT_FILE="$SCRIPT_DIR/PROMPT_build.md"
    MAX_ITERATIONS=0
fi

ITERATION=0
CURRENT_BRANCH=$(git -C "$REPO_ROOT" branch --show-current)

# Temp file for raw output (for completion detection)
RAWFILE=$(mktemp)
trap "rm -f $RAWFILE" EXIT

echo -e "${BOLD}🚀 Starting Ralph (Codex)${NC}"
echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Mode:   ${CYAN}$MODE${NC}"
echo -e "Prompt: ${DIM}$PROMPT_FILE${NC}"
echo -e "Root:   ${DIM}$REPO_ROOT${NC}"
echo -e "Branch: ${GREEN}$CURRENT_BRANCH${NC}"
[ -n "$WORK_SCOPE" ] && echo -e "Scope:  ${YELLOW}$WORK_SCOPE${NC}"
[ $MAX_ITERATIONS -gt 0 ] && echo -e "Max:    ${YELLOW}$MAX_ITERATIONS iterations${NC}"
echo -e "${DIM}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Verify prompt file exists
if [ ! -f "$PROMPT_FILE" ]; then
    echo -e "${RED}✗ Error: $PROMPT_FILE not found${NC}"
    exit 1
fi

while true; do
    if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ]; then
        echo -e "${YELLOW}⚠ Reached max iterations: $MAX_ITERATIONS${NC}"
        break
    fi

    # Run Ralph iteration with selected prompt
    # --json: Structured JSONL output for logging/monitoring
    # --sandbox danger-full-access: Full access (use only in controlled environments)
    # -a never: Non-interactive automation
    if [ -n "$WORK_SCOPE" ]; then
        # Prepend scope to plan-work prompt
        { echo "## Work Scope: $WORK_SCOPE"; echo ""; cat "$PROMPT_FILE"; } | codex \
            -a never \
            -s danger-full-access \
            -C "$REPO_ROOT" \
            exec \
            --json \
            - 2>&1 | tee "$RAWFILE" | filter_output
    else
        cat "$PROMPT_FILE" | codex \
            -a never \
            -s danger-full-access \
            -C "$REPO_ROOT" \
            exec \
            --json \
            - 2>&1 | tee "$RAWFILE" | filter_output
    fi

    # Check for completion signal
    if grep -qE '<promise>COMPLETE</promise>' "$RAWFILE" 2>/dev/null; then
        echo -e "${GREEN}✅ All tasks complete!${NC}"
        break
    fi

    # Commit + push changes after each iteration (build mode only, opt-in)
    if [ "$MODE" = "build" ]; then
        if [ "${AUTO_GIT:-0}" = "1" ]; then
            # Create a checkpoint commit if there are any changes (including untracked).
            if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
                ts=$(date +"%Y-%m-%d %H:%M:%S")
                msg="loop: iteration $((ITERATION + 1)) @ $ts"
                echo -e "${DIM}📦 Committing checkpoint: ${msg}${NC}"
                git -C "$REPO_ROOT" add -A
                git -C "$REPO_ROOT" commit -m "$msg" 2>&1 | head -5 || {
                    echo -e "${YELLOW}⚠ Commit failed; leaving changes uncommitted${NC}"
                }
            else
                echo -e "${DIM}✓ No changes to commit${NC}"
            fi

            echo -e "${DIM}📤 Pushing to origin/$CURRENT_BRANCH...${NC}"
            git -C "$REPO_ROOT" push origin "$CURRENT_BRANCH" 2>&1 | head -3 || {
                echo -e "${YELLOW}Creating remote branch...${NC}"
                git -C "$REPO_ROOT" push -u origin "$CURRENT_BRANCH" 2>&1 | head -3
            }
        else
            echo -e "${DIM}↪ Skipping commit/push (set AUTO_GIT=1 to enable)${NC}"
        fi
    else
        echo -e "${DIM}↪ Skipping commit/push in $MODE mode${NC}"
    fi

    ITERATION=$((ITERATION + 1))
    echo ""
    echo -e "${BOLD}${CYAN}═══════════════════════ LOOP $ITERATION ═══════════════════════${NC}"
    echo ""
done
