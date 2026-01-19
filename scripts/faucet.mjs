#!/usr/bin/env node
/**
 * faucet.mjs - Fund a test wallet with chips
 *
 * This script:
 * 1. Takes a wallet public key (or generates one if not provided)
 * 2. Checks if the wallet is registered, registers if needed
 * 3. Submits a CasinoDeposit transaction to fund the wallet
 * 4. Outputs the resulting balance
 *
 * Usage:
 *   node faucet.mjs [SIMULATOR_URL] [PUBLIC_KEY_HEX] [PRIVATE_KEY_HEX]
 *   node faucet.mjs --help
 *
 * Environment:
 *   SIMULATOR_URL - Base URL for the simulator (default: http://localhost:8080)
 *   FAUCET_AMOUNT - Amount to deposit (default: 1000)
 *
 * Exit codes:
 *   0 - Success (balance updated)
 *   1 - Transaction failed
 *   2 - Rate limited (try again later)
 *   3 - Configuration error
 */

import { ed25519 } from '@noble/curves/ed25519';
import { randomBytes } from 'crypto';

// Instruction tags from types/src/execution.rs
const INSTRUCTION_TAG_CASINO_REGISTER = 10;
const INSTRUCTION_TAG_CASINO_DEPOSIT = 11;
const SUBMISSION_TAG_TRANSACTIONS = 1;
const TRANSACTION_NAMESPACE = new TextEncoder().encode('_NULLSPACE_TX');

// Default configuration
const DEFAULT_SIMULATOR_URL = 'http://localhost:8080';
const DEFAULT_FAUCET_AMOUNT = 1000n;

function printUsage() {
  console.log(`
Usage: node faucet.mjs [OPTIONS] [SIMULATOR_URL] [PUBLIC_KEY_HEX] [PRIVATE_KEY_HEX]

Fund a test wallet with chips.

Arguments:
  SIMULATOR_URL    Simulator API URL (default: $SIMULATOR_URL or ${DEFAULT_SIMULATOR_URL})
  PUBLIC_KEY_HEX   Wallet public key in hex (generates new if omitted)
  PRIVATE_KEY_HEX  Wallet private key in hex (generates new if omitted)

Options:
  --help, -h       Show this help message
  --amount N       Amount to deposit (default: $FAUCET_AMOUNT or ${DEFAULT_FAUCET_AMOUNT})
  --json           Output as JSON only (for scripting)
  --register-only  Only register the account, don't deposit

Environment:
  SIMULATOR_URL    Default simulator URL
  FAUCET_AMOUNT    Default deposit amount

Examples:
  # Fund a new random wallet
  node faucet.mjs

  # Fund a specific wallet
  node faucet.mjs http://localhost:8080 abc123...def456 private789...

  # Fund on testnet
  SIMULATOR_URL=https://indexer.testnet.regenesis.dev node faucet.mjs
`);
}

/**
 * Encode varint (protobuf-style)
 */
