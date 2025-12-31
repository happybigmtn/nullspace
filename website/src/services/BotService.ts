/**
 * BotService - Spawns simulated bots that play against the chain during tournaments
 *
 * Bots make random bets on all casino games at configurable intervals.
 * This creates realistic tournament competition for testing.
 */

import { WasmWrapper } from '../api/wasm.js';
import { logDebug } from '../utils/logger';
import { validateBetAmount } from './games/validation';

export interface BotConfig {
  enabled: boolean;
  numBots: number;
  betIntervalMs: number;
  randomizeInterval: boolean;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  enabled: true,
  numBots: 300,
  betIntervalMs: 5000,
  randomizeInterval: true,
};

interface BotState {
  id: number;
  name: string;
  wasm: WasmWrapper;
  nonce: number;
  sessionCounter: number;
  isActive: boolean;
  loopStarted: boolean;
  profile: BotProfile;
}

type BotProfile = {
  baseBet: number;
  volatility: number; // 0..1 (higher = more aggressive / more sidebets / more multi-bet rounds)
  favoriteGames: number[];
};

// Game type enum matching the chain
const GameType = {
  Baccarat: 0,
  Blackjack: 1,
  CasinoWar: 2,
  Craps: 3,
  VideoPoker: 4,
  HiLo: 5,
  Roulette: 6,
  SicBo: 7,
  ThreeCard: 8,
  UltimateHoldem: 9,
};

const ALL_GAMES = [
  GameType.Baccarat,
  GameType.Blackjack,
  GameType.CasinoWar,
  GameType.Craps,
  GameType.VideoPoker,
  GameType.HiLo,
  GameType.Roulette,
  GameType.SicBo,
  GameType.ThreeCard,
  GameType.UltimateHoldem,
];

export class BotService {
  private bots: BotState[] = [];
  private config: BotConfig = DEFAULT_BOT_CONFIG;
  private isRunning = false;
  private intervalHandles: number[] = [];
  private baseUrl: string;
  private identityHex: string;
  private onStatusUpdate?: (status: BotServiceStatus) => void;
  private preparedTournamentId: number | null = null;
  private prepareGeneration = 0;
  private totalSubmitted = 0;

  constructor(baseUrl: string, identityHex: string) {
    this.baseUrl = baseUrl;
    this.identityHex = identityHex;
  }

  setConfig(config: BotConfig) {
    this.config = config;
  }

  setStatusCallback(callback: (status: BotServiceStatus) => void) {
    this.onStatusUpdate = callback;
  }

  private updateStatus(status: Partial<BotServiceStatus>) {
    if (this.onStatusUpdate) {
      this.onStatusUpdate({
        isRunning: this.isRunning,
        activeBots: this.bots.filter(b => b.isActive).length,
        totalBets: this.totalSubmitted,
        ...status,
      });
    }
  }

  async prepareTournamentBots(tournamentId: number): Promise<void> {
    if (!this.config.enabled) return;
    if (this.preparedTournamentId === tournamentId && this.bots.length === this.config.numBots) {
      return;
    }

    this.stop();
    const generation = this.prepareGeneration;
    this.preparedTournamentId = tournamentId;

    logDebug(`[BotService] Preparing ${this.config.numBots} bots for tournament ${tournamentId}...`);
    this.updateStatus({ isRunning: false });

    for (let i = 0; i < this.config.numBots; i++) {
      if (generation !== this.prepareGeneration) break;
      try {
        const bot = await this.createBot(i);
        if (generation !== this.prepareGeneration) break;

        // Join the tournament during registration (or early).
        await this.joinTournament(bot, tournamentId);
        if (generation !== this.prepareGeneration) break;

        this.bots.push(bot);
        if (this.isRunning && bot.isActive && !bot.loopStarted) {
          bot.loopStarted = true;
          this.startBotLoop(bot);
        }

        // Stagger bot creation slightly to avoid overloading the backend.
        await new Promise(r => setTimeout(r, 5));
      } catch (e) {
        console.warn(`[BotService] Failed to prepare bot ${i}:`, e);
      }
    }

    logDebug(`[BotService] Prepared ${this.bots.length} bots for tournament ${tournamentId}`);
    this.updateStatus({ activeBots: this.bots.length });
  }

