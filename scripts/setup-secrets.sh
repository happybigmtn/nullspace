#!/bin/bash
#
# Setup secrets management for Nullspace
#
# This script helps you:
#   1. Generate Age encryption keys for each environment
#   2. Create initial encrypted secrets files
#   3. Update .sops.yaml with your public keys
#
# Usage:
#   ./scripts/setup-secrets.sh              # Interactive setup
#   ./scripts/setup-secrets.sh generate     # Generate keys only
#   ./scripts/setup-secrets.sh encrypt <env> # Encrypt secrets for environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
KEYS_DIR="$HOME/.config/sops/age"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}INFO:${NC} $1"; }
log_success() { echo -e "${GREEN}SUCCESS:${NC} $1"; }
log_warn() { echo -e "${YELLOW}WARNING:${NC} $1"; }
log_error() { echo -e "${RED}ERROR:${NC} $1"; }

check_dependencies() {
    local missing=()

    if ! command -v sops &> /dev/null; then
        missing+=("sops")
    fi

    if ! command -v age &> /dev/null; then
        missing+=("age")
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing[*]}"
        echo ""
        echo "Install with:"
        echo "  macOS:   brew install sops age"
        echo "  Ubuntu:  apt install sops age"
        echo "  Arch:    pacman -S sops age"
        exit 1
    fi

    log_success "All dependencies found"
}

generate_key() {
    local env="$1"
    local key_file="$KEYS_DIR/${env}.key"

    if [[ -f "$key_file" ]]; then
        log_warn "Key already exists: $key_file"
        echo "To regenerate, delete the file first."
        return 0
    fi

    mkdir -p "$KEYS_DIR"
    chmod 700 "$KEYS_DIR"

    log_info "Generating Age key for environment: $env"
    age-keygen -o "$key_file" 2>&1

    chmod 600 "$key_file"

    local public_key
    public_key=$(grep "public key:" "$key_file" | cut -d: -f2 | tr -d ' ')

    log_success "Key generated: $key_file"
    echo ""
    echo "  Public key: $public_key"
    echo ""
    echo "  Add this to .sops.yaml for the $env environment."
    echo "  NEVER share the private key file."
}

generate_all_keys() {
    log_info "Generating Age keys for all environments..."
    echo ""

    for env in production staging development ci; do
        generate_key "$env"
        echo ""
    done

    log_success "All keys generated in: $KEYS_DIR"
    echo ""
    echo "Next steps:"
    echo "  1. Update .sops.yaml with the public keys shown above"
    echo "  2. Store production/CI private keys securely (password manager, HSM)"
    echo "  3. Add CI key to GitHub Secrets as SOPS_AGE_KEY"
}

encrypt_secrets() {
    local env="${1:-}"

    if [[ -z "$env" ]]; then
        log_error "Usage: $0 encrypt <environment>"
        echo "Environments: production, staging, development"
        exit 1
    fi

    local secrets_dir="$REPO_ROOT/secrets/$env"
    local input_file="$secrets_dir/secrets.yaml"
    local output_file="$secrets_dir/secrets.enc.yaml"
    local key_file="$KEYS_DIR/${env}.key"

    # Check for input file
    if [[ ! -f "$input_file" ]]; then
        log_error "Secrets file not found: $input_file"
        echo ""
        echo "Create it from template:"
        echo "  mkdir -p $secrets_dir"
        echo "  cp $REPO_ROOT/secrets/secrets.template.yaml $input_file"
        echo "  # Edit $input_file with actual values"
        echo "  $0 encrypt $env"
        exit 1
    fi

    # Setup key file
    if [[ -f "$key_file" ]]; then
        export SOPS_AGE_KEY_FILE="$key_file"
    elif [[ -n "${SOPS_AGE_KEY:-}" ]]; then
        log_info "Using SOPS_AGE_KEY environment variable"
    else
        log_error "No Age key found for environment: $env"
        echo ""
        echo "Generate keys with: $0 generate"
        exit 1
    fi

    log_info "Encrypting secrets for: $env"

    # Encrypt
    sops -e "$input_file" > "$output_file"

    log_success "Encrypted secrets written to: $output_file"
    echo ""
    echo "Next steps:"
    echo "  1. Verify: sops -d $output_file | head"
    echo "  2. Delete plaintext: rm $input_file"
    echo "  3. Commit: git add $output_file"
}

edit_secrets() {
    local env="${1:-}"

    if [[ -z "$env" ]]; then
        log_error "Usage: $0 edit <environment>"
        exit 1
    fi

    local secrets_file="$REPO_ROOT/secrets/$env/secrets.enc.yaml"
    local key_file="$KEYS_DIR/${env}.key"

    if [[ ! -f "$secrets_file" ]]; then
        log_error "No encrypted secrets file: $secrets_file"
        echo "Create one with: $0 encrypt $env"
        exit 1
    fi

    if [[ -f "$key_file" ]]; then
        export SOPS_AGE_KEY_FILE="$key_file"
    fi

    log_info "Editing secrets for: $env"
    sops "$secrets_file"
}

show_usage() {
    echo "Nullspace Secrets Management Setup"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  generate         Generate Age keys for all environments"
    echo "  encrypt <env>    Encrypt secrets.yaml for environment"
    echo "  edit <env>       Edit encrypted secrets in place"
    echo "  help             Show this help"
    echo ""
    echo "Environments: production, staging, development, ci"
    echo ""
    echo "Quick Start:"
    echo "  1. $0 generate"
    echo "  2. Update .sops.yaml with public keys"
    echo "  3. cp secrets/secrets.template.yaml secrets/staging/secrets.yaml"
    echo "  4. # Edit secrets/staging/secrets.yaml"
    echo "  5. $0 encrypt staging"
    echo "  6. rm secrets/staging/secrets.yaml"
}

# Main
check_dependencies

case "${1:-help}" in
    generate)
        generate_all_keys
        ;;
    encrypt)
        encrypt_secrets "${2:-}"
        ;;
    edit)
        edit_secrets "${2:-}"
        ;;
    help|--help|-h)
        show_usage
        ;;
    *)
        log_error "Unknown command: $1"
        show_usage
        exit 1
        ;;
esac
