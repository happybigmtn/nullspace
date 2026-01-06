/**
 * Base Game Test - Common functionality for all game integration tests
 * Provides session management, balance tracking, and test assertions
 */

import { TestLogger } from './TestLogger';
import { WebSocketTestClient, GameMessage } from './WebSocketTestClient';

export interface GameTestConfig {
  gatewayUrl: string;
  testName: string;
  timeout?: number;
}

export interface TestResult {
  passed: boolean;
  duration: number;
  errors: string[];
  warnings: string[];
  gameResults: Array<{
    bet: number;
    result: string;
    payout: number;
    balanceChange: number;
  }>;
}

export abstract class BaseGameTest {
  protected logger: TestLogger;
  protected client: WebSocketTestClient;
  protected sessionId: string | null = null;
  protected publicKey: string | null = null;
  protected initialBalance: number = 0;
  protected currentBalance: number = 0;
  protected errors: string[] = [];
  protected warnings: string[] = [];
  protected gameResults: Array<{
    bet: number;
    result: string;
    payout: number;
    balanceChange: number;
  }> = [];

  constructor(protected config: GameTestConfig) {
    this.logger = new TestLogger(config.testName);
    this.client = new WebSocketTestClient({
      url: config.gatewayUrl,
      timeout: config.timeout,
      logger: this.logger,
    });
  }

  /**
   * Setup: Connect to gateway and establish session
   */
  async setup(): Promise<void> {
    this.logger.info('=== Test Setup ===');

    // Connect to WebSocket
    await this.client.connect();

    // Wait for session_ready
    const sessionReady = await this.client.waitForMessage('session_ready');
    this.sessionId = sessionReady.sessionId as string;
    this.publicKey = sessionReady.publicKey as string;

    this.logger.success('Session established', {
      sessionId: this.sessionId,
      publicKey: this.publicKey,
    });

    // Wait for account registration to complete
    // The backend automatically registers accounts asynchronously
    let balanceMsg: any;
    let attempts = 0;
    const maxAttempts = 20; // 2 seconds max (100ms * 20)

    do {
      await new Promise((r) => setTimeout(r, 100)); // Wait 100ms between attempts
      this.client.send({ type: 'get_balance' });
      balanceMsg = await this.client.waitForMessage('balance', 2000);
      attempts++;

      // Exit early if registered and has balance flag
      if (balanceMsg.registered && balanceMsg.hasBalance) {
        break;
      }
    } while (
      (!balanceMsg.registered || !balanceMsg.hasBalance) &&
      attempts < maxAttempts
    );

    // Set initial balance (may be 0 in test mode)
    this.initialBalance = parseFloat(balanceMsg.balance as string);
    this.currentBalance = this.initialBalance;

    if (!balanceMsg.hasBalance) {
      throw new Error(`Account registration failed after ${attempts * 100}ms`);
    }

    this.logger.success('Account ready', {
      balance: this.initialBalance,
      registered: balanceMsg.registered,
      hasBalance: balanceMsg.hasBalance,
      attempts,
      waitTimeMs: attempts * 100,
    });
  }

  /**
   * Teardown: Disconnect and generate report
   */
  async teardown(): Promise<TestResult> {
    this.logger.info('=== Test Teardown ===');

    // Get final balance
    try {
      this.client.send({ type: 'get_balance' });
      const balanceMsg = await this.client.waitForMessage('balance', 3000);
      this.currentBalance = parseFloat(balanceMsg.balance as string);

      const balanceChange = this.currentBalance - this.initialBalance;
      this.logger.info('Final balance', {
        initial: this.initialBalance,
        final: this.currentBalance,
        change: balanceChange,
      });
    } catch (error) {
      this.logger.warn('Could not retrieve final balance');
    }

    await this.client.disconnect();

    const result: TestResult = {
      passed: this.errors.length === 0,
      duration: 0, // Will be set by logger
      errors: this.errors,
      warnings: this.warnings,
      gameResults: this.gameResults,
    };

    this.logger.printSummary();

    return result;
  }

