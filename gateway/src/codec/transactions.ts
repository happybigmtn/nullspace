/**
 * Transaction building and signing
 * Matches Rust types/src/execution.rs Transaction struct
 *
 * TODO: This transaction building logic is gateway-specific and uses a different format
 * than @nullspace/protocol encoding. The protocol package focuses on game moves while
 * this module handles the full transaction signing with Ed25519 and nonce management.
 * Keep this module separate as it serves a different purpose.
 */
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { TRANSACTION_NAMESPACE, SubmissionTag } from './constants.js';

/**
 * Encode a number as a varint (protobuf-style variable-length integer)
 * Used for Vec lengths in commonware codec
 *
 * Format:
 * - 7 bits per byte for data
 * - High bit (0x80) indicates more bytes follow
 */
export function encodeVarint(value: number): Uint8Array {
  if (value < 0) throw new Error('Varint cannot encode negative numbers');

  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);  // 7 data bits + continuation bit
    value >>>= 7;
  }
  bytes.push(value & 0x7f);  // Last byte has no continuation bit

  return new Uint8Array(bytes);
}

/**
 * Calculate size of varint encoding for a value
 */
export function varintSize(value: number): number {
  if (value === 0) return 1;
  let size = 0;
  while (value > 0) {
    size++;
    value >>>= 7;
  }
  return size;
}

/**
 * Build union_unique format for signing (matches commonware-utils)
 *
 * Format: [varint(namespace.len)] [namespace] [message]
 *
 * This is how commonware-cryptography signs with a namespace.
 */
function unionUnique(namespace: Uint8Array, message: Uint8Array): Uint8Array {
  const lenVarint = encodeVarint(namespace.length);
  const result = new Uint8Array(lenVarint.length + namespace.length + message.length);
  result.set(lenVarint, 0);
  result.set(namespace, lenVarint.length);
  result.set(message, lenVarint.length + namespace.length);
  return result;
}

/**
 * Build a signed transaction
 *
 * Transaction format:
 * [nonce:u64 BE] [instruction bytes] [pubkey:32] [signature:64]
 *
 * Signature covers (using union_unique format):
 * [varint(namespace.len)] [TRANSACTION_NAMESPACE] [nonce + instruction]
 */
export function buildTransaction(
  nonce: bigint,
  instruction: Uint8Array,
  privateKey: Uint8Array
): Uint8Array {
  const publicKey = ed25519.getPublicKey(privateKey);

  // Build payload for signing: nonce (8 bytes BE) + instruction
  const payload = new Uint8Array(8 + instruction.length);
  new DataView(payload.buffer).setBigUint64(0, nonce, false);  // BE
  payload.set(instruction, 8);

  // Sign with union_unique format: [varint(namespace.len)] [namespace] [payload]
  // This matches how commonware-cryptography handles namespaced signing
  const toSign = unionUnique(TRANSACTION_NAMESPACE, payload);
  const signature = ed25519.sign(toSign, privateKey);

  // Build transaction: payload + pubkey + signature
  const tx = new Uint8Array(payload.length + 32 + 64);
  tx.set(payload, 0);
  tx.set(publicKey, payload.length);
  tx.set(signature, payload.length + 32);

  return tx;
}

/**
 * Wrap transaction(s) in Submission::Transactions format for /submit endpoint
 *
 * Format:
 * [tag:u8 = 1] [vec_length:varint] [tx1 bytes]...
 *
 * CRITICAL: Tag 1 is Transactions, NOT tag 0 (that's Seed)
 * CRITICAL: Vec length uses varint encoding (commonware codec)
 */
export function wrapSubmission(tx: Uint8Array): Uint8Array {
  const lenVarint = encodeVarint(1);  // Vec length = 1
  const result = new Uint8Array(1 + lenVarint.length + tx.length);

  result[0] = SubmissionTag.Transactions;  // tag 1
  result.set(lenVarint, 1);
  result.set(tx, 1 + lenVarint.length);

  return result;
}

/**
 * Wrap multiple transactions in a single submission
 */
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

/**
 * Generate a unique session ID from public key and counter
 * Uses SHA256 hash to avoid collisions
 */
export function generateSessionId(publicKey: Uint8Array, counter: bigint): bigint {
  const data = new Uint8Array(32 + 8);
  data.set(publicKey, 0);
  new DataView(data.buffer).setBigUint64(32, counter, false);

  const hash = sha256(data);
  // Use first 8 bytes of hash as session ID
  return new DataView(hash.buffer).getBigUint64(0, false);
}

/**
 * Verify a transaction signature (for testing)
 */
export function verifyTransaction(tx: Uint8Array, instructionLen: number): boolean {
  // Extract components
  const nonce = new DataView(tx.buffer, tx.byteOffset).getBigUint64(0, false);
  const instruction = tx.slice(8, 8 + instructionLen);
  const publicKey = tx.slice(8 + instructionLen, 8 + instructionLen + 32);
  const signature = tx.slice(8 + instructionLen + 32, 8 + instructionLen + 32 + 64);

  // Rebuild the signed message
  const payload = new Uint8Array(8 + instructionLen);
  new DataView(payload.buffer).setBigUint64(0, nonce, false);
  payload.set(instruction, 8);

  // Use union_unique format to match signing
  const toSign = unionUnique(TRANSACTION_NAMESPACE, payload);

  try {
    return ed25519.verify(signature, toSign, publicKey);
  } catch {
    return false;
  }
}

// Re-export for convenience
export { ed25519 };
