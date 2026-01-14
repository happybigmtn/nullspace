/**
 * Codec for parsing backend Update events
 *
 * The backend sends binary-encoded Update messages via WebSocket.
 * This module decodes them and extracts casino game events.
 *
 * Note: @nullspace/protocol decode helpers are used by clients for state rendering, but
 * the gateway Update/FilteredEvents parsing is unique to this module.
 */
import { logDebug, logError, logWarn } from '../logger.js';

/**
 * Event tags matching Rust nullspace_types::execution::tags::event
 */
export const EVENT_TAGS = {
  CASINO_PLAYER_REGISTERED: 20,
  CASINO_GAME_STARTED: 21,
  CASINO_GAME_MOVED: 22,
  CASINO_GAME_COMPLETED: 23,
  CASINO_LEADERBOARD_UPDATED: 24,
  TOURNAMENT_STARTED: 25,
  PLAYER_JOINED: 26,
  TOURNAMENT_PHASE_CHANGED: 27,
  TOURNAMENT_ENDED: 28,
  CASINO_ERROR: 29,
  CASINO_DEPOSITED: 41,
  PLAYER_MODIFIER_TOGGLED: 42,
} as const;

export const GLOBAL_TABLE_EVENT_TAGS = {
  GLOBAL_TABLE_ROUND_OPENED: 60,
  GLOBAL_TABLE_BET_ACCEPTED: 61,
  GLOBAL_TABLE_BET_REJECTED: 62,
  GLOBAL_TABLE_LOCKED: 63,
  GLOBAL_TABLE_OUTCOME: 64,
  GLOBAL_TABLE_PLAYER_SETTLED: 65,
  GLOBAL_TABLE_FINALIZED: 66,
} as const;

const GLOBAL_TABLE_GAME_TYPE_CRAPS = 3;
const GLOBAL_TABLE_MAX_TOTALS = 64;
const GLOBAL_TABLE_MAX_BETS = 64;
const GLOBAL_TABLE_VALUE_TAG = 30;
const STATE_OP_UPDATE_CONTEXT = 0xD2;

/**
 * Parsed casino game event
 */
export interface CasinoGameEvent {
  type: 'started' | 'moved' | 'completed' | 'error';
  sessionId: bigint;
  gameType?: number;
  player?: Uint8Array;
  // Started event fields
  bet?: bigint;
  initialState?: Uint8Array;
  // Moved event fields
  moveNumber?: number;
  newState?: Uint8Array;
  logs?: string[];
  balanceSnapshot?: {
    chips: bigint;
    vusdt: bigint;
    rng: bigint;
  };
  // Completed event fields
  payout?: bigint;
  finalChips?: bigint;
  wasShielded?: boolean;
  wasDoubled?: boolean;
  // Error event fields
  errorCode?: number;
  errorMessage?: string;
}

export interface GlobalTableBet {
  betType: number;
  target: number;
  amount: bigint;
}

export interface GlobalTableTotal {
  betType: number;
  target: number;
  amount: bigint;
}

export interface GlobalTableRound {
  gameType: number;
  roundId: bigint;
  phase: number;
  phaseEndsAtMs: bigint;
  mainPoint: number;
  d1: number;
  d2: number;
  madePointsMask: number;
  epochPointEstablished: boolean;
  fieldPaytable: number;
  rngCommit: Uint8Array;
  rollSeed: Uint8Array;
  totals: GlobalTableTotal[];
}

export type GlobalTableEvent =
  | {
      type: 'round_opened';
      round: GlobalTableRound;
    }
  | {
      type: 'bet_accepted';
      player: Uint8Array;
      roundId: bigint;
      bets: GlobalTableBet[];
      balanceSnapshot?: { chips: bigint; vusdt: bigint; rng: bigint };
    }
  | {
      type: 'bet_rejected';
      player: Uint8Array;
      roundId: bigint;
      errorCode: number;
      message: string;
    }
  | {
      type: 'locked';
      gameType: number;
      roundId: bigint;
      phaseEndsAtMs: bigint;
    }
  | {
      type: 'outcome';
      round: GlobalTableRound;
    }
  | {
      type: 'player_settled';
      player: Uint8Array;
      roundId: bigint;
      payout: bigint;
      balanceSnapshot?: { chips: bigint; vusdt: bigint; rng: bigint };
      myBets: GlobalTableBet[];
    }
  | {
      type: 'finalized';
      gameType: number;
      roundId: bigint;
    };

/**
 * Binary reader helper class
 */
