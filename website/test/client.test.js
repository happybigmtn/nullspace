import { spawn } from 'child_process';
import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import { WasmWrapper } from '../src/api/wasm.js';

// Setup globals for browser-like APIs used by the client code.
global.fetch = fetch;
global.WebSocket = WebSocket;

// Mock localStorage for Node.js environment
global.localStorage = {
  storage: {},
  getItem(key) {
    return this.storage[key] || null;
  },
  setItem(key, value) {
    this.storage[key] = value;
  },
  removeItem(key) {
    delete this.storage[key];
  },
  clear() {
    this.storage = {};
  },
  get length() {
    return Object.keys(this.storage).length;
  },
  key(index) {
    return Object.keys(this.storage)[index];
  }
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SIMULATOR_PORT = 8089;
const SIMULATOR_URL = `http://localhost:${SIMULATOR_PORT}`;

let wasmWrapper;
let simulatorProcess;

async function loadWasmForNode() {
  const wasmPath = path.join(__dirname, '../wasm/pkg/nullspace_wasm_bg.wasm');
  const wasmBuffer = await fs.readFile(wasmPath);
  const wasmJs = await import('../wasm/pkg/nullspace_wasm.js');
  await wasmJs.default(wasmBuffer);
  return wasmJs;
}

async function waitForSimulatorReady(port, maxAttempts = 40) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const latestQuery = wasmWrapper.encodeQueryLatest();
      const latestHex = wasmWrapper.bytesToHex(latestQuery);
      const response = await fetch(`http://localhost:${port}/seed/${latestHex}`);
      if (response.status === 404 || response.ok) return true;
    } catch {
      // ignore
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Simulator on port ${port} did not become ready`);
}

async function startSimulator() {
  const identityBytes = wasmWrapper.getIdentity(0n);
  const identityHex = wasmWrapper.bytesToHex(identityBytes);

  const simulatorPath = path.join(__dirname, '../../target/release/nullspace-simulator');
  const simulatorArgs = ['-p', SIMULATOR_PORT.toString(), '-i', identityHex];

  simulatorProcess = spawn(simulatorPath, simulatorArgs, {
    cwd: path.join(__dirname, '../../'),
    stdio: 'pipe'
  });

  simulatorProcess.stderr.on('data', (data) => {
    const str = data.toString();
    if (!str.includes('WARN') && !str.includes('INFO') && !str.includes('warning:')) {
      console.error(`Simulator: ${str}`);
    }
  });

  await waitForSimulatorReady(SIMULATOR_PORT);
}

async function stopSimulator() {
  if (simulatorProcess) {
    simulatorProcess.kill();
    await new Promise(resolve => setTimeout(resolve, 500));
    simulatorProcess = null;
  }
}

before(async () => {
  const wasmJs = await loadWasmForNode();
  wasmWrapper = new WasmWrapper();
  wasmWrapper.wasm = wasmJs;
  wasmWrapper.identityBytes = wasmJs.get_identity(0n);
});

after(async () => {
  await stopSimulator();
});

describe('WASM (pure)', () => {
  test('Signer generation and properties', () => {
    const keypair1 = new wasmWrapper.Signer();
    const keypair2 = new wasmWrapper.Signer();

    assert(keypair1.public_key instanceof Uint8Array);
    assert.equal(keypair1.public_key.length, 32);
    assert(keypair1.private_key instanceof Uint8Array);
    assert.equal(keypair1.private_key.length, 32);

    assert.notDeepEqual(keypair1.public_key, keypair2.public_key);
    assert.notDeepEqual(keypair1.private_key, keypair2.private_key);

    assert.equal(keypair1.public_key_hex.length, 64);
    assert.equal(keypair1.private_key_hex.length, 64);

    const keypair3 = wasmWrapper.Signer.from_bytes(keypair1.private_key);
    assert.deepEqual(keypair3.public_key, keypair1.public_key);
    assert.deepEqual(keypair3.private_key, keypair1.private_key);

    assert.throws(() => {
      wasmWrapper.Signer.from_bytes(new Uint8Array(31));
    });
  });

  test('Transaction creation and encoding', () => {
    const keypair = new wasmWrapper.Signer();

    const registerTx = wasmWrapper.Transaction.casino_register(keypair, 0n, 'Alice');
    const registerBytes = registerTx.encode();
    assert(registerBytes instanceof Uint8Array);
    assert(registerBytes.length > 64);

    const depositTx = wasmWrapper.Transaction.casino_deposit(keypair, 1n, 1000n);
    const depositBytes = depositTx.encode();
    assert(depositBytes instanceof Uint8Array);
    assert(depositBytes.length > 64);

    assert.notDeepEqual(registerBytes, depositBytes);
  });

  test('Key encoding functions', () => {
    const keypair = new wasmWrapper.Signer();

    const accountKey = wasmWrapper.encodeAccountKey(keypair.public_key);
    assert(accountKey instanceof Uint8Array);
    assert.equal(accountKey[0], 0);
    assert.equal(accountKey.length, 33);

    const playerKey = wasmWrapper.encodeCasinoPlayerKey(keypair.public_key);
    assert(playerKey instanceof Uint8Array);
    assert.equal(playerKey[0], 10);
    assert.equal(playerKey.length, 33);

    const vaultKey = wasmWrapper.encodeVaultKey(keypair.public_key);
    assert(vaultKey instanceof Uint8Array);
    assert.equal(vaultKey[0], 16);
    assert.equal(vaultKey.length, 33);

    const houseKey = wasmWrapper.encodeHouseKey();
    assert(houseKey instanceof Uint8Array);
    assert.equal(houseKey[0], 14);
    assert.equal(houseKey.length, 1);

    const ammKey = wasmWrapper.encodeAmmPoolKey();
    assert(ammKey instanceof Uint8Array);
    assert.equal(ammKey[0], 17);
    assert.equal(ammKey.length, 1);

    const stakerKey = wasmWrapper.encodeStakerKey(keypair.public_key);
    assert(stakerKey instanceof Uint8Array);
    assert.equal(stakerKey[0], 15);
    assert.equal(stakerKey.length, 33);

    assert.throws(() => wasmWrapper.encodeAccountKey(new Uint8Array(31)));
    assert.throws(() => wasmWrapper.encodeCasinoPlayerKey(new Uint8Array(31)));
    assert.throws(() => wasmWrapper.encodeVaultKey(new Uint8Array(31)));
    assert.throws(() => wasmWrapper.encodeStakerKey(new Uint8Array(31)));
  });

  test('Query encoding functions', () => {
    const latestQuery = wasmWrapper.encodeQueryLatest();
    assert(latestQuery instanceof Uint8Array);
    assert.equal(latestQuery.length, 1);

    const indexQuery = wasmWrapper.encodeQueryIndex(42n);
    assert(indexQuery instanceof Uint8Array);
    assert(indexQuery.length > 1);
  });
});

describe('Simulator (integration)', () => {
  beforeEach(async () => {
    await startSimulator();
  });

  afterEach(async () => {
    await stopSimulator();
  });

  test('WebSocket updates (All) includes register event + transaction', async () => {
    const allFilter = wasmWrapper.encodeUpdatesFilterAll();
    const filterHex = wasmWrapper.bytesToHex(allFilter);
    const updatesWs = new WebSocket(`ws://localhost:${SIMULATOR_PORT}/updates/${filterHex}`);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        updatesWs.close();
        reject(new Error('Timed out waiting for Events update'));
      }, 5000);

      updatesWs.on('open', async () => {
        const keypair = new wasmWrapper.Signer();
        const tx = wasmWrapper.Transaction.casino_register(keypair, 0n, 'Alice');
        const summaryBytes = wasmWrapper.executeBlock(0n, 1n, tx.encode());
        const submission = wasmWrapper.wrapSummarySubmission(summaryBytes);

        const response = await fetch(`${SIMULATOR_URL}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: submission
        });
        assert.equal(response.status, 200);
      });

      updatesWs.on('message', (data) => {
        const update = wasmWrapper.decodeUpdate(new Uint8Array(data));
        if (update.type !== 'Events') return;

        const types = update.events.map((e) => e.type);
        assert(types.includes('CasinoPlayerRegistered'));
        assert(types.includes('Transaction'));

        clearTimeout(timeout);
        updatesWs.close();
        resolve();
      });

      updatesWs.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  test('State query returns CasinoPlayer after register', async () => {
    const keypair = new wasmWrapper.Signer();

    const playerKey = wasmWrapper.encodeCasinoPlayerKey(keypair.public_key);
    const hashedPlayerKey = wasmWrapper.hashKey(playerKey);
    const playerHex = wasmWrapper.bytesToHex(hashedPlayerKey);

    const beforeResp = await fetch(`${SIMULATOR_URL}/state/${playerHex}`);
    assert.equal(beforeResp.status, 404);

    const tx = wasmWrapper.Transaction.casino_register(keypair, 0n, 'Alice');
    const summaryBytes = wasmWrapper.executeBlock(0n, 1n, tx.encode());
    const submission = wasmWrapper.wrapSummarySubmission(summaryBytes);

    const submitResp = await fetch(`${SIMULATOR_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: submission
    });
    assert.equal(submitResp.status, 200);

    const afterResp = await fetch(`${SIMULATOR_URL}/state/${playerHex}`);
    assert.equal(afterResp.status, 200);
    const lookupBytes = new Uint8Array(await afterResp.arrayBuffer());
    const value = wasmWrapper.decodeLookup(lookupBytes);
    assert.equal(value.type, 'CasinoPlayer');
    assert.equal(typeof value.name, 'string');
    assert.equal(typeof value.chips, 'number');
  });

  test('UpdatesFilter(Account) only includes that account’s outputs', async () => {
    const keypair1 = new wasmWrapper.Signer();
    const keypair2 = new wasmWrapper.Signer();

    const accountFilter = wasmWrapper.encodeUpdatesFilterAccount(keypair1.public_key);
    const filterHex = wasmWrapper.bytesToHex(accountFilter);
    const updatesWs = new WebSocket(`ws://localhost:${SIMULATOR_PORT}/updates/${filterHex}`);

    const pk1Hex = keypair1.public_key_hex.toLowerCase();

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        updatesWs.close();
        reject(new Error('Timed out waiting for FilteredEvents update'));
      }, 5000);

      updatesWs.on('open', async () => {
        const tx1 = wasmWrapper.Transaction.casino_register(keypair1, 0n, 'Alice');
        const tx2 = wasmWrapper.Transaction.casino_register(keypair2, 0n, 'Bob');

        const tx1Bytes = tx1.encode();
        const tx2Bytes = tx2.encode();
        const combined = new Uint8Array(tx1Bytes.length + tx2Bytes.length);
        combined.set(tx1Bytes, 0);
        combined.set(tx2Bytes, tx1Bytes.length);

        const summaryBytes = wasmWrapper.executeBlock(0n, 1n, combined);
        const submission = wasmWrapper.wrapSummarySubmission(summaryBytes);

        const response = await fetch(`${SIMULATOR_URL}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: submission
        });
        assert.equal(response.status, 200);
      });

      updatesWs.on('message', (data) => {
        const update = wasmWrapper.decodeUpdate(new Uint8Array(data));
        if (update.type !== 'Events') return;

        const txOutputs = update.events.filter((e) => e.type === 'Transaction');
        assert.equal(txOutputs.length, 1);
        assert.equal(txOutputs[0].public.toLowerCase(), pk1Hex);

        const registerEvents = update.events.filter((e) => e.type === 'CasinoPlayerRegistered');
        assert.equal(registerEvents.length, 1);
        assert.equal(registerEvents[0].player.toLowerCase(), pk1Hex);

        clearTimeout(timeout);
        updatesWs.close();
        resolve();
      });

      updatesWs.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  test('Seed upload and query with verification', async () => {
    const seedBytes = wasmWrapper.encodeSeed(0n, 1n);
    const submission = wasmWrapper.wrapSeedSubmission(seedBytes);

    const uploadResp = await fetch(`${SIMULATOR_URL}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: submission
    });
    assert.equal(uploadResp.status, 200);

    const latestQuery = wasmWrapper.encodeQueryLatest();
    const latestHex = wasmWrapper.bytesToHex(latestQuery);

    const seedResp = await fetch(`${SIMULATOR_URL}/seed/${latestHex}`);
    assert.equal(seedResp.status, 200);

    const seedRespBytes = new Uint8Array(await seedResp.arrayBuffer());
    const seed = wasmWrapper.decodeSeed(seedRespBytes);
    assert.equal(seed.type, 'Seed');
    assert.equal(seed.view, 1);
    assert(seed.bytes);
  });
});

