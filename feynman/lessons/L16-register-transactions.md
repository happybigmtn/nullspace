# L16 - Transaction building (register + deposit) (from scratch)

Focus file: `gateway/src/codec/transactions.ts`

Goal: explain how register/deposit instructions are turned into signed transactions and wrapped into submissions. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Transactions are signed envelopes
A transaction is:
- nonce (u64),
- instruction bytes,
- public key,
- signature.

### 2) Submissions wrap transactions
The backend expects a **Submission** with a tag and length prefix, not raw transaction bytes.

---

## Limits & management callouts (important)

1) **Nonce must strictly increase**
- If you reuse a nonce, the backend rejects the transaction.

2) **Namespace signing is fixed**
- The `TRANSACTION_NAMESPACE` is a protocol constant. Changing it invalidates all signatures.

---

## Walkthrough with code excerpts

### 1) Build a signed transaction
```ts
export function buildTransaction(
  nonce: bigint,
  instruction: Uint8Array,
  privateKey: Uint8Array
): Uint8Array {
  const publicKey = ed25519.getPublicKey(privateKey);

  const payload = new Uint8Array(8 + instruction.length);
  new DataView(payload.buffer).setBigUint64(0, nonce, false);  // BE
  payload.set(instruction, 8);

  const toSign = unionUnique(TRANSACTION_NAMESPACE, payload);
  const signature = ed25519.sign(toSign, privateKey);

  const tx = new Uint8Array(payload.length + 32 + 64);
  tx.set(payload, 0);
  tx.set(publicKey, payload.length);
  tx.set(signature, payload.length + 32);

  return tx;
}
```

Why this matters:
- Register and deposit only work if the signature and layout are correct.

What this code does:
- Builds `[nonce][instruction]` as the payload.
- Signs the payload with a namespaced hash.
- Appends the public key and signature to produce the final transaction bytes.

---

### 2) Wrap a transaction into a submission
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
- The backend accepts `Submission::Transactions`, not raw transactions.

What this code does:
- Prefixes the submission with a tag and a varint length.
- Copies the transaction bytes after the header.

---

## Key takeaways
- Transactions are signed with a namespace and include nonce + instruction.
- Submissions are the outer envelope the backend expects.

## Next lesson
L17 - Register submit client: `feynman/lessons/L17-register-submit-client.md`
