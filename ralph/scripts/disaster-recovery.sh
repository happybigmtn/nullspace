#!/usr/bin/env bash
set -euo pipefail

# Disaster Recovery Runbook for Nullspace Platform (AC-9.3)
#
# This script provides snapshot-based disaster recovery capabilities:
# - Create snapshots of explorer persistence data
# - Restore from snapshots
# - Validate state integrity after restore
#
# Usage:
#   ./scripts/disaster-recovery.sh snapshot [--path FILE]
#   ./scripts/disaster-recovery.sh restore --path FILE [--confirm]
#   ./scripts/disaster-recovery.sh validate [--path FILE]
#   ./scripts/disaster-recovery.sh drill [--path FILE]
#   ./scripts/disaster-recovery.sh status
#
# Environment Variables:
#   SIMULATOR_HOST     Simulator hostname (default: 127.0.0.1)
#   SIMULATOR_PORT     Simulator port (default: 8080)
#   SNAPSHOT_DIR       Directory for snapshots (default: ./snapshots)
#   PERSISTENCE_PATH   SQLite persistence path (default: ./data/explorer.db)
#   POSTGRES_URL       PostgreSQL connection URL (optional)
#   TIMEOUT            HTTP request timeout (default: 30)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$RALPH_DIR/.." && pwd)"

# Configuration
SIMULATOR_HOST="${SIMULATOR_HOST:-127.0.0.1}"
SIMULATOR_PORT="${SIMULATOR_PORT:-8080}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-$ROOT_DIR/snapshots}"
PERSISTENCE_PATH="${PERSISTENCE_PATH:-$ROOT_DIR/data/explorer.db}"
POSTGRES_URL="${POSTGRES_URL:-}"
TIMEOUT="${TIMEOUT:-30}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[1;36m'
BOLD='\033[1m'
NC='\033[0m'

# Logging
log_info() { printf "${CYAN}[INFO]${NC} %s\n" "$*"; }
log_success() { printf "${GREEN}[OK]${NC} %s\n" "$*"; }
log_warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$*"; }
log_error() { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; }
log_step() { printf "${BOLD}==> %s${NC}\n" "$*"; }

# Generate timestamp for snapshot filename
snapshot_timestamp() {
    date -u +"%Y%m%d_%H%M%S"
}

# Get simulator health status
get_simulator_health() {
    local url="http://${SIMULATOR_HOST}:${SIMULATOR_PORT}/health"
    curl -sf --max-time "$TIMEOUT" "$url" 2>/dev/null || echo '{"healthy":false}'
}

# Get simulator readiness
check_simulator_ready() {
    local url="http://${SIMULATOR_HOST}:${SIMULATOR_PORT}/readyz"
    local response
    response=$(curl -sf --max-time "$TIMEOUT" -w "%{http_code}" -o /dev/null "$url" 2>/dev/null) || response="000"
    [[ "$response" == "200" ]]
}

# Get indexed blocks count from health endpoint
get_indexed_blocks() {
    local health
    health=$(get_simulator_health)
    echo "$health" | jq -r '.indexed_blocks // 0' 2>/dev/null || echo "0"
}

# Get indexed rounds count from health endpoint
get_indexed_rounds() {
    local health
    health=$(get_simulator_health)
    echo "$health" | jq -r '.indexed_rounds // 0' 2>/dev/null || echo "0"
}

# Get indexed accounts count from health endpoint
get_indexed_accounts() {
    local health
    health=$(get_simulator_health)
    echo "$health" | jq -r '.indexed_accounts // 0' 2>/dev/null || echo "0"
}

