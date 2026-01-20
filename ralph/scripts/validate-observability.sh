#!/usr/bin/env bash
# Validate observability configurations (dashboards, alerts, prometheus)
# AC-9.2: Metrics dashboards and alert thresholds exist for latency, error rates, and queue depth
#
# Exit codes:
#   0 - All validations passed
#   1 - Validation failed (JSON parse error, missing required fields, etc.)
#
# Usage:
#   ./scripts/validate-observability.sh [--verbose]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OBS_DIR="$PROJECT_ROOT/observability"

VERBOSE="${1:-}"
ERRORS=0
WARNINGS=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_error() {
    echo -e "${RED}ERROR:${NC} $1" >&2
    ((ERRORS++)) || true
}

log_warn() {
    echo -e "${YELLOW}WARN:${NC} $1"
    ((WARNINGS++)) || true
}

log_ok() {
    echo -e "${GREEN}OK:${NC} $1"
}

log_verbose() {
    if [[ "$VERBOSE" == "--verbose" || "$VERBOSE" == "-v" ]]; then
        echo "  $1"
    fi
}

echo "=== Observability Configuration Validation ==="
echo "Directory: $OBS_DIR"
echo ""

# =============================================================================
# 1. Validate directory structure exists
# =============================================================================
echo "--- Checking directory structure ---"

if [[ ! -d "$OBS_DIR" ]]; then
    log_error "Observability directory not found: $OBS_DIR"
    exit 1
fi

if [[ ! -d "$OBS_DIR/dashboards" ]]; then
    log_error "Dashboards directory not found: $OBS_DIR/dashboards"
fi

if [[ ! -d "$OBS_DIR/alerts" ]]; then
    log_error "Alerts directory not found: $OBS_DIR/alerts"
fi

# =============================================================================
# 2. Validate Grafana dashboard JSON files
# =============================================================================
echo ""
echo "--- Validating Grafana dashboards ---"

REQUIRED_DASHBOARDS=(
    "nullspace-slo.json"
    "nullspace-simulator.json"
    "nullspace-gateway.json"
)

for dashboard in "${REQUIRED_DASHBOARDS[@]}"; do
    filepath="$OBS_DIR/dashboards/$dashboard"

    if [[ ! -f "$filepath" ]]; then
        log_error "Required dashboard missing: $dashboard"
        continue
    fi

    # Validate JSON syntax
    if ! python3 -c "import json; json.load(open('$filepath'))" 2>/dev/null; then
        log_error "Invalid JSON in dashboard: $dashboard"
        continue
    fi

    # Check required fields using Python for robust JSON parsing
    validation=$(python3 << EOF
import json
import sys

with open('$filepath') as f:
    dashboard = json.load(f)

errors = []

# Check required top-level fields
required_fields = ['uid', 'title', 'panels']
for field in required_fields:
    if field not in dashboard:
        errors.append(f"Missing required field: {field}")

# Check panels exist and have required structure
panels = dashboard.get('panels', [])
if len(panels) == 0:
    errors.append("Dashboard has no panels")
else:
    for i, panel in enumerate(panels):
        if panel.get('type') in ['row']:
            continue  # Skip row separators
        if 'title' not in panel:
            errors.append(f"Panel {i} missing title")
        if 'type' not in panel:
            errors.append(f"Panel {i} missing type")

# Print results
if errors:
    for e in errors:
        print(f"ERROR:{e}")
    sys.exit(1)
else:
    print(f"PANELS:{len([p for p in panels if p.get('type') != 'row'])}")
    sys.exit(0)
EOF
    )

    if [[ $? -ne 0 ]]; then
        while IFS= read -r line; do
            if [[ "$line" == ERROR:* ]]; then
                log_error "${dashboard}: ${line#ERROR:}"
            fi
        done <<< "$validation"
    else
        panel_count=$(echo "$validation" | grep "PANELS:" | cut -d: -f2)
        log_ok "$dashboard (${panel_count} panels)"
    fi
done

# =============================================================================
# 3. Validate required metrics coverage in dashboards
# =============================================================================
echo ""
echo "--- Checking metrics coverage (AC-9.2) ---"

# AC-9.2 requires: latency, error rates, queue depth
REQUIRED_METRICS=(
    "latency_ms"        # Latency metrics
    "errors"            # Error rate metrics
    "queue"             # Queue depth metrics
)

METRICS_COVERAGE=()

