/**
 * BotService - Spawns simulated bots that play against the chain during tournaments
 *
 * Bots make random bets on all casino games at configurable intervals.
 * This creates realistic tournament competition for testing.
 */

import { WasmWrapper } from '../api/wasm.js';

export interface BotConfig {
  enabled: boolean;
  numBots: number;
  betIntervalMs: number;
  randomizeInterval: boolean;
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  enabled: false,
  numBots: 100,
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
}

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
        totalBets: 0,
        ...status,
      });
    }
  }

  async start(): Promise<void> {
    if (this.isRunning || !this.config.enabled) return;

    console.log(`[BotService] Starting ${this.config.numBots} bots...`);
    this.isRunning = true;
    this.updateStatus({ isRunning: true });

    // Create bots
    for (let i = 0; i < this.config.numBots; i++) {
      try {
        const bot = await this.createBot(i);
        this.bots.push(bot);

        // Start bot playing loop
        this.startBotLoop(bot);

        // Stagger bot creation slightly
        await new Promise(r => setTimeout(r, 10));
      } catch (e) {
        console.warn(`[BotService] Failed to create bot ${i}:`, e);
      }
    }

    console.log(`[BotService] Started ${this.bots.length} bots`);
    this.updateStatus({ activeBots: this.bots.length });
  }

  stop(): void {
    if (!this.isRunning) return;

    console.log('[BotService] Stopping all bots...');
    this.isRunning = false;

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

    this.updateStatus({ isRunning: false, activeBots: 0 });
  }

  private async createBot(id: number): Promise<BotState> {
    const wasm = new WasmWrapper(this.identityHex);
    await wasm.init();

    // Generate a new keypair for this bot
    wasm.createKeypair();

    const name = `Bot${String(id).padStart(4, '0')}`;

    // Register the bot
    try {
      const registerTx = wasm.createCasinoRegisterTransaction(0, name);
      await this.submitTransaction(wasm, registerTx);
    } catch (e) {
      // May already be registered from previous run
      console.debug(`[BotService] Bot ${name} registration:`, e);
    }

    return {
      id,
      name,
      wasm,
      nonce: 1, // Start at 1 since we used 0 for registration
      sessionCounter: id * 1_000_000,
      isActive: true,
    };
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
  }

  private startBotLoop(bot: BotState): void {
    const runGame = async () => {
      if (!this.isRunning || !bot.isActive) return;

      try {
        await this.playRandomGame(bot);
      } catch (e) {
        console.debug(`[BotService] Bot ${bot.name} game error:`, e);
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
    const gameType = ALL_GAMES[Math.floor(Math.random() * ALL_GAMES.length)];
    const sessionId = BigInt(++bot.sessionCounter);
    const bet = 10; // Small consistent bet

    // Start game
    const startTx = bot.wasm.createCasinoStartGameTransaction(
      bot.nonce++,
      gameType,
      bet,
      sessionId
    );
    await this.submitTransaction(bot.wasm, startTx);

    // Small delay
    await new Promise(r => setTimeout(r, 20));

    // Make moves based on game type
    const moves = this.getGameMoves(gameType);
    for (const move of moves) {
      try {
        const moveTx = bot.wasm.createCasinoGameMoveTransaction(
          bot.nonce++,
          sessionId,
          move
        );
        await this.submitTransaction(bot.wasm, moveTx);
        await new Promise(r => setTimeout(r, 10));
      } catch {
        // Game may have ended
        break;
      }
    }
  }

  private getGameMoves(gameType: number): Uint8Array[] {
    switch (gameType) {
      case GameType.Baccarat:
        // Place bet then deal
        return [
          this.serializeBaccaratBet(Math.floor(Math.random() * 3), 10),
          new Uint8Array([1]), // Deal
        ];

      case GameType.Blackjack:
        // Stand immediately
        return [new Uint8Array([1])];

      case GameType.CasinoWar:
        return [];

      case GameType.Craps:
        // Pass bet then roll
        return [
          this.serializeCrapsBet(0, 0, 10),
          new Uint8Array([2]), // Roll
        ];

      case GameType.VideoPoker:
        // Hold all
        return [new Uint8Array([31])];

      case GameType.HiLo:
        // Random higher/lower
        return [new Uint8Array([Math.floor(Math.random() * 2)])];

      case GameType.Roulette:
        // Bet on red
        return [new Uint8Array([1, 0])];

      case GameType.SicBo:
        // Bet on small
        return [new Uint8Array([0, 0])];

      case GameType.ThreeCard:
        // Play
        return [new Uint8Array([0])];

      case GameType.UltimateHoldem:
        // Check then fold
        return [new Uint8Array([0]), new Uint8Array([4])];

      default:
        return [];
    }
  }

  private serializeBaccaratBet(betType: number, amount: number): Uint8Array {
    const payload = new Uint8Array(10);
    payload[0] = 0; // Place bet action
    payload[1] = betType;
    const view = new DataView(payload.buffer);
    view.setBigUint64(2, BigInt(amount), false);
    return payload;
  }

  private serializeCrapsBet(betType: number, target: number, amount: number): Uint8Array {
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
