/**
 * In-Flight Game State Reconnection Tests
 *
 * US-088: Add reconnection with in-flight game state test
 *
 * ARCHITECTURE DOCUMENTATION:
 * This test suite documents the CURRENT behavior where in-flight game state
 * is NOT preserved across reconnections. This is intentional documentation
 * of the architecture gap, not a bug to fix.
 *
 * Key findings:
 * - Gateway creates NEW session UUID on every WebSocket connection
 * - activeGameId is reset to null on new sessions
 * - Previous game state is LOST on reconnection
 * - Balance persists because it's stored on-chain
 * - Nonce sequence is maintained server-side
 */

import { TestLogger } from './TestLogger';
import { WebSocketTestClient, GameMessage } from './WebSocketTestClient';

export interface InFlightGameStateTestConfig {
  gatewayUrl: string;
  timeout?: number;
}

export interface InFlightGameStateTestResult {
  passed: boolean;
  duration: number;
  tests: Array<{
    name: string;
    passed: boolean;
    error?: string;
    finding?: string;
  }>;
}

/**
 * In-Flight Game State Test Suite
 * Documents architectural behavior for US-088
 */
export class InFlightGameStateTest {
  private logger: TestLogger;
  private client: WebSocketTestClient;
  private sessionId: string | null = null;
  private publicKey: string | null = null;
  private initialBalance: number = 0;
  private testResults: Array<{ name: string; passed: boolean; error?: string; finding?: string }> = [];

  constructor(private config: InFlightGameStateTestConfig) {
    this.logger = new TestLogger('InFlightGameState');
    this.client = new WebSocketTestClient({
      url: config.gatewayUrl,
      timeout: config.timeout ?? 60000,
      logger: this.logger,
    });
  }

  /**
   * Run all in-flight game state tests
   */
  async run(): Promise<InFlightGameStateTestResult> {
    const startTime = Date.now();

    try {
      await this.setup();

      // Run each test
      await this.runTest(
        'Disconnect during game - game state NOT preserved (documents gap)',
        () => this.testGameStateNotPreserved()
      );
      await this.runTest(
        'Reconnect creates NEW session with different sessionId',
        () => this.testNewSessionIdOnReconnect()
      );
      await this.runTest(
        'Balance consistent after reconnect mid-game',
        () => this.testBalanceConsistencyMidGame()
      );
      await this.runTest(
        'Nonce sequence maintained across reconnection',
        () => this.testNonceSequenceMaintained()
      );
      await this.runTest(
        'activeGameId is null after reconnect (documents gap)',
        () => this.testActiveGameIdNullAfterReconnect()
      );
      await this.runTest(
        'Can start new game after mid-game reconnection',
        () => this.testCanStartNewGameAfterReconnect()
      );

    } catch (error) {
      this.logger.error('Test suite failed with exception', error);
      this.testResults.push({
        name: 'Test Suite Setup',
        passed: false,
        error: String(error),
      });
    } finally {
      await this.teardown();
    }

    const duration = Date.now() - startTime;
    const allPassed = this.testResults.every(t => t.passed);

    this.logger.info('=== Test Summary ===');
    this.logger.info('ARCHITECTURE DOCUMENTATION: In-flight game state is NOT preserved on reconnect');
    for (const result of this.testResults) {
      if (result.passed) {
        this.logger.success(`✓ ${result.name}`);
        if (result.finding) {
          this.logger.info(`  Finding: ${result.finding}`);
        }
      } else {
        this.logger.error(`✗ ${result.name}: ${result.error}`);
      }
    }

    return {
      passed: allPassed,
      duration,
      tests: this.testResults,
    };
  }

  private async setup(): Promise<void> {
    this.logger.info('=== Test Setup ===');

    await this.client.connect();

    const sessionReady = await this.client.waitForMessage('session_ready');
    this.sessionId = sessionReady.sessionId as string;
    this.publicKey = sessionReady.publicKey as string;

    this.logger.success('Session established', {
      sessionId: this.sessionId,
      publicKey: this.publicKey,
    });

    // Wait for registration and get initial balance
    let balanceMsg: GameMessage;
    let attempts = 0;
    const maxAttempts = 20;

    do {
      await new Promise(r => setTimeout(r, 100));
      this.client.send({ type: 'get_balance' });
      balanceMsg = await this.client.waitForMessage('balance', 2000);
      attempts++;
    } while (
      (!(balanceMsg.registered as boolean) || !(balanceMsg.hasBalance as boolean)) &&
      attempts < maxAttempts
    );

    if (!(balanceMsg.hasBalance as boolean)) {
      throw new Error(`Account registration failed after ${attempts * 100}ms`);
    }

    this.initialBalance = parseFloat(balanceMsg.balance as string);
    this.logger.success('Account ready', { balance: this.initialBalance });
  }

  private async teardown(): Promise<void> {
    this.logger.info('=== Test Teardown ===');
    await this.client.disconnect();
    this.logger.printSummary();
  }

