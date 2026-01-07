# Production Secrets

This directory contains SOPS-encrypted secrets for the production environment.

## CRITICAL SECURITY NOTES

- Production Age private key MUST be stored in a secure location (password manager, HSM, or dedicated secrets vault)
- NEVER store the production private key in plain text on developer machines
- Only CI/CD and authorized operators should have access to the production key
- Rotate secrets after any suspected compromise

## Setup

1. Generate an Age key for production (do this on a secure machine):
   ```bash
   ./scripts/setup-secrets.sh generate
   ```

2. Store the private key securely:
   - Copy `~/.config/sops/age/production.key` to secure storage
   - Delete the local copy after storing securely

3. Copy the template and fill in production values:
   ```bash
   cp ../secrets.template.yaml secrets.yaml
   # Edit secrets.yaml with production values
   ```

4. Encrypt the secrets:
   ```bash
   ./scripts/setup-secrets.sh encrypt production
   ```

5. Delete the plaintext file immediately:
   ```bash
   rm secrets.yaml
   ```

## Deployment

For CI/CD deployment, add the Age private key to GitHub Secrets:
- Secret name: `SOPS_AGE_KEY_PRODUCTION`
- Value: Contents of production.key file

```bash
# In CI/CD workflow
export SOPS_AGE_KEY="${{ secrets.SOPS_AGE_KEY_PRODUCTION }}"
./scripts/decrypt-secrets.sh production /etc/nullspace
```

## Manual Decryption (Emergency Only)

```bash
# Load key from secure storage
export SOPS_AGE_KEY="AGE-SECRET-KEY-..."

# Decrypt
./scripts/decrypt-secrets.sh production /etc/nullspace
```