# Check all dashboards for required metrics
for dashboard in "$OBS_DIR"/dashboards/*.json; do
    if [[ ! -f "$dashboard" ]]; then continue; fi

    dashboard_name=$(basename "$dashboard")

    # Extract all prometheus expressions
    expressions=$(python3 << EOF
import json
import re

with open('$dashboard') as f:
    dashboard = json.load(f)

exprs = []
def find_exprs(obj):
    if isinstance(obj, dict):
        if 'expr' in obj:
            exprs.append(obj['expr'])
        for v in obj.values():
            find_exprs(v)
    elif isinstance(obj, list):
        for item in obj:
            find_exprs(item)

find_exprs(dashboard)
for e in exprs:
    print(e)
EOF
    )

    # Check for latency metrics
    if echo "$expressions" | grep -qi "latency"; then
        METRICS_COVERAGE+=("latency")
        log_verbose "$dashboard_name has latency metrics"
    fi

    # Check for error metrics
    if echo "$expressions" | grep -qi "error"; then
        METRICS_COVERAGE+=("errors")
        log_verbose "$dashboard_name has error metrics"
    fi

    # Check for queue metrics
    if echo "$expressions" | grep -qi "queue"; then
        METRICS_COVERAGE+=("queue")
        log_verbose "$dashboard_name has queue depth metrics"
    fi
done

# Dedupe and check coverage
UNIQUE_COVERAGE=($(printf '%s\n' "${METRICS_COVERAGE[@]}" | sort -u))

if [[ ! " ${UNIQUE_COVERAGE[*]} " =~ " latency " ]]; then
    log_error "Missing dashboard coverage for: latency metrics"
fi
if [[ ! " ${UNIQUE_COVERAGE[*]} " =~ " errors " ]]; then
    log_error "Missing dashboard coverage for: error rate metrics"
fi
if [[ ! " ${UNIQUE_COVERAGE[*]} " =~ " queue " ]]; then
    log_error "Missing dashboard coverage for: queue depth metrics"
fi

if [[ ${#UNIQUE_COVERAGE[@]} -eq 3 ]]; then
    log_ok "AC-9.2 metrics coverage complete: latency, error rates, queue depth"
fi

# =============================================================================
# 4. Validate Prometheus alert rules (YAML)
# =============================================================================
echo ""
echo "--- Validating alert rules ---"

ALERTS_FILE="$OBS_DIR/alerts/alerts.yml"

if [[ ! -f "$ALERTS_FILE" ]]; then
    log_error "Alert rules file missing: $ALERTS_FILE"
else
    # Validate YAML syntax
    if ! python3 -c "import yaml; yaml.safe_load(open('$ALERTS_FILE'))" 2>/dev/null; then
        log_error "Invalid YAML in alerts file"
    else
        # Validate alert structure
        validation=$(python3 << EOF
import yaml
import sys

with open('$ALERTS_FILE') as f:
    alerts = yaml.safe_load(f)

errors = []
alert_count = 0
critical_count = 0
warning_count = 0

if 'groups' not in alerts:
    errors.append("Missing 'groups' key in alerts file")
else:
    for group in alerts.get('groups', []):
        if 'name' not in group:
            errors.append("Alert group missing 'name'")
            continue
        if 'rules' not in group:
            errors.append(f"Alert group '{group['name']}' missing 'rules'")
            continue

        for rule in group['rules']:
            # Skip recording rules
            if 'record' in rule:
                continue

            alert_count += 1

            if 'alert' not in rule:
                errors.append(f"Rule in group '{group['name']}' missing 'alert' name")
                continue

            if 'expr' not in rule:
                errors.append(f"Alert '{rule.get('alert', '?')}' missing 'expr'")

            if 'labels' not in rule:
                errors.append(f"Alert '{rule.get('alert', '?')}' missing 'labels'")
            elif 'severity' not in rule.get('labels', {}):
                errors.append(f"Alert '{rule.get('alert', '?')}' missing severity label")
            else:
                severity = rule['labels']['severity']
                if severity == 'critical':
                    critical_count += 1
                elif severity == 'warning':
                    warning_count += 1

            if 'annotations' not in rule:
                errors.append(f"Alert '{rule.get('alert', '?')}' missing 'annotations'")
            elif 'summary' not in rule.get('annotations', {}):
                errors.append(f"Alert '{rule.get('alert', '?')}' missing summary annotation")

if errors:
    for e in errors:
        print(f"ERROR:{e}")
    sys.exit(1)
else:
    print(f"ALERTS:{alert_count}")
    print(f"CRITICAL:{critical_count}")
    print(f"WARNING:{warning_count}")
    sys.exit(0)
EOF
        )

        if [[ $? -ne 0 ]]; then
            while IFS= read -r line; do
                if [[ "$line" == ERROR:* ]]; then
                    log_error "alerts.yml: ${line#ERROR:}"
                fi
            done <<< "$validation"
        else
            alert_count=$(echo "$validation" | grep "ALERTS:" | cut -d: -f2)
            critical=$(echo "$validation" | grep "CRITICAL:" | cut -d: -f2)
            warning=$(echo "$validation" | grep "WARNING:" | cut -d: -f2)
            log_ok "alerts.yml ($alert_count alerts: $critical critical, $warning warning)"
        fi
    fi
fi

# =============================================================================
# 5. Validate alert coverage for critical metrics
# =============================================================================
echo ""
echo "--- Checking alert thresholds (AC-9.2) ---"

if [[ -f "$ALERTS_FILE" ]]; then
    # Check for required alert types
    alert_content=$(cat "$ALERTS_FILE")

    REQUIRED_ALERT_PATTERNS=(
        "Latency"       # Latency alerts
        "Error"         # Error rate alerts
        "Queue"         # Queue depth alerts
    )

    ALERT_COVERAGE=()

    for pattern in "${REQUIRED_ALERT_PATTERNS[@]}"; do
        if echo "$alert_content" | grep -qi "$pattern"; then
            ALERT_COVERAGE+=("$pattern")
            log_verbose "Alert coverage found for: $pattern"
        fi
    done

    if [[ ${#ALERT_COVERAGE[@]} -ge 3 ]]; then
        log_ok "AC-9.2 alert thresholds defined: ${ALERT_COVERAGE[*]}"
    else
        missing=()
        for pattern in "${REQUIRED_ALERT_PATTERNS[@]}"; do
            if [[ ! " ${ALERT_COVERAGE[*]} " =~ " $pattern " ]]; then
                missing+=("$pattern")
            fi
        done
        log_warn "Alert coverage incomplete. Missing: ${missing[*]}"
    fi
fi

# =============================================================================
# 6. Validate Prometheus config
# =============================================================================
echo ""
echo "--- Validating Prometheus config ---"

PROMETHEUS_FILE="$OBS_DIR/prometheus.yml"

if [[ ! -f "$PROMETHEUS_FILE" ]]; then
    log_warn "Prometheus config missing (optional): $PROMETHEUS_FILE"
else
    if ! python3 -c "import yaml; yaml.safe_load(open('$PROMETHEUS_FILE'))" 2>/dev/null; then
        log_error "Invalid YAML in prometheus.yml"
    else
        # Validate scrape configs
        validation=$(python3 << EOF
import yaml
import sys

with open('$PROMETHEUS_FILE') as f:
    config = yaml.safe_load(f)

scrape_jobs = []
if 'scrape_configs' in config:
    for job in config['scrape_configs']:
        if 'job_name' in job:
            scrape_jobs.append(job['job_name'])

print(f"JOBS:{','.join(scrape_jobs)}")
EOF
        )

        jobs=$(echo "$validation" | grep "JOBS:" | cut -d: -f2)
        log_ok "prometheus.yml (scrape jobs: $jobs)"
    fi
fi

# =============================================================================
# 7. Validate Alertmanager config
# =============================================================================
echo ""
echo "--- Validating Alertmanager config ---"

ALERTMANAGER_FILE="$OBS_DIR/alertmanager.yml"

if [[ ! -f "$ALERTMANAGER_FILE" ]]; then
    log_warn "Alertmanager config missing (optional): $ALERTMANAGER_FILE"
else
    if ! python3 -c "import yaml; yaml.safe_load(open('$ALERTMANAGER_FILE'))" 2>/dev/null; then
        log_error "Invalid YAML in alertmanager.yml"
    else
        validation=$(python3 << EOF
import yaml
import sys

with open('$ALERTMANAGER_FILE') as f:
    config = yaml.safe_load(f)

receivers = []
if 'receivers' in config:
    for r in config['receivers']:
        if 'name' in r:
            receivers.append(r['name'])

print(f"RECEIVERS:{','.join(receivers)}")
EOF
        )

        receivers=$(echo "$validation" | grep "RECEIVERS:" | cut -d: -f2)
        log_ok "alertmanager.yml (receivers: $receivers)"
    fi
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=== Validation Summary ==="
echo "Errors:   $ERRORS"
echo "Warnings: $WARNINGS"

if [[ $ERRORS -gt 0 ]]; then
    echo -e "${RED}FAILED${NC}: $ERRORS validation errors found"
    exit 1
else
    echo -e "${GREEN}PASSED${NC}: All observability configs are valid"
    exit 0
fi