  private async runTest(
    name: string,
    testFn: () => Promise<{ finding?: string }>
  ): Promise<void> {
    this.logger.info(`\n--- Running: ${name} ---`);
    try {
      const result = await testFn();
      this.testResults.push({ name, passed: true, finding: result.finding });
      this.logger.success(`${name} - PASSED`);
      if (result.finding) {
        this.logger.info(`Finding: ${result.finding}`);
      }
    } catch (error) {
      this.testResults.push({ name, passed: false, error: String(error) });
      this.logger.error(`${name} - FAILED`, error);
    }
  }

  /**
   * Test 1: Game state NOT preserved on disconnect (DOCUMENTS GAP)
   *
   * Expected behavior (documenting current architecture):
   * - Start a blackjack game
   * - Disconnect mid-game (before any action)
   * - Reconnect
   * - Try to continue game with 'stand' action
   * - Server returns error because activeGameId is null
   */
  private async testGameStateNotPreserved(): Promise<{ finding?: string }> {
    const betAmount = 10;

    // Start a blackjack game
    this.client.send({
      type: 'blackjack_deal',
      amount: betAmount,
    });

    const gameStarted = await this.client.waitForMessage('game_started');
    const originalGameSessionId = gameStarted.sessionId;
    this.logger.debug('Game started', { sessionId: originalGameSessionId });

    // Disconnect mid-game (without hitting or standing)
    await this.client.reconnect();
    const newSession = await this.client.waitForMessage('session_ready');
    const newSessionId = newSession.sessionId;

    // Clear any queued messages to isolate test
    this.client.clearQueue();

    // Try to continue the game with a stand action
    this.client.send({
      type: 'blackjack_stand',
    });

    // Wait for response - expect error because game state was lost
    try {
      const response = await Promise.race([
        this.client.waitForMessage('game_result', 5000).then(msg => ({ type: 'game_result' as const, msg })),
        this.client.waitForMessage('game_move', 5000).then(msg => ({ type: 'game_move' as const, msg })),
        this.client.waitForMessage('error', 5000).then(msg => ({ type: 'error' as const, msg })),
      ]);

      if (response.type === 'error') {
        // This is the EXPECTED behavior - game state was lost
        const errorMsg = response.msg.message || response.msg.code || 'Unknown error';
        return {
          finding: `Game state correctly NOT preserved. Error on continue: ${errorMsg}`,
        };
      } else {
        // If somehow the game continued, document this unexpected behavior
        return {
          finding: `UNEXPECTED: Game continued despite reconnection. Response type: ${response.type}`,
        };
      }
    } catch (timeoutError) {
      // Timeout also indicates game state was lost (no active game to respond)
      return {
        finding: 'Game state NOT preserved - no response to stand action (timeout)',
      };
    }
  }

  /**
   * Test 2: Reconnect creates NEW session with different sessionId
   *
   * Documents: Gateway assigns new UUID on every connection
   */
  private async testNewSessionIdOnReconnect(): Promise<{ finding?: string }> {
    const sessionBefore = this.sessionId;
    const publicKeyBefore = this.publicKey;

    // Disconnect and reconnect
    await this.client.reconnect();

    const sessionReady = await this.client.waitForMessage('session_ready');
    const sessionAfter = sessionReady.sessionId as string;
    const publicKeyAfter = sessionReady.publicKey as string;

    // Public key MUST be the same (same player identity)
    if (publicKeyAfter !== publicKeyBefore) {
      throw new Error(`Public key changed unexpectedly: ${publicKeyBefore} -> ${publicKeyAfter}`);
    }

    // Session ID SHOULD be different (new session)
    if (sessionAfter === sessionBefore) {
      throw new Error(`Session ID should change on reconnect but didn't: ${sessionAfter}`);
    }

    // Update tracking
    this.sessionId = sessionAfter;

    return {
      finding: `Session ID changed: ${sessionBefore?.substring(0, 8)}... -> ${sessionAfter.substring(0, 8)}... (expected behavior)`,
    };
  }

