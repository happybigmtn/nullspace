/**
 * Global-table Craps coordinator (single on-chain table).
 *
 * Drives the on-chain global table lifecycle and fans out updates to clients.
 */
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { encodeCrapsBet, CRAPS_BET_TYPES, type CrapsBetName } from '@nullspace/constants/bet-types';
import type { Session } from '../types/session.js';
import type { HandleResult } from '../handlers/base.js';
import type { SubmitClient } from '../backend/http.js';
import { UpdatesClient, type GlobalTableEvent } from '../backend/updates.js';
import { NonceManager } from '../session/nonce.js';
import { createError, ErrorCodes } from '../types/errors.js';
import {
  GameType,
  encodeCasinoRegister,
  encodeGlobalTableFinalize,
  encodeGlobalTableInit,
  encodeGlobalTableLock,
  encodeGlobalTableOpenRound,
  encodeGlobalTableReveal,
  encodeGlobalTableSettle,
  encodeGlobalTableSubmitBets,
  buildTransaction,
  wrapSubmission,
  decodeGlobalTableRoundLookup,
} from '../codec/index.js';
import type { GlobalTableBet } from '../codec/events.js';

const isTruthy = (value: string | undefined): boolean => {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const readMs = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readFloat = (key: string, fallback: number): number => {
  const raw = process.env[key];
  const parsed = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readString = (key: string): string | null => {
  const raw = process.env[key]?.trim();
  return raw ? raw : null;
};

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';

const ENABLED = isTruthy(process.env.GATEWAY_LIVE_TABLE_CRAPS ?? (IS_PROD ? '1' : '0'));
const ALLOW_ADMIN_KEY_ENV = !IS_PROD || isTruthy(process.env.GATEWAY_LIVE_TABLE_ALLOW_ADMIN_ENV);
const ADMIN_KEY_FILE = (process.env.GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE
  ?? process.env.CASINO_ADMIN_PRIVATE_KEY_FILE
  ?? '').trim() || null;

if (IS_PROD && ENABLED && !ALLOW_ADMIN_KEY_ENV && !ADMIN_KEY_FILE) {
  throw new Error(
    'GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE (or CASINO_ADMIN_PRIVATE_KEY_FILE) must be set in production for global table admin access',
  );
}

const CONFIG = {
  enabled: ENABLED,
  tickMs: readMs('GATEWAY_LIVE_TABLE_TICK_MS', 1000),
  broadcastIntervalMs: readMs('GATEWAY_LIVE_TABLE_BROADCAST_MS', 1000),
  broadcastBatchSize: Math.max(1, readInt('GATEWAY_LIVE_TABLE_BROADCAST_BATCH', 1000)),
  presenceUpdateMs: readMs('GATEWAY_LIVE_TABLE_PRESENCE_UPDATE_MS', 2000),
  presenceTimeoutMs: readMs('GATEWAY_LIVE_TABLE_PRESENCE_TIMEOUT_MS', 2000),
  bettingMs: readMs('GATEWAY_LIVE_TABLE_BETTING_MS', 20_000),
  lockMs: readMs('GATEWAY_LIVE_TABLE_LOCK_MS', 2_000),
  payoutMs: readMs('GATEWAY_LIVE_TABLE_PAYOUT_MS', 4_000),
  cooldownMs: readMs('GATEWAY_LIVE_TABLE_COOLDOWN_MS', 4_000),
  minBet: BigInt(readInt('GATEWAY_LIVE_TABLE_MIN_BET', 5)),
  maxBet: BigInt(readInt('GATEWAY_LIVE_TABLE_MAX_BET', 1000)),
  maxBetsPerRound: readInt('GATEWAY_LIVE_TABLE_MAX_BETS_PER_ROUND', 12),
  settleBatchSize: readInt('GATEWAY_LIVE_TABLE_SETTLE_BATCH', 25),
  botBatchSize: readInt('GATEWAY_LIVE_TABLE_BOT_BATCH', 10),
  adminRetryMs: readMs('GATEWAY_LIVE_TABLE_ADMIN_RETRY_MS', 1500),
  adminGraceMs: readMs('GATEWAY_LIVE_TABLE_ADMIN_GRACE_MS', 3000),
  botCount: readInt('GATEWAY_LIVE_TABLE_BOT_COUNT', IS_PROD ? 0 : 100),
  botBetMin: readInt('GATEWAY_LIVE_TABLE_BOT_BET_MIN', 5),
  botBetMax: readInt('GATEWAY_LIVE_TABLE_BOT_BET_MAX', 25),
  botBetsPerRoundMin: readInt('GATEWAY_LIVE_TABLE_BOT_BETS_MIN', 1),
  botBetsPerRoundMax: readInt('GATEWAY_LIVE_TABLE_BOT_BETS_MAX', 3),
  botParticipationRate: Math.max(0, Math.min(1, readFloat('GATEWAY_LIVE_TABLE_BOT_PARTICIPATION', 1))),
};

const PRESENCE_ID = (
  readString('GATEWAY_INSTANCE_ID')
  ?? readString('GATEWAY_PRESENCE_ID')
  ?? readString('HOSTNAME')
  ?? readString('COMPUTERNAME')
  ?? `gateway-${process.pid}`
);
const PRESENCE_TOKEN = readString('GATEWAY_LIVE_TABLE_PRESENCE_TOKEN');

export interface LiveCrapsBetInput {
  type: string | number;
  amount: number;
  target?: number;
}

interface LiveTableDependencies {
  submitClient: SubmitClient;
  nonceManager: NonceManager;
  backendUrl: string;
  origin?: string;
}

interface BotState {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
  registered: boolean;
  balance?: bigint;
  lastBetRoundId?: bigint;
}

interface SignerState {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
}

interface StoredBet {
  betType: number;
  target: number;
  amount: bigint;
}

type LiveTablePhase = 'betting' | 'locked' | 'rolling' | 'payout' | 'cooldown';

const betTypeToView = (
  betType: number,
  target: number
): { type: string; target?: number } => {
  switch (betType) {
    case 0:
      return { type: 'PASS' };
    case 1:
      return { type: 'DONT_PASS' };
    case 2:
      return { type: 'COME' };
    case 3:
      return { type: 'DONT_COME' };
    case 4:
      return { type: 'FIELD' };
    case 5:
      return { type: 'YES', target };
    case 6:
      return { type: 'NO', target };
    case 7:
      return { type: 'NEXT', target };
    case 8:
      return { type: 'HARDWAY', target: 4 };
    case 9:
      return { type: 'HARDWAY', target: 6 };
    case 10:
      return { type: 'HARDWAY', target: 8 };
    case 11:
      return { type: 'HARDWAY', target: 10 };
    case 12:
      return { type: 'FIRE' };
    case 15:
      return { type: 'ATS_SMALL' };
    case 16:
      return { type: 'ATS_TALL' };
    case 17:
      return { type: 'ATS_ALL' };
    case 18:
      return { type: 'MUGGSY' };
    case 19:
      return { type: 'DIFF_DOUBLES' };
    case 20:
      return { type: 'RIDE_LINE' };
    case 21:
      return { type: 'REPLAY' };
    case 22:
      return { type: 'HOT_ROLLER' };
    default:
      return { type: `BET_${betType}` };
  }
};

const mapPhase = (phase: number): LiveTablePhase => {
  switch (phase) {
    case 0:
      return 'betting';
    case 1:
      return 'locked';
    case 2:
      return 'rolling';
    case 3:
      return 'payout';
    case 4:
      return 'cooldown';
    default:
      return 'betting';
  }
};

const parseHexKey = (raw?: string): Uint8Array | null => {
  if (!raw) return null;
  const cleaned = raw.startsWith('0x') ? raw.slice(2) : raw;
  if (cleaned.length !== 64) return null;
  try {
    return Uint8Array.from(Buffer.from(cleaned, 'hex'));
  } catch {
    return null;
  }
};

const YES_NO_TARGETS = [4, 5, 6, 8, 9, 10];
const NEXT_TARGETS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const HARDWAY_TARGETS = [4, 6, 8, 10];
const BOT_BET_TYPES: CrapsBetName[] = [
  'PASS',
  'DONT_PASS',
  'COME',
  'DONT_COME',
  'FIELD',
  'YES',
  'NO',
  'NEXT',
  'HARDWAY',
  'FIRE',
  'ATS_SMALL',
  'ATS_TALL',
  'ATS_ALL',
  'MUGGSY',
  'DIFF_DOUBLES',
  'RIDE_LINE',
  'REPLAY',
  'HOT_ROLLER',
];

const betKey = (betType: number, target: number): string => `${betType}:${target}`;

const toNumber = (value: bigint | number): number => (
  typeof value === 'bigint' ? Number(value) : value
);

export class OnchainCrapsTable {
  private enabled = CONFIG.enabled;
  private deps: LiveTableDependencies | null = null;
  private sessions = new Map<string, Session>();
  private sessionsByKey = new Map<string, Set<string>>();
  private updatesClient: UpdatesClient | null = null;
  private startPromise: Promise<void> | null = null;
  private started = false;

  private admin: SignerState | null = null;
  private roundId = 0n;
  private phase: LiveTablePhase = 'cooldown';
  private phaseEndsAt = 0;
  private point: number | null = null;
  private dice: [number, number] | null = null;

  private totals = new Map<string, StoredBet>();
  private playerBets = new Map<string, Map<string, StoredBet>>();
  private activePlayers = new Set<string>();
  private pendingSettlements = new Set<string>();
  private settleInFlight = new Set<string>();

  private bots: BotState[] = [];
  private botsByKey = new Map<string, BotState>();
  private botQueue: string[] = [];

  private ticker: ReturnType<typeof setInterval> | null = null;
  private tickRunning = false;
  private lastBroadcastAt = 0;
  private broadcastInFlight = false;
  private broadcastQueued = false;
  private lastPresenceAt = 0;
  private presenceInFlight = false;
  private globalPlayerCount: number | null = null;

  private lastAdminAttempt = {
    open: 0,
    lock: 0,
    reveal: 0,
    finalize: 0,
  };

  configure(deps: LiveTableDependencies): void {
    this.deps = deps;
    if (this.enabled) {
      void this.ensureStarted().catch((err) => {
        console.error('[GlobalTable] Failed to start on-chain table:', err);
      });
    }
  }

  async join(session: Session): Promise<HandleResult> {
    if (!this.enabled) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_DISABLED'),
      };
    }

    this.sessions.set(session.id, session);
    this.trackSessionKey(session);

    try {
      await this.ensureStarted();
    } catch (err) {
      this.removeSession(session);
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_UNAVAILABLE'),
      };
    }

    this.sendStateToSession(session);
    return { success: true };
  }

  async leave(session: Session): Promise<HandleResult> {
    this.removeSession(session);
    return { success: true };
  }

  removeSession(session: Session): void {
    this.sessions.delete(session.id);
    this.untrackSessionKey(session);
  }

  async placeBets(session: Session, bets: LiveCrapsBetInput[]): Promise<HandleResult> {
    if (!this.enabled) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_DISABLED'),
      };
    }

    if (!this.sessions.has(session.id)) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'NOT_SUBSCRIBED'),
      };
    }

    if (!session.registered) {
      return {
        success: false,
        error: createError(ErrorCodes.NOT_REGISTERED, 'Player not registered'),
      };
    }

    try {
      await this.ensureStarted();
    } catch (err) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_UNAVAILABLE'),
      };
    }

    if (this.roundId === 0n) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_MESSAGE, 'LIVE_TABLE_NOT_READY'),
      };
    }

    let normalized: { betType: number; target: number; amount: bigint }[] = [];
    try {
      normalized = this.normalizeBets(bets);
    } catch (err) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, err instanceof Error ? err.message : 'Invalid bet'),
      };
    }

    if (normalized.length === 0) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'No bets submitted'),
      };
    }

    if (normalized.length > CONFIG.maxBetsPerRound) {
      return {
        success: false,
        error: createError(ErrorCodes.INVALID_BET, 'Too many bets submitted'),
      };
    }

    const instruction = encodeGlobalTableSubmitBets(
      GameType.Craps,
      this.roundId,
      normalized
    );

    const accepted = await this.submitInstruction(session, instruction);
    if (!accepted) {
      return {
        success: false,
        error: createError(ErrorCodes.TRANSACTION_REJECTED, 'Bet submission rejected'),
      };
    }

    this.sendConfirmation(session.publicKeyHex, 'pending', 'Awaiting on-chain confirmation', session.balance, this.roundId);
    return { success: true };
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) {
      await this.startPromise;
      return;
    }
    if (!this.deps) {
      throw new Error('Live table dependencies not configured');
    }

    this.startPromise = (async () => {
      const admin = this.buildAdminSigner();
      if (!admin) {
        throw new Error('Missing admin key');
      }
      this.admin = admin;

      await this.deps!.nonceManager.syncFromBackend(admin.publicKeyHex, this.deps!.backendUrl)
        .catch(() => undefined);

      await this.connectUpdates();
      await this.bootstrapRoundFromState();
      await this.initGlobalTable();
      if (this.roundId === 0n) {
        await this.attemptOpenRound();
      }
      this.ensureBots();
      void this.registerBots();

      if (!this.ticker) {
        this.ticker = setInterval(() => {
          void this.tick();
        }, CONFIG.tickMs);
      }

      this.started = true;
    })();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private buildAdminSigner(): SignerState | null {
    if (this.admin) return this.admin;
    const envKeyRaw = (process.env.GATEWAY_LIVE_TABLE_ADMIN_KEY
      ?? process.env.CASINO_ADMIN_PRIVATE_KEY_HEX
      ?? '').trim();
    if (envKeyRaw && !ALLOW_ADMIN_KEY_ENV) {
      throw new Error(
        'Global table admin key env vars are disabled in production. Use GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE or set GATEWAY_LIVE_TABLE_ALLOW_ADMIN_ENV=1.',
      );
    }

    let key: Uint8Array | null = null;
    if (ADMIN_KEY_FILE) {
      try {
        const raw = readFileSync(ADMIN_KEY_FILE, 'utf8').trim();
        key = parseHexKey(raw) ?? null;
      } catch {
        key = null;
      }
    }
    if (!key && ALLOW_ADMIN_KEY_ENV) {
      key = parseHexKey(envKeyRaw);
    }

    if (!key) return null;

    const publicKey = ed25519.getPublicKey(key);
    const publicKeyHex = Buffer.from(publicKey).toString('hex');
    this.admin = { privateKey: key, publicKey, publicKeyHex };
    return this.admin;
  }

  private ensureBots(): void {
    if (CONFIG.botCount <= 0 || this.bots.length > 0) return;
    for (let i = 0; i < CONFIG.botCount; i += 1) {
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);
      const publicKeyHex = Buffer.from(publicKey).toString('hex');
      const bot: BotState = {
        privateKey,
        publicKey,
        publicKeyHex,
        registered: false,
        balance: 1000n,
      };
      this.bots.push(bot);
      this.botsByKey.set(publicKeyHex, bot);
    }
  }

  private async registerBots(): Promise<void> {
    if (!this.deps) return;
    for (const bot of this.bots) {
      if (!this.enabled) break;
      if (bot.registered) continue;
      await this.registerBot(bot);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  private async registerBot(bot: BotState): Promise<boolean> {
    if (!this.deps || bot.registered) return bot.registered;

    await this.deps.nonceManager.syncFromBackend(bot.publicKeyHex, this.deps.backendUrl)
      .catch(() => undefined);

    const name = `bot-${bot.publicKeyHex.slice(0, 6)}`;
    const instruction = encodeCasinoRegister(name);
    const accepted = await this.submitInstruction(bot, instruction);
    if (accepted) {
      bot.registered = true;
      bot.balance = bot.balance ?? 1000n;
    }
    return accepted;
  }

  private async connectUpdates(): Promise<void> {
    if (this.updatesClient) return;
    if (!this.deps) throw new Error('Missing dependencies');
    const updates = new UpdatesClient(this.deps.backendUrl, this.deps.origin);
    updates.on('globalTableEvent', this.handleGlobalTableEvent);
    updates.on('error', (err) => {
      console.error('[GlobalTable] Updates client error:', err);
    });
    this.updatesClient = updates;
    await updates.connectForAll();
  }

  private async bootstrapRoundFromState(): Promise<void> {
    if (!this.deps) return;
    try {
      const keyBytes = new Uint8Array([30, GameType.Craps]);
      const digestHex = bytesToHex(sha256(keyBytes));
      const base = this.deps.backendUrl.replace(/\/$/, '');
      const origin = this.deps.origin ?? 'http://localhost:9010';
      const response = await fetch(`${base}/state/${digestHex}`, {
        headers: { Origin: origin },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return;
      const data = new Uint8Array(await response.arrayBuffer());
      const round = decodeGlobalTableRoundLookup(data);
      if (round) {
        this.applyRoundUpdate(round);
      }
    } catch {
      // Ignore bootstrap failures; UpdatesClient will sync on new events.
    }
  }

  private async initGlobalTable(): Promise<void> {
    if (!this.admin) return;
    const instruction = encodeGlobalTableInit({
      gameType: GameType.Craps,
      bettingMs: CONFIG.bettingMs,
      lockMs: CONFIG.lockMs,
      payoutMs: CONFIG.payoutMs,
      cooldownMs: CONFIG.cooldownMs,
      minBet: CONFIG.minBet,
      maxBet: CONFIG.maxBet,
      maxBetsPerRound: CONFIG.maxBetsPerRound,
    });

    await this.submitInstruction(this.admin, instruction);
  }

  private async tick(): Promise<void> {
    if (this.tickRunning) return;
    this.tickRunning = true;
    try {
      const now = Date.now();
      const graceMs = CONFIG.adminGraceMs;

      if (this.phase === 'betting' && now >= this.phaseEndsAt + graceMs) {
        await this.attemptLockRound();
      } else if (this.phase === 'locked' && now >= this.phaseEndsAt + graceMs) {
        await this.attemptRevealRound();
      } else if (this.phase === 'payout' && now >= this.phaseEndsAt + graceMs) {
        await this.attemptFinalizeRound();
      } else if (this.phase === 'cooldown' && now >= this.phaseEndsAt + graceMs) {
        await this.attemptOpenRound();
      }

      await this.processSettlements();
      await this.processBotBets();
      void this.syncPresence();

      if (this.sessions.size > 0) {
        this.requestBroadcast();
      }
    } finally {
      this.tickRunning = false;
    }
  }

  private shouldAttempt(action: keyof typeof this.lastAdminAttempt): boolean {
    const now = Date.now();
    if (now - this.lastAdminAttempt[action] < CONFIG.adminRetryMs) {
      return false;
    }
    this.lastAdminAttempt[action] = now;
    return true;
  }

  private async attemptOpenRound(): Promise<void> {
    if (!this.admin || !this.shouldAttempt('open')) return;
    if (this.pendingSettlements.size > 0 || this.settleInFlight.size > 0) {
      return;
    }
    const instruction = encodeGlobalTableOpenRound(GameType.Craps);
    await this.submitInstruction(this.admin, instruction);
  }

  private async attemptLockRound(): Promise<void> {
    if (!this.admin || !this.shouldAttempt('lock')) return;
    if (this.roundId === 0n) return;
    const instruction = encodeGlobalTableLock(GameType.Craps, this.roundId);
    await this.submitInstruction(this.admin, instruction);
  }

  private async attemptRevealRound(): Promise<void> {
    if (!this.admin || !this.shouldAttempt('reveal')) return;
    if (this.roundId === 0n) return;
    const instruction = encodeGlobalTableReveal(GameType.Craps, this.roundId);
    await this.submitInstruction(this.admin, instruction);
  }

  private async attemptFinalizeRound(): Promise<void> {
    if (!this.admin || !this.shouldAttempt('finalize')) return;
    if (this.roundId === 0n) return;
    const instruction = encodeGlobalTableFinalize(GameType.Craps, this.roundId);
    await this.submitInstruction(this.admin, instruction);
  }

  private async processSettlements(): Promise<void> {
    if (this.pendingSettlements.size === 0) return;
    if (this.roundId === 0n) return;

    const keys = Array.from(this.pendingSettlements).slice(0, CONFIG.settleBatchSize);
    for (const key of keys) {
      if (this.settleInFlight.has(key)) continue;
      const signer = this.findSigner(key);
      if (!signer) {
        this.pendingSettlements.delete(key);
        continue;
      }
      const instruction = encodeGlobalTableSettle(GameType.Craps, this.roundId);
      const accepted = await this.submitInstruction(signer, instruction);
      if (accepted) {
        this.pendingSettlements.delete(key);
        this.settleInFlight.add(key);
      }
    }
  }

  private async processBotBets(): Promise<void> {
    if (this.phase !== 'betting') return;
    if (this.botQueue.length === 0) return;
    if (this.roundId === 0n) return;

    const batch = this.botQueue.splice(0, CONFIG.botBatchSize);
    for (const key of batch) {
      const bot = this.botsByKey.get(key);
      if (!bot) continue;

      if (!bot.registered) {
        const registered = await this.registerBot(bot);
        if (!registered) {
          this.botQueue.push(key);
          continue;
        }
      }

      const bets = this.pickBotBets(bot);
      if (bets.length === 0) continue;
      const instruction = encodeGlobalTableSubmitBets(GameType.Craps, this.roundId, bets);
      const accepted = await this.submitInstruction(bot, instruction);
      if (accepted) {
        bot.lastBetRoundId = this.roundId;
      }
    }
  }

  private handleGlobalTableEvent = (event: GlobalTableEvent): void => {
    switch (event.type) {
      case 'round_opened': {
        this.applyRoundUpdate(event.round);
        this.botQueue = this.bots.map((bot) => bot.publicKeyHex);
        this.requestBroadcast(true);
        break;
      }
      case 'locked': {
        this.roundId = event.roundId;
        this.setPhase('locked', CONFIG.lockMs);
        this.requestBroadcast(true);
        break;
      }
      case 'outcome': {
        this.applyRoundUpdate(event.round);
        this.pendingSettlements = new Set(this.activePlayers);
        this.settleInFlight.clear();
        this.requestBroadcast(true);
        break;
      }
      case 'finalized': {
        this.roundId = event.roundId;
        this.setPhase('cooldown', CONFIG.cooldownMs);
        this.requestBroadcast(true);
        break;
      }
      case 'bet_accepted': {
        const playerHex = Buffer.from(event.player).toString('hex');
        if (this.roundId !== event.roundId) {
          this.roundId = event.roundId;
          if (this.phase !== 'betting') {
            this.setPhase('betting', CONFIG.bettingMs);
          }
        }
        this.activePlayers.add(playerHex);
        this.addBetsToMap(this.playerBets, playerHex, event.bets);
        this.addBetsToTotals(event.bets);
        if (event.balanceSnapshot?.chips !== undefined) {
          this.updateSessionsBalance(playerHex, event.balanceSnapshot.chips);
          const bot = this.botsByKey.get(playerHex);
          if (bot) bot.balance = event.balanceSnapshot.chips;
        }
        this.sendConfirmation(
          playerHex,
          'confirmed',
          'On-chain bet accepted',
          event.balanceSnapshot?.chips,
          event.roundId,
        );
        this.requestBroadcast(true);
        break;
      }
      case 'bet_rejected': {
        const playerHex = Buffer.from(event.player).toString('hex');
        this.sendConfirmation(
          playerHex,
          'failed',
          event.message || 'Bet rejected',
        );
        break;
      }
      case 'player_settled': {
        const playerHex = Buffer.from(event.player).toString('hex');
        const before = this.playerBets.get(playerHex) ?? new Map<string, StoredBet>();
        const after = this.buildBetMap(event.myBets);
        this.playerBets.set(playerHex, after);
        this.applyTotalsDelta(before, after);
        this.pendingSettlements.delete(playerHex);
        this.settleInFlight.delete(playerHex);
        if (event.balanceSnapshot?.chips !== undefined) {
          this.updateSessionsBalance(playerHex, event.balanceSnapshot.chips);
          const bot = this.botsByKey.get(playerHex);
          if (bot) bot.balance = event.balanceSnapshot.chips;
        }
        this.sendLiveResult(playerHex, event.roundId, event.payout, event.myBets);
        this.requestBroadcast(true);
        break;
      }
      default:
        break;
    }
  };

  private applyRoundUpdate(round: {
    roundId: bigint;
    phase: number;
    phaseEndsAtMs: bigint;
    mainPoint: number;
    d1: number;
    d2: number;
    totals: { betType: number; target: number; amount: bigint }[];
  }): void {
    this.roundId = round.roundId;
    const phase = mapPhase(round.phase);
    this.setPhase(phase, this.phaseDuration(phase));
    this.point = round.mainPoint > 0 ? round.mainPoint : null;
    this.dice = round.d1 > 0 && round.d2 > 0 ? [round.d1, round.d2] : null;
    this.setTotalsFromRound(round.totals);
  }

  private setPhase(phase: LiveTablePhase, durationMs: number): void {
    this.phase = phase;
    this.phaseEndsAt = Date.now() + durationMs;
  }

  private phaseDuration(phase: LiveTablePhase): number {
    switch (phase) {
      case 'betting':
        return CONFIG.bettingMs;
      case 'locked':
        return CONFIG.lockMs;
      case 'rolling':
        return CONFIG.lockMs;
      case 'payout':
        return CONFIG.payoutMs;
      case 'cooldown':
        return CONFIG.cooldownMs;
      default:
        return CONFIG.bettingMs;
    }
  }

  private setTotalsFromRound(
    totals: { betType: number; target: number; amount: bigint }[]
  ): void {
    this.totals.clear();
    for (const total of totals) {
      this.totals.set(betKey(total.betType, total.target), {
        betType: total.betType,
        target: total.target,
        amount: total.amount,
      });
    }
  }

  private addBetsToTotals(bets: GlobalTableBet[]): void {
    for (const bet of bets) {
      this.adjustTotals(bet.betType, bet.target, bet.amount);
    }
  }

  private adjustTotals(betType: number, target: number, delta: bigint): void {
    const key = betKey(betType, target);
    const existing = this.totals.get(key);
    const nextAmount = (existing?.amount ?? 0n) + delta;
    if (nextAmount <= 0n) {
      this.totals.delete(key);
      return;
    }
    this.totals.set(key, { betType, target, amount: nextAmount });
  }

  private addBetsToMap(
    map: Map<string, Map<string, StoredBet>>,
    playerHex: string,
    bets: GlobalTableBet[],
  ): void {
    const existing = map.get(playerHex) ?? new Map<string, StoredBet>();
    for (const bet of bets) {
      const key = betKey(bet.betType, bet.target);
      const current = existing.get(key);
      const nextAmount = (current?.amount ?? 0n) + bet.amount;
      existing.set(key, {
        betType: bet.betType,
        target: bet.target,
        amount: nextAmount,
      });
    }
    map.set(playerHex, existing);
  }

  private buildBetMap(bets: GlobalTableBet[]): Map<string, StoredBet> {
    const result = new Map<string, StoredBet>();
    for (const bet of bets) {
      result.set(betKey(bet.betType, bet.target), {
        betType: bet.betType,
        target: bet.target,
        amount: bet.amount,
      });
    }
    return result;
  }

  private applyTotalsDelta(before: Map<string, StoredBet>, after: Map<string, StoredBet>): void {
    const keys = new Set<string>();
    for (const key of before.keys()) keys.add(key);
    for (const key of after.keys()) keys.add(key);

    for (const key of keys) {
      const beforeBet = before.get(key);
      const afterBet = after.get(key);
      const beforeAmount = beforeBet?.amount ?? 0n;
      const afterAmount = afterBet?.amount ?? 0n;
      const delta = afterAmount - beforeAmount;
      if (delta === 0n) continue;
      const betType = afterBet?.betType ?? beforeBet?.betType ?? 0;
      const target = afterBet?.target ?? beforeBet?.target ?? 0;
      this.adjustTotals(betType, target, delta);
    }
  }

  private requestBroadcast(force = false): void {
    if (this.sessions.size === 0) return;
    const now = Date.now();
    if (!force && now - this.lastBroadcastAt < CONFIG.broadcastIntervalMs) {
      return;
    }
    if (this.broadcastInFlight) {
      this.broadcastQueued = true;
      return;
    }
    this.lastBroadcastAt = now;
    this.broadcastInFlight = true;
    void this.flushBroadcast();
  }

  private async syncPresence(): Promise<void> {
    if (!this.deps) return;
    if (CONFIG.presenceUpdateMs <= 0) return;
    if (!PRESENCE_ID) return;
    const now = Date.now();
    if (now - this.lastPresenceAt < CONFIG.presenceUpdateMs) return;
    if (this.presenceInFlight) return;
    this.lastPresenceAt = now;
    this.presenceInFlight = true;

    try {
      const origin = this.deps.origin ?? 'http://localhost:9010';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Origin: origin,
      };
      if (PRESENCE_TOKEN) {
        headers['x-presence-token'] = PRESENCE_TOKEN;
      }
      const response = await fetch(`${this.deps.backendUrl.replace(/\/$/, '')}/presence/global-table`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          gateway_id: PRESENCE_ID,
          player_count: this.sessionsByKey.size,
        }),
        signal: AbortSignal.timeout(CONFIG.presenceTimeoutMs),
      });
      if (!response.ok) return;
      const data = await response.json().catch(() => null) as { total_players?: number } | null;
      if (data && typeof data.total_players === 'number') {
        this.globalPlayerCount = data.total_players;
      }
    } catch {
      // Ignore presence sync errors; we'll retry on the next tick.
    } finally {
      this.presenceInFlight = false;
    }
  }

  private async flushBroadcast(): Promise<void> {
    try {
      const base = this.buildStatePayload();
      const sessions = Array.from(this.sessions.values());
      const payloadByKey = new Map<string, string>();
      const batchSize = CONFIG.broadcastBatchSize;
      let index = 0;

      await new Promise<void>((resolve) => {
        const sendBatch = () => {
          const end = Math.min(index + batchSize, sessions.length);
          for (; index < end; index += 1) {
            const session = sessions[index];
            if (!session) continue;
            let payloadJson = payloadByKey.get(session.publicKeyHex);
            if (!payloadJson) {
              const myBets = this.serializePlayerBets(session.publicKeyHex);
              session.balanceSeq++;
              const payload: Record<string, unknown> = {
                ...base,
                balance: session.balance.toString(),
                balanceSeq: session.balanceSeq.toString(),
              };
              if (myBets.length > 0) {
                payload.myBets = myBets;
              }
              payloadJson = JSON.stringify(payload);
              payloadByKey.set(session.publicKeyHex, payloadJson);
            }
            this.sendJsonToSession(session, payloadJson);
          }
          if (index < sessions.length) {
            setImmediate(sendBatch);
          } else {
            resolve();
          }
        };
        sendBatch();
      });
    } finally {
      this.broadcastInFlight = false;
      if (this.broadcastQueued) {
        this.broadcastQueued = false;
        this.requestBroadcast(true);
      }
    }
  }

  private sendStateToSession(session: Session): void {
    const myBets = this.serializePlayerBets(session.publicKeyHex);
    session.balanceSeq++;
    const payload: Record<string, unknown> = {
      ...this.buildStatePayload(),
      balance: session.balance.toString(),
      balanceSeq: session.balanceSeq.toString(),
    };
    if (myBets.length > 0) {
      payload.myBets = myBets;
    }
    this.sendToSession(session, payload);
  }

  private buildStatePayload(): Record<string, unknown> {
    const timeRemainingMs = Math.max(0, this.phaseEndsAt - Date.now());
    const payload: Record<string, unknown> = {
      type: 'live_table_state',
      game: 'craps',
      roundId: Number(this.roundId),
      phase: this.phase,
      timeRemainingMs,
      playerCount: this.globalPlayerCount ?? this.sessionsByKey.size,
      tableTotals: this.serializeTotals(),
      source: 'onchain',
    };
    if (this.point !== null) payload.point = this.point;
    if (this.dice) payload.dice = this.dice;
    return payload;
  }

  private serializeTotals(): Array<{ type: string; amount: number; target?: number }> {
    const output: Array<{ type: string; amount: number; target?: number }> = [];
    for (const total of this.totals.values()) {
      const view = betTypeToView(total.betType, total.target);
      const entry: { type: string; amount: number; target?: number } = {
        type: view.type,
        amount: toNumber(total.amount),
      };
      if (view.target !== undefined) entry.target = view.target;
      output.push(entry);
    }
    return output;
  }

  private serializePlayerBets(playerHex: string): Array<{ type: string; amount: number; target?: number }> {
    const map = this.playerBets.get(playerHex);
    if (!map) return [];
    const output: Array<{ type: string; amount: number; target?: number }> = [];
    for (const bet of map.values()) {
      if (bet.amount <= 0n) continue;
      const view = betTypeToView(bet.betType, bet.target);
      const entry: { type: string; amount: number; target?: number } = {
        type: view.type,
        amount: toNumber(bet.amount),
      };
      if (view.target !== undefined) entry.target = view.target;
      output.push(entry);
    }
    return output;
  }

  private sendLiveResult(
    playerHex: string,
    roundId: bigint,
    payout: bigint,
    myBets: GlobalTableBet[],
  ): void {
    const dice = this.dice ?? [0, 0];
    const total = dice[0] + dice[1];
    const payload: Record<string, unknown> = {
      type: 'live_table_result',
      game: 'craps',
      roundId: Number(roundId),
      dice,
      total,
      payout: toNumber(payout),
      netWin: toNumber(payout),
      myBets: this.serializeBets(myBets),
      source: 'onchain',
    };
    if (this.point !== null) payload.point = this.point;
    const session = this.findSession(playerHex);
    if (session) payload.balance = session.balance.toString();

    this.sendToPlayer(playerHex, payload);
  }

  private serializeBets(bets: GlobalTableBet[]): Array<{ type: string; amount: number; target?: number }> {
    const output: Array<{ type: string; amount: number; target?: number }> = [];
    for (const bet of bets) {
      if (bet.amount <= 0n) continue;
      const view = betTypeToView(bet.betType, bet.target);
      const entry: { type: string; amount: number; target?: number } = {
        type: view.type,
        amount: toNumber(bet.amount),
      };
      if (view.target !== undefined) entry.target = view.target;
      output.push(entry);
    }
    return output;
  }

  private sendConfirmation(
    playerHex: string,
    status: 'pending' | 'confirmed' | 'failed',
    message?: string,
    balance?: bigint,
    roundId?: bigint,
  ): void {
    const payload: Record<string, unknown> = {
      type: 'live_table_confirmation',
      game: 'craps',
      status,
      source: 'onchain',
      roundId: Number(roundId ?? this.roundId),
    };
    if (message) payload.message = message;
    if (balance !== undefined) payload.balance = balance.toString();
    this.sendToPlayer(playerHex, payload);
  }

  private sendToPlayer(playerHex: string, payload: Record<string, unknown>): void {
    const ids = this.sessionsByKey.get(playerHex);
    if (!ids) return;
    for (const id of ids.values()) {
      const session = this.sessions.get(id);
      if (session) this.sendToSession(session, payload);
    }
  }

  private sendJsonToSession(session: Session, payloadJson: string): void {
    if (session.ws.readyState === session.ws.OPEN) {
      session.ws.send(payloadJson);
    } else {
      this.removeSession(session);
    }
  }

  private sendToSession(session: Session, payload: Record<string, unknown>): void {
    if (session.ws.readyState === session.ws.OPEN) {
      session.ws.send(JSON.stringify(payload));
    } else {
      this.removeSession(session);
    }
  }

  private updateSessionsBalance(playerHex: string, balance: bigint): void {
    const ids = this.sessionsByKey.get(playerHex);
    if (!ids) return;
    for (const id of ids.values()) {
      const session = this.sessions.get(id);
      if (session) {
        session.balance = balance;
      }
    }
  }

  private trackSessionKey(session: Session): void {
    const existing = this.sessionsByKey.get(session.publicKeyHex) ?? new Set<string>();
    existing.add(session.id);
    this.sessionsByKey.set(session.publicKeyHex, existing);
  }

  private untrackSessionKey(session: Session): void {
    const existing = this.sessionsByKey.get(session.publicKeyHex);
    if (!existing) return;
    existing.delete(session.id);
    if (existing.size === 0) {
      this.sessionsByKey.delete(session.publicKeyHex);
    }
  }

  private normalizeBets(
    bets: LiveCrapsBetInput[]
  ): { betType: number; target: number; amount: bigint }[] {
    const output: { betType: number; target: number; amount: bigint }[] = [];
    for (const bet of bets) {
      // Validate bet amount before BigInt conversion to prevent crashes
      if (typeof bet.amount !== 'number' || !Number.isFinite(bet.amount)) {
        throw new Error('Bet amount must be a valid finite number');
      }
      if (bet.amount < 0) {
        throw new Error('Bet amount cannot be negative');
      }
      if (bet.amount > Number.MAX_SAFE_INTEGER) {
        throw new Error('Bet amount exceeds maximum safe integer');
      }

      const amount = BigInt(Math.floor(bet.amount));
      if (amount <= 0n) continue;
      if (amount < CONFIG.minBet) {
        throw new Error(`Bet below minimum (${CONFIG.minBet.toString()})`);
      }
      if (amount > CONFIG.maxBet) {
        throw new Error(`Bet exceeds maximum (${CONFIG.maxBet.toString()})`);
      }

      let betType: number;
      let target: number;

      if (typeof bet.type === 'string') {
        const key = bet.type.toUpperCase();
        if (!(key in CRAPS_BET_TYPES)) {
          throw new Error(`Unknown bet type: ${bet.type}`);
        }
        const encoded = encodeCrapsBet(key as CrapsBetName, bet.target);
        betType = encoded.betType;
        target = encoded.target;
      } else {
        betType = bet.type;
        target = bet.target ?? 0;
      }

      output.push({ betType, target, amount });
    }
    return output;
  }

  private pickBotBets(bot: BotState): { betType: number; target: number; amount: bigint }[] {
    if (bot.lastBetRoundId === this.roundId) return [];
    if (Math.random() > CONFIG.botParticipationRate) return [];
    const betCount = Math.max(
      CONFIG.botBetsPerRoundMin,
      Math.min(
        CONFIG.botBetsPerRoundMax,
        CONFIG.botBetsPerRoundMin + Math.floor(Math.random() * (CONFIG.botBetsPerRoundMax - CONFIG.botBetsPerRoundMin + 1)),
      ),
    );
    const bets: { betType: number; target: number; amount: bigint }[] = [];
    for (let i = 0; i < betCount; i += 1) {
      const betName = BOT_BET_TYPES[Math.floor(Math.random() * BOT_BET_TYPES.length)] ?? 'PASS';
      let target: number | undefined;
      if (betName === 'YES' || betName === 'NO') {
        target = YES_NO_TARGETS[Math.floor(Math.random() * YES_NO_TARGETS.length)];
      } else if (betName === 'NEXT') {
        target = NEXT_TARGETS[Math.floor(Math.random() * NEXT_TARGETS.length)];
      } else if (betName === 'HARDWAY') {
        target = HARDWAY_TARGETS[Math.floor(Math.random() * HARDWAY_TARGETS.length)];
      }
      const amountRaw = CONFIG.botBetMin + Math.floor(Math.random() * (CONFIG.botBetMax - CONFIG.botBetMin + 1));
      const amount = BigInt(amountRaw);
      if (bot.balance !== undefined && amount > bot.balance) continue;

      const encoded = encodeCrapsBet(betName, target);
      bets.push({ betType: encoded.betType, target: encoded.target, amount });
    }
    return bets;
  }

  private findSigner(publicKeyHex: string): SignerState | null {
    const ids = this.sessionsByKey.get(publicKeyHex);
    if (ids) {
      for (const id of ids.values()) {
        const session = this.sessions.get(id);
        if (session) return session;
      }
    }
    const bot = this.botsByKey.get(publicKeyHex);
    if (bot) return bot;
    return null;
  }

  private findSession(publicKeyHex: string): Session | null {
    const ids = this.sessionsByKey.get(publicKeyHex);
    if (!ids) return null;
    for (const id of ids.values()) {
      const session = this.sessions.get(id);
      if (session) return session;
    }
    return null;
  }

  private async submitInstruction(signer: SignerState, instruction: Uint8Array): Promise<boolean> {
    if (!this.deps) return false;
    const { submitClient, nonceManager, backendUrl } = this.deps;

    return nonceManager.withLock(signer.publicKeyHex, async (nonce) => {
      const tx = buildTransaction(nonce, instruction, signer.privateKey);
      const submission = wrapSubmission(tx);
      const result = await submitClient.submit(submission);

      if (result.accepted) {
        nonceManager.setCurrentNonce(signer.publicKeyHex, nonce + 1n);
        return true;
      }

      if (result.error && nonceManager.handleRejection(signer.publicKeyHex, result.error)) {
        const synced = await nonceManager.syncFromBackend(signer.publicKeyHex, backendUrl);
        if (synced) {
          const retryNonce = nonceManager.getCurrentNonce(signer.publicKeyHex);
          const retryTx = buildTransaction(retryNonce, instruction, signer.privateKey);
          const retrySubmission = wrapSubmission(retryTx);
          const retryResult = await submitClient.submit(retrySubmission);
          if (retryResult.accepted) {
            nonceManager.setCurrentNonce(signer.publicKeyHex, retryNonce + 1n);
            return true;
          }
        }
      }

      return false;
    });
  }
}

export const crapsLiveTable = new OnchainCrapsTable();
