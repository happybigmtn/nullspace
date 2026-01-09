# E33 - Secrets management (SOPS + Age encryption patterns)

Focus files:
- `scripts/setup-secrets.sh`
- `scripts/decrypt-secrets.sh`
- `.sops.yaml`
- `secrets/` directory structure

Goal: explain how Nullspace manages secrets using SOPS and Age encryption, why encryption-at-rest in the repository is safe and auditable, how per-environment key isolation works, how secrets are decrypted at deployment time, and how key lifecycle management prevents operational disasters.

---

## Learning objectives

After this lesson you should be able to:

1) Explain the threat model that SOPS + Age addresses.
2) Understand Age key generation and the public/private key relationship.
3) Describe SOPS configuration for per-environment encryption rules.
4) Walk through the encryption workflow from plaintext to committed encrypted files.
5) Understand deployment-time decryption and CI/CD integration.
6) Describe key rotation procedures and emergency response.
7) Identify failure modes and mitigation strategies.

---

## 1) Context: why secrets management matters

### 1.1 The secrets problem

Modern applications require secrets:

- API keys for external services (Stripe, Gemini, etc.)
- Database credentials
- Private keys for cryptographic signing
- JWT signing secrets
- Webhook endpoint secrets

These secrets must be:

- **Available** to services at runtime
- **Secret** from unauthorized parties
- **Auditable** for compliance and security review
- **Rotatable** when compromised or expired

### 1.2 Anti-patterns to avoid

Common dangerous patterns:

1. **Plaintext in repo**: Anyone with repo access gets production secrets forever (including Git history).
2. **Environment variables only**: No audit trail, hard to rotate, easy to leak in logs.
3. **Shared password manager**: No programmatic access, breaks deployment automation.
4. **Encrypted zip files**: No granular access, manual workflow, prone to human error.

### 1.3 The SOPS + Age solution

SOPS (Secrets OPerationS) is Mozilla's tool for encrypting structured data (YAML, JSON, ENV files). Age is a modern encryption tool with simple public/private key pairs.

Together, they provide:

- **Encryption at rest**: Secrets are encrypted in the Git repository.
- **Granular access**: Each environment has its own encryption key.
- **Auditability**: Encrypted changes are visible in Git diffs.
- **Automation-friendly**: Decryption is scriptable for CI/CD.

The threat model is: protect secrets from repository viewers who should not have production access, while allowing authorized deployers to decrypt at deployment time.

---

## 2) Age encryption fundamentals

### 2.1 What Age is

Age is a file encryption tool that uses X25519 (Curve25519) public key cryptography. It is designed to be simple and hard to misuse.

Key properties:

- **Public key**: Can be shared freely. Used to encrypt.
- **Private key**: Must be kept secret. Used to decrypt.
- **No identity verification**: Age does not have a web of trust. Keys are raw cryptographic material.

An Age key pair looks like this:

```
# private key (age-keygen output)
AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ

# public key (derived from private key)
age1publickey8characters6numbers2randomletters
```

### 2.2 Age vs GPG

Age is a deliberate simplification of GPG:

- GPG supports web of trust, key servers, multiple algorithms, and complex key management.
- Age supports one algorithm, raw key files, and nothing else.

For secrets management, Age is better because:

- Fewer ways to misconfigure.
- No global keyserver dependencies.
- Easier to script.

SOPS originally supported GPG, but Age is now the recommended backend.

### 2.3 Key generation workflow

Age keys are generated with `age-keygen`:

```bash
age-keygen -o ~/.config/sops/age/production.key
```

This produces a file containing both the private key and a comment with the public key:

```
# created: 2025-01-08T10:15:30Z
# public key: age1abcdef1234567890abcdef1234567890abcdef1234567890abcdef12
AGE-SECRET-KEY-1SECRETKEYCONTENTHERE
```

The public key is what you add to `.sops.yaml`. The private key file must be protected with file permissions (`chmod 600`) and stored securely.

### 2.4 Key storage requirements

Private keys must be:

- **On disk**: File permissions `600` (owner read/write only).
- **In CI**: Stored as GitHub Secrets or equivalent secret manager.
- **For production**: Ideally in HSM or cloud KMS, but Age keys can also be stored in password managers as text.

Public keys can be:

- Committed to `.sops.yaml` in the repository.
- Shared in documentation or Slack.
- Posted publicly (they are not secret).

---

## 3) SOPS configuration and path-based encryption rules

### 3.1 The .sops.yaml file

SOPS uses `.sops.yaml` to define which keys encrypt which files. Here is the Nullspace configuration:

```yaml
creation_rules:
  # Production secrets - requires production key
  - path_regex: secrets/production/.*\.enc\.(yaml|json|env)$
    age: >-
      age1production_key_placeholder_replace_with_actual_public_key

  # Staging secrets - requires staging key
  - path_regex: secrets/staging/.*\.enc\.(yaml|json|env)$
    age: >-
      age1xaw2rdg74qg5qtxltsj9sjzul9uptelmuptge36xdz4d9x4r7q7qt6vn49

  # Development secrets - can use local development key
  - path_regex: secrets/development/.*\.enc\.(yaml|json|env)$
    age: >-
      age1development_key_placeholder_replace_with_actual_public_key

  # CI secrets - for GitHub Actions automated deployments
  - path_regex: secrets/ci/.*\.enc\.(yaml|json|env)$
    age: >-
      age1ci_key_placeholder_replace_with_actual_public_key

encrypted_suffix: .enc.yaml
```

### 3.2 Path regex rules

Each `creation_rule` has two critical fields:

- `path_regex`: A regex matching file paths that should be encrypted with this rule.
- `age`: The Age public key (or comma-separated keys) authorized to decrypt these files.

When you run `sops secrets/staging/secrets.enc.yaml`, SOPS:

1. Looks for the first matching `path_regex`.
2. Uses the corresponding `age` public key to encrypt.
3. Stores encrypted content with metadata about which key was used.

### 3.3 Per-environment key isolation

The configuration creates strict isolation:

- **Production secrets**: Only the production private key can decrypt.
- **Staging secrets**: Only the staging private key can decrypt.
- **Development secrets**: Only the development private key can decrypt.
- **CI secrets**: Only the CI private key can decrypt.

This means:

- Developers with the staging key cannot decrypt production secrets.
- CI pipelines with the CI key cannot decrypt production secrets.
- Compromising one key does not expose secrets for other environments.

### 3.4 Why encrypted_suffix matters

The `encrypted_suffix` field tells SOPS to only operate on files ending with `.enc.yaml` (or `.enc.json`, `.enc.env`).

This prevents accidental encryption of plaintext files. If you run `sops secrets/staging/secrets.yaml` (no `.enc`), SOPS will refuse to encrypt it because it does not match the suffix rule.

This is a safety mechanism: it ensures you never accidentally commit plaintext secrets because SOPS will not encrypt them.

---

## 4) Secrets directory structure and .gitignore safety

### 4.1 Directory layout

The `secrets/` directory is organized by environment:

```
secrets/
├── secrets.template.yaml      # Template for creating new secrets
├── .gitignore                 # Protects against plaintext leaks
├── development/
│   ├── README.md              # Setup instructions
│   └── secrets.enc.yaml       # Encrypted secrets (committed)
├── staging/
│   ├── README.md
│   └── secrets.enc.yaml
├── production/
│   ├── README.md
│   └── secrets.enc.yaml
└── ci/
    ├── README.md
    └── secrets.enc.yaml
```

### 4.2 The .gitignore protection layer

The `secrets/.gitignore` file is critical:

```gitignore
# Ignore unencrypted secrets
*.yaml
!*.enc.yaml
*.json
!*.enc.json
*.env
!*.enc.env

# Ignore decrypted output
*.decrypted
*.plain
*.tmp

# Ignore Age private keys (should never be in repo)
*.key
keys.txt
```

This configuration:

- **Blocks all `.yaml` files** by default.
- **Allows only `.enc.yaml` files** (encrypted).
- **Blocks private keys** (`.key`, `keys.txt`).
- **Blocks temporary decrypted files** (`.decrypted`, `.plain`, `.tmp`).