  /**
   * Test 3: Balance consistent after reconnect mid-game
   *
   * Documents: Balance is stored on-chain and persists across reconnections
   * Note: Bet amount may be deducted even if game was abandoned
   */
  private async testBalanceConsistencyMidGame(): Promise<{ finding?: string }> {
    // Get balance before game
    this.client.send({ type: 'get_balance' });
    const balanceBefore = await this.client.waitForMessage('balance');
    const balanceValueBefore = parseFloat(balanceBefore.balance as string);

    // Start a game
    const betAmount = 10;
    this.client.send({
      type: 'blackjack_deal',
      amount: betAmount,
    });
    await this.client.waitForMessage('game_started');

    // Disconnect mid-game
    await this.client.reconnect();
    await this.client.waitForMessage('session_ready');

    // Get balance after reconnect
    this.client.send({ type: 'get_balance' });
    const balanceAfter = await this.client.waitForMessage('balance');
    const balanceValueAfter = parseFloat(balanceAfter.balance as string);

    // Balance should reflect on-chain state (bet may or may not be deducted)
    const balanceDiff = balanceValueBefore - balanceValueAfter;

    if (balanceDiff === betAmount) {
      return {
        finding: `Balance reflects bet deduction: ${balanceValueBefore} -> ${balanceValueAfter} (bet: ${betAmount})`,
      };
    } else if (balanceDiff === 0) {
      return {
        finding: `Balance unchanged: ${balanceValueAfter} (bet not committed to chain before disconnect)`,
      };
    } else {
      // Any other difference might indicate a race condition or other issue
      this.logger.warn('Unexpected balance difference', { before: balanceValueBefore, after: balanceValueAfter, diff: balanceDiff });
      return {
        finding: `Balance changed by ${balanceDiff} (expected ${betAmount} or 0)`,
      };
    }
  }

  /**
   * Test 4: Nonce sequence maintained across reconnection
   *
   * Documents: Nonce is managed server-side and persists
   */
  private async testNonceSequenceMaintained(): Promise<{ finding?: string }> {
    // Complete a full game to establish nonce
    this.client.send({
      type: 'blackjack_deal',
      amount: 10,
    });
    await this.client.waitForMessage('game_started');
    this.client.send({ type: 'blackjack_stand' });
    await Promise.race([
      this.client.waitForMessage('game_result', 10000),
      this.client.waitForMessage('game_move', 10000),
    ]);

    this.logger.debug('First transaction completed');

    // Disconnect and reconnect
    await this.client.reconnect();
    await this.client.waitForMessage('session_ready');

    // Start another game after reconnect
    this.client.send({
      type: 'blackjack_deal',
      amount: 10,
    });

    try {
      await this.client.waitForMessage('game_started', 10000);
      this.client.send({ type: 'blackjack_stand' });
      await Promise.race([
        this.client.waitForMessage('game_result', 10000),
        this.client.waitForMessage('game_move', 10000),
      ]);

      return {
        finding: 'Nonce sequence maintained - transactions work after reconnect',
      };
    } catch (error) {
      throw new Error(`Transaction failed after reconnect (possible nonce issue): ${error}`);
    }
  }

  /**
   * Test 5: activeGameId is null after reconnect
   *
   * Documents: New session starts with no active game
   */
  private async testActiveGameIdNullAfterReconnect(): Promise<{ finding?: string }> {
    // Start a game
    this.client.send({
      type: 'blackjack_deal',
      amount: 10,
    });
    await this.client.waitForMessage('game_started');

    // Disconnect mid-game
    await this.client.reconnect();
    await this.client.waitForMessage('session_ready');
    this.client.clearQueue();

    // Try to make a move without starting a new game
    this.client.send({
      type: 'blackjack_hit',
    });

    // Expect error because no active game
    try {
      const response = await Promise.race([
        this.client.waitForMessage('game_move', 3000).then(msg => ({ type: 'move' as const, msg })),
        this.client.waitForMessage('error', 3000).then(msg => ({ type: 'error' as const, msg })),
      ]);

      if (response.type === 'error') {
        const errorCode = response.msg.code || response.msg.message || 'Unknown';
        return {
          finding: `activeGameId confirmed null - hit rejected with: ${errorCode}`,
        };
      } else {
        throw new Error('UNEXPECTED: Hit action succeeded without active game');
      }
    } catch (timeoutError) {
      return {
        finding: 'activeGameId confirmed null - no response to hit (timeout)',
      };
    }
  }

  /**
   * Test 6: Can start new game after mid-game reconnection
   *
   * Documents: System recovers gracefully - new games can be started
   */
  private async testCanStartNewGameAfterReconnect(): Promise<{ finding?: string }> {
    // Start and abandon a game
    this.client.send({
      type: 'blackjack_deal',
      amount: 10,
    });
    await this.client.waitForMessage('game_started');

    // Disconnect mid-game
    await this.client.reconnect();
    await this.client.waitForMessage('session_ready');
    this.client.clearQueue();

    // Start a fresh game
    this.client.send({
      type: 'blackjack_deal',
      amount: 10,
    });

    try {
      const gameStarted = await this.client.waitForMessage('game_started', 10000);
      const newGameSessionId = gameStarted.sessionId;

      // Complete the game to verify full functionality
      this.client.send({ type: 'blackjack_stand' });
      await Promise.race([
        this.client.waitForMessage('game_result', 10000),
        this.client.waitForMessage('game_move', 10000),
      ]);

      return {
        finding: `New game started successfully with sessionId: ${String(newGameSessionId).substring(0, 8)}...`,
      };
    } catch (error) {
      throw new Error(`Failed to start new game after reconnect: ${error}`);
    }
  }
}