  startPlaying(): void {
    if (this.isRunning || !this.config.enabled) return;

    logDebug(`[BotService] Starting bot play loops (${this.bots.length} bots)...`);
    this.isRunning = true;
    this.updateStatus({ isRunning: true });

    for (const bot of this.bots) {
      if (!bot.isActive || bot.loopStarted) continue;
      bot.loopStarted = true;
      this.startBotLoop(bot);
    }
  }

  stop(): void {
    if (!this.isRunning && this.bots.length === 0) return;

    logDebug('[BotService] Stopping all bots...');
    this.isRunning = false;
    this.prepareGeneration++;

    // Clear all intervals
    for (const handle of this.intervalHandles) {
      clearTimeout(handle);
    }
    this.intervalHandles = [];

    // Mark all bots as inactive
    for (const bot of this.bots) {
      bot.isActive = false;
    }
    this.bots = [];
    this.preparedTournamentId = null;

    this.updateStatus({ isRunning: false, activeBots: 0 });
  }

  private createProfile(id: number): BotProfile {
    // Weighted base bet sizes (tournament stack starts at 1000).
    const baseBets = [5, 10, 25, 50];
    const baseWeights = [0.45, 0.35, 0.15, 0.05];
    const baseBet = this.weightedChoice(baseBets, baseWeights);

    // Volatility: most bots are conservative, a few are high-variance.
    const volatility = Math.min(1, Math.max(0, (Math.random() ** 2) * 1.15));

    // Give each bot a small set of favorite games so the table looks less uniform.
    const favCount = 2 + (id % 2); // 2-3 favorites, deterministic per id
    const shuffled = [...ALL_GAMES].sort(() => Math.random() - 0.5);
    const favoriteGames = shuffled.slice(0, favCount);

    return { baseBet, volatility, favoriteGames };
  }

  private async createBot(id: number): Promise<BotState> {
    const wasm = new WasmWrapper(this.identityHex);
    await wasm.init();

    // Generate a new keypair for this bot
    wasm.createKeypair();

    const name = `Bot${String(id).padStart(4, '0')}`;
    const publicKeyBytes = wasm.getPublicKeyBytes();

    // Fetch current account state from chain to get the actual nonce
    let currentNonce = 0;
    try {
      const accountState = await this.getAccountState(publicKeyBytes);
      if (accountState) {
        currentNonce = accountState.nonce;
        logDebug(`[BotService] Bot ${name} loaded nonce from chain: ${currentNonce}`);
      }
    } catch (e) {
      logDebug(`[BotService] Bot ${name} failed to fetch account state:`, e);
    }

    // Register the bot if not already registered
    if (currentNonce === 0) {
      try {
        const registerTx = wasm.createCasinoRegisterTransaction(0, name);
        await this.submitTransaction(wasm, registerTx);
        currentNonce = 1; // After registration, nonce is 1
        logDebug(`[BotService] Bot ${name} registered, nonce is now 1`);
      } catch (e) {
        // May already be registered from previous run
        logDebug(`[BotService] Bot ${name} registration:`, e);
        // If registration failed, query the nonce again
        try {
          const accountState = await this.getAccountState(publicKeyBytes);
          if (accountState) {
            currentNonce = accountState.nonce;
          }
        } catch (queryError) {
          console.warn(`[BotService] Bot ${name} failed to query nonce after registration error`);
        }
      }
    }

    return {
      id,
      name,
      wasm,
      nonce: currentNonce,
      sessionCounter: id * 1_000_000,
      isActive: true,
      loopStarted: false,
      profile: this.createProfile(id),
    };
  }

