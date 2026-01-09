# L52 - Protocol versioning (binary message compatibility)

Focus file: `packages/protocol/src/version.ts`

Goal: explain how protocol versioning enables backward compatibility and future evolution of binary messages. For every excerpt, you'll see **why it matters** and a **plain description of what the code does**.

Supporting references:
- `packages/protocol/src/encode.ts` (version header usage in encoding)
- `packages/protocol/src/decode.ts` (version header validation in decoding)
- `packages/protocol/src/errors.ts` (ProtocolError base class)

---

## Concepts from scratch (expanded)

### 1) What is protocol versioning?
Protocol versioning is a technique for marking binary messages with a version identifier. This allows both sides of a communication channel to agree on how to interpret the bytes.

Without versioning, changing the binary format breaks all existing clients. With versioning, you can:
- Support multiple formats simultaneously
- Gracefully reject unsupported versions
- Evolve the protocol over time without breaking existing deployments

### 2) Why binary messages need versioning
JSON APIs have built-in flexibility: you can add fields, and parsers ignore unknown keys. Binary protocols have no such luxury. Every byte has a fixed meaning, and changing the layout invalidates all existing parsers.

Versioning solves this by adding a single byte at the start of every message. That byte tells the decoder which format to use.

### 3) Version negotiation vs version validation
There are two approaches to handling versions:

- **Version negotiation**: Client and server exchange supported versions and choose the best common one.
- **Version validation**: Client sends messages with its current version, and server validates that version is supported.

This codebase uses validation. The client always sends `CURRENT_PROTOCOL_VERSION`, and the server checks that it falls within `MIN_PROTOCOL_VERSION` to `MAX_PROTOCOL_VERSION`.

### 4) Backward compatibility window
The difference between `MIN_PROTOCOL_VERSION` and `MAX_PROTOCOL_VERSION` defines the backward compatibility window.

- `MIN = 1, MAX = 1`: Only version 1 is supported. No backward compatibility.
- `MIN = 1, MAX = 3`: Versions 1, 2, and 3 are all accepted. Backward compatible across 3 versions.

A wider window lets older clients continue working while newer clients use enhanced features. A narrower window simplifies server logic but forces coordinated upgrades.

### 5) Header stripping and payload separation
The version byte is not part of the logical payload. It is metadata about the encoding format.

After validating the version, decoders strip the header and return the raw payload bytes. This keeps protocol handling separate from game logic.

---

## Limits & management callouts (important)

1) **Version is a single byte (u8)**
- This caps the maximum protocol version at 255.
- That is plenty for most systems, but it is finite.
- If you ever need more, you would need a protocol migration to multi-byte versions.

2) **Version must be the first byte**
- Decoders peek at byte 0 to determine the format.
- If the version is not first, you cannot parse the rest of the message.
- This is why all encoders use `withVersionHeader` to prepend the version.

3) **MIN and MAX must be coordinated**
- If the server sets `MAX = 2` but the client sends version 3, the message is rejected.
- Deployments must coordinate version bumps to avoid breaking clients.

4) **Version bump is a breaking change**
- Increasing `CURRENT_PROTOCOL_VERSION` means changing the binary format.
- All clients must upgrade to the new format, or they must fall within the backward compatibility window.

---

## Walkthrough with code excerpts

### 1) Current protocol version constant
```ts
/** Current protocol version used for encoding messages */
export const CURRENT_PROTOCOL_VERSION = 1;
```

Why this matters:
- This is the version that all new messages are encoded with.
- When you bump this constant, you are changing the wire format for the entire system.

What this code does:
- Defines a single source of truth for the active protocol version.
- Used by all encoders to prepend the version byte to payloads.

---

### 2) Backward compatibility range
```ts
/** Minimum supported protocol version (for backward compatibility) */
export const MIN_PROTOCOL_VERSION = 1;

/** Maximum supported protocol version (current) */
export const MAX_PROTOCOL_VERSION = 1;
```

Why this matters:
- These constants define which versions the decoder will accept.
- If a client sends version 2 but `MAX = 1`, the message is rejected with `UnsupportedProtocolVersionError`.

What this code does:
- Sets the inclusive range of supported versions.
- Typically `MAX` equals `CURRENT_PROTOCOL_VERSION`, meaning only the current version is accepted.
- You can set `MIN < MAX` to support older clients during migration windows.