class BinaryReader {
  private view: DataView;
  private offset: number;
  private data: Uint8Array;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.offset = 0;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }

  readU8(): number {
    if (this.offset >= this.data.length) throw new Error('End of buffer');
    return this.data[this.offset++];
  }

  readU16LE(): number {
    if (this.remaining < 2) throw new Error('End of buffer');
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readU16BE(): number {
    if (this.remaining < 2) throw new Error('End of buffer');
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  readU32LE(): number {
    if (this.remaining < 4) throw new Error('End of buffer');
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  /**
   * Read u32 as Big Endian (commonware-codec format)
   */
  readU32BE(): number {
    if (this.remaining < 4) throw new Error('End of buffer');
    const value = this.view.getUint32(this.offset, false);  // false = BE
    this.offset += 4;
    return value;
  }

  readI64LE(): bigint {
    if (this.remaining < 8) throw new Error('End of buffer');
    const value = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return value;
  }

  /**
   * Read signed i64 as Big Endian (commonware-codec format)
   */
  readI64BE(): bigint {
    if (this.remaining < 8) throw new Error('End of buffer');
    const value = this.view.getBigInt64(this.offset, false);  // false = BE
    this.offset += 8;
    return value;
  }

  /**
   * Read u64 as Little Endian (legacy, kept for compatibility)
   */
  readU64LE(): bigint {
    if (this.remaining < 8) throw new Error('End of buffer');
    const value = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return value;
  }

  /**
   * Read u64 as Big Endian (commonware-codec format)
   */
  readU64BE(): bigint {
    if (this.remaining < 8) throw new Error('End of buffer');
    const value = this.view.getBigUint64(this.offset, false);  // false = BE
    this.offset += 8;
    return value;
  }

  readBool(): boolean {
    return this.readU8() !== 0;
  }

  readBytes(length: number): Uint8Array {
    if (this.remaining < length) throw new Error('End of buffer');
    const bytes = this.data.slice(this.offset, this.offset + length);
    this.offset += length;
    return bytes;
  }

  readPublicKey(): Uint8Array {
    return this.readBytes(32);
  }

  /**
   * Read a varint-encoded unsigned integer (LEB128 format used by commonware-codec)
   * See: https://en.wikipedia.org/wiki/LEB128
   */
  readVarint(): number {
    let result = 0;
    let shift = 0;
    while (true) {
      if (this.offset >= this.data.length) throw new Error('End of buffer reading varint');
      const byte = this.data[this.offset++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error('Varint too long');
    }
    return result;
  }

  readVec(): Uint8Array {
    const length = this.readVarint();
    if (length > 10000) {
      throw new Error(`Vec length ${length} too large (remaining=${this.remaining})`);
    }
    return this.readBytes(length);
  }

  readString(): string {
    const bytes = this.readVec();
    return new TextDecoder().decode(bytes);
  }

  readStringVec(): string[] {
    const count = this.readVarint();
    const strings: string[] = [];
    for (let i = 0; i < count; i++) {
      strings.push(this.readString());
    }
    return strings;
  }

  readStringU32(): string {
    const length = this.readU32BE();
    if (length > 10000) {
      throw new Error(`String length ${length} too large (remaining=${this.remaining})`);
    }
    return new TextDecoder().decode(this.readBytes(length));
  }

  readStringU32Bytes(): void {
    const length = this.readU32BE();
    if (length > 10000) {
      throw new Error(`String length ${length} too large (remaining=${this.remaining})`);
    }
    this.skip(length);
  }

  readStringVecU32(): string[] {
    const count = this.readU32BE();
    const strings: string[] = [];
    if (count > 10000) {
      throw new Error(`String vec length ${count} too large (remaining=${this.remaining})`);
    }
    for (let i = 0; i < count; i += 1) {
      strings.push(this.readStringU32());
    }
    return strings;
  }

  readOptionU64LE(): bigint | null {
    const hasValue = this.readBool();
    if (hasValue) {
      return this.readU64LE();
    }
    return null;
  }

  /**
   * Read Option<u64> in Big Endian (commonware-codec format)
   */
  readOptionU64BE(): bigint | null {
    const hasValue = this.readBool();
    if (hasValue) {
      return this.readU64BE();
    }
    return null;
  }

  readPlayerBalanceSnapshot(): { chips: bigint; vusdt: bigint; rng: bigint } {
    return {
      chips: this.readU64BE(),
      vusdt: this.readU64BE(),
      rng: this.readU64BE(),
    };
  }

  skip(bytes: number): void {
    this.offset += bytes;
  }
}

const DIGEST_SIZE = 32;
const BLS_G1_SIGNATURE_SIZE = 48;
const ED25519_SIGNATURE_SIZE = 64;

/**
 * Parse a CasinoGameStarted event
 * Uses Big Endian for u64 fields (commonware-codec format)
 */
function parseCasinoGameStarted(reader: BinaryReader): CasinoGameEvent {
  const sessionId = reader.readU64BE();
  const player = reader.readPublicKey();
  const gameType = reader.readU8();
  const bet = reader.readU64BE();
  const initialState = reader.readVec();

  return {
    type: 'started',
    sessionId,
    player,
    gameType,
    bet,
    initialState,
  };
}

/**
 * Parse a CasinoGameMoved event
 * Uses Big Endian for u64 fields (commonware-codec format)
 */
function parseCasinoGameMoved(reader: BinaryReader): CasinoGameEvent {
  const sessionId = reader.readU64BE();
  const moveNumber = reader.readU32BE();
  const newState = reader.readVec();
  const logs = reader.readStringVecU32();
  const balanceSnapshot = reader.readPlayerBalanceSnapshot();

  return {
    type: 'moved',
    sessionId,
    moveNumber,
    newState,
    logs,
    balanceSnapshot,
  };
}

/**
 * Parse a CasinoGameCompleted event
 * Uses Big Endian for u64/i64 fields (commonware-codec format)
 */
function parseCasinoGameCompleted(reader: BinaryReader): CasinoGameEvent {
  const sessionId = reader.readU64BE();
  const player = reader.readPublicKey();
  const gameType = reader.readU8();
  const payout = reader.readI64BE();
  const finalChips = reader.readU64BE();
  const wasShielded = reader.readBool();
  const wasDoubled = reader.readBool();
  const logs = reader.readStringVecU32();
  const balanceSnapshot = reader.readPlayerBalanceSnapshot();

  return {
    type: 'completed',
    sessionId,
    player,
    gameType,
    payout,
    finalChips,
    wasShielded,
    wasDoubled,
    logs,
    balanceSnapshot,
  };
}

/**
 * Parse a CasinoError event
 * Uses Big Endian for u64 fields (commonware-codec format)
 * Note: The errorMessage string may have unreasonable length values if
 * this is a false positive match. We try to parse it, but return without
 * errorMessage if the length is too large.
 */
function parseCasinoError(reader: BinaryReader): CasinoGameEvent {
  const player = reader.readPublicKey();
  const sessionId = reader.readOptionU64BE();
  const errorCode = reader.readU8();

  // Try to read errorMessage, but it may fail on false positives
  let errorMessage = '';
  try {
    if (reader.remaining >= 4) {
      const view = new DataView(
        reader['data'].buffer,
        reader['data'].byteOffset + reader['offset'],
        4
      );
      const length = view.getUint32(0, false);
      if (length <= 1000 && length <= reader.remaining - 4) {
        errorMessage = reader.readStringU32();
      }
    }
  } catch {
    // errorMessage is optional for validation purposes
  }

  return {
    type: 'error',
    sessionId: sessionId ?? 0n,
    player,
    errorCode,
    errorMessage,
  };
}

function skipProgress(reader: BinaryReader): void {
  // Progress uses fixed-width u64 fields (commonware-codec)
  reader.readU64BE(); // view
  reader.readU64BE(); // height
  reader.readBytes(DIGEST_SIZE); // block_digest
  reader.readBytes(DIGEST_SIZE); // state_root
  reader.readU64BE(); // state_start_op
  reader.readU64BE(); // state_end_op
  reader.readBytes(DIGEST_SIZE); // events_root
  reader.readU64BE(); // events_start_op
  reader.readU64BE(); // events_end_op
}

function skipCertificate(reader: BinaryReader): void {
  // Aggregation certificate uses a single threshold signature (MinSig -> G1, 48 bytes)
  reader.readVarint(); // Item index (UInt)
  reader.readBytes(DIGEST_SIZE); // Item digest
  reader.readBytes(BLS_G1_SIGNATURE_SIZE); // Signature
}

function skipProof(reader: BinaryReader): void {
  // Proof<Digest> = UInt(size) + Vec<Digest>
  reader.readVarint(); // size (Position)
  const digestCount = reader.readVarint();
  const bytes = digestCount * DIGEST_SIZE;
  if (bytes > reader.remaining) {
    throw new Error(`Proof digest count ${digestCount} too large (remaining=${reader.remaining})`);
  }
  reader.skip(bytes);
}

function skipPolicyState(reader: BinaryReader): void {
  for (let i = 0; i < 19; i += 1) {
    reader.readU16BE();
  }
  reader.readU64BE(); // credit_vest_secs
  reader.readU64BE(); // credit_expiry_secs
  reader.readBool(); // bridge_paused
  reader.readU64BE(); // bridge_daily_limit
  reader.readU64BE(); // bridge_daily_limit_per_account
  reader.readU64BE(); // bridge_min_withdraw
  reader.readU64BE(); // bridge_max_withdraw
  reader.readU64BE(); // bridge_delay_secs
  reader.readBool(); // oracle_enabled
  reader.readU16BE(); // oracle_max_deviation_bps
  reader.readU64BE(); // oracle_stale_secs
}

function skipTreasuryState(reader: BinaryReader): void {
  for (let i = 0; i < 6; i += 1) {
    reader.readU64BE();
  }
}

function skipTreasuryVestingState(reader: BinaryReader): void {
  for (let i = 0; i < 18; i += 1) {
    reader.readU64BE();
  }
}

function skipGlobalTableConfig(reader: BinaryReader): void {
  reader.readU8(); // game_type
  reader.readU64BE(); // betting_ms
  reader.readU64BE(); // lock_ms
  reader.readU64BE(); // payout_ms
  reader.readU64BE(); // cooldown_ms
  reader.readU64BE(); // min_bet
  reader.readU64BE(); // max_bet
  reader.readU8(); // max_bets_per_round
}

function skipInstruction(reader: BinaryReader): void {
  const tag = reader.readU8();
  switch (tag) {
    case 10: // CasinoRegister
      reader.readStringU32Bytes();
      return;
    case 11: // CasinoDeposit
      reader.readU64BE();
      return;
    case 12: // CasinoStartGame
      reader.readU8();
      reader.readU64BE();
      reader.readU64BE();
      return;
    case 13: { // CasinoGameMove
      reader.readU64BE();
      const payloadLen = reader.readU32BE();
      reader.skip(payloadLen);
      return;
    }
    case 14: // CasinoPlayerAction
      reader.readU8();
      return;
    case 15: // CasinoSetTournamentLimit
      reader.readPublicKey();
      reader.readU8();
      return;
    case 16: // CasinoJoinTournament
      reader.readU64BE();
      return;
    case 17: // CasinoStartTournament
      reader.readU64BE();
      reader.readU64BE();
      reader.readU64BE();
      return;
    case 18: // Stake
      reader.readU64BE();
      reader.readU64BE();
      return;
    case 19: // Unstake
    case 20: // ClaimRewards
    case 21: // ProcessEpoch
    case 22: // CreateVault
      return;
    case 23: // DepositCollateral
    case 24: // BorrowUSDT
    case 25: // RepayUSDT
      reader.readU64BE();
      return;
    case 26: // Swap
      reader.readU64BE();
      reader.readU64BE();
      reader.readBool();
      return;
    case 27: // AddLiquidity
      reader.readU64BE();
      reader.readU64BE();
      return;
    case 28: // RemoveLiquidity
      reader.readU64BE();
      return;
    case 29: // CasinoEndTournament
      reader.readU64BE();
      return;
    case 30: // LiquidateVault
      reader.readPublicKey();
      return;
    case 31: // SetPolicy
      skipPolicyState(reader);
      return;
    case 32: // SetTreasury
      skipTreasuryState(reader);
      return;
    case 33: // FundRecoveryPool
      reader.readU64BE();
      return;
    case 34: // RetireVaultDebt
      reader.readPublicKey();
      reader.readU64BE();
      return;
    case 35: // RetireWorstVaultDebt
    case 36: // DepositSavings
    case 37: // WithdrawSavings
      reader.readU64BE();
      return;
    case 38: // ClaimSavingsRewards
      return;
    case 39: // SeedAmm
      reader.readU64BE();
      reader.readU64BE();
      reader.readU64BE();
      reader.readU64BE();
      return;
    case 40: // FinalizeAmmBootstrap
      return;
    case 41: // SetTreasuryVesting
      skipTreasuryVestingState(reader);
      return;
    case 42: // ReleaseTreasuryAllocation
      reader.readU8(); // bucket
      reader.readU64BE();
      return;
    case 43: // BridgeWithdraw
      reader.readU64BE();
      reader.readVec();
      return;
    case 44: // BridgeDeposit
      reader.readPublicKey();
      reader.readU64BE();
      reader.readVec();
      return;
    case 45: // FinalizeBridgeWithdrawal
      reader.readU64BE();
      reader.readVec();
      return;
    case 46: // UpdateOracle
      reader.readU64BE();
      reader.readU64BE();
      reader.readU64BE();
      reader.readVec();
      return;
    case 60: // GlobalTableInit
      skipGlobalTableConfig(reader);
      return;
    case 61: // GlobalTableOpenRound
      reader.readU8();
      return;
    case 62: { // GlobalTableSubmitBets
      reader.readU8();
      reader.readU64BE();
      const betsLen = reader.readVarint();
      for (let i = 0; i < betsLen; i += 1) {
        reader.readU8();
        reader.readU8();
        reader.readU64BE();
      }
      return;
    }
    case 63: // GlobalTableLock
    case 64: // GlobalTableReveal
    case 65: // GlobalTableSettle
    case 66: // GlobalTableFinalize
      reader.readU8();
      reader.readU64BE();
      return;
    default:
      throw new Error(`Unknown instruction tag ${tag}`);
  }
}

function skipTransaction(reader: BinaryReader): void {
  reader.readU64BE(); // nonce
  skipInstruction(reader);
  reader.readPublicKey(); // public key
  reader.readBytes(ED25519_SIGNATURE_SIZE); // signature
}

function skipCasinoLeaderboard(reader: BinaryReader): void {
  const count = reader.readVarint();
  for (let i = 0; i < count; i += 1) {
    reader.readPublicKey();
    reader.readStringU32Bytes();
    reader.readU64BE();
    reader.readU32BE();
  }
}

function skipTournamentRankings(reader: BinaryReader): void {
  const count = reader.readVarint();
  for (let i = 0; i < count; i += 1) {
    reader.readPublicKey();
    reader.readU64BE();
  }
}

function skipEventByTag(reader: BinaryReader, tag: number): void {
  switch (tag) {
    case EVENT_TAGS.CASINO_PLAYER_REGISTERED:
      reader.readPublicKey();
      reader.readStringU32Bytes();
      return;
    case EVENT_TAGS.CASINO_DEPOSITED:
      reader.readPublicKey();
      reader.readU64BE();
      reader.readU64BE();
      return;
    case EVENT_TAGS.CASINO_LEADERBOARD_UPDATED:
      skipCasinoLeaderboard(reader);
      return;
    case EVENT_TAGS.PLAYER_MODIFIER_TOGGLED:
      reader.readPublicKey();
      reader.readU8(); // action
      reader.readBool();
      reader.readBool();
      reader.readBool();
      return;
    case EVENT_TAGS.TOURNAMENT_STARTED:
      reader.readU64BE();
      reader.readU64BE();
      return;
    case EVENT_TAGS.PLAYER_JOINED:
      reader.readU64BE();
      reader.readPublicKey();
      return;
    case EVENT_TAGS.TOURNAMENT_PHASE_CHANGED:
      reader.readU64BE();
      reader.readU8(); // phase
      return;
    case EVENT_TAGS.TOURNAMENT_ENDED:
      reader.readU64BE();
      skipTournamentRankings(reader);
      return;
    default:
      throw new Error(`Unknown event tag ${tag}`);
  }
}

function parseCasinoEventWithTag(reader: BinaryReader, tag: number): CasinoGameEvent | null {
  switch (tag) {
    case EVENT_TAGS.CASINO_GAME_STARTED:
      return parseCasinoGameStarted(reader);
    case EVENT_TAGS.CASINO_GAME_MOVED:
      return parseCasinoGameMoved(reader);
    case EVENT_TAGS.CASINO_GAME_COMPLETED:
      return parseCasinoGameCompleted(reader);
    case EVENT_TAGS.CASINO_ERROR:
      return parseCasinoError(reader);
    default:
      return null;
  }
}

function parseGlobalTableEventWithTag(
  reader: BinaryReader,
  tag: number
): GlobalTableEvent | null {
  switch (tag) {
    case GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_ROUND_OPENED:
      return { type: 'round_opened', round: parseGlobalTableRound(reader) };
    case GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_BET_ACCEPTED: {
      const player = reader.readPublicKey();
      const roundId = reader.readU64BE();
      const betsLen = reader.readVarint();
      const bets: GlobalTableBet[] = [];
      for (let i = 0; i < betsLen; i += 1) {
        bets.push(readGlobalTableBet(reader));
      }
      const balanceSnapshot = reader.readPlayerBalanceSnapshot();
      return {
        type: 'bet_accepted',
        player,
        roundId,
        bets,
        balanceSnapshot,
      };
    }
    case GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_BET_REJECTED: {
      const player = reader.readPublicKey();
      const roundId = reader.readU64BE();
      const errorCode = reader.readU8();
      const message = reader.readStringU32();
      return {
        type: 'bet_rejected',
        player,
        roundId,
        errorCode,
        message,
      };
    }
    case GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_LOCKED:
      return {
        type: 'locked',
        gameType: reader.readU8(),
        roundId: reader.readU64BE(),
        phaseEndsAtMs: reader.readU64BE(),
      };
    case GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_OUTCOME:
      return { type: 'outcome', round: parseGlobalTableRound(reader) };
    case GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_PLAYER_SETTLED: {
      const player = reader.readPublicKey();
      const roundId = reader.readU64BE();
      const payout = reader.readI64BE();
      const balanceSnapshot = reader.readPlayerBalanceSnapshot();
      const myBetsLen = reader.readVarint();
      const myBets: GlobalTableBet[] = [];
      for (let i = 0; i < myBetsLen; i += 1) {
        myBets.push(readGlobalTableBet(reader));
      }
      return {
        type: 'player_settled',
        player,
        roundId,
        payout,
        balanceSnapshot,
        myBets,
      };
    }
    case GLOBAL_TABLE_EVENT_TAGS.GLOBAL_TABLE_FINALIZED:
      return {
        type: 'finalized',
        gameType: reader.readU8(),
        roundId: reader.readU64BE(),
      };
    default:
      return null;
  }
}

function decodeOutput(
  reader: BinaryReader,
  casino: CasinoGameEvent[],
  global: GlobalTableEvent[],
  contextLabel: string
): void {
  const outputKind = reader.readU8();
  if (outputKind === 0x00) {
    const tag = reader.readU8();
    const casinoEvent = parseCasinoEventWithTag(reader, tag);
    if (casinoEvent) {
      if (validateEvent(casinoEvent)) {
        casino.push(casinoEvent);
      }
      return;
    }

    const globalEvent = parseGlobalTableEventWithTag(reader, tag);
    if (globalEvent) {
      if (validateGlobalTableEvent(globalEvent)) {
        global.push(globalEvent);
      }
      return;
    }

    skipEventByTag(reader, tag);
    return;
  }

  if (outputKind === 0x01) {
    skipTransaction(reader);
    return;
  }

  if (outputKind === 0x02) {
    reader.readU64BE();
    reader.readU64BE();
    return;
  }

  throw new Error(`Unexpected Output kind ${outputKind} in ${contextLabel}`);
}

function decodeFilteredEvents(
  data: Uint8Array
): { casino: CasinoGameEvent[]; global: GlobalTableEvent[] } {
  const casino: CasinoGameEvent[] = [];
  const global: GlobalTableEvent[] = [];

  if (data.length === 0 || data[0] !== 0x02) {
    return { casino, global };
  }

  const reader = new BinaryReader(data);
  reader.readU8(); // Update::FilteredEvents tag

  skipProgress(reader);
  skipCertificate(reader);
  skipProof(reader);

  const opsLen = reader.readVarint();
  for (let i = 0; i < opsLen; i += 1) {
    reader.readU64BE(); // location
    const context = reader.readU8();
    if (context === 0x01) {
      decodeOutput(reader, casino, global, 'FilteredEvents');
    } else if (context === 0x00) {
      const hasValue = reader.readBool();
      if (!hasValue) {
        continue;
      }
      decodeOutput(reader, casino, global, 'FilteredEvents commit');
    } else {
      throw new Error(`Unknown keyless op context ${context}`);
    }
  }

  return { casino, global };
}

function decodeEvents(
  data: Uint8Array
): { casino: CasinoGameEvent[]; global: GlobalTableEvent[] } {
  const casino: CasinoGameEvent[] = [];
  const global: GlobalTableEvent[] = [];

  if (data.length === 0 || data[0] !== 0x01) {
    return { casino, global };
  }

  const reader = new BinaryReader(data);
  reader.readU8(); // Update::Events tag

  skipProgress(reader);
  skipCertificate(reader);
  skipProof(reader);

  const opsLen = reader.readVarint();
  for (let i = 0; i < opsLen; i += 1) {
    const context = reader.readU8();
    if (context === 0x01) {
      decodeOutput(reader, casino, global, 'Events');
    } else if (context === 0x00) {
      const hasValue = reader.readBool();
      if (!hasValue) {
        continue;
      }
      decodeOutput(reader, casino, global, 'Events commit');
    } else {
      throw new Error(`Unknown keyless op context ${context}`);
    }
  }

  return { casino, global };
}

function readGlobalTableBet(reader: BinaryReader): GlobalTableBet {
  return {
    betType: reader.readU8(),
    target: reader.readU8(),
    amount: reader.readU64BE(),
  };
}

function readGlobalTableTotal(reader: BinaryReader): GlobalTableTotal {
  return {
    betType: reader.readU8(),
    target: reader.readU8(),
    amount: reader.readU64BE(),
  };
}

function parseGlobalTableRound(reader: BinaryReader): GlobalTableRound {
  const gameType = reader.readU8();
  const roundId = reader.readU64BE();
  const phase = reader.readU8();
  const phaseEndsAtMs = reader.readU64BE();
  const mainPoint = reader.readU8();
  const d1 = reader.readU8();
  const d2 = reader.readU8();
  const madePointsMask = reader.readU8();
  const epochPointEstablished = reader.readBool();
  const fieldPaytable = reader.readU8();
  const rngCommit = reader.readVec();
  const rollSeed = reader.readVec();
  const totalsLen = reader.readVarint();
  const totals: GlobalTableTotal[] = [];
  for (let i = 0; i < totalsLen; i += 1) {
    totals.push(readGlobalTableTotal(reader));
  }

  return {
    gameType,
    roundId,
    phase,
    phaseEndsAtMs,
    mainPoint,
    d1,
    d2,
    madePointsMask,
    epochPointEstablished,
    fieldPaytable,
    rngCommit,
    rollSeed,
    totals,
  };
}

/**
 * Parse a GlobalTableEvent by reading the tag and delegating to parseGlobalTableEventWithTag
 */
function parseGlobalTableEvent(reader: BinaryReader): GlobalTableEvent | null {
  const tag = reader.readU8();
  return parseGlobalTableEventWithTag(reader, tag);
}

/**
 * Parse an Event by reading the tag and delegating to parseCasinoEventWithTag
 */
function parseEvent(reader: BinaryReader): CasinoGameEvent | null {
  const tag = reader.readU8();
  return parseCasinoEventWithTag(reader, tag);
}

/**
 * Parse an Output from binary data
 * Output is: Event(0) | Transaction(1) | Commit(2)
 */
function parseOutput(reader: BinaryReader): CasinoGameEvent | null {
  const kind = reader.readU8();

  if (kind === 0) {
    // Event
    return parseEvent(reader);
  }

  // Transaction or Commit - skip (we only care about Events)
  return null;
}

/**
 * Extract casino game events from an Update message
 *
 * The Update structure:
 * - Update::Seed(0) - heartbeat, skip
 * - Update::Events(1) - contains events_proof_ops
 * - Update::FilteredEvents(2) - contains (u64 location, Output) pairs
 *
 * FilteredEvents structure:
 * [02][Progress ~120 bytes][Certificate ~100+ bytes][Proof variable][events_proof_ops: Vec<(u64, EventOp)>]
 *
 * Each element in events_proof_ops:
 * [u64 location][Output discriminant: u8][if Event: tag + data]
 *
 * Output enum: Event(0), Transaction(1), Commit(2)
 */
export function extractCasinoEvents(data: Uint8Array): CasinoGameEvent[] {
  const events: CasinoGameEvent[] = [];
  const isCasinoTag = (tag: number): boolean =>
    tag === EVENT_TAGS.CASINO_GAME_STARTED
    || tag === EVENT_TAGS.CASINO_GAME_MOVED
    || tag === EVENT_TAGS.CASINO_GAME_COMPLETED
    || tag === EVENT_TAGS.CASINO_ERROR;

  if (data.length === 0) {
    return events;
  }

  // Skip Seed updates (no events included)
  if (data[0] === 0x00) {
    return events;
  }

  if (data[0] === 0x01) {
    try {
      const decoded = decodeEvents(data);
      if (decoded.casino.length > 0) {
        return decoded.casino;
      }
    } catch (err) {
      logWarn('[extractCasinoEvents] Failed to decode Events:', err);
    }
  }

  if (data[0] === 0x02) {
    try {
      const decoded = decodeFilteredEvents(data);
      if (decoded.casino.length > 0) {
        return decoded.casino;
      }
    } catch (err) {
      logWarn('[extractCasinoEvents] Failed to decode FilteredEvents:', err);
    }
  }

  // The events_proof_ops Vec is at the END of the message after ~700-900 bytes of header
  // Structure: [Vec length: u32][item1][item2]...
  // Each item: [u64 location][op context][Output discriminant][if Event: tag + event_data]
  //
  // We scan BACKWARDS from the end to find the Vec, avoiding false positives in crypto data.
  // The Vec length should be small (1-10 events) and is preceded by the Proof.

  // Scan the entire message for event markers; proof sizes vary and can push events earlier.
  const scanStart = 0;

  const appendContexts = new Set([0x01, 0x05]);

  // Debug: find and show the [01/05 00 tag] pattern location - scan more of the message
  const debugStart = Math.max(0, data.length - 400);
  if (data.length > 100) {
    for (let d = debugStart; d < data.length - 3; d++) {
      if (appendContexts.has(data[d]) && data[d + 1] === 0x00) {
        const tag = data[d + 2];
        if (!isCasinoTag(tag)) {
          continue;
        }
        const ctx = Array.from(data.slice(d, Math.min(d + 20, data.length)))
          .map((x) => x.toString(16).padStart(2, '0'))
          .join(' ');
        logDebug(
          `[extractCasinoEvents] Found [${data[d].toString(16).padStart(2, '0')} 00 ${tag.toString(16)}] at ${d}: ${ctx}`
        );
      }
    }
  }

  // Scan backwards for [01/05][00][tag] pattern (Keyless::Append + Output::Event + tag)
  for (let i = Math.max(0, data.length - 3); i >= scanStart; i--) {
    if (appendContexts.has(data[i]) && data[i + 1] === 0x00) {
      const eventTag = data[i + 2];
      if (isCasinoTag(eventTag)) {
        try {
          // Parse starting from the tag (skip Keyless + Output discriminants)
          const reader = new BinaryReader(data.slice(i + 2));
          const event = parseEvent(reader);

          if (event && validateEvent(event)) {
            logDebug(
              `[extractCasinoEvents] Found ${event.type} via fallback at ${i}: session=${event.sessionId}`,
              event.type === 'error' ? `error=${event.errorCode} msg=${event.errorMessage}` : ''
            );
            events.push(event);
            return events; // Found valid event
          }
        } catch {
          // Silent - false positives are expected in crypto data
        }
      }
    }
  }

  if (events.length === 0 && data.length > 100) {
    // Last resort debug: dump the entire last 150 bytes
    const last150 = Array.from(data.slice(Math.max(0, data.length - 150)))
      .map((x) => x.toString(16).padStart(2, '0'))
      .join(' ');
    logDebug(`[extractCasinoEvents] No events in ${data.length}b FilteredEvents. Last 150 bytes: ${last150}`);
  }

  return events;
}

export function extractGlobalTableEvents(data: Uint8Array): GlobalTableEvent[] {
  const events: GlobalTableEvent[] = [];

  if (data.length === 0) {
    return events;
  }

  if (data[0] === 0x00) {
    return events;
  }

  if (data[0] === 0x01) {
    try {
      const decoded = decodeEvents(data);
      return decoded.global;
    } catch (err) {
      logWarn('[extractGlobalTableEvents] Failed to decode Events:', err);
      return events;
    }
  }

  if (data[0] === 0x02) {
    try {
      const decoded = decodeFilteredEvents(data);
      return decoded.global;
    } catch (err) {
      logWarn('[extractGlobalTableEvents] Failed to decode FilteredEvents:', err);
      return events;
    }
  }

  return events;
}

export function decodeGlobalTableRoundLookup(data: Uint8Array): GlobalTableRound | null {
  if (data.length === 0) return null;
  try {
    const reader = new BinaryReader(data);
    skipProgress(reader);
    skipCertificate(reader);
    skipProof(reader);
    reader.readU64BE(); // location
    const opContext = reader.readU8();
    if (opContext !== STATE_OP_UPDATE_CONTEXT) return null;
    reader.readBytes(DIGEST_SIZE); // key
    const valueTag = reader.readU8();
    if (valueTag !== GLOBAL_TABLE_VALUE_TAG) return null;
    const round = parseGlobalTableRound(reader);
    return validateGlobalTableRound(round) ? round : null;
  } catch {
    return null;
  }
}

/**
 * Validate that an event looks reasonable (not a false positive from random bytes)
 */
function validateEvent(event: CasinoGameEvent): boolean {
  // Session ID should be non-zero for most events (except some errors)
  if (event.type !== 'error' && event.sessionId === 0n) {
    return false;
  }

  // Player key should be 32 bytes and not all zeros
  if (event.player) {
    if (event.player.length !== 32) return false;
    if (event.player.every((b) => b === 0)) return false;
  }

  // For started/completed, player is required
  if ((event.type === 'started' || event.type === 'completed') && !event.player) {
    return false;
  }

  return true;
}

function validateGlobalTableEvent(event: GlobalTableEvent): boolean {
  switch (event.type) {
    case 'round_opened':
    case 'outcome':
      return validateGlobalTableRound(event.round);
    case 'locked':
    case 'finalized':
      return event.roundId !== 0n && event.gameType === GLOBAL_TABLE_GAME_TYPE_CRAPS;
    case 'bet_accepted':
      return event.roundId !== 0n && event.bets.length <= GLOBAL_TABLE_MAX_BETS;
    case 'bet_rejected':
      return event.roundId !== 0n;
    case 'player_settled':
      return event.roundId !== 0n && event.myBets.length <= GLOBAL_TABLE_MAX_BETS;
    default:
      return false;
  }
}

function validateGlobalTableRound(round: GlobalTableRound): boolean {
  if (round.roundId === 0n) return false;
  if (round.gameType !== GLOBAL_TABLE_GAME_TYPE_CRAPS) return false;
  if (round.phase < 0 || round.phase > 4) return false;
  if (round.totals.length > GLOBAL_TABLE_MAX_TOTALS) return false;
  if (round.rngCommit.length !== 0 && round.rngCommit.length !== 32) return false;
  if (round.rollSeed.length !== 0 && round.rollSeed.length !== 32) return false;
  return true;
}

/**
 * Parse a single casino game event from raw event data
 * (when we know the exact boundary of the event)
 */
export function parseCasinoEvent(data: Uint8Array): CasinoGameEvent | null {
  try {
    const reader = new BinaryReader(data);
    return parseOutput(reader);
  } catch (err) {
      logError('Failed to parse casino event:', err);
    return null;
  }
}

/**
 * Parse JSON game log from logs array
 */
export function parseGameLog(log: string): Record<string, unknown> | null {
  const VIDEO_POKER_HAND_NAMES: Record<number, string> = {
    0: 'HIGH_CARD',
    1: 'JACKS_OR_BETTER',
    2: 'TWO_PAIR',
    3: 'THREE_OF_A_KIND',
    4: 'STRAIGHT',
    5: 'FLUSH',
    6: 'FULL_HOUSE',
    7: 'FOUR_OF_A_KIND',
    8: 'STRAIGHT_FLUSH',
    9: 'ROYAL_FLUSH',
  };

  const normalizeVideoPokerLog = (data: Record<string, unknown>): Record<string, unknown> => {
    const hasHand = Object.prototype.hasOwnProperty.call(data, 'hand')
      || Object.prototype.hasOwnProperty.call(data, 'handId');
    const hasMultiplier = Object.prototype.hasOwnProperty.call(data, 'multiplier');
    if (!hasHand || !hasMultiplier) return data;

    const handIdRaw = data.handId;
    const handRaw = data.hand;

    let handFromId: number | null = null;
    if (typeof handIdRaw === 'number' && Number.isFinite(handIdRaw)) {
      handFromId = handIdRaw;
    } else if (typeof handRaw === 'number' && Number.isFinite(handRaw)) {
      handFromId = handRaw;
    }

    if (handFromId !== null) {
      data.handId = handFromId;
      if (typeof data.hand !== 'string') {
        data.hand = VIDEO_POKER_HAND_NAMES[handFromId] ?? data.hand;
      }
    }
    return data;
  };

  try {
    const parsed = JSON.parse(log) as Record<string, unknown>;
    return normalizeVideoPokerLog(parsed);
  } catch {
    // Some games use non-JSON format (e.g., Video Poker uses "RESULT:hand:multiplier")
    if (log.startsWith('RESULT:')) {
      const parts = log.split(':');
      const handId = Number(parts[1]);
      return {
        type: 'RESULT',
        handId,
        hand: VIDEO_POKER_HAND_NAMES[handId] ?? 'UNKNOWN',
        multiplier: parseInt(parts[2], 10),
      };
    }
    return null;
  }
}