### 4.3 How this prevents accidents

If a developer creates `secrets/staging/secrets.yaml` (plaintext) and tries to commit it:

```bash
git add secrets/staging/secrets.yaml
# Git ignores it due to .gitignore
```

Only `secrets/staging/secrets.enc.yaml` can be committed. This is a guardrail against the most common secrets leak: accidentally committing plaintext.

### 4.4 The secrets template

The `secrets/secrets.template.yaml` file documents the expected secret structure:

```yaml
# Nullspace Secrets Template
auth:
  AUTH_SECRET: "replace-with-secure-value"
  CASINO_ADMIN_PRIVATE_KEY_HEX: "replace-with-64-char-hex-private-key"
  GEMINI_API_KEY: "replace-with-gemini-api-key"

convex:
  CONVEX_SERVICE_TOKEN: "replace-with-convex-token"

stripe:
  STRIPE_SECRET_KEY: "sk_test_replace_me"
  STRIPE_WEBHOOK_SECRET: "whsec_replace_me"
# ... more sections
```

This serves as:

- **Documentation**: New developers know what secrets are required.
- **Scaffolding**: Copy to `secrets/development/secrets.yaml`, fill in values, then encrypt.
- **Validation**: If a service expects a secret that is not in the template, the template should be updated.

---

## 5) Encryption workflow: from plaintext to committed encrypted file

### 5.1 Initial setup: generating keys

The `setup-secrets.sh` script automates key generation for all environments:

```bash
./scripts/setup-secrets.sh generate
```

This runs `age-keygen` for each environment and stores keys in `~/.config/sops/age/`:

```bash
for env in production staging development ci; do
    age-keygen -o "$KEYS_DIR/${env}.key" 2>&1
done
```

Key observations from the script:

```bash
mkdir -p "$KEYS_DIR"
chmod 700 "$KEYS_DIR"      # Only owner can access directory
...
chmod 600 "$key_file"       # Only owner can read/write key file
```

This enforces secure file permissions automatically. If you generate keys manually, you must remember to `chmod 600` the key file. The script does it for you.

### 5.2 Extracting public keys

After generating keys, you need to extract the public key and add it to `.sops.yaml`:

```bash
public_key=$(grep "public key:" "$key_file" | cut -d: -f2 | tr -d ' ')
echo "Public key: $public_key"
echo "Add this to .sops.yaml for the $env environment."
```

The script outputs the public key for each environment. You manually copy these into `.sops.yaml` to replace the placeholder values.

### 5.3 Creating secrets from template

To create secrets for a new environment:

```bash
# Copy template
cp secrets/secrets.template.yaml secrets/staging/secrets.yaml

# Edit with actual values
# (Use your editor to fill in real secrets)

# Encrypt
./scripts/setup-secrets.sh encrypt staging
```

### 5.4 Encryption step by step

The `encrypt_secrets` function in `setup-secrets.sh`:

```bash
encrypt_secrets() {
    local env="${1:-}"
    local secrets_dir="$REPO_ROOT/secrets/$env"
    local input_file="$secrets_dir/secrets.yaml"       # Plaintext input
    local output_file="$secrets_dir/secrets.enc.yaml"  # Encrypted output
    local key_file="$KEYS_DIR/${env}.key"

    # Setup key file
    if [[ -f "$key_file" ]]; then
        export SOPS_AGE_KEY_FILE="$key_file"
    fi

    # Encrypt
    sops -e "$input_file" > "$output_file"

    # Next steps
    echo "Next steps:"
    echo "  1. Verify: sops -d $output_file | head"
    echo "  2. Delete plaintext: rm $input_file"
    echo "  3. Commit: git add $output_file"
}
```

Key steps:

1. **Set key file**: `export SOPS_AGE_KEY_FILE` tells SOPS where to find the private key for decryption checks.
2. **Encrypt**: `sops -e input > output` encrypts the plaintext file.
3. **Verify**: Decrypt and check that the output is correct.
4. **Delete plaintext**: Remove the unencrypted `secrets.yaml` file.
5. **Commit encrypted file**: Add `secrets.enc.yaml` to Git.