---

### 3) Unsupported version error
```ts
export class UnsupportedProtocolVersionError extends ProtocolError {
  readonly version: number;

  constructor(version: number) {
    super(`Unsupported protocol version: ${version} (supported: ${MIN_PROTOCOL_VERSION}-${MAX_PROTOCOL_VERSION})`);
    this.name = 'UnsupportedProtocolVersionError';
    this.version = version;
  }
}
```

Why this matters:
- This error communicates exactly why a message was rejected, including the version that was sent and the supported range.
- Clients can use this to detect version mismatches and prompt upgrades.

What this code does:
- Extends `ProtocolError` with a `version` field for debugging.
- Constructs a user-friendly error message showing the valid range.
- Allows callers to catch and handle version errors separately from other protocol errors.

---

### 4) Version support check
```ts
export function isVersionSupported(version: number): boolean {
  return version >= MIN_PROTOCOL_VERSION && version <= MAX_PROTOCOL_VERSION;
}
```

Why this matters:
- This is the core compatibility check used throughout the codebase.
- It centralizes the version range logic so all validators use the same rules.

What this code does:
- Returns true if the version falls within the inclusive range `[MIN, MAX]`.
- Used by `validateVersion` and other utilities to enforce version constraints.

---

### 5) Version validation (throws on error)
```ts
export function validateVersion(version: number): void {
  if (!isVersionSupported(version)) {
    throw new UnsupportedProtocolVersionError(version);
  }
}
```

Why this matters:
- This is the entry point for all decoding paths.
- If the version is unsupported, decoding stops immediately and returns a clear error.

What this code does:
- Checks if the version is supported using `isVersionSupported`.
- Throws `UnsupportedProtocolVersionError` if the version is out of range.
- Does nothing if the version is valid, allowing decoding to proceed.

---

### 6) Prepend version header to payload
```ts
export function withVersionHeader(payload: Uint8Array): Uint8Array {
  const versioned = new Uint8Array(1 + payload.length);
  versioned[0] = CURRENT_PROTOCOL_VERSION;
  versioned.set(payload, 1);
  return versioned;
}
```

Why this matters:
- Every encoded message must include the version header, or decoders cannot parse it.
- This utility ensures the version is always prepended correctly.

What this code does:
- Allocates a new buffer 1 byte larger than the payload.
- Writes `CURRENT_PROTOCOL_VERSION` at byte 0.
- Copies the payload starting at byte 1.
- Returns the combined buffer `[version][payload...]`.

---

### 7) Extract and validate version header
```ts
export function stripVersionHeader(data: Uint8Array): { version: number; payload: Uint8Array } {
  if (data.length < 1) {
    throw new ProtocolError('Message too short: missing version header');
  }

  const version = data[0];
  validateVersion(version);

  return {
    version,
    payload: data.slice(1),
  };
}
```

Why this matters:
- This is the decoder entry point for all versioned messages.
- It validates the version and separates the metadata (version) from the data (payload).

What this code does:
- Checks that the message has at least 1 byte (the version header).
- Reads the version from byte 0.
- Calls `validateVersion` to ensure the version is supported.
- Returns an object with the validated version and the payload (everything after byte 0).

---

### 8) Peek at version without validation
```ts
export function peekVersion(data: Uint8Array): number | null {
  if (data.length < 1) {
    return null;
  }
  return data[0];
}
```

Why this matters:
- Useful for debugging and logging when you want to see the version without triggering validation errors.
- Allows conditional logic based on version without committing to full decoding.

What this code does:
- Returns the version byte (byte 0) if the message is at least 1 byte long.
- Returns `null` if the message is too short to have a version.
- Does not validate the version or throw errors.

---

## Extended deep dive: versioning strategy and migration paths

The snippets above show how versioning works mechanically, but they do not explain when or why you would bump the version. This section fills in the operational context.

### 9) When to bump the protocol version

You must bump `CURRENT_PROTOCOL_VERSION` when you make a change that is not backward compatible. Examples:

- Adding a new required field to a message.
- Reordering fields in a binary struct.
- Changing the encoding of an existing field (e.g., from u32 to u64).
- Removing a field that old decoders expect.

You do **not** need to bump the version when:

- Adding optional fields to the end of a message (if parsers ignore trailing bytes).
- Adding entirely new message types with new opcodes (existing opcodes remain unchanged).

The key question: can an old decoder still parse a new message? If no, bump the version.

### 10) Migration strategy for version bumps

When you bump `CURRENT_PROTOCOL_VERSION` from 1 to 2, follow these steps:

1. **Deploy the new server first** with `MIN = 1, MAX = 2`.
   This allows the server to accept both old (v1) and new (v2) messages.

2. **Roll out the new client** that sends version 2 messages.
   During rollout, some clients are still on v1. The server accepts both.

3. **Wait for all clients to upgrade** to v2.
   Monitor server logs to confirm no v1 messages are being received.

4. **Update the server to `MIN = 2, MAX = 2`**.
   This drops support for v1 and simplifies server logic.

This is a **staged rollout**. It prevents downtime by maintaining overlap between old and new versions.

### 11) Encoding side: automatic version prepending

Look at how `encode.ts` uses `withVersionHeader`:

```ts
export function encodeBlackjackMove(move: BlackjackMoveAction): Uint8Array {
  return withVersionHeader(new Uint8Array([BLACKJACK_OPCODES[move]]));
}
```

The encoder does not manually write the version byte. It builds the payload and wraps it with `withVersionHeader`. This keeps versioning consistent across all encoders.

If you ever add a new encoder, you must use `withVersionHeader` or manually prepend the version. If you forget, the decoder will interpret the first payload byte as the version, which will likely fail validation.

### 12) Decoding side: automatic version stripping

Look at how `decode.ts` uses `stripVersionHeader`:

```ts
export function decodeVersionedPayload(data: Uint8Array): DecodedVersionedPayload {
  if (data.length < 2) {
    throw new ProtocolError('Versioned payload too short: expected at least 2 bytes (version + opcode)');
  }

  const { version, payload } = stripVersionHeader(data);
  const opcode = payload[0];

  return {
    version,
    opcode,
    payload,
  };
}
```

The decoder calls `stripVersionHeader` first, which validates and removes the version byte. After that, the decoder works with the raw payload and reads the opcode from byte 0 of the payload (which is byte 1 of the original message).

This separation keeps version handling isolated. Game logic decoders do not need to know about versioning; they only see the payload.

### 13) Version negotiation: why this codebase does not use it

Some protocols use version negotiation: the client sends a list of supported versions, and the server picks the best one. This codebase does not do that.

Instead, the client always sends `CURRENT_PROTOCOL_VERSION`, and the server validates it against `MIN` and `MAX`.

Why this approach?

1. **Simplicity**: No negotiation handshake is needed. Every message is self-describing.
2. **Statelessness**: The server does not need to remember which version a client agreed to use.
3. **Fast failure**: If the version is unsupported, the message is rejected immediately with a clear error.

The tradeoff is that the server must support all versions in the `[MIN, MAX]` range. That complexity is acceptable here because the binary format is stable and version bumps are rare.

### 14) Feynman explanation: the passport stamp analogy

Think of the version byte as a passport stamp. When you cross a border (send a message), the guard (decoder) checks the stamp. If the stamp is from a recognized country (supported version), you are let through. If not, you are turned away with an explanation.

The stamp does not tell the guard what is in your luggage (payload). It only tells the guard which rulebook to use when inspecting the luggage.

---

### 15) Worked example: encoding a blackjack move with version header

Start with a blackjack "hit" move. The opcode for "hit" is `1`.

Step 1: Build the payload.
```
payload = [1]
```

Step 2: Prepend the version header.
```
withVersionHeader([1])
→ allocate 2 bytes
→ write CURRENT_PROTOCOL_VERSION (1) at byte 0
→ copy payload ([1]) at byte 1
→ result = [1, 1]
```

The final encoded message is `[1, 1]`: version 1, opcode 1.

Step 3: Send the message to the server.

Step 4: Server decodes.
```
stripVersionHeader([1, 1])
→ read version from byte 0: version = 1
→ validateVersion(1): passes (MIN=1, MAX=1)
→ slice payload from byte 1: payload = [1]
→ return { version: 1, payload: [1] }
```

The server now has `payload = [1]` and knows the version was valid.

---

### 16) Worked example: handling an unsupported version

