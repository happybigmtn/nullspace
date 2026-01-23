/**
 * Casino Client Helper for Stress Testing
 *
 * Provides a high-level WebSocket client for casino betting operations.
 * Handles connection management, authentication, and bet lifecycle.
 */

import WebSocket from 'ws';

export interface CasinoClientConfig {
  gatewayUrl: string;
  connectionTimeout?: number;
  responseTimeout?: number;
}

export interface BetResult {
  success: boolean;
  type: string;
  sessionId?: string;
  payout?: bigint;
  balance?: bigint;
  won?: boolean;
  error?: string;
  latencyMs: number;
  rawResponse?: Record<string, unknown>;
}

export interface ConnectionStats {
  connectLatencyMs: number;
  registered: boolean;
  balance: bigint;
}

export type GameType =
  | 'blackjack'
  | 'roulette'
  | 'craps'
  | 'baccarat'
  | 'sicbo'
  | 'videopoker'
  | 'casinowar'
  | 'hilo'
  | 'threecard'
  | 'ultimateholdem';

/**
 * Casino client for stress testing
 */
export class CasinoClient {
  private ws: WebSocket | null = null;
  private config: Required<CasinoClientConfig>;
  private messageQueue: Map<string, (msg: Record<string, unknown>) => void> = new Map();
  private eventListeners: Map<string, ((msg: Record<string, unknown>) => void)[]> = new Map();
  private balance: bigint = 0n;
  private registered = false;
  private connected = false;

  constructor(config: CasinoClientConfig) {
    this.config = {
      gatewayUrl: config.gatewayUrl,
      connectionTimeout: config.connectionTimeout ?? 30000,
      responseTimeout: config.responseTimeout ?? 60000,
    };
  }