### 5.5 What happens during encryption

When you run `sops -e secrets/staging/secrets.yaml`:

1. SOPS reads `.sops.yaml` and finds the matching rule for `secrets/staging/`.
2. SOPS extracts the Age public key from the rule.
3. SOPS generates a random data encryption key (DEK).
4. SOPS encrypts the YAML file with the DEK (using AES-256-GCM).
5. SOPS encrypts the DEK with the Age public key.
6. SOPS outputs YAML with encrypted values and metadata.

The result looks like this (simplified):

```yaml
auth:
    AUTH_SECRET: ENC[AES256_GCM,data:abc123...,iv:xyz...,tag:...]
sops:
    age:
        - recipient: age1xaw2rdg74qg5qtxltsj9sjzul9uptelmuptge36xdz4d9x4r7q7qt6vn49
          enc: encrypted-data-key-here
    version: 3.8.1
```

The secret values are encrypted, but the YAML structure is preserved. This allows you to see diffs when secrets change, even though the values are encrypted.

### 5.6 Editing encrypted secrets in place

SOPS can decrypt, open an editor, and re-encrypt in one command:

```bash
sops secrets/staging/secrets.enc.yaml
```

This:

1. Decrypts to a temporary file.
2. Opens `$EDITOR` (vim, nano, etc.).
3. Re-encrypts when you save and exit.
4. Never writes plaintext to disk except the temporary file (which is cleaned up).

This is the safest way to edit secrets: you never manually create plaintext files that could be accidentally committed.

---

## 6) Decryption workflow: deployment-time secret access

### 6.1 Decryption prerequisites

To decrypt secrets, you need:

1. **The encrypted file**: `secrets/production/secrets.enc.yaml` (from the repo).
2. **The private key**: Either in `~/.config/sops/age/keys.txt` or as `SOPS_AGE_KEY` environment variable.
3. **SOPS installed**: `sops` command in `$PATH`.

### 6.2 The decrypt-secrets.sh script

The `decrypt-secrets.sh` script handles decryption for deployment:

```bash
#!/bin/bash
set -euo pipefail

ENVIRONMENT="${1:-}"
OUTPUT_DIR="${2:-}"

SECRETS_FILE="$REPO_ROOT/secrets/$ENVIRONMENT/secrets.enc.yaml"

# Check for age key
if [[ -z "${SOPS_AGE_KEY:-}" ]] && [[ -z "${SOPS_AGE_KEY_FILE:-}" ]]; then
    DEFAULT_KEY_FILE="$HOME/.config/sops/age/keys.txt"
    if [[ -f "$DEFAULT_KEY_FILE" ]]; then
        export SOPS_AGE_KEY_FILE="$DEFAULT_KEY_FILE"
    else
        echo "Error: No Age key found."
        exit 1
    fi
fi

# If no output dir, decrypt to stdout
if [[ -z "$OUTPUT_DIR" ]]; then
    sops -d "$SECRETS_FILE"
    exit 0
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"
chmod 700 "$OUTPUT_DIR"

# Decrypt and parse YAML to generate service-specific env files
if command -v yq &> /dev/null; then
    sops -d "$SECRETS_FILE" | yq -r '.auth // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/auth.env"
    sops -d "$SECRETS_FILE" | yq -r '.convex // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/convex.env"
    # ... more services
    chmod 600 "$OUTPUT_DIR"/*.env
fi
```

### 6.3 Decryption modes

The script supports two modes:

**1. Stdout mode** (for inspection):

```bash
./scripts/decrypt-secrets.sh staging
# Outputs decrypted YAML to stdout
```

**2. Directory mode** (for deployment):

```bash
./scripts/decrypt-secrets.sh production /etc/nullspace
# Creates /etc/nullspace/auth.env, /etc/nullspace/convex.env, etc.
```

### 6.4 Service-specific env file generation

The script uses `yq` to parse the decrypted YAML and generate service-specific env files:

```bash
sops -d "$SECRETS_FILE" | yq -r '.auth // {} | to_entries | .[] | "\(.key)=\(.value)"' > "$OUTPUT_DIR/auth.env"
```

This extracts the `auth` section and converts it to env format:

```
AUTH_SECRET=actual-secret-value
CASINO_ADMIN_PRIVATE_KEY_HEX=actual-hex-key
GEMINI_API_KEY=actual-api-key
```

Each service gets its own env file:

- `auth.env` for the auth service
- `convex.env` for Convex backend
- `stripe.env` for Stripe integration
- `gateway.env` for the gateway service
- etc.

This allows systemd units to source only the secrets they need. A service does not get secrets for other services.

### 6.5 File permissions for decrypted secrets

The script enforces secure permissions:

```bash
chmod 700 "$OUTPUT_DIR"      # Directory: owner-only access
chmod 600 "$OUTPUT_DIR"/*.env  # Files: owner-only read/write
```

This prevents other users on the server from reading the decrypted secrets. Only the service user (or root) can access them.

---

## 7) CI/CD integration: automated decryption in pipelines

### 7.1 GitHub Actions secret storage

For CI/CD, the private key is stored as a GitHub Actions secret:

```yaml
# In GitHub repo settings -> Secrets and variables -> Actions
SOPS_AGE_KEY: AGE-SECRET-KEY-1QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ
```

This is the entire private key file content as a single secret.

### 7.2 Decryption in workflow

In a GitHub Actions workflow:

```yaml
- name: Decrypt secrets
  env:
    SOPS_AGE_KEY: ${{ secrets.SOPS_AGE_KEY }}
  run: |
    ./scripts/decrypt-secrets.sh production /tmp/secrets
    # Now /tmp/secrets/*.env contains decrypted secrets
```

The `SOPS_AGE_KEY` environment variable contains the private key. SOPS reads it automatically.

### 7.3 Key rotation in CI

If you rotate the Age key:

1. Generate a new key pair.
2. Re-encrypt all secrets with the new public key.
3. Update the `SOPS_AGE_KEY` GitHub secret with the new private key.
4. Commit the re-encrypted secrets.

The workflow does not change. Only the key content changes.

### 7.4 Multi-key encryption for zero-downtime rotation

SOPS supports encrypting with multiple Age keys:

```yaml
age: >-
  age1oldkey...,
  age1newkey...
```

This allows both the old and new key to decrypt the same file. During rotation:

1. Add the new key to `.sops.yaml` alongside the old key.
2. Re-encrypt secrets (now both keys can decrypt).
3. Update CI/CD to use the new key.
4. Verify deployments work.
5. Remove the old key from `.sops.yaml`.
6. Re-encrypt again (now only the new key can decrypt).

This is zero-downtime rotation: the old key continues working until the new key is fully deployed.

---

## 8) Key lifecycle management

### 8.1 Initial key generation checklist

When setting up a new environment:

1. Run `./scripts/setup-secrets.sh generate`.
2. Save private keys to secure storage (password manager, HSM, or cloud secret manager).
3. Add public keys to `.sops.yaml`.
4. Commit `.sops.yaml` changes.
5. For CI keys, add private key to GitHub Secrets.
6. For production keys, distribute private keys to authorized operators via secure channel (not email, not Slack).

### 8.2 Key storage best practices

**Development keys**:
- Can be shared among team members.
- Store in team password manager or onboarding docs.
- Risk is low (development secrets are not production-sensitive).

**Staging keys**:
- Shared among developers and CI.
- Store in password manager and GitHub Secrets.
- Medium risk (staging may have test data or pre-production configs).

**Production keys**:
- Shared only with authorized operators.
- Store in enterprise password manager, HSM, or cloud KMS.
- High risk (production secrets grant access to live systems).

**CI keys**:
- Stored in GitHub Secrets.
- Should be separate from production keys.
- Risk is medium (CI can deploy, but limited to automated workflows).

### 8.3 Key backup and recovery

If a key is lost, you cannot decrypt secrets encrypted with that key. To prevent this:

1. **Backup keys to password manager**: Store private keys in 1Password, Bitwarden, or equivalent.
2. **Multi-key encryption**: Use multiple keys for critical environments (e.g., production encrypted with both operator key and backup key).
3. **Key escrow**: For production, consider a sealed envelope in a physical safe or bank vault.

If a key is lost and no backup exists, you must:

1. Generate a new key.
2. Manually re-create all secrets (from memory, backups, or external sources).
3. Re-encrypt with the new key.

This is catastrophic. Always back up keys.

### 8.4 Key rotation triggers

Rotate keys when:

1. **Scheduled rotation**: Every 90-180 days (best practice).
2. **Team member departure**: If someone leaves the team and had access to the key.
3. **Suspected compromise**: If a key may have been exposed (leaked in logs, sent via insecure channel, etc.).
4. **Audit requirement**: Compliance frameworks may require regular rotation.

### 8.5 Key rotation procedure

Full rotation procedure:

```bash
# 1. Generate new key
age-keygen -o ~/.config/sops/age/production-new.key

# 2. Extract public key
grep "public key:" ~/.config/sops/age/production-new.key

# 3. Add new public key to .sops.yaml (keep old key for now)
# Edit .sops.yaml:
#   age: age1oldkey..., age1newkey...

# 4. Re-encrypt all secrets
export SOPS_AGE_KEY_FILE=~/.config/sops/age/production-new.key
sops updatekeys secrets/production/secrets.enc.yaml

# 5. Verify decryption with new key
sops -d secrets/production/secrets.enc.yaml | head

# 6. Commit re-encrypted secrets
git add secrets/production/secrets.enc.yaml .sops.yaml
git commit -m "Rotate production Age key"

# 7. Update CI/CD secret
# In GitHub: Update SOPS_AGE_KEY to new private key content

# 8. Deploy and verify
# Run deployment, check that services start successfully

# 9. Remove old key from .sops.yaml
# Edit .sops.yaml: remove old public key, keep only new key

# 10. Re-encrypt again (final state: only new key)
sops updatekeys secrets/production/secrets.enc.yaml

# 11. Commit final state
git add .sops.yaml secrets/production/secrets.enc.yaml
git commit -m "Complete production key rotation"

# 12. Securely destroy old key
shred -u ~/.config/sops/age/production-old.key
```

This is a multi-step process, but it ensures zero downtime and auditable changes.

---

## 9) Emergency procedures

### 9.1 Suspected key compromise

If a key is suspected to be compromised:

1. **Immediate rotation**: Follow key rotation procedure above, but skip multi-key phase. Generate new key, re-encrypt immediately, remove old key.
2. **Audit secret usage**: Check service logs for unauthorized access. Look for unexpected API calls or data access.
3. **Rotate downstream secrets**: If production key is compromised, assume all secrets may be exposed. Rotate Stripe API keys, database passwords, JWT signing secrets, etc.
4. **Incident report**: Document what happened, how the key was exposed, and steps taken to remediate.

### 9.2 Lost key with no backup

If a key is lost and there is no backup:

1. **Generate new key**: Create a replacement key.
2. **Re-create secrets**: Manually gather all secret values from external sources (Stripe dashboard, Gemini dashboard, database admin, etc.).
3. **Update secrets template**: Ensure template reflects current secrets structure.
4. **Encrypt new secrets**: Use new key to encrypt.
5. **Deploy**: Update CI/CD and deploy with new secrets.

This is disruptive and may require downtime. Always back up keys to avoid this scenario.

### 9.3 Accidental plaintext commit

If plaintext secrets are committed to Git:

1. **Rotate all exposed secrets immediately**: Assume they are public.
2. **Remove from Git history**: Use `git filter-branch` or BFG Repo-Cleaner to purge the file from history.
3. **Notify team**: Ensure everyone re-clones the repository after history rewrite.
4. **Update `.gitignore`**: Ensure the plaintext file pattern is blocked.

**Critical**: Removing from Git history does not remove from GitHub's cache or forks. If the repo is public, assume the secrets are permanently exposed. If private, assume anyone with access during the exposure window has the secrets.

