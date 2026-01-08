#!/bin/bash
#
# Decrypt secrets for deployment
#
# Usage:
#   ./scripts/decrypt-secrets.sh <environment> [output-dir]
#
# Examples:
#   ./scripts/decrypt-secrets.sh staging              # Output to stdout
#   ./scripts/decrypt-secrets.sh production /etc/nullspace  # Output to directory
#
# Prerequisites:
#   - sops installed (brew install sops / apt install sops)
#   - Age private key available:
#     - File: SOPS_AGE_KEY_FILE environment variable, or ~/.config/sops/age/keys.txt
#     - Inline: SOPS_AGE_KEY environment variable (for CI)
#
# In CI/CD:
#   export SOPS_AGE_KEY="${{ secrets.SOPS_AGE_KEY }}"
#   ./scripts/decrypt-secrets.sh production /etc/nullspace

set -euo pipefail

ENVIRONMENT="${1:-}"
OUTPUT_DIR="${2:-}"

if [[ -z "$ENVIRONMENT" ]]; then
    echo "Usage: $0 <environment> [output-dir]"
    echo ""
    echo "Environments: production, staging, development"
    echo ""
    echo "Examples:"
    echo "  $0 staging                    # Print decrypted secrets to stdout"
    echo "  $0 production /etc/nullspace  # Write env files to directory"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_FILE="$REPO_ROOT/secrets/$ENVIRONMENT/secrets.enc.yaml"

# Validate environment
if [[ ! -f "$SECRETS_FILE" ]]; then
    echo "Error: Secrets file not found: $SECRETS_FILE"
    echo ""
    echo "Available environments:"
    ls -1 "$REPO_ROOT/secrets/" 2>/dev/null | grep -v -E '^\.' | grep -v template || echo "  (none)"
    exit 1
fi

# Check for sops
if ! command -v sops &> /dev/null; then
    echo "Error: sops not found. Install with:"
    echo "  brew install sops  # macOS"
    echo "  apt install sops   # Ubuntu/Debian"
    exit 1
fi

# Check for age key
if [[ -z "${SOPS_AGE_KEY:-}" ]] && [[ -z "${SOPS_AGE_KEY_FILE:-}" ]]; then
    DEFAULT_KEY_FILE="$HOME/.config/sops/age/keys.txt"
    if [[ -f "$DEFAULT_KEY_FILE" ]]; then
        export SOPS_AGE_KEY_FILE="$DEFAULT_KEY_FILE"
    else
        echo "Error: No Age key found."
        echo ""
        echo "Options:"
        echo "  1. Set SOPS_AGE_KEY environment variable"
        echo "  2. Set SOPS_AGE_KEY_FILE environment variable"
        echo "  3. Create key at $DEFAULT_KEY_FILE"
        echo ""
        echo "Generate new key: age-keygen -o $DEFAULT_KEY_FILE"
        exit 1
    fi
fi

echo "Decrypting secrets for environment: $ENVIRONMENT" >&2

# If no output dir, decrypt to stdout as YAML
if [[ -z "$OUTPUT_DIR" ]]; then
    sops -d "$SECRETS_FILE"
    exit 0
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"

# Decrypt and parse YAML to generate service-specific env files
echo "Writing env files to: $OUTPUT_DIR" >&2

# Use yq to extract sections and convert to env format
# If yq is not available, fall back to a simpler approach

if command -v yq &> /dev/null; then
    # Extract auth secrets
    sops -d "$SECRETS_FILE" | yq -r '.auth // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/auth.env"

    # Extract convex secrets
    sops -d "$SECRETS_FILE" | yq -r '.convex // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/convex.env"

    # Extract stripe secrets
    sops -d "$SECRETS_FILE" | yq -r '.stripe // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/stripe.env"

    # Extract gateway secrets
    sops -d "$SECRETS_FILE" | yq -r '.gateway // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/gateway.env"

    # Extract simulator secrets
    sops -d "$SECRETS_FILE" | yq -r '.simulator // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/simulator.env"

    # Extract node/validator secrets (same as simulator for now)
    sops -d "$SECRETS_FILE" | yq -r '.simulator // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/node.env"

    # Extract ops secrets
    sops -d "$SECRETS_FILE" | yq -r '.ops // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/ops.env"

    # Extract evm secrets
    sops -d "$SECRETS_FILE" | yq -r '.evm // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/evm.env"

    # Extract alerting secrets
    sops -d "$SECRETS_FILE" | yq -r '.alerting // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/alerting.env"

    # Set secure permissions
    chmod 600 "$OUTPUT_DIR"/*.env

    echo "Generated env files:" >&2
    ls -la "$OUTPUT_DIR"/*.env >&2
else
    # Fallback: output full decrypted YAML
    echo "Warning: yq not found. Outputting full secrets.yaml instead of individual env files." >&2
    sops -d "$SECRETS_FILE" > "$OUTPUT_DIR/secrets.yaml"
    chmod 600 "$OUTPUT_DIR/secrets.yaml"
fi

echo "" >&2
echo "Done! Secrets decrypted to: $OUTPUT_DIR" >&2
