# Staging Secrets

This directory contains SOPS-encrypted secrets for the staging environment.

## Setup

1. Generate an Age key for staging:
   ```bash
   ./scripts/setup-secrets.sh generate
   ```

2. Copy the template and fill in staging values:
   ```bash
   cp ../secrets.template.yaml secrets.yaml
   # Edit secrets.yaml with your staging values
   ```

3. Encrypt the secrets:
   ```bash
   ./scripts/setup-secrets.sh encrypt staging
   ```

4. Delete the plaintext file:
   ```bash
   rm secrets.yaml
   ```

## Decrypt at deployment

```bash
# Set the Age private key (from secure storage)
export SOPS_AGE_KEY="AGE-SECRET-KEY-..."

# Decrypt to env files
./scripts/decrypt-secrets.sh staging /etc/nullspace
```

## Edit existing secrets

```bash
./scripts/setup-secrets.sh edit staging
```
