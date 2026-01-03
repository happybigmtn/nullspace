# L15 - Register + deposit instruction encoding (from scratch)

Focus file: `gateway/src/codec/instructions.ts`

Goal: explain how the register and deposit instructions are encoded into bytes for on‑chain submission. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Instructions are byte layouts
The simulator expects instructions in a strict binary format. For register and deposit:
- **Register** includes a tag + name length + UTF‑8 bytes.
- **Deposit** includes a tag + amount.

### 2) Big‑endian encoding
All multi‑byte numbers here use **big‑endian** order. This must match Rust decoding exactly.

---

## Limits & management callouts (important)

1) **Player name length uses u32**
- No explicit max length enforced here.
- Clients should cap name size to prevent huge payloads.

2) **Deposit amount is u64**
- Max deposit is `2^64 - 1` in binary, but policy limits should cap this elsewhere.

---

## Walkthrough with code excerpts

### 1) CasinoRegister encoding
```ts
export function encodeCasinoRegister(name: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const result = new Uint8Array(1 + 4 + nameBytes.length);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoRegister;
  view.setUint32(1, nameBytes.length, false); // BE
  result.set(nameBytes, 5);

  return result;
}
```

Why this matters:
- Registration is the first on‑chain action. If this encoding is wrong, new users can’t join.

What this code does:
- Encodes the player name into UTF‑8 bytes.
- Allocates a buffer for tag + u32 length + name bytes.
- Writes the tag at byte 0 and the name length as big‑endian at byte 1.
- Copies the name bytes after the header.

---

### 2) CasinoDeposit encoding
```ts
export function encodeCasinoDeposit(amount: bigint): Uint8Array {
  const result = new Uint8Array(9);
  const view = new DataView(result.buffer);

  result[0] = InstructionTag.CasinoDeposit;
  view.setBigUint64(1, amount, false);  // BE

  return result;
}
```

Why this matters:
- Faucet claims and chip deposits rely on this exact layout.

What this code does:
- Allocates a 9‑byte buffer.
- Writes the deposit tag at byte 0.
- Writes the amount as a big‑endian u64 starting at byte 1.

---

## Key takeaways
- Register and deposit are simple but strict byte layouts.
- Big‑endian encoding must match Rust decoding exactly.

## Next lesson
L16 - Register transaction building: `feynman/lessons/L16-register-transactions.md`