Suppose the client sends a version 3 message, but the server only supports version 1.

Encoded message:
```
[3, 1]  // version 3, opcode 1
```

Server decoding:
```
stripVersionHeader([3, 1])
→ read version from byte 0: version = 3
→ validateVersion(3): fails (3 > MAX_PROTOCOL_VERSION=1)
→ throw UnsupportedProtocolVersionError(3)
```

The server returns an error to the client:
```
Unsupported protocol version: 3 (supported: 1-1)
```

The client can use this error to detect that it is running a newer version than the server and prompt the user to wait for a server upgrade.

---

### 17) Testing strategy for version compatibility

When testing version handling, cover these cases:

1. **Happy path**: Send a message with `CURRENT_PROTOCOL_VERSION` and verify it decodes successfully.
2. **Minimum version**: Send a message with `MIN_PROTOCOL_VERSION` and verify it is accepted.
3. **Maximum version**: Send a message with `MAX_PROTOCOL_VERSION` and verify it is accepted.
4. **Too old**: Send a message with `MIN_PROTOCOL_VERSION - 1` and verify it is rejected with `UnsupportedProtocolVersionError`.
5. **Too new**: Send a message with `MAX_PROTOCOL_VERSION + 1` and verify it is rejected.
6. **Missing header**: Send a 0-byte message and verify it throws `ProtocolError('Message too short: missing version header')`.

These tests ensure that version validation behaves correctly at the boundaries.

---

### 18) Performance considerations

The version header adds 1 byte to every message. That is negligible for most payloads, but it does add up if you send millions of tiny messages.

The tradeoff is worth it because:

- Version validation is fast: a single comparison (`version >= MIN && version <= MAX`).
- The benefit of protocol evolution far outweighs the 1-byte overhead.
- The header is prepended at the start, so no parsing is needed to find it.

In practice, the version overhead is invisible compared to network latency and serialization costs.

---

### 19) Interop with Rust: version handling must match

The Rust backend must decode the same version header format. That means:

- The Rust decoder must read byte 0 as the version.
- The Rust decoder must validate the version against the same `MIN` and `MAX` constants.
- The Rust decoder must strip the version byte before parsing the payload.

If the TypeScript and Rust version handling diverge, you will see mysterious errors where one side accepts messages that the other side rejects.

To prevent this, both sides should share version constants (e.g., via code generation or a shared config file). In this codebase, the constants are manually kept in sync.

---

### 20) Debugging version errors

If you see `UnsupportedProtocolVersionError`, check these things:

1. **Client version**: Is the client using `CURRENT_PROTOCOL_VERSION`?
2. **Server range**: Is the server's `MAX_PROTOCOL_VERSION` at least as high as the client's version?
3. **Deployment timing**: Did the client upgrade before the server was ready?
4. **Encoding bug**: Is the encoder actually calling `withVersionHeader`?
5. **Byte corruption**: Is the version byte being corrupted in transit (e.g., by a proxy or middleware)?

Most version errors are caused by deployment mismatches: the client is ahead of the server or vice versa. The solution is to coordinate upgrades.

---

### 21) Evolution path: adding features without breaking versions

Suppose you want to add a new field to a blackjack move without bumping the version. You can do this by:

1. Adding the field at the end of the payload.
2. Making the field optional in the decoder (use a length check to see if the field is present).
3. Having old clients omit the field (they send shorter payloads).
4. Having new clients include the field.

This works as long as:

- The new field is truly optional (the backend can compute a default if missing).
- The decoder checks the payload length before reading the new field.

This is called **forward-compatible encoding**. It avoids version bumps at the cost of more complex decoding logic.

In this codebase, most changes require version bumps because the binary format is strict. But forward-compatible encoding is an option for minor additions.

---

### 22) Security: version validation as an attack surface

Version validation is a potential attack surface. An attacker could send messages with:

- Invalid versions (too low, too high, or nonsensical values).
- Missing version headers (0-byte messages).
- Version bytes that exploit decoder assumptions.

The defenses in this code:

1. **Range checks**: The validator ensures the version is within `[MIN, MAX]`.
2. **Length checks**: `stripVersionHeader` checks that the message is at least 1 byte before reading the version.
3. **Early rejection**: Unsupported versions are rejected before any payload parsing happens.