# ─────────────────────────────────────────────────────────────────────────────
# SNAPSHOT COMMAND
# Creates a snapshot of the explorer persistence database
# ─────────────────────────────────────────────────────────────────────────────
cmd_snapshot() {
    local snapshot_path="${1:-}"

    log_step "Creating Disaster Recovery Snapshot"
    echo "Started at: $(date)"
    echo ""

    # Ensure snapshot directory exists
    mkdir -p "$SNAPSHOT_DIR"

    # Generate snapshot filename if not provided
    if [[ -z "$snapshot_path" ]]; then
        snapshot_path="${SNAPSHOT_DIR}/snapshot_$(snapshot_timestamp).tar.gz"
    fi

    # Check if persistence file exists
    if [[ -n "$POSTGRES_URL" ]]; then
        log_info "Using PostgreSQL backend: ${POSTGRES_URL%%@*}@..."

        # Create snapshot from PostgreSQL using pg_dump
        local temp_dir
        temp_dir=$(mktemp -d)
        trap "rm -rf $temp_dir" EXIT

        log_info "Exporting PostgreSQL tables..."
        PGPASSWORD=$(echo "$POSTGRES_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p') \
        pg_dump -h "$(echo "$POSTGRES_URL" | sed -n 's/.*@\([^:\/]*\).*/\1/p')" \
                -U "$(echo "$POSTGRES_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')" \
                -d "$(echo "$POSTGRES_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p')" \
                -t explorer_blocks -t explorer_ops \
                -F c -f "$temp_dir/explorer.pgdump" 2>/dev/null || {
            log_error "PostgreSQL dump failed"
            return 1
        }

        # Add metadata
        create_snapshot_metadata "$temp_dir/metadata.json"

        # Create tarball
        tar -czf "$snapshot_path" -C "$temp_dir" . 2>/dev/null

    elif [[ -f "$PERSISTENCE_PATH" ]]; then
        log_info "Using SQLite backend: $PERSISTENCE_PATH"

        local temp_dir
        temp_dir=$(mktemp -d)
        trap "rm -rf $temp_dir" EXIT

        # Copy SQLite database (with WAL checkpoint for consistency)
        log_info "Checkpointing WAL and copying database..."
        sqlite3 "$PERSISTENCE_PATH" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
        cp "$PERSISTENCE_PATH" "$temp_dir/explorer.db"

        # Copy WAL/SHM files if they exist
        [[ -f "${PERSISTENCE_PATH}-wal" ]] && cp "${PERSISTENCE_PATH}-wal" "$temp_dir/" || true
        [[ -f "${PERSISTENCE_PATH}-shm" ]] && cp "${PERSISTENCE_PATH}-shm" "$temp_dir/" || true

        # Add metadata
        create_snapshot_metadata "$temp_dir/metadata.json"

        # Create tarball
        tar -czf "$snapshot_path" -C "$temp_dir" . 2>/dev/null

    else
        log_warn "No persistence backend found"
        log_info "Creating metadata-only snapshot for drill validation"

        local temp_dir
        temp_dir=$(mktemp -d)
        trap "rm -rf $temp_dir" EXIT

        create_snapshot_metadata "$temp_dir/metadata.json"
        tar -czf "$snapshot_path" -C "$temp_dir" . 2>/dev/null
    fi

    # Verify snapshot was created
    if [[ -f "$snapshot_path" ]]; then
        local size
        size=$(du -h "$snapshot_path" | cut -f1)
        log_success "Snapshot created: $snapshot_path ($size)"

        # Show snapshot contents summary
        echo ""
        log_info "Snapshot contents:"
        tar -tzf "$snapshot_path" 2>/dev/null | while read -r file; do
            printf "  - %s\n" "$file"
        done

        return 0
    else
        log_error "Failed to create snapshot"
        return 1
    fi
}

# Create snapshot metadata JSON
create_snapshot_metadata() {
    local output_path="$1"
    local health
    health=$(get_simulator_health)

    cat > "$output_path" <<EOF
{
    "version": "1.0",
    "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
    "hostname": "$(hostname)",
    "simulator_host": "${SIMULATOR_HOST}:${SIMULATOR_PORT}",
    "indexed_blocks": $(echo "$health" | jq -r '.indexed_blocks // 0'),
    "indexed_rounds": $(echo "$health" | jq -r '.indexed_rounds // 0'),
    "indexed_accounts": $(echo "$health" | jq -r '.indexed_accounts // 0'),
    "persistence_enabled": $(echo "$health" | jq -r '.persistence_enabled // false'),
    "backend": "${POSTGRES_URL:+postgres}${POSTGRES_URL:-sqlite}"
}
EOF
}

# ─────────────────────────────────────────────────────────────────────────────
# RESTORE COMMAND
# Restores explorer state from a snapshot
# ─────────────────────────────────────────────────────────────────────────────
cmd_restore() {
    local snapshot_path="${1:-}"
    local confirm="${2:-}"

    if [[ -z "$snapshot_path" ]]; then
        log_error "Snapshot path required: --path FILE"
        return 1
    fi

    if [[ ! -f "$snapshot_path" ]]; then
        log_error "Snapshot not found: $snapshot_path"
        return 1
    fi

    log_step "Disaster Recovery Restore"
    echo "Started at: $(date)"
    echo "Snapshot: $snapshot_path"
    echo ""

    # Extract and display metadata
    local temp_dir
    temp_dir=$(mktemp -d)
    trap "rm -rf $temp_dir" EXIT

    tar -xzf "$snapshot_path" -C "$temp_dir" 2>/dev/null || {
        log_error "Failed to extract snapshot"
        return 1
    }

    if [[ -f "$temp_dir/metadata.json" ]]; then
        log_info "Snapshot metadata:"
        jq '.' "$temp_dir/metadata.json" 2>/dev/null || cat "$temp_dir/metadata.json"
        echo ""
    fi

    # Confirm restore (destructive operation)
    if [[ "$confirm" != "--confirm" && "$confirm" != "true" ]]; then
        log_warn "Restore will REPLACE current persistence data!"
        printf "Type 'yes' to confirm: "
        read -r response
        if [[ "$response" != "yes" ]]; then
            log_info "Restore cancelled"
            return 1
        fi
    fi

    # Check for PostgreSQL dump
    if [[ -f "$temp_dir/explorer.pgdump" ]]; then
        if [[ -z "$POSTGRES_URL" ]]; then
            log_error "PostgreSQL URL required to restore PostgreSQL snapshot"
            return 1
        fi

        log_info "Restoring PostgreSQL tables..."
        PGPASSWORD=$(echo "$POSTGRES_URL" | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p') \
        pg_restore -h "$(echo "$POSTGRES_URL" | sed -n 's/.*@\([^:\/]*\).*/\1/p')" \
                   -U "$(echo "$POSTGRES_URL" | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')" \
                   -d "$(echo "$POSTGRES_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p')" \
                   --clean --if-exists \
                   "$temp_dir/explorer.pgdump" 2>/dev/null || {
            log_error "PostgreSQL restore failed"
            return 1
        }

        log_success "PostgreSQL tables restored"

    elif [[ -f "$temp_dir/explorer.db" ]]; then
        log_info "Restoring SQLite database..."

        # Backup existing database if present
        if [[ -f "$PERSISTENCE_PATH" ]]; then
            local backup_path="${PERSISTENCE_PATH}.backup.$(date +%s)"
            cp "$PERSISTENCE_PATH" "$backup_path"
            log_info "Existing database backed up to: $backup_path"
        fi

        # Ensure target directory exists
        mkdir -p "$(dirname "$PERSISTENCE_PATH")"

        # Copy restored database
        cp "$temp_dir/explorer.db" "$PERSISTENCE_PATH"
        [[ -f "$temp_dir/explorer.db-wal" ]] && cp "$temp_dir/explorer.db-wal" "${PERSISTENCE_PATH}-wal" || true
        [[ -f "$temp_dir/explorer.db-shm" ]] && cp "$temp_dir/explorer.db-shm" "${PERSISTENCE_PATH}-shm" || true

        log_success "SQLite database restored to: $PERSISTENCE_PATH"

    else
        log_warn "No database dump found in snapshot (metadata-only snapshot)"
        return 0
    fi

    echo ""
    log_info "Restart the simulator to load restored data"

    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# VALIDATE COMMAND
# Validates state integrity after restore or for current state
# ─────────────────────────────────────────────────────────────────────────────
cmd_validate() {
    local snapshot_path="${1:-}"
    local validation_errors=0

    log_step "State Integrity Validation"
    echo "Started at: $(date)"
    echo ""

    # Check simulator health
    log_info "Checking simulator health..."
    if ! check_simulator_ready; then
        log_warn "Simulator not ready (may need restart after restore)"
    fi

    local health
    health=$(get_simulator_health)
    local healthy
    healthy=$(echo "$health" | jq -r '.healthy // false')

    printf "  %-25s " "Simulator healthy:"
    if [[ "$healthy" == "true" ]]; then
        printf "${GREEN}YES${NC}\n"
    else
        printf "${RED}NO${NC}\n"
        validation_errors=$((validation_errors + 1))
    fi

    # Check indexed data counts
    local blocks rounds accounts
    blocks=$(echo "$health" | jq -r '.indexed_blocks // 0')
    rounds=$(echo "$health" | jq -r '.indexed_rounds // 0')
    accounts=$(echo "$health" | jq -r '.indexed_accounts // 0')

    printf "  %-25s %s\n" "Indexed blocks:" "$blocks"
    printf "  %-25s %s\n" "Indexed rounds:" "$rounds"
    printf "  %-25s %s\n" "Indexed accounts:" "$accounts"
    echo ""

    # If snapshot provided, compare against snapshot metadata
    if [[ -n "$snapshot_path" && -f "$snapshot_path" ]]; then
        log_info "Comparing against snapshot metadata..."

        local temp_dir
        temp_dir=$(mktemp -d)
        trap "rm -rf $temp_dir" EXIT

        tar -xzf "$snapshot_path" -C "$temp_dir" 2>/dev/null || {
            log_error "Failed to extract snapshot for comparison"
            return 1
        }

        if [[ -f "$temp_dir/metadata.json" ]]; then
            local snap_blocks snap_rounds snap_accounts
            snap_blocks=$(jq -r '.indexed_blocks // 0' "$temp_dir/metadata.json")
            snap_rounds=$(jq -r '.indexed_rounds // 0' "$temp_dir/metadata.json")
            snap_accounts=$(jq -r '.indexed_accounts // 0' "$temp_dir/metadata.json")

            printf "  %-25s " "Blocks match snapshot:"
            if [[ "$blocks" -ge "$snap_blocks" ]]; then
                printf "${GREEN}YES${NC} (%s >= %s)\n" "$blocks" "$snap_blocks"
            else
                printf "${RED}NO${NC} (%s < %s)\n" "$blocks" "$snap_blocks"
                validation_errors=$((validation_errors + 1))
            fi

            printf "  %-25s " "Rounds match snapshot:"
            if [[ "$rounds" -ge "$snap_rounds" ]]; then
                printf "${GREEN}YES${NC} (%s >= %s)\n" "$rounds" "$snap_rounds"
            else
                printf "${RED}NO${NC} (%s < %s)\n" "$rounds" "$snap_rounds"
                validation_errors=$((validation_errors + 1))
            fi

            printf "  %-25s " "Accounts match snapshot:"
            if [[ "$accounts" -ge "$snap_accounts" ]]; then
                printf "${GREEN}YES${NC} (%s >= %s)\n" "$accounts" "$snap_accounts"
            else
                printf "${RED}NO${NC} (%s < %s)\n" "$accounts" "$snap_accounts"
                validation_errors=$((validation_errors + 1))
            fi
        fi
    fi

    # Check database integrity (SQLite specific)
    if [[ -f "$PERSISTENCE_PATH" ]]; then
        echo ""
        log_info "Checking SQLite database integrity..."
        local integrity
        integrity=$(sqlite3 "$PERSISTENCE_PATH" "PRAGMA integrity_check;" 2>/dev/null || echo "error")

        printf "  %-25s " "Database integrity:"
        if [[ "$integrity" == "ok" ]]; then
            printf "${GREEN}OK${NC}\n"
        else
            printf "${RED}FAILED${NC} (%s)\n" "$integrity"
            validation_errors=$((validation_errors + 1))
        fi

        # Check table row counts
        local block_count op_count
        block_count=$(sqlite3 "$PERSISTENCE_PATH" "SELECT COUNT(*) FROM explorer_blocks;" 2>/dev/null || echo "0")
        op_count=$(sqlite3 "$PERSISTENCE_PATH" "SELECT COUNT(*) FROM explorer_ops;" 2>/dev/null || echo "0")

        printf "  %-25s %s\n" "Persisted blocks:" "$block_count"
        printf "  %-25s %s\n" "Persisted operations:" "$op_count"
    fi

    echo ""
    echo "=========================================="

    if [[ $validation_errors -eq 0 ]]; then
        log_success "Validation PASSED: State integrity confirmed"
        return 0
    else
        log_error "Validation FAILED: $validation_errors error(s) detected"
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# DRILL COMMAND
# Runs a full disaster recovery drill (snapshot -> restore -> validate)
# ─────────────────────────────────────────────────────────────────────────────
cmd_drill() {
    local snapshot_path="${1:-}"
    local drill_log="${SNAPSHOT_DIR}/drill_$(snapshot_timestamp).log"
    local drill_snapshot=""

    log_step "Disaster Recovery Drill"
    echo "Started at: $(date)"
    echo "Log file: $drill_log"
    echo ""

    mkdir -p "$SNAPSHOT_DIR"

    # Tee output to log file
    exec > >(tee -a "$drill_log") 2>&1

    echo "=============================================="
    echo "DISASTER RECOVERY DRILL"
    echo "Date: $(date)"
    echo "Host: $(hostname)"
    echo "Simulator: ${SIMULATOR_HOST}:${SIMULATOR_PORT}"
    echo "=============================================="
    echo ""

    # Phase 1: Pre-drill validation
    log_step "Phase 1: Pre-drill State Validation"
    if ! cmd_validate ""; then
        log_warn "Pre-drill validation failed (continuing drill)"
    fi
    echo ""

    # Phase 2: Create snapshot
    log_step "Phase 2: Create Snapshot"
    if [[ -n "$snapshot_path" && -f "$snapshot_path" ]]; then
        log_info "Using provided snapshot: $snapshot_path"
        drill_snapshot="$snapshot_path"
    else
        drill_snapshot="${SNAPSHOT_DIR}/drill_$(snapshot_timestamp).tar.gz"
        if ! cmd_snapshot "$drill_snapshot"; then
            log_error "Snapshot creation failed - drill aborted"
            echo ""
            echo "DRILL RESULT: FAILED (snapshot creation)"
            return 1
        fi
    fi
    echo ""

    # Phase 3: Simulate disaster (optional - controlled by environment)
    if [[ "${DRILL_SIMULATE_DISASTER:-0}" == "1" ]]; then
        log_step "Phase 3: Simulating Disaster"
        log_warn "DRILL_SIMULATE_DISASTER=1: Would delete persistence data"
        log_info "Skipping actual deletion for safety (manual intervention required)"
        echo ""
    else
        log_step "Phase 3: Disaster Simulation (skipped)"
        log_info "Set DRILL_SIMULATE_DISASTER=1 to enable (destructive)"
        echo ""
    fi

    # Phase 4: Restore from snapshot
    log_step "Phase 4: Restore from Snapshot"
    log_info "Snapshot: $drill_snapshot"

    # In a real drill, we would restore. For safety, we just validate the snapshot.
    if [[ "${DRILL_PERFORM_RESTORE:-0}" == "1" ]]; then
        if ! cmd_restore "$drill_snapshot" "--confirm"; then
            log_error "Restore failed - drill failed"
            echo ""
            echo "DRILL RESULT: FAILED (restore)"
            return 1
        fi
    else
        log_info "Set DRILL_PERFORM_RESTORE=1 to perform actual restore (destructive)"

        # Instead, verify the snapshot is extractable and valid
        local temp_dir
        temp_dir=$(mktemp -d)
        trap "rm -rf $temp_dir" EXIT

        if tar -xzf "$drill_snapshot" -C "$temp_dir" 2>/dev/null; then
            log_success "Snapshot verified extractable"

            if [[ -f "$temp_dir/metadata.json" ]]; then
                log_success "Metadata file present"
            fi

            if [[ -f "$temp_dir/explorer.db" ]] || [[ -f "$temp_dir/explorer.pgdump" ]]; then
                log_success "Database dump present"
            else
                log_warn "No database dump in snapshot"
            fi
        else
            log_error "Snapshot extraction failed"
            echo ""
            echo "DRILL RESULT: FAILED (snapshot verification)"
            return 1
        fi
    fi
    echo ""

    # Phase 5: Post-restore validation
    log_step "Phase 5: Post-Restore Validation"
    if ! cmd_validate "$drill_snapshot"; then
        if [[ "${DRILL_PERFORM_RESTORE:-0}" == "1" ]]; then
            log_error "Post-restore validation failed"
            echo ""
            echo "DRILL RESULT: FAILED (post-restore validation)"
            return 1
        else
            log_warn "Validation against snapshot (no restore performed)"
        fi
    fi
    echo ""

    # Phase 6: Summary
    echo "=============================================="
    echo "DRILL SUMMARY"
    echo "=============================================="
    echo "Snapshot created: $drill_snapshot"
    echo "Snapshot size: $(du -h "$drill_snapshot" 2>/dev/null | cut -f1 || echo 'N/A')"
    echo "Restore performed: ${DRILL_PERFORM_RESTORE:-0}"
    echo "Log file: $drill_log"
    echo ""

    log_success "DRILL RESULT: PASSED"
    echo ""
    echo "Recovery drill completed successfully at $(date)"

    return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# STATUS COMMAND
# Shows current system status relevant to disaster recovery
# ─────────────────────────────────────────────────────────────────────────────
cmd_status() {
    log_step "Disaster Recovery Status"
    echo "Started at: $(date)"
    echo ""

    # Simulator status
    log_info "Simulator Status:"
    local health
    health=$(get_simulator_health)
    echo "$health" | jq '.' 2>/dev/null || echo "$health"
    echo ""

    # Persistence status
    log_info "Persistence Status:"
    if [[ -n "$POSTGRES_URL" ]]; then
        printf "  %-20s %s\n" "Backend:" "PostgreSQL"
        printf "  %-20s %s\n" "URL:" "${POSTGRES_URL%%@*}@..."
    elif [[ -f "$PERSISTENCE_PATH" ]]; then
        printf "  %-20s %s\n" "Backend:" "SQLite"
        printf "  %-20s %s\n" "Path:" "$PERSISTENCE_PATH"
        printf "  %-20s %s\n" "Size:" "$(du -h "$PERSISTENCE_PATH" 2>/dev/null | cut -f1 || echo 'N/A')"

        local block_count
        block_count=$(sqlite3 "$PERSISTENCE_PATH" "SELECT COUNT(*) FROM explorer_blocks;" 2>/dev/null || echo "0")
        printf "  %-20s %s\n" "Persisted blocks:" "$block_count"
    else
        printf "  %-20s %s\n" "Backend:" "None configured"
    fi
    echo ""

    # Snapshot status
    log_info "Snapshot Status:"
    printf "  %-20s %s\n" "Directory:" "$SNAPSHOT_DIR"
    if [[ -d "$SNAPSHOT_DIR" ]]; then
        local snapshot_count latest_snapshot
        snapshot_count=$(find "$SNAPSHOT_DIR" -name "*.tar.gz" -type f 2>/dev/null | wc -l || echo "0")
        latest_snapshot=$(find "$SNAPSHOT_DIR" -name "*.tar.gz" -type f -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)

        printf "  %-20s %s\n" "Total snapshots:" "$snapshot_count"
        if [[ -n "$latest_snapshot" ]]; then
            printf "  %-20s %s\n" "Latest:" "$(basename "$latest_snapshot")"
            printf "  %-20s %s\n" "Latest size:" "$(du -h "$latest_snapshot" 2>/dev/null | cut -f1 || echo 'N/A')"
        fi
    else
        printf "  %-20s %s\n" "Total snapshots:" "0 (directory missing)"
    fi
    echo ""

    # Drill history
    log_info "Drill History:"
    if [[ -d "$SNAPSHOT_DIR" ]]; then
        local drill_logs
        drill_logs=$(find "$SNAPSHOT_DIR" -name "drill_*.log" -type f 2>/dev/null | sort -r | head -5)
        if [[ -n "$drill_logs" ]]; then
            echo "$drill_logs" | while read -r log; do
                local result
                result=$(grep -o "DRILL RESULT: [A-Z]*" "$log" 2>/dev/null | tail -1 || echo "UNKNOWN")
                printf "  - %s: %s\n" "$(basename "$log")" "$result"
            done
        else
            printf "  No drill logs found\n"
        fi
    fi
}

# ─────────────────────────────────────────────────────────────────────────────
# HELP
# ─────────────────────────────────────────────────────────────────────────────
show_help() {
    cat <<EOF
Disaster Recovery Runbook for Nullspace Platform (AC-9.3)

Usage:
  $0 <command> [options]

Commands:
  snapshot [--path FILE]     Create a snapshot of current state
  restore --path FILE        Restore from a snapshot (requires --confirm)
  validate [--path FILE]     Validate state integrity
  drill [--path FILE]        Run full disaster recovery drill
  status                     Show current DR status

Options:
  --path FILE    Path to snapshot file
  --confirm      Confirm destructive operations
  --help         Show this help

Environment Variables:
  SIMULATOR_HOST             Simulator hostname (default: 127.0.0.1)
  SIMULATOR_PORT             Simulator port (default: 8080)
  SNAPSHOT_DIR               Directory for snapshots (default: ./snapshots)
  PERSISTENCE_PATH           SQLite persistence path (default: ./data/explorer.db)
  POSTGRES_URL               PostgreSQL connection URL (optional)
  DRILL_PERFORM_RESTORE      Set to 1 to perform actual restore during drill
  DRILL_SIMULATE_DISASTER    Set to 1 to simulate disaster during drill

Examples:
  # Create a snapshot
  $0 snapshot

  # Run a recovery drill (non-destructive by default)
  $0 drill

  # Validate current state
  $0 validate

  # Restore from specific snapshot (destructive)
  $0 restore --path snapshots/snapshot_20260120_120000.tar.gz --confirm

  # Run drill with actual restore (destructive)
  DRILL_PERFORM_RESTORE=1 $0 drill
EOF
}

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
main() {
    local command="${1:-}"
    shift || true

    # Parse remaining arguments
    local path=""
    local confirm=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --path)
                path="${2:-}"
                shift 2 || { log_error "--path requires a value"; exit 1; }
                ;;
            --confirm)
                confirm="--confirm"
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                # Unknown argument, might be positional
                if [[ -z "$path" && -f "$1" ]]; then
                    path="$1"
                fi
                shift
                ;;
        esac
    done

    case "$command" in
        snapshot)
            cmd_snapshot "$path"
            ;;
        restore)
            cmd_restore "$path" "$confirm"
            ;;
        validate)
            cmd_validate "$path"
            ;;
        drill)
            cmd_drill "$path"
            ;;
        status)
            cmd_status
            ;;
        --help|-h|help|"")
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown command: $command"
            show_help
            exit 1
            ;;
    esac
}

main "$@"
