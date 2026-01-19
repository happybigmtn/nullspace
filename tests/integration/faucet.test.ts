/**
 * Faucet Integration Tests (AC-1.3)
 *
 * Tests that the faucet helper can fund test wallets:
 * - Fund a new wallet (register + deposit)
 * - Fund an existing wallet (deposit only)
 * - Verify balance is updated
 *
 * Run with: RUN_CROSS_SERVICE=true pnpm test faucet.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import { randomBytes } from 'crypto';
import { SERVICE_URLS, checkServiceHealth } from './helpers/services.js';

// Match constants from faucet.mjs
const INSTRUCTION_TAG_CASINO_REGISTER = 10;
const INSTRUCTION_TAG_CASINO_DEPOSIT = 11;
const SUBMISSION_TAG_TRANSACTIONS = 1;
const TRANSACTION_NAMESPACE = new TextEncoder().encode('_NULLSPACE_TX');
const DEFAULT_FAUCET_AMOUNT = 1000n;

const CROSS_SERVICE_ENABLED = process.env.RUN_CROSS_SERVICE === 'true';
const IS_TESTNET = SERVICE_URLS.simulator.includes('testnet.regenesis.dev');
const TEST_TIMEOUT_MS = IS_TESTNET ? 120000 : 60000;

/**
 * Encode varint (protobuf-style)
 */
