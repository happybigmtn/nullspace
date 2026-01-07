import { describe, it, expect } from 'vitest';
import {
  extractGlobalTableEvents,
  decodeGlobalTableRoundLookup,
  GLOBAL_TABLE_EVENT_TAGS,
} from '../../src/codec/events.js';

const u8 = (value: number): Uint8Array => Uint8Array.of(value & 0xff);

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const encodeVarint = (value: number): Uint8Array => {
  let remaining = value >>> 0;
  const bytes: number[] = [];
  while (true) {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining !== 0) byte |= 0x80;
    bytes.push(byte);
    if (remaining === 0) break;
  }
  return Uint8Array.from(bytes);
};

const encodeU64BE = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
};

const encodeI64BE = (value: bigint): Uint8Array => {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigInt64(0, value, false);
  return new Uint8Array(buf);
};

const encodeU32BE = (value: number): Uint8Array => {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value >>> 0, false);
  return new Uint8Array(buf);
};

const encodeVec = (bytes: Uint8Array): Uint8Array => concat([encodeVarint(bytes.length), bytes]);

const encodeStringU32 = (value: string): Uint8Array => {
  const bytes = new TextEncoder().encode(value);
  return concat([encodeU32BE(bytes.length), bytes]);
};

const buildProgress = (): Uint8Array => {
  const zeros32 = new Uint8Array(32);
  return concat([
    encodeU64BE(1n), // view
    encodeU64BE(1n), // height
    zeros32, // block_digest
    zeros32, // state_root
    encodeU64BE(0n), // state_start_op
    encodeU64BE(0n), // state_end_op
    zeros32, // events_root
    encodeU64BE(0n), // events_start_op
    encodeU64BE(0n), // events_end_op
  ]);
};

const buildCertificate = (): Uint8Array => concat([
  encodeVarint(0), // item index
  new Uint8Array(32), // digest
  new Uint8Array(48), // signature
]);

const buildProof = (): Uint8Array => concat([
  encodeVarint(0), // size
  encodeVarint(0), // digest count
]);

const buildRound = (overrides?: Partial<{
  roundId: bigint;
  phase: number;
  phaseEndsAtMs: bigint;
  mainPoint: number;
  d1: number;
  d2: number;
}>): Uint8Array => {
  const roundId = overrides?.roundId ?? 7n;
  const phase = overrides?.phase ?? 1;
  const phaseEndsAtMs = overrides?.phaseEndsAtMs ?? 1_000n;
  const mainPoint = overrides?.mainPoint ?? 0;
  const d1 = overrides?.d1 ?? 0;
  const d2 = overrides?.d2 ?? 0;
  const totals = [
    { betType: 0, target: 0, amount: 500n },
  ];

  return concat([
    u8(3), // game_type = craps
    encodeU64BE(roundId),
    u8(phase),
    encodeU64BE(phaseEndsAtMs),
    u8(mainPoint),
    u8(d1),
    u8(d2),
    u8(0), // made_points_mask
    u8(0), // epoch_point_established
    u8(0), // field_paytable
    encodeVec(new Uint8Array(0)), // rng_commit
    encodeVec(new Uint8Array(0)), // roll_seed
    encodeVarint(totals.length),
    ...totals.map((total) => concat([u8(total.betType), u8(total.target), encodeU64BE(total.amount)])),
  ]);
};

const buildUpdate = (eventPayloads: Uint8Array[]): Uint8Array => {
  const ops = eventPayloads.map((payload) => concat([u8(0x01), u8(0x00), payload]));
  return concat([
    u8(0x01), // Update::Events
    buildProgress(),
    buildCertificate(),
    buildProof(),
    encodeVarint(ops.length),
    ...ops,
  ]);
};