These checks prevent version-related exploits. As long as you do not skip validation, the version system is secure.

---

### 23) Upgrading to multi-byte versions (future-proofing)

If you ever need more than 255 protocol versions, you would need to migrate to a multi-byte version header. One approach:

- Reserve version `255` as a "long version follows" flag.
- If the version byte is `255`, read the next 2 or 4 bytes as the actual version.
- Otherwise, treat the version byte as the version.

This is backward compatible: old decoders see version `255` and reject it (unsupported). New decoders recognize `255` as a signal to read more bytes.

This is called **varint-style versioning** and is used in protocols like Protocol Buffers. It is overkill for this codebase, but it is an option if you ever exceed 255 versions.

---

### 24) Version header vs instruction tag: two layers of protocol

Do not confuse the version header with instruction tags. They serve different purposes:

- **Version header**: Describes the binary format of the message.
- **Instruction tag**: Describes the semantic action inside the message.

For example:

```
[version=1][tag=12][sessionId=100]
```

- The version (1) tells the decoder how to parse the bytes.
- The tag (12) tells the backend which instruction is being invoked.

Changing the version means changing the binary layout. Changing the tag means adding or removing an instruction type. They are orthogonal.

---

### 25) Checklist for adding a new protocol version

Use this checklist when you bump `CURRENT_PROTOCOL_VERSION`:

1. **Document the change**: Write a migration guide explaining what changed and why.
2. **Update constants**: Increment `CURRENT_PROTOCOL_VERSION` in `version.ts`.
3. **Widen the range**: Set `MAX_PROTOCOL_VERSION = CURRENT_PROTOCOL_VERSION` and optionally keep `MIN` at the old version for backward compatibility.
4. **Update encoders**: Ensure all encoders use `withVersionHeader` with the new format.
5. **Update decoders**: Add version-specific decoding logic if the format changed significantly.
6. **Test interop**: Verify that old clients can still talk to new servers (if `MIN < MAX`) and that new clients work with new servers.
7. **Deploy staged**: Roll out servers first, then clients, to avoid downtime.
8. **Monitor**: Watch for `UnsupportedProtocolVersionError` in logs and handle any stragglers.

Following this checklist prevents version-related outages.

---

## Key takeaways
- Every binary message starts with a 1-byte version header to enable protocol evolution.
- The version range `[MIN, MAX]` defines the backward compatibility window.
- `withVersionHeader` and `stripVersionHeader` centralize version handling across all encoders and decoders.
- Version bumps are breaking changes and require coordinated deployments.

## Feynman recap

Imagine you are sending letters through the mail, but the postal system has different rules in different years.

- In year 1, letters must have a stamp in the top-right corner.
- In year 2, letters must have a barcode on the back.

If you send a year-2 letter to a post office that only knows year-1 rules, the letter is rejected.

To solve this, you write the year at the very top of every letter. The post office reads the year first and decides whether it can process the letter.

- If the year is within the supported range, the post office uses the correct rulebook.
- If the year is too old or too new, the post office rejects the letter with a note: "We only accept letters from years 1 to 2."

Protocol versioning is the same idea. The version byte is the "year" on your letter. It tells the receiver which rulebook to use.

---

## Exercises

1. **Version range exploration**
   Set `MIN_PROTOCOL_VERSION = 1` and `MAX_PROTOCOL_VERSION = 3`. What happens when:
   - A client sends version 2?
   - A client sends version 0?
   - A client sends version 4?
   - A message is 0 bytes long?

2. **Migration simulation**
   Imagine you are bumping `CURRENT_PROTOCOL_VERSION` from 1 to 2. Write pseudocode for:
   - The server's `MIN` and `MAX` settings during the migration window.
   - The client upgrade steps.
   - The server's final settings after all clients are upgraded.

3. **Forward-compatible encoding**
   Suppose you want to add a new optional field to a blackjack move without bumping the version. Design an encoding that:
   - Old clients omit the field (send 2-byte payloads).
   - New clients include the field (send 4-byte payloads).
   - The decoder checks payload length to determine whether the field is present.
   - Write the encoder and decoder for both cases.

4. **Version debugging**
   You see this error in production: `Unsupported protocol version: 3 (supported: 1-1)`.
   What are the possible causes? How would you fix it? What would you check in the logs?