  /**
   * Connect to the gateway and wait for session_ready
   */
  async connect(): Promise<ConnectionStats> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.disconnect();
        reject(new Error('Connection timeout'));
      }, this.config.connectionTimeout);

      try {
        this.ws = new WebSocket(this.config.gatewayUrl);

        this.ws.on('open', () => {
          this.connected = true;
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const msg = JSON.parse(data.toString());
            this.handleMessage(msg);

            // Wait for session_ready
            if (msg.type === 'session_ready') {
              this.waitForRegistration()
                .then((stats) => {
                  clearTimeout(timeout);
                  resolve({
                    connectLatencyMs: Date.now() - startTime,
                    registered: stats.registered,
                    balance: stats.balance,
                  });
                })
                .catch(reject);
            }
          } catch {
            // Ignore parse errors
          }
        });

        this.ws.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });

        this.ws.on('close', () => {
          this.connected = false;
        });
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /**
   * Poll for registration and balance, requesting faucet if needed
   */
  private async waitForRegistration(): Promise<{ registered: boolean; balance: bigint }> {
    let faucetRequested = false;

    for (let i = 0; i < 60; i++) {
      const balance = await this.sendAndReceive({ type: 'get_balance' });

      // If registered with balance, we're done
      if (balance.registered && balance.hasBalance) {
        this.registered = true;
        this.balance = BigInt(balance.balance?.toString() ?? '0');
        return { registered: true, balance: this.balance };
      }

      // If registered but no balance, request faucet chips
      if (balance.registered && !balance.hasBalance && !faucetRequested) {
        faucetRequested = true;
        try {
          this.send({ type: 'faucet_claim', amount: 100000 });
        } catch {
          // Ignore faucet errors, will retry get_balance
        }
      }

      await this.sleep(200);
    }

    // Final check - accept registration even without balance for simulation
    const finalBalance = await this.sendAndReceive({ type: 'get_balance' });
    if (finalBalance.registered) {
      this.registered = true;
      this.balance = BigInt(finalBalance.balance?.toString() ?? '0');
      return { registered: true, balance: this.balance };
    }

    return { registered: false, balance: 0n };
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(msg: Record<string, unknown>): void {
    const type = msg.type as string;

    // Update balance if present
    if (msg.balance !== undefined) {
      this.balance = BigInt(msg.balance.toString());
    }

    // Emit to type-specific listeners
    const listeners = this.eventListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        listener(msg);
      }
    }

    // Resolve pending promises for response types
    const responseTypes = [
      'game_started',
      'game_move',
      'game_result',
      'error',
      'balance_response',
      'move_accepted',
    ];
    if (responseTypes.includes(type)) {
      const resolver = this.messageQueue.get(type);
      if (resolver) {
        this.messageQueue.delete(type);
        resolver(msg);
      }
    }
  }

  /**
   * Send message without waiting for response
   */
  send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send message and wait for response
   */
  async sendAndReceive(
    msg: Record<string, unknown>,
    timeout = this.config.responseTimeout
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const timer = setTimeout(() => {
        reject(new Error('Response timeout'));
      }, timeout);

      const handler = (data: WebSocket.Data) => {
        clearTimeout(timer);
        this.ws?.off('message', handler);
        try {
          resolve(JSON.parse(data.toString()));
        } catch (err) {
          reject(err);
        }
      };

      this.ws.on('message', handler);
      this.ws.send(JSON.stringify(msg));
    });
  }

  /**
   * Wait for a specific message type
   */
  waitForType(type: string, timeout = this.config.responseTimeout): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.messageQueue.delete(type);
        reject(new Error(`Timeout waiting for ${type}`));
      }, timeout);

      this.messageQueue.set(type, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  /**
   * Place a roulette bet and spin
   */
  async playRoulette(
    bets: Array<{ type: string; amount: number; target?: number; number?: number; value?: number }>
  ): Promise<BetResult> {
    const startTime = Date.now();
    try {
      const response = await this.sendAndReceive({
        type: 'roulette_spin',
        bets: bets.map((b) => ({
          type: b.type,
          amount: b.amount,
          target: b.target,
          number: b.number,
          value: b.value,
        })),
      });

      // Wait for game_result
      const result = response.type === 'game_result' ? response : await this.waitForType('game_result');

      return {
        success: true,
        type: 'roulette',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'roulette',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Place craps bets and roll
   */
  async playCraps(
    bets: Array<{ type: string; amount: number; target?: number }>
  ): Promise<BetResult> {
    const startTime = Date.now();
    try {
      const response = await this.sendAndReceive({
        type: 'craps_roll',
        bets: bets.map((b) => ({
          type: b.type,
          amount: b.amount,
          target: b.target ?? 0,
        })),
      });

      const result = response.type === 'game_result' ? response : await this.waitForType('game_result');

      return {
        success: true,
        type: 'craps',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'craps',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Play a blackjack hand (deal and auto-stand)
   */
  async playBlackjack(
    amount: number,
    options?: { sideBet21Plus3?: number }
  ): Promise<BetResult> {
    const startTime = Date.now();
    try {
      // Deal
      const dealResponse = await this.sendAndReceive({
        type: 'blackjack_deal',
        amount,
        sideBet21Plus3: options?.sideBet21Plus3,
      });

      if (dealResponse.type === 'error') {
        return {
          success: false,
          type: 'blackjack',
          error: dealResponse.message as string,
          latencyMs: Date.now() - startTime,
        };
      }

      // For stress testing, just stand after deal (simplest strategy)
      const standResponse = await this.sendAndReceive({ type: 'blackjack_stand' });
      const result = standResponse.type === 'game_result' ? standResponse : await this.waitForType('game_result');

      return {
        success: true,
        type: 'blackjack',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'blackjack',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Play baccarat
   */
  async playBaccarat(
    bets: Array<{ type: string; amount: number }>
  ): Promise<BetResult> {
    const startTime = Date.now();
    try {
      const response = await this.sendAndReceive({
        type: 'baccarat_deal',
        bets: bets.map((b) => ({ type: b.type, amount: b.amount })),
      });

      const result = response.type === 'game_result' ? response : await this.waitForType('game_result');

      return {
        success: true,
        type: 'baccarat',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'baccarat',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Play Sic Bo
   */
  async playSicBo(
    bets: Array<{ type: string; amount: number; target?: number }>
  ): Promise<BetResult> {
    const startTime = Date.now();
    try {
      const response = await this.sendAndReceive({
        type: 'sicbo_roll',
        bets: bets.map((b) => ({
          type: b.type,
          amount: b.amount,
          target: b.target ?? 0,
        })),
      });

      const result = response.type === 'game_result' ? response : await this.waitForType('game_result');

      return {
        success: true,
        type: 'sicbo',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'sicbo',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Play Video Poker
   */
  async playVideoPoker(amount: number): Promise<BetResult> {
    const startTime = Date.now();
    try {
      // Deal
      const dealResponse = await this.sendAndReceive({
        type: 'videopoker_deal',
        amount,
      });

      if (dealResponse.type === 'error') {
        return {
          success: false,
          type: 'videopoker',
          error: dealResponse.message as string,
          latencyMs: Date.now() - startTime,
        };
      }

      // For stress testing, hold nothing and redraw all (using legacy hold endpoint)
      const drawResponse = await this.sendAndReceive({
        type: 'videopoker_hold',
        holds: [false, false, false, false, false],
      });

      const result = drawResponse.type === 'game_result' ? drawResponse : await this.waitForType('game_result');

      return {
        success: true,
        type: 'videopoker',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'videopoker',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Play Casino War
   */
  async playCasinoWar(amount: number): Promise<BetResult> {
    const startTime = Date.now();
    try {
      const response = await this.sendAndReceive({
        type: 'casinowar_deal',
        amount,
      });

      // If tie, go to war (for stress testing, always go to war)
      if (response.type === 'game_move' && (response as Record<string, unknown>).requiresWar) {
        const warResponse = await this.sendAndReceive({ type: 'casinowar_war' });
        const result = warResponse.type === 'game_result' ? warResponse : await this.waitForType('game_result');
        return {
          success: true,
          type: 'casinowar',
          sessionId: result.sessionId as string,
          payout: BigInt(result.payout?.toString() ?? '0'),
          balance: BigInt(result.balance?.toString() ?? '0'),
          won: result.won as boolean,
          latencyMs: Date.now() - startTime,
          rawResponse: result,
        };
      }

      const result = response.type === 'game_result' ? response : await this.waitForType('game_result');

      return {
        success: true,
        type: 'casinowar',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'casinowar',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Play HiLo
   */
  async playHiLo(amount: number, guess: 'higher' | 'lower' | 'same' = 'higher'): Promise<BetResult> {
    const startTime = Date.now();
    try {
      // Start game with initial bet
      const startResponse = await this.sendAndReceive({
        type: 'hilo_bet',
        amount,
      });

      if (startResponse.type === 'error') {
        return {
          success: false,
          type: 'hilo',
          error: startResponse.message as string,
          latencyMs: Date.now() - startTime,
        };
      }

      // Deal the first card
      const dealResponse = await this.sendAndReceive({
        type: 'hilo_deal',
      });

      if (dealResponse.type === 'error') {
        return {
          success: false,
          type: 'hilo',
          error: dealResponse.message as string,
          latencyMs: Date.now() - startTime,
        };
      }

      // Make guess
      const guessResponse = await this.sendAndReceive({
        type: 'hilo_guess',
        guess,
      });

      // Cash out or get result
      if (guessResponse.type === 'game_move') {
        const cashoutResponse = await this.sendAndReceive({ type: 'hilo_cashout' });
        const result = cashoutResponse.type === 'game_result' ? cashoutResponse : await this.waitForType('game_result');
        return {
          success: true,
          type: 'hilo',
          sessionId: result.sessionId as string,
          payout: BigInt(result.payout?.toString() ?? '0'),
          balance: BigInt(result.balance?.toString() ?? '0'),
          won: result.won as boolean,
          latencyMs: Date.now() - startTime,
          rawResponse: result,
        };
      }

      const result = guessResponse.type === 'game_result' ? guessResponse : await this.waitForType('game_result');

      return {
        success: true,
        type: 'hilo',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'hilo',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Play Three Card Poker
   */
  async playThreeCard(amount: number, options?: { pairPlus?: number }): Promise<BetResult> {
    const startTime = Date.now();
    try {
      const response = await this.sendAndReceive({
        type: 'threecardpoker_deal',
        amount,
        pairPlus: options?.pairPlus,
      });

      if (response.type === 'error') {
        return {
          success: false,
          type: 'threecard',
          error: response.message as string,
          latencyMs: Date.now() - startTime,
        };
      }

      // For stress testing, always play
      const playResponse = await this.sendAndReceive({ type: 'threecardpoker_play' });
      const result = playResponse.type === 'game_result' ? playResponse : await this.waitForType('game_result');

      return {
        success: true,
        type: 'threecard',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'threecard',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Play Ultimate Texas Hold'em
   */
  async playUltimateHoldem(amount: number, options?: { trips?: number }): Promise<BetResult> {
    const startTime = Date.now();
    try {
      const response = await this.sendAndReceive({
        type: 'ultimateholdem_deal',
        amount,
        trips: options?.trips,
      });

      if (response.type === 'error') {
        return {
          success: false,
          type: 'ultimateholdem',
          error: response.message as string,
          latencyMs: Date.now() - startTime,
        };
      }

      // For stress testing, check through all streets to showdown
      // Ultimate Texas: preflop check, flop check, then river play/fold
      await this.sendAndReceive({ type: 'ultimateholdem_check' }); // preflop
      await this.sendAndReceive({ type: 'ultimateholdem_check' }); // flop
      // On river, must bet 1x or fold - bet for stress testing
      const finalResponse = await this.sendAndReceive({ type: 'ultimateholdem_bet' });
      const result = finalResponse.type === 'game_result' ? finalResponse : await this.waitForType('game_result');

      return {
        success: true,
        type: 'ultimateholdem',
        sessionId: result.sessionId as string,
        payout: BigInt(result.payout?.toString() ?? '0'),
        balance: BigInt(result.balance?.toString() ?? '0'),
        won: result.won as boolean,
        latencyMs: Date.now() - startTime,
        rawResponse: result,
      };
    } catch (err) {
      return {
        success: false,
        type: 'ultimateholdem',
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get current balance
   */
  async getBalance(): Promise<bigint> {
    const response = await this.sendAndReceive({ type: 'get_balance' });
    this.balance = BigInt(response.balance?.toString() ?? '0');
    return this.balance;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Check if registered
   */
  isRegistered(): boolean {
    return this.registered;
  }

  /**
   * Get cached balance
   */
  getCachedBalance(): bigint {
    return this.balance;
  }

  /**
   * Disconnect from gateway
   */
  disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close(1000);
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.connected = false;
    this.registered = false;
    this.messageQueue.clear();
    this.eventListeners.clear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create multiple clients for load testing
 */
export async function createClientPool(
  gatewayUrl: string,
  count: number,
  batchSize = 10
): Promise<CasinoClient[]> {
  const clients: CasinoClient[] = [];

  for (let batch = 0; batch < Math.ceil(count / batchSize); batch++) {
    const batchStart = batch * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, count);
    const batchPromises: Promise<CasinoClient | null>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const client = new CasinoClient({ gatewayUrl });
      batchPromises.push(
        client
          .connect()
          .then(() => client)
          .catch(() => {
            client.disconnect();
            return null;
          })
      );
    }

    const results = await Promise.all(batchPromises);
    clients.push(...results.filter((c): c is CasinoClient => c !== null));

    // Small delay between batches
    if (batch < Math.ceil(count / batchSize) - 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return clients;
}

/**
 * Disconnect all clients in pool
 */
export function disconnectPool(clients: CasinoClient[]): void {
  for (const client of clients) {
    client.disconnect();
  }
}
