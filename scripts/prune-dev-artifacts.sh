#!/bin/bash
#
# Prune local development artifacts (dev-only).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

DIST_DIR="$REPO_DIR/website/dist"
WASM_PKG_DIR="$REPO_DIR/website/wasm/pkg"
LOGS_DIR="$REPO_DIR/logs"
COVERAGE_DIR="$REPO_DIR/coverage"
TURBO_DIR="$REPO_DIR/.turbo"
QA_DIR="$REPO_DIR/qa-artifacts"
WEBSITE_QA_DIR="$REPO_DIR/website/qa-artifacts"
TMP_DIR="$REPO_DIR/tmp"

REMOVE_DATA=false
REMOVE_DIST=false
REMOVE_WASM=false
REMOVE_LOGS=false
REMOVE_COVERAGE=false
REMOVE_TURBO=false
REMOVE_QA=false
REMOVE_TMP=false

usage() {
    cat <<'EOF'
Usage: ./scripts/prune-dev-artifacts.sh [--data] [--dist] [--wasm] [--logs] [--coverage] [--turbo] [--qa] [--tmp] [--all]

Defaults to --data --dist when no flags are provided.

  --data  Remove local node data directories
  --dist  Remove website build output (website/dist)
  --wasm  Remove wasm-pack output (website/wasm/pkg)
  --logs  Remove logs/ plus root *.log/*.pid/*.out files
  --coverage Remove coverage output
  --turbo Remove Turbo cache output (.turbo)
  --qa    Remove QA artifacts (qa-artifacts and website/qa-artifacts)
  --tmp   Remove temporary files (tmp)
  --all   Remove all of the above
EOF
}

if [ "$#" -eq 0 ]; then
    REMOVE_DATA=true
    REMOVE_DIST=true
else
    for arg in "$@"; do
        case "$arg" in
            --data)
                REMOVE_DATA=true
                ;;
            --dist)
                REMOVE_DIST=true
                ;;
            --wasm)
                REMOVE_WASM=true
                ;;
            --logs)
                REMOVE_LOGS=true
                ;;
            --coverage)
                REMOVE_COVERAGE=true
                ;;
            --turbo)
                REMOVE_TURBO=true
                ;;
            --qa)
                REMOVE_QA=true
                ;;
            --tmp)
                REMOVE_TMP=true
                ;;
            --all)
                REMOVE_DATA=true
                REMOVE_DIST=true
                REMOVE_WASM=true
                REMOVE_LOGS=true
                REMOVE_COVERAGE=true
                REMOVE_TURBO=true
                REMOVE_QA=true
                REMOVE_TMP=true
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                echo "Unknown option: $arg"
                usage
                exit 1
                ;;
        esac
    done
fi

if [ "$REMOVE_DATA" = true ]; then
    "$SCRIPT_DIR/prune-node-data.sh"
fi

if [ "$REMOVE_DIST" = true ]; then
    echo "Removing frontend build output at $DIST_DIR"
    rm -rf "$DIST_DIR" 2>/dev/null || true
fi

if [ "$REMOVE_WASM" = true ]; then
    echo "Removing wasm-pack output at $WASM_PKG_DIR"
    rm -rf "$WASM_PKG_DIR" 2>/dev/null || true
fi

if [ "$REMOVE_LOGS" = true ]; then
    echo "Removing logs at $LOGS_DIR"
    rm -rf "$LOGS_DIR" 2>/dev/null || true
    find "$REPO_DIR" -maxdepth 1 -type f \( -name '*.log' -o -name '*.pid' -o -name '*.out' \) -exec rm -f {} + 2>/dev/null || true
    rm -rf "$REPO_DIR"/load-test-* 2>/dev/null || true
fi

if [ "$REMOVE_COVERAGE" = true ]; then
    echo "Removing coverage output at $COVERAGE_DIR"
    rm -rf "$COVERAGE_DIR" 2>/dev/null || true
fi

if [ "$REMOVE_TURBO" = true ]; then
    echo "Removing Turbo cache at $TURBO_DIR"
    rm -rf "$TURBO_DIR" 2>/dev/null || true
fi

if [ "$REMOVE_QA" = true ]; then
    echo "Removing QA artifacts at $QA_DIR and $WEBSITE_QA_DIR"
    rm -rf "$QA_DIR" "$WEBSITE_QA_DIR" 2>/dev/null || true
fi

if [ "$REMOVE_TMP" = true ]; then
    echo "Removing temporary files at $TMP_DIR"
    rm -rf "$TMP_DIR" 2>/dev/null || true
fi

echo "Done."
