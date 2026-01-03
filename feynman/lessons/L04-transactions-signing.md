# L04 - Transaction building + signing (from scratch)

Focus file: `gateway/src/codec/transactions.ts`

Goal: explain how raw instructions become signed transactions and how they are wrapped for submission. For every excerpt, you’ll see **why it matters** and a **plain description of what the code does**.

Supporting references:
- `gateway/src/codec/constants.ts` (TRANSACTION_NAMESPACE, SubmissionTag)
- `types/src/execution.rs` (Transaction layout in Rust)

---

## Concepts from scratch (expanded)

### 1) What is a transaction?
A transaction is a byte package that says:
- **who** is sending it (public key),
- **what** they want to do (instruction bytes),
- **in what order** (nonce),
- and a **signature** proving it was authorized.

### 2) Why sign?
A signature is a tamper‑proof stamp. If anyone changes the bytes, the signature becomes invalid. This prevents forgery.

### 3) What is Ed25519?
Ed25519 is a fast signature scheme:
- Private key signs.
- Public key verifies.
- Keys and signatures have fixed sizes (32‑byte public key, 64‑byte signature).

### 4) Namespacing signatures
A namespace (e.g., `_NULLSPACE_TX`) is prefixed when signing. It prevents a signature from being reused in a different protocol or context.

### 5) Submission envelope
The backend expects **Submission** objects. Even a single transaction must be wrapped in a “transactions” submission with a length prefix.

---

## Limits & management callouts (important)

1) **Nonce is u64**
- This caps the maximum number of transactions per account. It’s practically huge but still finite.

2) **No size caps here**
- `wrapSubmission` does not enforce a max request size. The server must enforce payload limits elsewhere.

3) **Namespace is fixed**
- Changing `_NULLSPACE_TX` would invalidate all existing signatures. This is a network‑wide breaking change.

---

## Walkthrough with code excerpts

### 1) Varint encoding
```ts
export function encodeVarint(value: number): Uint8Array {
  if (value < 0) throw new Error('Varint cannot encode negative numbers');

  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);  // 7 data bits + continuation bit
    value >>>= 7;
  }
  bytes.push(value & 0x7f);

  return new Uint8Array(bytes);
}
```

Why this matters:
- Submission vectors need compact length encoding. Varints save space for small lengths.

What this code does:
- Encodes a number into 1–N bytes, using 7 data bits per byte and a continuation bit.
- Iteratively takes the lowest 7 bits, sets the continuation bit if more bytes follow, and shifts the value down.
- Returns the resulting byte array in the same order the Rust decoder expects.

---

### 2) Varint size helper
```ts
export function varintSize(value: number): number {
  if (value === 0) return 1;
  let size = 0;
  while (value > 0) {
    size++;
    value >>>= 7;
  }
  return size;
}
```

Why this matters:
- Used to pre‑allocate buffers correctly for performance.

What this code does:
- Calculates how many bytes the varint encoding will use.
- Handles zero as a special case (1 byte) and otherwise counts how many 7‑bit chunks are needed.

---

### 3) Namespace signing format
```ts
function unionUnique(namespace: Uint8Array, message: Uint8Array): Uint8Array {
  const lenVarint = encodeVarint(namespace.length);
  const result = new Uint8Array(lenVarint.length + namespace.length + message.length);
  result.set(lenVarint, 0);
  result.set(namespace, lenVarint.length);
  result.set(message, lenVarint.length + namespace.length);
  return result;
}
```

Why this matters:
- This is the exact byte layout that Rust expects when verifying signatures.

What this code does:
- Builds the signed message as: `[len(namespace)][namespace][payload]`.
- Prefixes the namespace length as a varint so the decoder can parse unambiguously.
- Returns a single concatenated byte array for signing.

---

### 4) Build a signed transaction
```ts
export function buildTransaction(
  nonce: bigint,
  instruction: Uint8Array,
  privateKey: Uint8Array
): Uint8Array {
  const publicKey = ed25519.getPublicKey(privateKey);

  // Build payload: nonce (8 bytes BE) + instruction
  const payload = new Uint8Array(8 + instruction.length);
  new DataView(payload.buffer).setBigUint64(0, nonce, false);  // BE
  payload.set(instruction, 8);

  // Sign with namespace
  const toSign = unionUnique(TRANSACTION_NAMESPACE, payload);
  const signature = ed25519.sign(toSign, privateKey);

  // Build final transaction
  const tx = new Uint8Array(payload.length + 32 + 64);
  tx.set(payload, 0);
  tx.set(publicKey, payload.length);
  tx.set(signature, payload.length + 32);

  return tx;
}
```