### 9.4 SOPS failure during deployment

If `sops -d` fails during deployment:

1. **Check key availability**: Ensure `SOPS_AGE_KEY` or `SOPS_AGE_KEY_FILE` is set.
2. **Check file integrity**: Ensure `secrets.enc.yaml` is not corrupted (verify with `git status`).
3. **Check SOPS version**: Ensure SOPS version matches the version that encrypted the file.
4. **Fallback to previous deployment**: Roll back to last known good version while debugging.

---

## 10) Limits and management callouts

### 10.1 SOPS does not protect secrets at runtime

SOPS encrypts secrets at rest (in Git). Once decrypted, they are plain environment variables or files. Services must handle them securely:

- **Do not log secrets**: Avoid logging env vars or request headers that contain secrets.
- **Use TLS**: Transmit secrets over HTTPS only.
- **Restrict access**: Run services as non-root users with minimal permissions.

SOPS is not a runtime secret manager. It is a deployment-time decryption tool.

### 10.2 Age keys are symmetric trust

Age keys do not have identity. The public key `age1abc...` does not tell you who owns it. You must track key ownership externally (in documentation or a key registry).

If you have 10 keys and forget which is which, you cannot determine ownership from the keys themselves. Keep a key manifest:

```
production: age1abc... (stored in 1Password, distributed to Alice and Bob)
staging: age1def... (stored in GitHub Secrets, shared with team)
```

### 10.3 SOPS re-encryption is not atomic

When you edit secrets with `sops`, the file is decrypted, edited, and re-encrypted. If the process is interrupted (e.g., crash, Ctrl-C), the file may be left in an inconsistent state.

Always commit changes immediately after editing, and verify with `git diff` that the encrypted file looks correct (YAML structure preserved, `sops:` metadata updated).

### 10.4 Git diffs leak metadata

Encrypted files show diffs in Git:

```diff
- AUTH_SECRET: ENC[AES256_GCM,data:old...,iv:...]
+ AUTH_SECRET: ENC[AES256_GCM,data:new...,iv:...]
```

This reveals:

- Which secrets changed (key names visible).
- When they changed (commit timestamp).
- Who changed them (commit author).

This is good for auditability, but it does leak metadata. If key names are sensitive (e.g., `PARTNER_API_KEY_ACME_CORP`), consider using generic names or redacting Git history.

### 10.5 SOPS does not enforce value validation

SOPS encrypts whatever you give it. If you encrypt an invalid API key or malformed JSON, SOPS will not detect it. Validation happens at runtime when services fail to start.

To mitigate:

1. **Use the template**: Follow the structure in `secrets.template.yaml`.
2. **Test in staging**: Deploy to staging before production.
3. **Automated validation**: Run `yq` or `jq` on decrypted secrets to validate structure before deployment.

---

## 11) Feynman recap

Secrets management is a locked safe with multiple keys. Each environment gets its own safe (production, staging, development). The keys are Age keypairs. The safe is SOPS encryption. You put plaintext secrets into the safe, lock it with the public key, and commit the locked safe to Git. When you deploy, you unlock the safe with the private key and hand the secrets to the services. If you lose the key, the safe is permanently locked. If someone steals the key, they can unlock the safe. Protect the key, rotate it regularly, and never commit plaintext. That is secrets management.

---

## 12) Exercises

1) Why does the `.gitignore` file block `*.yaml` but allow `*.enc.yaml`?
2) What happens if you run `sops -e` on a file that does not match any `path_regex` in `.sops.yaml`?
3) Why does the `decrypt-secrets.sh` script use `chmod 600` on decrypted env files?
4) How does SOPS support zero-downtime key rotation with multiple keys?
5) If a production key is compromised, what secrets must be rotated beyond the Age key itself?
6) Why is it safe to commit `secrets/staging/secrets.enc.yaml` to a public repository?
7) What is the difference between `SOPS_AGE_KEY` and `SOPS_AGE_KEY_FILE`?

---

## Next lesson

E34 - Deployment orchestration: `feynman/lessons/E34-deployment-orchestration.md` (or next available lesson number)
