# L50 - Web vault (passkey + password) storage (from scratch)

Focus file: `website/src/security/keyVault.ts`

Goal: explain how the web app creates a local vault using passkeys or passwords, and how secrets are encrypted/decrypted on the device. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Local key vault
The web client stores private keys locally in the browser. The vault encrypts those keys so they are not stored in plain text.

### 2) Passkey-based vault
Modern authenticators can produce a secret (PRF/hmac-secret/largeBlob). This secret is used to derive an AES key for encryption.

### 3) Password-based vault
If passkeys are not available, the vault can derive an AES key using PBKDF2 and a user password.

### 4) IndexedDB + localStorage
- Encrypted vault records are stored in IndexedDB.
- Non-secret metadata (kind, public key) is stored in localStorage for fast access.

---

## Limits & management callouts (important)

1) **Password min length = 8**
- `PASSWORD_MIN_LENGTH` enforces a baseline.
- Consider raising this for production security.

2) **PBKDF2 iterations = 310,000**
- This is a CPU cost knob for password vaults.
- Higher values improve security but can slow low-end devices.

3) **Passkey fallback mode (v2) stores a key in IndexedDB**
- If PRF/largeBlob are not supported, it falls back to a non-extractable AES key.
- This is device-local and not portable across devices.

---

## Walkthrough with code excerpts

### 1) Passkey support detection
```rust
export function isPasskeyVaultSupported(): boolean {
  if (!isVaultStorageSupported()) return false;
  return typeof window.PublicKeyCredential !== 'undefined' && !!navigator?.credentials;
}
```

Why this matters:
- The UI needs to know whether passkey flows can even work on this device.

What this code does:
- Checks for browser crypto and WebAuthn support.
- Returns true only if passkeys are likely supported.

---

### 2) Creating a passkey credential
```rust
async function createPasskeyCredential(): Promise<{ credentialId: string }> {
  if (!isPasskeyVaultSupported()) throw new Error('passkey-vault-unsupported');

  const rpId = normalizeRpId(window.location.hostname);
  const challenge = randomBytes(32);
  const userId = randomBytes(32);

  const publicKey: any = {
    rp: { name: 'null/space', id: rpId },
    user: { id: userId, name: 'nullspace', displayName: 'nullspace' },
    challenge,
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 60_000,
    attestation: 'none',
    authenticatorSelection: {
      userVerification: 'required',
      residentKey: 'required',
    },
    extensions: {
      prf: {},
      hmacCreateSecret: true,
      largeBlob: { support: 'preferred' },
    },
  };

  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error('passkey-create-failed');

  const credentialId = bytesToBase64Url(new Uint8Array(cred.rawId));
  return { credentialId };
}
```

Why this matters:
- This is how the browser creates a passkey identity for the vault.

What this code does:
- Builds a WebAuthn request with PRF/hmac-secret/largeBlob extensions.
- Creates a passkey and stores its credential ID.

---

### 3) Deriving an AES key from PRF output
```rust
async function deriveAesKeyFromPrf(prfOutput: Uint8Array, prfSalt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', prfOutput as BufferSource, 'HKDF', false, ['deriveKey']);
  const info = new TextEncoder().encode('nullspace-vault-v1');
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: prfSalt as BufferSource, info: info as BufferSource },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
```

Why this matters:
- The PRF output is not used directly; it is stretched into a stable AES key.

Syntax notes:
- `HKDF` derives a key from raw bytes using salt + info.
- `AES-GCM` is used for authenticated encryption.

What this code does:
- Imports the PRF output as an HKDF key.
- Derives a 256-bit AES-GCM key for encryption/decryption.

---