  /**
   * Assert balance updated correctly
   */
  protected assertBalanceUpdated(
    expected: number,
    actual: number,
    tolerance: number = 0.01
  ): void {
    const diff = Math.abs(expected - actual);
    if (diff > tolerance) {
      const error = `Balance mismatch: expected ${expected}, got ${actual}`;
      this.logger.error(error);
      this.errors.push(error);
    } else {
      this.logger.success('Balance updated correctly', { expected, actual });
    }
  }

  /**
   * Assert message received within timeout
   */
  protected async assertMessageReceived(
    messageType: string,
    timeoutMs?: number
  ): Promise<GameMessage> {
    try {
      const message = await this.client.waitForMessage(messageType, timeoutMs);
      this.logger.success(`Received ${messageType}`);
      return message;
    } catch (error) {
      const errorMsg = `Failed to receive ${messageType}: ${error}`;
      this.logger.error(errorMsg);
      this.errors.push(errorMsg);
      throw error;
    }
  }

  /**
   * Wait for either game_move or game_result
   * Useful for games that might send either depending on game state.
   * Atomic games may return game_move (with final state) or game_result.
   * Returns the message along with which type it was.
   * Also handles error messages for better diagnostics.
   */
  protected async waitForGameOutcome(
    timeoutMs: number = 5000
  ): Promise<{ type: 'move' | 'result' | 'error'; message: GameMessage }> {
    try {
      const result = await Promise.race([
        this.client.waitForMessage('game_move', timeoutMs).then(msg => ({ type: 'move' as const, message: msg })),
        this.client.waitForMessage('game_result', timeoutMs).then(msg => ({ type: 'result' as const, message: msg })),
        this.client.waitForMessage('error', timeoutMs).then(msg => ({ type: 'error' as const, message: msg })),
      ]);

      if (result.type === 'error') {
        const errorMsg = `Game error: ${JSON.stringify(result.message)}`;
        this.logger.error(errorMsg);
        this.errors.push(errorMsg);
        // Still return the result so tests can inspect error details
      } else {
        this.logger.success(`Received game_${result.type}`);
      }
      return result;
    } catch (error) {
      const errorMsg = `Failed to receive game outcome: ${error}`;
      this.logger.error(errorMsg);
      this.errors.push(errorMsg);
      throw error;
    }
  }

  /**
   * Test reconnection scenario
   */
  async testReconnection(): Promise<void> {
    this.logger.info('=== Testing Reconnection ===');

    const balanceBeforeDisconnect = this.currentBalance;

    // Disconnect
    await this.client.reconnect();

    // Verify session restored
    const sessionReady = await this.client.waitForMessage('session_ready');
    if (sessionReady.sessionId !== this.sessionId) {
      this.warnings.push(
        'Session ID changed after reconnection (this might be expected)'
      );
      this.logger.warn('Session ID changed after reconnect');
    }

    // Verify balance maintained
    this.client.send({ type: 'get_balance' });
    const balanceMsg = await this.client.waitForMessage('balance');
    const balanceAfterReconnect = parseFloat(balanceMsg.balance as string);

    this.assertBalanceUpdated(balanceBeforeDisconnect, balanceAfterReconnect);
  }

  /**
   * Record game result for reporting
   */
  protected recordGameResult(
    bet: number,
    result: string,
    payout: number
  ): void {
    const balanceChange = payout - bet;
    this.currentBalance += balanceChange;

    this.gameResults.push({
      bet,
      result,
      payout,
      balanceChange,
    });

    this.logger.info('Game result', {
      bet,
      result,
      payout,
      balanceChange,
      newBalance: this.currentBalance,
    });
  }

  /**
   * Abstract method: Implement game-specific test logic
   */
  abstract runGameTests(): Promise<void>;

  /**
   * Run complete test suite
   */
  async run(): Promise<TestResult> {
    try {
      await this.setup();
      await this.runGameTests();
      await this.testReconnection();
    } catch (error) {
      this.logger.error('Test failed with exception', error);
      this.errors.push(`Exception: ${error}`);
    }

    return await this.teardown();
  }
}
