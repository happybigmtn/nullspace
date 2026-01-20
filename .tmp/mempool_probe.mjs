import { ed25519 } from '@noble/curves/ed25519';
import { randomBytes } from 'crypto';
import WebSocket from 'ws';

const SIM_URL = process.argv[2] || 'https://indexer.testnet.regenesis.dev';
const WS_URL = SIM_URL.replace('https://','wss://').replace('http://','ws://') + '/mempool';

const INSTRUCTION_TAG_CASINO_REGISTER = 10;
const SUBMISSION_TAG_TRANSACTIONS = 1;
const TRANSACTION_NAMESPACE = new TextEncoder().encode('_NULLSPACE_TX');

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

function unionUnique(namespace, message) {
  const lenVarint = encodeVarint(namespace.length);
  const result = new Uint8Array(lenVarint.length + namespace.length + message.length);
  result.set(lenVarint, 0);
  result.set(namespace, lenVarint.length);
  result.set(message, lenVarint.length + namespace.length);
  return result;
}

function encodeString(str) {
  const bytes = new TextEncoder().encode(str);
  const result = new Uint8Array(4 + bytes.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, bytes.length, false);
  result.set(bytes, 4);
  return result;
}

function encodeCasinoRegister(name) {
  const nameEncoded = encodeString(name);
  const result = new Uint8Array(1 + nameEncoded.length);
  result[0] = INSTRUCTION_TAG_CASINO_REGISTER;
  result.set(nameEncoded, 1);
  return result;
}

function buildTransaction(nonce, instruction, privateKey) {
  const publicKey = ed25519.getPublicKey(privateKey);
  const payload = new Uint8Array(8 + instruction.length);
  new DataView(payload.buffer).setBigUint64(0, BigInt(nonce), false);
  payload.set(instruction, 8);
  const toSign = unionUnique(TRANSACTION_NAMESPACE, payload);
  const signature = ed25519.sign(toSign, privateKey);
  const tx = new Uint8Array(payload.length + 32 + 64);
  tx.set(payload, 0);
  tx.set(publicKey, payload.length);
  tx.set(signature, payload.length + 32);
  return tx;
}

function wrapSubmission(tx) {
  const lenVarint = encodeVarint(1);
  const result = new Uint8Array(1 + lenVarint.length + tx.length);
  result[0] = SUBMISSION_TAG_TRANSACTIONS;
  result.set(lenVarint, 1);
  result.set(tx, 1 + lenVarint.length);
  return result;
}

async function submitTx(submission) {
  const res = await fetch(`${SIM_URL}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(submission),
  });
  const text = await res.text().catch(()=>'');
  return { ok: res.ok, status: res.status, text };
}

async function main() {
  console.log('Connecting to', WS_URL);
  const ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';

  let gotMessage = false;
  ws.on('message', (data) => {
    gotMessage = true;
    const len = data instanceof Buffer ? data.length : data.byteLength;
    console.log('Mempool message received len=', len);
  });
  ws.on('error', (err) => {
    console.error('WS error', err?.message ?? err);
  });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('close', () => reject(new Error('ws closed before open')));
  });

  const priv = randomBytes(32);
  const pub = Buffer.from(ed25519.getPublicKey(priv)).toString('hex');
  const name = `Probe-${pub.slice(0,8)}`;
  const tx = buildTransaction(0, encodeCasinoRegister(name), priv);
  const submission = wrapSubmission(tx);

  console.log('Submitting register tx for', pub);
  const res = await submitTx(submission);
  console.log('Submit result', res);

  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log('Received mempool message?', gotMessage);
  ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