  private async joinTournament(bot: BotState, tournamentId: number): Promise<void> {
    const attempt = async () => {
      const joinNonce = bot.nonce;
      const joinTx = bot.wasm.createCasinoJoinTournamentTransaction(joinNonce, tournamentId);
      await this.submitTransaction(bot.wasm, joinTx);
      bot.nonce++;
    };
    try {
      await attempt();
    } catch (e) {
      // If join fails (already joined / tournament not registering / nonce mismatch), re-sync and retry once.
      await this.resyncNonce(bot);
      try {
        await attempt();
      } catch {
        // Give up for now; bot can still play cash games, and will re-sync on later failures.
        await this.resyncNonce(bot);
      }
    }
  }

  private async getAccountState(publicKeyBytes: Uint8Array): Promise<{ nonce: number } | null> {
    try {
      // Create a temporary WasmWrapper to use encoding functions
      const tempWasm = new WasmWrapper(this.identityHex);
      await tempWasm.init();

      // Encode the account key
      const keyBytes = tempWasm.encodeAccountKey(publicKeyBytes);
      const hashedKey = tempWasm.hashKey(keyBytes);
      const hexKey = tempWasm.bytesToHex(hashedKey);

      // Query the state
      const response = await fetch(`${this.baseUrl}/state/${hexKey}`);

      if (response.status === 404) {
        return null;
      }

      if (response.status !== 200) {
        throw new Error(`State query returned ${response.status}`);
      }

      // Get binary response
      const buffer = await response.arrayBuffer();
      const valueBytes = new Uint8Array(buffer);

      if (valueBytes.length === 0) {
        return null;
      }

      // Decode value using WASM
      const value = tempWasm.decodeLookup(valueBytes);

      if (value && value.type === 'Account') {
        return { nonce: value.nonce };
      }

      return null;
    } catch (error) {
      console.error('[BotService] Failed to get account state:', error);
      return null;
    }
  }

