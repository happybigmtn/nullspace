# Development Secrets

This directory contains SOPS-encrypted secrets for local development.

## Setup

For development, you can use a shared development key that all team members have access to.

1. Get the development Age key from your team lead or onboarding docs
2. Save it to `~/.config/sops/age/development.key`

Or generate a new one for solo development:
```bash
./scripts/setup-secrets.sh generate
```

## Quick Start

```bash
# Create secrets from template
cp ../secrets.template.yaml secrets.yaml

# Fill in development values (can use test/dummy values)
# Edit secrets.yaml

# Encrypt
./scripts/setup-secrets.sh encrypt development

# Clean up plaintext
rm secrets.yaml
```

## Usage

```bash
# Decrypt to stdout
./scripts/decrypt-secrets.sh development

# Decrypt to directory
./scripts/decrypt-secrets.sh development ./tmp-secrets
source ./tmp-secrets/auth.env
```

## Notes

- Development secrets can use test API keys
- Never use production keys in development
- The development key can be shared among the team (unlike production)