describe('global table event decoding', () => {
  it('decodes lifecycle events from Update::Events', () => {
    const roundOpened = concat([u8(GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_ROUND_OPENED), buildRound()]);
    const locked = concat([
      u8(GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_LOCKED),
      u8(3),
      encodeU64BE(7n),
      encodeU64BE(2_000n),
    ]);
    const outcome = concat([
      u8(GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_OUTCOME),
      buildRound({ phase: 3, d1: 2, d2: 5 }),
    ]);
    const player = Uint8Array.from({ length: 32 }, (_, idx) => idx + 1);
    const playerSettled = concat([
      u8(GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_PLAYER_SETTLED),
      player,
      encodeU64BE(7n),
      encodeI64BE(15n),
      encodeU64BE(1_000n),
      encodeU64BE(0n),
      encodeU64BE(0n),
      encodeVarint(1),
      u8(0),
      u8(0),
      encodeU64BE(5n),
    ]);
    const finalized = concat([
      u8(GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_FINALIZED),
      u8(3),
      encodeU64BE(7n),
    ]);

    const update = buildUpdate([roundOpened, locked, outcome, playerSettled, finalized]);
    const events = extractGlobalTableEvents(update);

    expect(events.map((event) => event.type)).toEqual([
      'round_opened',
      'locked',
      'outcome',
      'player_settled',
      'finalized',
    ]);

    const opened = events[0];
    expect(opened.type).toBe('round_opened');
    if (opened.type === 'round_opened') {
      expect(opened.round.roundId).toBe(7n);
      expect(opened.round.gameType).toBe(3);
    }

    const settled = events[3];
    expect(settled.type).toBe('player_settled');
    if (settled.type === 'player_settled') {
      expect(settled.roundId).toBe(7n);
      expect(settled.payout).toBe(15n);
      expect(settled.myBets.length).toBe(1);
    }
  });

  it('decodes bet accepted and rejected events', () => {
    const player = Uint8Array.from({ length: 32 }, (_, idx) => 200 - idx);
    const betAccepted = concat([
      u8(GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_BET_ACCEPTED),
      player,
      encodeU64BE(9n),
      encodeVarint(1),
      u8(0),
      u8(0),
      encodeU64BE(25n),
      encodeU64BE(900n),
      encodeU64BE(0n),
      encodeU64BE(0n),
    ]);
    const betRejected = concat([
      u8(GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_BET_REJECTED),
      player,
      encodeU64BE(9n),
      u8(2),
      encodeStringU32('nope'),
    ]);

    const update = buildUpdate([betAccepted, betRejected]);
    const events = extractGlobalTableEvents(update);
    expect(events.map((event) => event.type)).toEqual(['bet_accepted', 'bet_rejected']);
    const accepted = events[0];
    if (accepted.type === 'bet_accepted') {
      expect(accepted.roundId).toBe(9n);
      expect(accepted.bets.length).toBe(1);
      expect(accepted.balanceSnapshot?.chips).toBe(900n);
    }
    const rejected = events[1];
    if (rejected.type === 'bet_rejected') {
      expect(rejected.errorCode).toBe(2);
      expect(rejected.message).toBe('nope');
    }
  });
});

describe('global table round lookup', () => {
  it('decodes round state lookup', () => {
    const round = buildRound({ roundId: 12n, phase: 2, phaseEndsAtMs: 4_000n });
    const data = concat([
      buildProgress(),
      buildCertificate(),
      buildProof(),
      encodeU64BE(99n), // location
      u8(0xd2), // STATE_OP_UPDATE_CONTEXT
      new Uint8Array(32), // key digest
      u8(30), // GLOBAL_TABLE_VALUE_TAG
      round,
    ]);

    const decoded = decodeGlobalTableRoundLookup(data);
    expect(decoded?.roundId).toBe(12n);
    expect(decoded?.phase).toBe(2);
  });

  it('returns null for wrong value tag', () => {
    const data = concat([
      buildProgress(),
      buildCertificate(),
      buildProof(),
      encodeU64BE(1n),
      u8(0xd2),
      new Uint8Array(32),
      u8(31),
      buildRound(),
    ]);
    expect(decodeGlobalTableRoundLookup(data)).toBeNull();
  });
});