### 4) Creating a passkey vault with fallback
```rust
export async function createPasskeyVault(options?: { migrateExistingCasinoKey?: boolean }): Promise<VaultRecord> {
  if (!isPasskeyVaultSupported()) throw new Error('passkey-vault-unsupported');
  const vaultId: VaultId = 'default';

  const { credentialId } = await createPasskeyCredential();
  const prfSalt = randomBytes(32);

  let aesKey: CryptoKey;
  let recordVersion: 1 | 2 = 1;
  try {
    const largeBlobSeed = randomBytes(32);
    const prfOutput = await getPrfOutput(credentialId, prfSalt, { largeBlobWrite: largeBlobSeed });
    aesKey = await deriveAesKeyFromPrf(prfOutput, prfSalt);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (msg !== 'passkey-prf-unsupported') throw e;

    aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    recordVersion = 2;
  }

  const { secrets, nullspacePublicKeyHex, bettingPrivateKeyBytes, chatEvmPrivateKey } = await createVaultSecrets(options);
  const cipher = await encryptVaultSecrets(aesKey, vaultId, secrets);
  const now = Date.now();

  const record: VaultRecord = recordVersion === 1
    ? { id: vaultId, version: 1, credentialId, prfSalt: bytesToBase64Url(prfSalt), cipher, nullspacePublicKeyHex, createdAtMs: now, updatedAtMs: now }
    : { id: vaultId, version: 2, credentialId, keystoreKey: aesKey, cipher, nullspacePublicKeyHex, createdAtMs: now, updatedAtMs: now };

  await idbPutVault(record);
  setVaultMeta({ kind: VAULT_KIND_PASSKEY, vaultId, publicKeyHex: nullspacePublicKeyHex, credentialId });

  const unlocked: UnlockedVault = {
    vaultId,
    credentialId,
    unlockedAtMs: now,
    nullspaceEd25519PrivateKey: bettingPrivateKeyBytes,
    chatEvmPrivateKey,
    nullspacePublicKeyHex,
  };
  setUnlockedVault(unlocked);

  return record;
}
```

Why this matters:
- This is the core flow that creates a passkey-protected vault.

What this code does:
- Creates a passkey and derives an AES key from PRF output.
- Falls back to a device-local AES key if PRF is unsupported.
- Encrypts secrets, stores the vault, and marks it unlocked in memory.

---

### 5) Password-based vault creation
```rust
export async function createPasswordVault(
  password: string,
  options?: { migrateExistingCasinoKey?: boolean },
): Promise<VaultRecord> {
  if (!isPasswordVaultSupported()) throw new Error('password-vault-unsupported');
  if (!password || password.length < PASSWORD_MIN_LENGTH) throw new Error('password-too-short');

  const vaultId: VaultId = 'default';
  const salt = randomBytes(32);
  const aesKey = await deriveAesKeyFromPassword(password, salt, PASSWORD_KDF_ITERATIONS);

  const { secrets, nullspacePublicKeyHex, bettingPrivateKeyBytes, chatEvmPrivateKey } = await createVaultSecrets(options);
  const cipher = await encryptVaultSecrets(aesKey, vaultId, secrets);
  const now = Date.now();

  const record: VaultRecordV3 = {
    id: vaultId,
    version: 3,
    kind: 'password',
    kdf: { name: 'PBKDF2', iterations: PASSWORD_KDF_ITERATIONS, hash: 'SHA-256' },
    salt: bytesToBase64Url(salt),
    cipher,
    nullspacePublicKeyHex,
    createdAtMs: now,
    updatedAtMs: now,
  };

  await idbPutVault(record);
  setVaultMeta({ kind: VAULT_KIND_PASSWORD, vaultId, publicKeyHex: nullspacePublicKeyHex });
  setUnlockedVault({ vaultId, unlockedAtMs: now, nullspaceEd25519PrivateKey: bettingPrivateKeyBytes, chatEvmPrivateKey, nullspacePublicKeyHex });

  return record;
}
```

Why this matters:
- Password vaults provide a non-passkey fallback for devices without WebAuthn support.

What this code does:
- Derives an AES key via PBKDF2.
- Encrypts and stores secrets in IndexedDB.
- Stores metadata in localStorage for quick access.

---

## Key takeaways
- The vault encrypts private keys on-device using passkeys or passwords.
- Passkey PRF is preferred; IndexedDB keystore is the fallback.
- Password vaults rely on PBKDF2 with a high iteration count.

## Next lesson
E16 - Limits inventory + tuning: `feynman/lessons/E16-limits-inventory.md`
