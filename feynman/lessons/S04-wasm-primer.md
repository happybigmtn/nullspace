# S04 - WASM pipeline (web tx builders) (from scratch)

Focus file: `website/wasm/src/lib.rs`

Goal: explain how the web app uses WASM to build and sign transactions safely and consistently. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) What WASM is
WebAssembly (WASM) is a binary format that lets Rust code run in the browser. It is fast and deterministic.

### 2) Why WASM is used here
Transaction encoding must match on-chain expectations. Using the same Rust logic in WASM keeps encoding identical across web and server.

### 3) Security note
Some WASM helpers include local signing for development only. Production should use real wallets or keystores.

---

## Limits & management callouts (important)

1) **Private keys in WASM are risky**
- The WASM `Signer` holds raw private key material in memory.
- The code explicitly warns not to use this in production.

---

## Walkthrough with code excerpts

### 1) Instruction kind enumeration
```rust
macro_rules! define_instruction_kinds {
    (
        $(
            $kind:ident = $discriminant:expr
                => $instruction_pattern:pat
                => $name:expr
                => $sample_instruction:expr
        ),+ $(,)?
    ) => {
        #[wasm_bindgen]
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum InstructionKind {
            $(
                $kind = $discriminant,
            )+
        }

        impl InstructionKind {
            fn from_instruction(instruction: &Instruction) -> Self {
                match instruction {
                    $(
                        $instruction_pattern => Self::$kind,
                    )+
                }
            }

            fn as_str(self) -> &'static str {
                match self {
                    $(
                        Self::$kind => $name,
                    )+
                }
            }
        }
    };
}
```

Why this matters:
- The web UI needs a stable mapping between instruction variants and human-readable names.

What this code does:
- Defines a WASM-exported enum of instruction kinds.
- Provides helpers to map instructions to enum variants and names.

---

### 2) WASM signer warning
```rust
/// The key to use for signing transactions.
///
/// **Security note:** this `Signer` holds raw ed25519 private key material in WASM memory and is
/// intended for local development/testing. Do not treat it as a production wallet. Keep the
/// `private-key-export` feature disabled in production builds, and prefer integrating an external
/// wallet/keystore when real value is at stake.
#[wasm_bindgen]
pub struct Signer {
    private_key: ed25519::PrivateKey,
    public_key: ed25519::PublicKey,
}
```

Why this matters:
- This is a clear warning that browser-based signing is not a production security model.

What this code does:
- Exposes a WASM signer for local development and test flows.

---

## Key takeaways
- WASM keeps transaction encoding consistent across web and Rust.
- Instruction kinds are exported for UI and analytics.
- The built-in signer is dev-only and should not be used in production.

## Next primer
S05 - Auth flows + threat model: `feynman/lessons/S05-auth-primer.md`