  private async submitTransaction(wasm: WasmWrapper, txBytes: Uint8Array): Promise<void> {
    // Wrap transaction in Submission enum
    const submission = wasm.wrapTransactionSubmission(txBytes);

    const response = await fetch(`${this.baseUrl}/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      body: submission
    });

    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }

    this.totalSubmitted++;
    if (this.totalSubmitted % 50 === 0) {
      this.updateStatus({ totalBets: this.totalSubmitted });
    }
  }

  private startBotLoop(bot: BotState): void {
    const runGame = async () => {
      if (!this.isRunning || !bot.isActive) return;

      try {
        await this.playRandomGame(bot);
      } catch (e) {
        logDebug(`[BotService] Bot ${bot.name} game error:`, e);
      }

      // Schedule next game
      if (this.isRunning && bot.isActive) {
        const delay = this.config.randomizeInterval
          ? Math.floor(this.config.betIntervalMs * (0.5 + Math.random()))
          : this.config.betIntervalMs;

        const handle = window.setTimeout(runGame, delay);
        this.intervalHandles.push(handle);
      }
    };

    // Start with a random initial delay to spread out bot activity
    const initialDelay = Math.floor(Math.random() * this.config.betIntervalMs);
    const handle = window.setTimeout(runGame, initialDelay);
    this.intervalHandles.push(handle);
  }

  private async playRandomGame(bot: BotState): Promise<void> {
    const gameType = this.pickGameForBot(bot);
    const sessionId = BigInt(++bot.sessionCounter);
    const plan = this.buildGamePlan(bot, gameType);

    // Start game - use current nonce, only increment on success
    const startNonce = bot.nonce;
    const startTx = bot.wasm.createCasinoStartGameTransaction(
      startNonce,
      gameType,
      plan.startBet,
      sessionId
    );

    try {
      await this.submitTransaction(bot.wasm, startTx);
      bot.nonce++; // Only increment after successful submission
    } catch (e) {
      logDebug(`[BotService] Bot ${bot.name} start game failed, re-syncing nonce`);
      // Try to re-sync nonce from chain on failure
      await this.resyncNonce(bot);
      return; // Exit early, next iteration will try again
    }

    // Small delay
    await new Promise(r => setTimeout(r, 20));

    // Make moves based on game type
    for (const move of plan.moves) {
      const moveNonce = bot.nonce;
      const moveTx = bot.wasm.createCasinoGameMoveTransaction(
        moveNonce,
        sessionId,
        move
      );
      try {
        await this.submitTransaction(bot.wasm, moveTx);
        bot.nonce++; // Only increment after successful submission
        await new Promise(r => setTimeout(r, 10));
      } catch {
        // Game may have ended or nonce issue - re-sync and exit
        await this.resyncNonce(bot);
        break;
      }
    }
  }

  private async resyncNonce(bot: BotState): Promise<void> {
    try {
      const accountState = await this.getAccountState(bot.wasm.getPublicKeyBytes());
      if (accountState) {
        bot.nonce = accountState.nonce;
        logDebug(`[BotService] Bot ${bot.name} nonce re-synced to ${bot.nonce}`);
      }
    } catch (e) {
      logDebug(`[BotService] Bot ${bot.name} failed to re-sync nonce:`, e);
    }
  }

  private pickGameForBot(bot: BotState): number {
    // Favor a bot's preferred games most of the time to create a less-uniform pool.
    if (bot.profile.favoriteGames.length > 0 && Math.random() < 0.7) {
      return bot.profile.favoriteGames[Math.floor(Math.random() * bot.profile.favoriteGames.length)];
    }
    return ALL_GAMES[Math.floor(Math.random() * ALL_GAMES.length)];
  }

  private buildGamePlan(bot: BotState, gameType: number): { startBet: number; moves: Uint8Array[] } {
    const v = bot.profile.volatility;
    const chipMenu = [1, 5, 10, 25, 50, 100, 200];
    const around = (target: number, min = 1, max = 200) =>
      this.pickClosestWeighted(
        chipMenu.filter(x => x >= min && x <= max),
        target
      );

    const base = bot.profile.baseBet;
    const mainBet = around(base * (0.6 + Math.random() * (1.2 + v)));

    const moves: Uint8Array[] = [];

    switch (gameType) {
      case GameType.Baccarat: {
        // Start with 0; wagers are placed via atomic batch.
        const total = Math.max(1, around(mainBet, 1, 100));
        const mainAmt = Math.max(1, around(total * (0.7 + Math.random() * 0.3), 1, 100));
        const sideAmt = Math.max(1, around(Math.max(1, Math.floor(total * 0.25)), 1, 25));

        // Main bet: mostly Player/Banker, occasional Tie.
        const mainType = this.weightedChoice([0, 1, 2], [0.46, 0.46, 0.08]);

        // Collect all bets for atomic batch
        const bets: Array<{ betType: number; amount: number }> = [];
        bets.push({ betType: mainType, amount: mainAmt });

        // Optional side bets: small and rare (high edge, high variance).
        if (Math.random() < 0.15 * (0.5 + v)) {
          const sideType = this.weightedChoice([3, 4, 5], [0.45, 0.45, 0.10]);
          bets.push({ betType: sideType, amount: sideAmt });
        }

        // Create single atomic batch move (action 3: place all bets + deal)
        moves.push(this.serializeBaccaratAtomicBatch(bets));
        return { startBet: 0, moves };
      }

      case GameType.Blackjack: {
        // Moves: optional 21+3 side bet, Deal, (optional hits), Stand, Reveal.
        // Side bet: small and occasional.
        if (Math.random() < 0.12 * (0.7 + v)) {
          const side = Math.max(1, Math.min(mainBet, around(Math.max(1, Math.floor(mainBet / 5)), 1, 25)));
          moves.push(this.serializeU64Action(5, side)); // Set 21+3
        }

        moves.push(new Uint8Array([4])); // Deal

        const hits = Math.random() < 0.35 ? (Math.random() < 0.25 ? 2 : 1) : 0;
        for (let i = 0; i < hits; i++) moves.push(new Uint8Array([0])); // Hit

        if (Math.random() < 0.10 * v) moves.push(new Uint8Array([2])); // Try Double sometimes

        moves.push(new Uint8Array([1])); // Stand (if already awaiting reveal, this is ignored on-chain)
        moves.push(new Uint8Array([6])); // Reveal
        return { startBet: mainBet, moves };
      }

      case GameType.CasinoWar: {
        // Optional tie bet, then Play; if tie, follow with War or Surrender to resolve.
        if (Math.random() < 0.10 * (0.5 + v)) {
          const tie = Math.max(1, around(Math.max(1, Math.floor(mainBet / 4)), 1, 25));
          moves.push(this.serializeU64Action(3, tie)); // SetTieBet
        }
        moves.push(new Uint8Array([0])); // Play

        // Always choose a tie resolution action; only applies if the hand was a tie.
        const resolve = Math.random() < 0.8 ? 1 : 2; // War or Surrender
        moves.push(new Uint8Array([resolve]));
        return { startBet: mainBet, moves };
      }

      case GameType.Craps: {
        // One-roll bets so sessions complete quickly (Field / Hop).
        const amount = Math.max(1, around(mainBet, 1, 50));
        const betType = Math.random() < 0.75 ? 4 : 7; // Field or Next
        const target = betType === 7 ? this.randInt(2, 12) : 0;
        moves.push(this.serializeTableBet(betType, target, amount));
        moves.push(new Uint8Array([2])); // Roll
        return { startBet: 0, moves };
      }

      case GameType.VideoPoker: {
        // Random hold mask (0..31). Holding all (31) is allowed but uncommon.
        const mask = Math.random() < 0.15 ? 31 : this.randInt(0, 31);
        moves.push(new Uint8Array([mask]));
        return { startBet: mainBet, moves };
      }

      case GameType.HiLo: {
        // One guess, then cashout (if guess was wrong, cashout is ignored).
        const guess = Math.random() < 0.5 ? 0 : 1;
        moves.push(new Uint8Array([guess]));
        moves.push(new Uint8Array([2])); // Cashout
        return { startBet: mainBet, moves };
      }

      case GameType.Roulette: {
        // Start with 0; place 1-3 bets, then spin.
        const betCount = this.weightedChoice([1, 2, 3], [0.6, 0.3, 0.1 * (0.7 + v)]);
        const total = Math.max(1, around(mainBet * betCount, 1, 200));
        for (let i = 0; i < betCount; i++) {
          const isInside = Math.random() < 0.12 * (0.5 + v);
          const isDozenOrColumn = !isInside && Math.random() < 0.25;
          const amount = Math.max(1, around(Math.max(1, Math.floor(total / betCount)), 1, isInside ? 25 : 100));

          if (isInside) {
            const betType = this.weightedChoice([0, 9, 10, 11, 12, 13], [0.35, 0.15, 0.15, 0.12, 0.12, 0.11]);
            const number = this.randomRouletteNumberForBetType(betType);
            moves.push(this.serializeTableBet(betType, number, amount));
          } else if (isDozenOrColumn) {
            const betType = this.weightedChoice([7, 8], [0.6, 0.4]);
            const number = this.randInt(0, 2);
            moves.push(this.serializeTableBet(betType, number, amount));
          } else {
            const betType = this.weightedChoice([1, 2, 3, 4, 5, 6], [0.22, 0.22, 0.16, 0.16, 0.12, 0.12]);
            moves.push(this.serializeTableBet(betType, 0, amount));
          }
        }
        moves.push(new Uint8Array([1])); // Spin
        return { startBet: 0, moves };
      }

      case GameType.SicBo: {
        // Start with 0; place 1-2 bets, then roll.
        const betCount = Math.random() < 0.75 ? 1 : 2;
        for (let i = 0; i < betCount; i++) {
          const exotic = Math.random() < 0.10 * (0.6 + v);
          const amount = Math.max(1, around(mainBet / betCount, 1, exotic ? 10 : 50));

          if (!exotic) {
            const betType = this.weightedChoice([0, 1, 2, 3, 8, 7], [0.28, 0.28, 0.14, 0.14, 0.10, 0.06]);
            const number =
              betType === 8
                ? this.randInt(1, 6) // Single
                : betType === 7
                  ? this.randInt(3, 18) // Total
                  : 0;
            moves.push(this.serializeTableBet(betType, number, amount));
          } else {
            // Rare, high-variance bets.
            const betType = this.weightedChoice([4, 5, 9], [0.45, 0.30, 0.25]);
            const number =
              betType === 4
                ? this.randInt(1, 6) // SpecificTriple
                : betType === 9
                  ? this.encodeSicBoDomino(this.randInt(1, 6), this.randInt(1, 6))
                  : 0; // AnyTriple
            moves.push(this.serializeTableBet(betType, number, amount));
          }
        }
        moves.push(new Uint8Array([1])); // Roll
        return { startBet: 0, moves };
      }

      case GameType.ThreeCard: {
        // Deal first, then decide to play or fold; reveal only after playing.
        const pairPlus = Math.random() < 0.18 * (0.6 + v) ? Math.max(1, around(Math.floor(mainBet / 4), 1, 25)) : 0;
        if (pairPlus > 0) moves.push(this.serializeU64Action(2, pairPlus)); // Deal + set Pairplus
        else moves.push(new Uint8Array([2])); // Deal

        const shouldPlay = Math.random() < 0.6 + v * 0.15;
        if (shouldPlay) {
          moves.push(new Uint8Array([0])); // Play (deducts Play bet)
          moves.push(new Uint8Array([4])); // Reveal
        } else {
          moves.push(new Uint8Array([1])); // Fold (resolves)
        }
        return { startBet: mainBet, moves };
      }

      case GameType.UltimateHoldem: {
        // Deal, then pick a line (bet early vs check down), and optionally reveal.
        const trips = Math.random() < 0.10 * (0.6 + v) ? Math.max(1, around(Math.floor(mainBet / 3), 1, 25)) : 0;
        if (trips > 0) moves.push(this.serializeU64Action(5, trips)); // Deal + set Trips
        else moves.push(new Uint8Array([5])); // Deal

        const betPreflop = Math.random() < 0.18 * (0.4 + v);
        if (betPreflop) {
          const action = Math.random() < 0.5 ? 1 : 8; // 4x or 3x
          moves.push(new Uint8Array([action]));
          moves.push(new Uint8Array([7])); // Reveal
          return { startBet: mainBet, moves };
        }

        // Check to flop.
        moves.push(new Uint8Array([0])); // Check

        const betFlop = Math.random() < 0.25 * (0.5 + v);
        if (betFlop) {
          moves.push(new Uint8Array([2])); // Bet 2x
          moves.push(new Uint8Array([7])); // Reveal
          return { startBet: mainBet, moves };
        }

        // Check to river.
        moves.push(new Uint8Array([0])); // Check

        const betRiver = Math.random() < 0.30 * (0.5 + v);
        if (betRiver) {
          moves.push(new Uint8Array([3])); // Bet 1x
          moves.push(new Uint8Array([7])); // Reveal
        } else {
          moves.push(new Uint8Array([4])); // Fold
        }

        return { startBet: mainBet, moves };
      }

      default:
        return { startBet: mainBet, moves: [] };
    }
  }

  private serializeU64Action(action: number, amount: number): Uint8Array {
    validateBetAmount(amount, 'BotService');
    const payload = new Uint8Array(9);
    payload[0] = action;
    new DataView(payload.buffer).setBigUint64(1, BigInt(amount), false);
    return payload;
  }

  private serializeTableBet(betType: number, number: number, amount: number): Uint8Array {
    validateBetAmount(amount, 'BotService');
    const payload = new Uint8Array(11);
    payload[0] = 0;
    payload[1] = betType;
    payload[2] = number;
    new DataView(payload.buffer).setBigUint64(3, BigInt(amount), false);
    return payload;
  }

  private randomRouletteNumberForBetType(betType: number): number {
    switch (betType) {
      case 0: // Straight
        return this.randInt(0, 36);
      case 9: // SplitH: 1-35, not rightmost (n % 3 != 0)
        return this.randIntFrom(() => this.randInt(1, 35), (n) => n % 3 !== 0);
      case 10: // SplitV: 1-33
        return this.randInt(1, 33);
      case 11: // Street: 1,4,...,34
        return 1 + 3 * this.randInt(0, 11);
      case 12: // Corner: 1-32, not rightmost (n % 3 != 0)
        return this.randIntFrom(() => this.randInt(1, 32), (n) => n % 3 !== 0);
      case 13: // SixLine: 1,4,...,31
        return 1 + 3 * this.randInt(0, 10);
      default:
        return 0;
    }
  }

  private encodeSicBoDomino(a: number, b: number): number {
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    if (min === max) {
      // Force distinct values (domino requires min<max).
      const alt = min === 6 ? 5 : 6;
      return (Math.min(min, alt) << 4) | Math.max(min, alt);
    }
    return (min << 4) | max;
  }

  private randInt(minInclusive: number, maxInclusive: number): number {
    return Math.floor(Math.random() * (maxInclusive - minInclusive + 1)) + minInclusive;
  }

  private randIntFrom(gen: () => number, pred: (n: number) => boolean, maxTries = 64): number {
    for (let i = 0; i < maxTries; i++) {
      const n = gen();
      if (pred(n)) return n;
    }
    return gen();
  }

  private weightedChoice<T>(items: T[], weights: number[]): T {
    const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (total <= 0) return items[0];
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i] ?? 0);
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  private pickClosestWeighted(options: number[], target: number): number {
    if (options.length === 0) return Math.max(1, Math.floor(target));
    const weights = options.map((x) => 1 / (1 + Math.abs(x - target)));
    return this.weightedChoice(options, weights);
  }

  private serializeBaccaratBet(betType: number, amount: number): Uint8Array {
    validateBetAmount(amount, 'BotService');
    const payload = new Uint8Array(10);
    payload[0] = 0; // Place bet action
    payload[1] = betType;
    const view = new DataView(payload.buffer);
    view.setBigUint64(2, BigInt(amount), false);
    return payload;
  }

  private serializeBaccaratAtomicBatch(bets: Array<{ betType: number; amount: number }>): Uint8Array {
    // Atomic batch format: [action:u8=3] [numBets:u8] [bet1:betType:u8,amount:u64 BE] ...
    // Each bet is 9 bytes: [betType:u8, amount:u64 BE]
    const payload = new Uint8Array(2 + bets.length * 9);
    payload[0] = 3; // Atomic batch action code
    payload[1] = bets.length;
    let offset = 2;
    for (const bet of bets) {
      validateBetAmount(bet.amount, 'BotService');
      payload[offset] = bet.betType;
      new DataView(payload.buffer).setBigUint64(offset + 1, BigInt(bet.amount), false);
      offset += 9;
    }
    return payload;
  }

  private serializeCrapsBet(betType: number, target: number, amount: number): Uint8Array {
    validateBetAmount(amount, 'BotService');
    const payload = new Uint8Array(11);
    payload[0] = 0; // Place bet action
    payload[1] = betType;
    payload[2] = target;
    const view = new DataView(payload.buffer);
    view.setBigUint64(3, BigInt(amount), false);
    return payload;
  }
}

export interface BotServiceStatus {
  isRunning: boolean;
  activeBots: number;
  totalBets: number;
}