function encodeVarint(value) {
  const bytes = [];
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
function unionUnique(namespace, message) {
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
function encodeString(str) {
  const bytes = new TextEncoder().encode(str);
  const result = new Uint8Array(4 + bytes.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, bytes.length, false); // BE
  result.set(bytes, 4);
  return result;
}

/**
 * Encode CasinoRegister instruction: [tag:10] [nameLen:u32 BE] [nameBytes...]
 */
function encodeCasinoRegister(name) {
  const nameEncoded = encodeString(name);
  const result = new Uint8Array(1 + nameEncoded.length);
  result[0] = INSTRUCTION_TAG_CASINO_REGISTER;
  result.set(nameEncoded, 1);
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
 * Wrap transactions in Submission::Transactions format
 */
function wrapSubmission(txs) {
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

/**
 * Fetch account info
 */
async function getAccountInfo(simulatorUrl, publicKeyHex) {
  try {
    const response = await fetch(`${simulatorUrl}/account/${publicKeyHex}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      if (response.status === 404) {
        return { exists: false, nonce: 0n, balance: 0n };
      }
      throw new Error(`Account fetch failed: HTTP ${response.status}`);
    }
    const data = await response.json();
    return {
      exists: true,
      nonce: BigInt(data.nonce || 0),
      balance: BigInt(data.balance || 0),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Account fetch timed out');
    }
    // Treat connection errors as "account doesn't exist"
    return { exists: false, nonce: 0n, balance: 0n };
  }
}

/**
 * Submit transactions to simulator
 */
async function submitTransactions(simulatorUrl, submission) {
  const response = await fetch(`${simulatorUrl}/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
    body: Buffer.from(submission),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 429 || text.includes('rate') || text.includes('cooldown')) {
      return { success: false, rateLimited: true, message: text || 'Rate limited' };
    }
    return { success: false, rateLimited: false, message: `HTTP ${response.status}: ${text}` };
  }

  return { success: true };
}

/**
 * Wait for transaction inclusion by polling account nonce
 */
async function waitForInclusion(simulatorUrl, publicKeyHex, expectedNonce, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await getAccountInfo(simulatorUrl, publicKeyHex);
    if (info.nonce >= expectedNonce) {
      return info;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);

  // Parse options
  let jsonOutput = false;
  let registerOnly = false;
  let amount = BigInt(process.env.FAUCET_AMOUNT || DEFAULT_FAUCET_AMOUNT);
  let simulatorUrl = process.env.SIMULATOR_URL || DEFAULT_SIMULATOR_URL;
  let publicKeyHex = null;
  let privateKeyHex = null;

  const positionalArgs = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--register-only') {
      registerOnly = true;
    } else if (arg === '--amount' && i + 1 < args.length) {
      amount = BigInt(args[++i]);
    } else if (!arg.startsWith('-')) {
      positionalArgs.push(arg);
    }
  }

  // Parse positional args
  if (positionalArgs.length >= 1) {
    simulatorUrl = positionalArgs[0];
  }
  if (positionalArgs.length >= 2) {
    publicKeyHex = positionalArgs[1];
  }
  if (positionalArgs.length >= 3) {
    privateKeyHex = positionalArgs[2];
  }

  // Generate or parse keypair
  let privateKey;
  let publicKey;
  if (privateKeyHex && publicKeyHex) {
    privateKey = Buffer.from(privateKeyHex, 'hex');
    publicKey = Buffer.from(publicKeyHex, 'hex');
    // Verify they match
    const derivedPubKey = ed25519.getPublicKey(privateKey);
    if (Buffer.from(derivedPubKey).toString('hex') !== publicKeyHex) {
      const error = 'Private key does not match public key';
      if (jsonOutput) {
        console.log(JSON.stringify({ error }));
      } else {
        console.error(`Error: ${error}`);
      }
      process.exit(3);
    }
  } else {
    // Generate new keypair
    privateKey = randomBytes(32);
    publicKey = ed25519.getPublicKey(privateKey);
    publicKeyHex = Buffer.from(publicKey).toString('hex');
    privateKeyHex = Buffer.from(privateKey).toString('hex');
  }

  // Get current account state
  const accountInfo = await getAccountInfo(simulatorUrl, publicKeyHex);

  // Determine what transactions to submit
  const txs = [];
  let nonce = accountInfo.nonce;

  // Register if account doesn't exist (nonce 0 and not found)
  const needsRegister = !accountInfo.exists || accountInfo.nonce === 0n;
  if (needsRegister) {
    const name = `Faucet-${publicKeyHex.slice(0, 8)}`;
    const registerInstruction = encodeCasinoRegister(name);
    const registerTx = buildTransaction(nonce, registerInstruction, privateKey);
    txs.push(registerTx);
    nonce++;
  }

  // Add deposit transaction unless register-only mode
  if (!registerOnly) {
    const depositInstruction = encodeCasinoDeposit(amount);
    const depositTx = buildTransaction(nonce, depositInstruction, privateKey);
    txs.push(depositTx);
    nonce++;
  }

  // Submit transactions
  const submission = wrapSubmission(txs);
  const submitResult = await submitTransactions(simulatorUrl, submission);

  if (!submitResult.success) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        error: submitResult.message,
        rateLimited: submitResult.rateLimited,
        publicKey: publicKeyHex,
        previousBalance: accountInfo.balance.toString(),
      }));
    } else {
      if (submitResult.rateLimited) {
        console.error(`Faucet rate limited: ${submitResult.message}`);
        console.error('Try again later (faucet has daily limits).');
      } else {
        console.error(`Transaction failed: ${submitResult.message}`);
      }
    }
    process.exit(submitResult.rateLimited ? 2 : 1);
  }

  // Wait for inclusion
  const finalInfo = await waitForInclusion(simulatorUrl, publicKeyHex, nonce);

  if (!finalInfo) {
    if (jsonOutput) {
      console.log(JSON.stringify({
        error: 'Transaction not confirmed within timeout',
        publicKey: publicKeyHex,
        previousBalance: accountInfo.balance.toString(),
      }));
    } else {
      console.error('Transaction submitted but not confirmed within timeout.');
    }
    process.exit(1);
  }

  // Success output
  if (jsonOutput) {
    console.log(JSON.stringify({
      success: true,
      publicKey: publicKeyHex,
      privateKey: privateKeyHex,
      previousBalance: accountInfo.balance.toString(),
      newBalance: finalInfo.balance.toString(),
      deposited: registerOnly ? '0' : amount.toString(),
      registered: needsRegister,
      nonce: finalInfo.nonce.toString(),
    }));
  } else {
    console.log('');
    console.log('Faucet completed successfully!');
    console.log('');
    console.log(`  Public Key:  ${publicKeyHex}`);
    console.log(`  Private Key: ${privateKeyHex}`);
    console.log('');
    if (needsRegister) {
      console.log('  Account registered: yes');
    }
    if (!registerOnly) {
      console.log(`  Deposited: ${amount} chips`);
    }
    console.log(`  Previous Balance: ${accountInfo.balance} chips`);
    console.log(`  New Balance: ${finalInfo.balance} chips`);
    console.log(`  Account Nonce: ${finalInfo.nonce}`);
    console.log('');
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});
