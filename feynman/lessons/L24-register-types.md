# L24 - Rust types (register + deposit) (from scratch)

Focus file: `types/src/execution.rs`

Goal: explain how register/deposit instructions and events are defined and encoded in Rust. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Instruction tags
Instructions are tagged by a single byte (opcode). Register and deposit are tags 10 and 11.

### 2) Event tags
Events carry the results of register/deposit. These are emitted and streamed to clients.

### 3) Length limits are enforced in Rust
Even if the gateway sends long names, Rust will reject names beyond `CASINO_MAX_NAME_LENGTH`.

---

## Limits & management callouts (important)

1) **CASINO_MAX_NAME_LENGTH**
- Enforced at decode time for `CasinoRegister`.
- Must match client-side limits to avoid confusing rejections.

2) **CASINO_MAX_PAYLOAD_LENGTH**
- Used for game moves, but shows how Rust enforces payload bounds.

---

## Walkthrough with code excerpts

### 1) Instruction enum (register + deposit)
```rust
pub enum Instruction {
    // Casino instructions (tags 10-17)
    /// Register a new casino player with a name.
    /// Binary: [10] [nameLen:u32 BE] [nameBytes...]
    CasinoRegister { name: String },

    /// Deposit chips (for testing/faucet).
    /// Binary: [11] [amount:u64 BE]
    CasinoDeposit { amount: u64 },
    // ... other instructions ...
}
```

Why this matters:
- These definitions are the source of truth for binary layouts.

What this code does:
- Declares the register and deposit instructions and documents their byte format.

---

### 2) Decode register + deposit with limits
```rust
pub const CASINO_MAX_NAME_LENGTH: usize = crate::casino::MAX_NAME_LENGTH;

impl Read for Instruction {
    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let kind = u8::read(reader)?;
        let instruction = match kind {
            tags::instruction::CASINO_REGISTER => {
                let name_len = u32::read(reader)? as usize;
                if name_len > CASINO_MAX_NAME_LENGTH {
                    return Err(Error::Invalid("Instruction", "casino name too long"));
                }
                if reader.remaining() < name_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut name_bytes = vec![0u8; name_len];
                reader.copy_to_slice(&mut name_bytes);
                let name = String::from_utf8(name_bytes)
                    .map_err(|_| Error::Invalid("Instruction", "invalid UTF-8 in casino name"))?;
                Self::CasinoRegister { name }
            }
            tags::instruction::CASINO_DEPOSIT => Self::CasinoDeposit {
                amount: u64::read(reader)?,
            },
            _ => { /* ... */ }
        };
        Ok(instruction)
    }
}
```

Why this matters:
- This is the exact server‑side validation the gateway must satisfy.

What this code does:
- Reads the opcode and branches on register vs deposit.
- Enforces a maximum name length and valid UTF‑8 for registration.
- Reads the deposit amount as a u64.

---

### 3) Event enum (registration + deposit results)
```rust
pub enum Event {
    CasinoPlayerRegistered {
        player: PublicKey,
        name: String,
    },
    CasinoDeposited {
        player: PublicKey,
        amount: u64,
        new_chips: u64,
    },
    // ... other events ...
}
```

Why this matters:
- These events are what the client sees after register/deposit.

What this code does:
- Defines the event payloads that are broadcast to updates streams.

---

## Key takeaways
- Rust types define the authoritative register/deposit layouts.
- Name length and UTF‑8 validation happen on the backend.
- Events are the public output of registration and deposits.

## Next lesson
L25 - Web nonce manager: `feynman/lessons/L25-web-nonce-manager.md`
