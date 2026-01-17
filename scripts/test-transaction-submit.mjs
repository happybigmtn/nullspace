#!/usr/bin/env node
/**
 * test-transaction-submit.mjs - Submit a test transaction to the simulator
 *
 * This script:
 * 1. Generates a random keypair (or uses provided seed)
 * 2. Fetches current account nonce
 * 3. Builds and signs a CasinoDeposit transaction
 * 4. Submits to the simulator
 * 5. Outputs JSON with pubkey and nonce for verification
 *
 * Usage: node test-transaction-submit.mjs [SIMULATOR_URL]
 */

import { ed25519 } from '@noble/curves/ed25519';
import { randomBytes } from 'crypto';

// Constants matching gateway/src/codec/constants.ts
const TRANSACTION_NAMESPACE = new TextEncoder().encode('_NULLSPACE_TX');
const INSTRUCTION_TAG_CASINO_DEPOSIT = 11;
const SUBMISSION_TAG_TRANSACTIONS = 1;

const SIMULATOR_URL = process.argv[2] || 'https://indexer.testnet.regenesis.dev';

/**
 * Encode varint (protobuf-style)
 */
function encodeVarint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return new Uint8Array(bytes);
}

/**
 * Build union_unique format for signing
 */
function unionUnique(namespace, message) {
  const lenVarint = encodeVarint(namespace.length);
  const result = new Uint8Array(lenVarint.length + namespace.length + message.length);
  result.set(lenVarint, 0);
  result.set(namespace, lenVarint.length);
  result.set(message, lenVarint.length + namespace.length);
  return result;
}

/**
 * Encode CasinoDeposit instruction: [tag:11] [amount:u64 BE]
 */
function encodeCasinoDeposit(amount) {
  const result = new Uint8Array(9);
  const view = new DataView(result.buffer);
  result[0] = INSTRUCTION_TAG_CASINO_DEPOSIT;
  view.setBigUint64(1, BigInt(amount), false); // BE
  return result;
}

/**
 * Build and sign a transaction
 */
function buildTransaction(nonce, instruction, privateKey) {
  const publicKey = ed25519.getPublicKey(privateKey);

  // Payload: nonce (8 bytes BE) + instruction
  const payload = new Uint8Array(8 + instruction.length);
  new DataView(payload.buffer).setBigUint64(0, BigInt(nonce), false);
  payload.set(instruction, 8);

  // Sign with union_unique format
  const toSign = unionUnique(TRANSACTION_NAMESPACE, payload);
  const signature = ed25519.sign(toSign, privateKey);

  // Transaction: payload + pubkey + signature
  const tx = new Uint8Array(payload.length + 32 + 64);
  tx.set(payload, 0);
  tx.set(publicKey, payload.length);
  tx.set(signature, payload.length + 32);

  return tx;
}

/**
 * Wrap transaction in Submission::Transactions format
 */
function wrapSubmission(tx) {
  const lenVarint = encodeVarint(1); // Vec length = 1
  const result = new Uint8Array(1 + lenVarint.length + tx.length);
  result[0] = SUBMISSION_TAG_TRANSACTIONS;
  result.set(lenVarint, 1);
  result.set(tx, 1 + lenVarint.length);
  return result;
}

/**
 * Fetch account nonce
 */
async function getAccountNonce(publicKeyHex) {
  try {
    const response = await fetch(`${SIMULATOR_URL}/account/${publicKeyHex}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      return 0n;
    }
    const data = await response.json();
    return BigInt(data.nonce || 0);
  } catch {
    return 0n;
  }
}

/**
 * Submit transaction to simulator
 */
async function submitTransaction(submission) {
  const response = await fetch(`${SIMULATOR_URL}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: Buffer.from(submission),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Submit failed: HTTP ${response.status} - ${text}`);
  }

  return true;
}

async function main() {
  // Generate random keypair
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  const publicKeyHex = Buffer.from(publicKey).toString('hex');

  // Get current nonce (should be 0 for new account)
  const nonce = await getAccountNonce(publicKeyHex);

  // Build CasinoDeposit transaction (deposit 1000 chips)
  const instruction = encodeCasinoDeposit(1000n);
  const tx = buildTransaction(nonce, instruction, privateKey);
  const submission = wrapSubmission(tx);

  // Submit
  await submitTransaction(submission);

  // Output result as JSON for the shell script to parse
  console.log(JSON.stringify({
    publicKey: publicKeyHex,
    nonce: Number(nonce),
    instructionTag: INSTRUCTION_TAG_CASINO_DEPOSIT,
    amount: 1000,
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