Why this matters:
- This is the **core of transaction creation**. Every on‑chain action uses this format.

What this code does:
- Creates the payload `[nonce][instruction]` in big‑endian order.
- Computes the public key from the private key so the signature can be verified later.
- Prepends the namespace for domain separation and signs the payload bytes.
- Appends the public key (32 bytes) and signature (64 bytes) to form the final transaction.

---

### 5) Wrap a single transaction into a submission
```ts
export function wrapSubmission(tx: Uint8Array): Uint8Array {
  const lenVarint = encodeVarint(1);  // Vec length = 1
  const result = new Uint8Array(1 + lenVarint.length + tx.length);

  result[0] = SubmissionTag.Transactions;  // tag 1
  result.set(lenVarint, 1);
  result.set(tx, 1 + lenVarint.length);

  return result;
}
```

Why this matters:
- The backend expects `Submission::Transactions`, not raw transaction bytes.

What this code does:
- Creates `[tag][vec_length][tx_bytes]` with tag = 1 for transactions.
- Encodes the vector length as a varint, then copies the raw transaction bytes after it.

---

### 6) Wrap multiple transactions
```ts
export function wrapMultipleSubmission(txs: Uint8Array[]): Uint8Array {
  const totalLen = txs.reduce((acc, tx) => acc + tx.length, 0);
  const lenVarint = encodeVarint(txs.length);
  const result = new Uint8Array(1 + lenVarint.length + totalLen);

  result[0] = SubmissionTag.Transactions;
  result.set(lenVarint, 1);

  let offset = 1 + lenVarint.length;
  for (const tx of txs) {
    result.set(tx, offset);
    offset += tx.length;
  }

  return result;
}
```

Why this matters:
- Bundling multiple transactions reduces overhead and is useful for batch operations.

What this code does:
- Builds a single submission with a vector of transactions.
- Computes total payload length, writes the tag and varint count, then copies each tx in order.

---

### 7) Generate a session ID
```ts
export function generateSessionId(publicKey: Uint8Array, counter: bigint): bigint {
  const data = new Uint8Array(32 + 8);
  data.set(publicKey, 0);
  new DataView(data.buffer).setBigUint64(32, counter, false);

  const hash = sha256(data);
  return new DataView(hash.buffer).getBigUint64(0, false);
}
```

Why this matters:
- Session IDs must be unique and deterministic. This ensures uniqueness across a player’s sessions.

What this code does:
- Hashes the public key + counter and takes the first 8 bytes as the session ID.
- Uses big‑endian when writing the counter so the hash input matches Rust.
- Produces a deterministic ID: same key + counter yields the same session id.

---

### 8) Verify a transaction signature (testing helper)
```ts
export function verifyTransaction(tx: Uint8Array, instructionLen: number): boolean {
  const nonce = new DataView(tx.buffer, tx.byteOffset).getBigUint64(0, false);
  const instruction = tx.slice(8, 8 + instructionLen);
  const publicKey = tx.slice(8 + instructionLen, 8 + instructionLen + 32);
  const signature = tx.slice(8 + instructionLen + 32, 8 + instructionLen + 32 + 64);

  const payload = new Uint8Array(8 + instructionLen);
  new DataView(payload.buffer).setBigUint64(0, nonce, false);
  payload.set(instruction, 8);

  const toSign = unionUnique(TRANSACTION_NAMESPACE, payload);
  return ed25519.verify(signature, toSign, publicKey);
}
```

Why this matters:
- This is a sanity check for developers; it confirms encoding and signing are correct.

What this code does:
- Rebuilds the signed payload (nonce + instruction) exactly as signing did.
- Extracts the public key and signature from the transaction bytes.
- Verifies the signature against the namespaced payload and returns true/false.

---

## Key takeaways
- Every transaction is `[nonce][instruction][pubkey][signature]`.
- Namespaced signing prevents cross‑protocol replay.
- Submissions wrap transactions in an envelope with a tag and length prefix.

## Next lesson
L05 - Submit client and HTTP submission: `feynman/lessons/L05-submit-client.md`
