#!/bin/bash
set -e

# Usage: ralph4.sh [iterations] [-v|--verbose]
MAX_ITERATIONS=10
VERBOSE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    -v|--verbose) VERBOSE=true; shift ;;
    [0-9]*) MAX_ITERATIONS=$1; shift ;;
    *) shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Change to project root so relative paths work
cd "$PROJECT_ROOT"

# Colors for output
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
DIM='\033[0;90m'
BOLD='\033[1m'
NC='\033[0m'

# Filter function to extract readable output from stream-json
filter_output() {
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue

    # Validate JSON before parsing
    if ! echo "$line" | jq -e . >/dev/null 2>&1; then
      continue
    fi

    type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
    subtype=$(echo "$line" | jq -r '.subtype // empty' 2>/dev/null)

    case "$type" in
      "system")
        case "$subtype" in
          "init")
            echo -e "${DIM}Initialized${NC}"
            ;;
        esac
        ;;
      "assistant")
        # Show tool uses with details
        tool_name=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .name // empty' 2>/dev/null | head -1)
        if [[ -n "$tool_name" ]]; then
          case "$tool_name" in
            "Read")
              file=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.file_path // empty' 2>/dev/null | xargs basename 2>/dev/null | head -1)
              echo -e "${DIM}Reading${NC} $file"
              ;;
            "Write")
              file=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.file_path // empty' 2>/dev/null | xargs basename 2>/dev/null | head -1)
              echo -e "${GREEN}Writing${NC} $file"
              ;;
            "Edit"|"MultiEdit")
              file=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.file_path // empty' 2>/dev/null | xargs basename 2>/dev/null | head -1)
              echo -e "${GREEN}Editing${NC} $file"
              ;;
            "Bash")
              desc=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.description // empty' 2>/dev/null | head -c 50)
              [[ -z "$desc" ]] && desc=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.command // empty' 2>/dev/null | head -c 50)
              echo -e "${YELLOW}Running${NC} ${DIM}${desc}${NC}"
              ;;
            "Grep"|"Glob")
              pattern=$(echo "$line" | jq -r '.message.content[]? | select(.type=="tool_use") | .input.pattern // empty' 2>/dev/null | head -c 30)
              echo -e "${DIM}Searching${NC} $pattern"
              ;;
            "TodoWrite")
              echo -e "${CYAN}Updating todos${NC}"
              ;;
            *)
              echo -e "${DIM}${tool_name}${NC}"
              ;;
          esac
        else
          # Show assistant text (first 120 chars)
          text=$(echo "$line" | jq -r '.message.content[]? | select(.type=="text") | .text // empty' 2>/dev/null | tr '\n' ' ' | head -c 120)
          if [[ -n "$text" ]]; then
            echo -e "${CYAN}>${NC} ${text}..."
          fi
        fi
        ;;
      "result")
        if [[ "$subtype" == "success" ]]; then
          cost=$(echo "$line" | jq -r '.total_cost_usd // empty' 2>/dev/null)
          if [[ -n "$cost" ]]; then
            echo -e "${GREEN}Done${NC} ${DIM}(\$${cost})${NC}"
          fi
        fi
        ;;
      "error")
        msg=$(echo "$line" | jq -r '.error.message // .message // empty' 2>/dev/null | head -c 200)
        [[ -n "$msg" ]] && echo -e "${RED}Error: ${msg}${NC}"
        ;;
    esac
  done
}

echo -e "${BOLD}Ralph4 - Luxury Redesign${NC}"
echo -e "${DIM}Superhuman Casino Implementation${NC}"
echo ""

RAWFILE=$(mktemp)
trap "rm -f $RAWFILE" EXIT

for i in $(seq 1 $MAX_ITERATIONS); do
  echo -e "${BOLD}=== Iteration $i/$MAX_ITERATIONS ===${NC}"

  if $VERBOSE; then
    claude --dangerously-skip-permissions --verbose \
      --output-format stream-json \
      -p "$(cat "$SCRIPT_DIR/prompt4.md")" 2>&1 \
      | tee "$RAWFILE" || true
  else
    claude --dangerously-skip-permissions --verbose \
      --output-format stream-json \
      -p "$(cat "$SCRIPT_DIR/prompt4.md")" 2>&1 \
      | tee "$RAWFILE" \
      | filter_output || true
  fi

  echo ""

  if grep -q "<promise>LUXURY-COMPLETE</promise>" "$RAWFILE"; then
    echo -e "${GREEN}Luxury redesign complete!${NC}"
    exit 0
  fi

  if grep -q "<promise>BLOCKED:" "$RAWFILE"; then
    echo -e "${YELLOW}Implementation blocked - check error details${NC}"
    exit 1
  fi

  sleep 2
done

echo -e "${YELLOW}Max iterations reached${NC}"
exit 1
