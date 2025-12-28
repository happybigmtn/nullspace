/**
 * Transaction building and signing
 * Matches Rust types/src/execution.rs Transaction struct
 */
import { ed25519 } from '@noble/curves/ed25519';
/**
 * Encode a number as a varint (protobuf-style variable-length integer)
 * Used for Vec lengths in commonware codec
 *
 * Format:
 * - 7 bits per byte for data
 * - High bit (0x80) indicates more bytes follow
 */
export declare function encodeVarint(value: number): Uint8Array;
/**
 * Calculate size of varint encoding for a value
 */
export declare function varintSize(value: number): number;
/**
 * Build a signed transaction
 *
 * Transaction format:
 * [nonce:u64 BE] [instruction bytes] [pubkey:32] [signature:64]
 *
 * Signature covers (using union_unique format):
 * [varint(namespace.len)] [TRANSACTION_NAMESPACE] [nonce + instruction]
 */
export declare function buildTransaction(nonce: bigint, instruction: Uint8Array, privateKey: Uint8Array): Uint8Array;
/**
 * Wrap transaction(s) in Submission::Transactions format for /submit endpoint
 *
 * Format:
 * [tag:u8 = 1] [vec_length:varint] [tx1 bytes]...
 *
 * CRITICAL: Tag 1 is Transactions, NOT tag 0 (that's Seed)
 * CRITICAL: Vec length uses varint encoding (commonware codec)
 */
export declare function wrapSubmission(tx: Uint8Array): Uint8Array;
/**
 * Wrap multiple transactions in a single submission
 */
export declare function wrapMultipleSubmission(txs: Uint8Array[]): Uint8Array;
/**
 * Generate a unique session ID from public key and counter
 * Uses SHA256 hash to avoid collisions
 */
export declare function generateSessionId(publicKey: Uint8Array, counter: bigint): bigint;
/**
 * Verify a transaction signature (for testing)
 */
export declare function verifyTransaction(tx: Uint8Array, instructionLen: number): boolean;
export { ed25519 };
//# sourceMappingURL=transactions.d.ts.map