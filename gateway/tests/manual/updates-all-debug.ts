import WebSocket from 'ws';
import { extractCasinoEvents } from '../../src/codec/events.js';

const UPDATES_URL = process.env.UPDATES_URL ?? 'wss://indexer.testnet.regenesis.dev/updates/00';
const UPDATES_ORIGIN = process.env.UPDATES_ORIGIN ?? 'https://api.testnet.regenesis.dev';

console.log(`Connecting to ${UPDATES_URL} (Origin: ${UPDATES_ORIGIN})`);

const ws = new WebSocket(UPDATES_URL, {
  headers: { Origin: UPDATES_ORIGIN },
});

ws.on('open', () => {
  console.log('connected');
});

ws.on('message', (data) => {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
  const events = extractCasinoEvents(new Uint8Array(buf));
  if (events.length > 0) {
    console.log(`events=${events.length}`, events.map((e) => ({
      type: e.type,
      sessionId: e.sessionId?.toString?.() ?? String(e.sessionId),
      player: e.player ? Buffer.from(e.player).toString('hex') : undefined,
    })));
  } else {
    console.log(`no events (len=${buf.length})`);
  }
});

ws.on('close', (code, reason) => {
  console.log(`closed code=${code} reason=${reason.toString()}`);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('ws error', err);
  process.exit(1);
});

setInterval(() => {}, 1000);