function encodeVarint(value: number | bigint): Uint8Array {
  const bytes: number[] = [];
  let v = BigInt(value);
  while (v > 0x7fn) {
    bytes.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  bytes.push(Number(v & 0x7fn));
  return new Uint8Array(bytes);
}

/**
 * Build union_unique format for signing
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
 * Encode string as [len:u32 BE][bytes...]
 */
function encodeString(str: string): Uint8Array {
  const bytes = new TextEncoder().encode(str);
  const result = new Uint8Array(4 + bytes.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, bytes.length, false);
  result.set(bytes, 4);
  return result;
}

/**
 * Encode CasinoRegister instruction
 */
function encodeCasinoRegister(name: string): Uint8Array {
  const nameEncoded = encodeString(name);
  const result = new Uint8Array(1 + nameEncoded.length);
  result[0] = INSTRUCTION_TAG_CASINO_REGISTER;
  result.set(nameEncoded, 1);
  return result;
}

/**
 * Encode CasinoDeposit instruction
 */
function encodeCasinoDeposit(amount: bigint): Uint8Array {
  const result = new Uint8Array(9);
  const view = new DataView(result.buffer);
  result[0] = INSTRUCTION_TAG_CASINO_DEPOSIT;
  view.setBigUint64(1, amount, false);
  return result;
}

/**
 * Build and sign a transaction
 */
function buildTransaction(
  nonce: bigint,
  instruction: Uint8Array,
  privateKey: Uint8Array
): Uint8Array {
  const publicKey = ed25519.getPublicKey(privateKey);

  const payload = new Uint8Array(8 + instruction.length);
  new DataView(payload.buffer).setBigUint64(0, nonce, false);
  payload.set(instruction, 8);

  const toSign = unionUnique(TRANSACTION_NAMESPACE, payload);
  const signature = ed25519.sign(toSign, privateKey);

  const tx = new Uint8Array(payload.length + 32 + 64);
  tx.set(payload, 0);
  tx.set(publicKey, payload.length);
  tx.set(signature, payload.length + 32);

  return tx;
}

/**
 * Wrap transactions in submission format
 */
function wrapSubmission(txs: Uint8Array[]): Uint8Array {
  const lenVarint = encodeVarint(txs.length);
  let totalLen = 0;
  for (const tx of txs) {
    totalLen += tx.length;
  }
  const result = new Uint8Array(1 + lenVarint.length + totalLen);
  result[0] = SUBMISSION_TAG_TRANSACTIONS;
  result.set(lenVarint, 1);
  let offset = 1 + lenVarint.length;
  for (const tx of txs) {
    result.set(tx, offset);
    offset += tx.length;
  }
  return result;
}

interface AccountInfo {
  exists: boolean;
  nonce: bigint;
  balance: bigint;
}

/**
 * Fetch account info from simulator
 */
async function getAccountInfo(publicKeyHex: string): Promise<AccountInfo> {
  try {
    const response = await fetch(`${SERVICE_URLS.simulator}/account/${publicKeyHex}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      return { exists: false, nonce: 0n, balance: 0n };
    }
    const data = await response.json();
    return {
      exists: true,
      nonce: BigInt(data.nonce || 0),
      balance: BigInt(data.balance || 0),
    };
  } catch {
    return { exists: false, nonce: 0n, balance: 0n };
  }
}

/**
 * Submit transactions to simulator
 */
async function submitTransactions(
  submission: Uint8Array
): Promise<{ success: boolean; rateLimited?: boolean; error?: string }> {
  try {
    const response = await fetch(`${SERVICE_URLS.simulator}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(submission),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const rateLimited =
        response.status === 429 || text.includes('rate') || text.includes('cooldown');
      return { success: false, rateLimited, error: `HTTP ${response.status}: ${text}` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Wait for transaction inclusion
 */
async function waitForInclusion(
  publicKeyHex: string,
  expectedNonce: bigint,
  timeoutMs = 30000
): Promise<AccountInfo | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await getAccountInfo(publicKeyHex);
    if (info.nonce >= expectedNonce) {
      return info;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

/**
 * Generate a test keypair
 */
function generateKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array; publicKeyHex: string } {
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    publicKeyHex: Buffer.from(publicKey).toString('hex'),
  };
}

describe.skipIf(!CROSS_SERVICE_ENABLED)('Faucet Integration Tests (AC-1.3)', () => {
  beforeAll(async () => {
    // Verify simulator is healthy
    const healthy = await checkServiceHealth(SERVICE_URLS.simulator);
    if (!healthy) {
      throw new Error(`Simulator not healthy at ${SERVICE_URLS.simulator}`);
    }
  });

  it(
    'should fund a new wallet (register + deposit)',
    async () => {
      const { privateKey, publicKeyHex } = generateKeypair();

      // Verify account doesn't exist
      const initialInfo = await getAccountInfo(publicKeyHex);
      expect(initialInfo.exists).toBe(false);
      expect(initialInfo.balance).toBe(0n);

      // Build register + deposit transactions
      const txs: Uint8Array[] = [];
      let nonce = 0n;

      // Register transaction
      const name = `Test-${publicKeyHex.slice(0, 8)}`;
      const registerTx = buildTransaction(nonce++, encodeCasinoRegister(name), privateKey);
      txs.push(registerTx);

      // Deposit transaction
      const depositTx = buildTransaction(nonce++, encodeCasinoDeposit(DEFAULT_FAUCET_AMOUNT), privateKey);
      txs.push(depositTx);

      // Submit
      const submission = wrapSubmission(txs);
      const result = await submitTransactions(submission);

      // Handle rate limiting gracefully (may occur on testnet)
      if (result.rateLimited) {
        console.log('Faucet rate limited - skipping test');
        return;
      }

      expect(result.success).toBe(true);

      // Wait for inclusion
      const finalInfo = await waitForInclusion(publicKeyHex, nonce);
      expect(finalInfo).not.toBeNull();
      expect(finalInfo!.balance).toBeGreaterThan(0n);

      console.log(`Funded new wallet: ${publicKeyHex.slice(0, 16)}...`);
      console.log(`  Balance: ${finalInfo!.balance} chips`);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'should fund an existing wallet (deposit only)',
    async () => {
      const { privateKey, publicKeyHex } = generateKeypair();

      // First register the account
      const registerTx = buildTransaction(0n, encodeCasinoRegister(`Test-${publicKeyHex.slice(0, 8)}`), privateKey);
      const registerSubmission = wrapSubmission([registerTx]);
      const registerResult = await submitTransactions(registerSubmission);

      if (registerResult.rateLimited) {
        console.log('Rate limited on register - skipping test');
        return;
      }

      expect(registerResult.success).toBe(true);

      // Wait for registration
      const afterRegister = await waitForInclusion(publicKeyHex, 1n);
      expect(afterRegister).not.toBeNull();
      const balanceAfterRegister = afterRegister!.balance;

      // Now deposit additional funds
      const depositTx = buildTransaction(1n, encodeCasinoDeposit(DEFAULT_FAUCET_AMOUNT), privateKey);
      const depositSubmission = wrapSubmission([depositTx]);
      const depositResult = await submitTransactions(depositSubmission);

      if (depositResult.rateLimited) {
        console.log('Rate limited on deposit - skipping test');
        return;
      }

      expect(depositResult.success).toBe(true);

      // Wait for deposit
      const afterDeposit = await waitForInclusion(publicKeyHex, 2n);
      expect(afterDeposit).not.toBeNull();

      // Balance should have increased
      expect(afterDeposit!.balance).toBeGreaterThan(balanceAfterRegister);

      console.log(`Funded existing wallet: ${publicKeyHex.slice(0, 16)}...`);
      console.log(`  Before: ${balanceAfterRegister} chips`);
      console.log(`  After: ${afterDeposit!.balance} chips`);
    },
    TEST_TIMEOUT_MS
  );

  it(
    'should show balance in account endpoint',
    async () => {
      const { privateKey, publicKeyHex } = generateKeypair();

      // Register and fund
      const txs = [
        buildTransaction(0n, encodeCasinoRegister(`Test-${publicKeyHex.slice(0, 8)}`), privateKey),
        buildTransaction(1n, encodeCasinoDeposit(DEFAULT_FAUCET_AMOUNT), privateKey),
      ];
      const submission = wrapSubmission(txs);
      const result = await submitTransactions(submission);

      if (result.rateLimited) {
        console.log('Rate limited - skipping test');
        return;
      }

      expect(result.success).toBe(true);

      // Wait for inclusion
      await waitForInclusion(publicKeyHex, 2n);

      // Verify account endpoint shows balance
      const response = await fetch(`${SERVICE_URLS.simulator}/account/${publicKeyHex}`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data).toHaveProperty('balance');
      expect(BigInt(data.balance)).toBeGreaterThan(0n);
      expect(data).toHaveProperty('nonce');
      expect(BigInt(data.nonce)).toBe(2n);

      console.log(`Account endpoint verified for: ${publicKeyHex.slice(0, 16)}...`);
      console.log(`  Balance: ${data.balance}`);
      console.log(`  Nonce: ${data.nonce}`);
    },
    TEST_TIMEOUT_MS
  );
});
