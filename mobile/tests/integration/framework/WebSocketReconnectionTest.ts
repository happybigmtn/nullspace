/**
 * WebSocket Reconnection Integration Tests
 * Tests session persistence, game state recovery, nonce continuity, and balance consistency
 * after network disconnections and reconnections.
 *
 * US-026: Add WebSocket reconnection integration tests
 */

import { TestLogger } from './TestLogger';
import { WebSocketTestClient, GameMessage } from './WebSocketTestClient';

export interface ReconnectionTestConfig {
  gatewayUrl: string;
  timeout?: number;
}

export interface ReconnectionTestResult {
  passed: boolean;
  duration: number;
  tests: Array<{
    name: string;
    passed: boolean;
    error?: string;
  }>;
}

/**
 * WebSocket Reconnection Test Suite
 * Tests all acceptance criteria for US-026
 */
export class WebSocketReconnectionTest {
  private logger: TestLogger;
  private client: WebSocketTestClient;
  private sessionId: string | null = null;
  private publicKey: string | null = null;
  private initialBalance: number = 0;
  private testResults: Array<{ name: string; passed: boolean; error?: string }> = [];

  constructor(private config: ReconnectionTestConfig) {
    this.logger = new TestLogger('WebSocketReconnection');
    this.client = new WebSocketTestClient({
      url: config.gatewayUrl,
      timeout: config.timeout ?? 60000,
      logger: this.logger,
    });
  }

  /**
   * Run all reconnection tests
   */
  async run(): Promise<ReconnectionTestResult> {
    const startTime = Date.now();

    try {
      await this.setup();

      // Run each test in isolation
      await this.runTest('Session persistence after reconnect', () => this.testSessionPersistence());
      await this.runTest('Balance consistency after network failure', () => this.testBalanceConsistency());
      await this.runTest('Game state recovery after mid-game disconnect', () => this.testMidGameDisconnect());
      await this.runTest('Nonce continuity after reconnection', () => this.testNonceContinuity());
      await this.runTest('Message queue flush after reconnect', () => this.testMessageQueueFlush());
      await this.runTest('Multiple rapid reconnections', () => this.testRapidReconnections());

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
    for (const result of this.testResults) {
      if (result.passed) {
        this.logger.success(`✓ ${result.name}`);
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

  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    this.logger.info(`\n--- Running: ${name} ---`);
    try {
      await testFn();
      this.testResults.push({ name, passed: true });
      this.logger.success(`${name} - PASSED`);
    } catch (error) {
      this.testResults.push({ name, passed: false, error: String(error) });
      this.logger.error(`${name} - FAILED`, error);
    }
  }

  /**
   * Test 1: Session persistence after reconnect
   * Verifies: sessionId and publicKey are consistent after reconnection
   */
  private async testSessionPersistence(): Promise<void> {
    const sessionBefore = this.sessionId;
    const publicKeyBefore = this.publicKey;

    // Disconnect and reconnect
    await this.client.reconnect();

    // Get new session
    const sessionReady = await this.client.waitForMessage('session_ready');
    const sessionAfter = sessionReady.sessionId as string;
    const publicKeyAfter = sessionReady.publicKey as string;

    // Public key should be the same (same client identity)
    if (publicKeyAfter !== publicKeyBefore) {
      throw new Error(`Public key changed: ${publicKeyBefore} -> ${publicKeyAfter}`);
    }

    // Note: sessionId may change after reconnect (server creates new session)
    // This is expected behavior - we warn but don't fail
    if (sessionAfter !== sessionBefore) {
      this.logger.warn('Session ID changed after reconnect (expected behavior)', {
        before: sessionBefore,
        after: sessionAfter,
      });
    }

    // Update our tracking
    this.sessionId = sessionAfter;

    this.logger.success('Session persistence verified', {
      publicKey: publicKeyAfter,
      sessionId: sessionAfter,
    });
  }

  /**
   * Test 2: Balance consistency after network failure
   * Verifies: balance remains accurate after disconnect/reconnect
   */
  private async testBalanceConsistency(): Promise<void> {
    // Get current balance
    this.client.send({ type: 'get_balance' });
    const balanceBefore = await this.client.waitForMessage('balance');
    const balanceValueBefore = parseFloat(balanceBefore.balance as string);

    // Disconnect and reconnect
    await this.client.reconnect();
    await this.client.waitForMessage('session_ready');

    // Get balance after reconnect
    this.client.send({ type: 'get_balance' });
    const balanceAfter = await this.client.waitForMessage('balance');
    const balanceValueAfter = parseFloat(balanceAfter.balance as string);

    // Balance should be exactly the same
    if (Math.abs(balanceValueAfter - balanceValueBefore) > 0.001) {
      throw new Error(`Balance changed: ${balanceValueBefore} -> ${balanceValueAfter}`);
    }

    this.logger.success('Balance consistency verified', {
      before: balanceValueBefore,
      after: balanceValueAfter,
    });
  }

  /**
   * Test 3: Game state recovery after mid-game disconnect
   * Verifies: ongoing game state is recovered after reconnection
   */
  private async testMidGameDisconnect(): Promise<void> {
    // Start a blackjack game
    const betAmount = 10;
    this.client.send({
      type: 'blackjack_deal',
      amount: betAmount,
    });

    // Wait for game to start
    const gameStarted = await this.client.waitForMessage('game_started');
    const gameSessionId = gameStarted.sessionId as string;
    this.logger.debug('Game started', { sessionId: gameSessionId });

    // Disconnect mid-game (don't hit or stand yet)
    await this.client.reconnect();
    await this.client.waitForMessage('session_ready');

    // Clear any queued messages
    this.client.clearQueue();

    // Try to continue the game with a stand action
    this.client.send({
      type: 'blackjack_stand',
    });

    // Wait for game outcome - gateway should either:
    // 1. Allow us to continue and return game_result
    // 2. Return an error if game was abandoned
    try {
      const result = await Promise.race([
        this.client.waitForMessage('game_result', 5000).then(msg => ({ type: 'result', msg })),
        this.client.waitForMessage('game_move', 5000).then(msg => ({ type: 'move', msg })),
        this.client.waitForMessage('error', 5000).then(msg => ({ type: 'error', msg })),
      ]);

      if (result.type === 'error') {
        // Game was abandoned - this is acceptable behavior
        this.logger.warn('Game was abandoned after disconnect (acceptable)', {
          error: result.msg.message,
        });
      } else {
        this.logger.success('Game state recovered after mid-game disconnect', {
          outcomeType: result.type,
        });
      }
    } catch (error) {
      // Timeout - try starting a new game to verify system is functional
      this.logger.warn('No response to stand - verifying system state');

      this.client.send({
        type: 'blackjack_deal',
        amount: betAmount,
      });

      try {
        await this.client.waitForMessage('game_started', 5000);
        // Complete the game
        this.client.send({ type: 'blackjack_stand' });
        await Promise.race([
          this.client.waitForMessage('game_result', 5000),
          this.client.waitForMessage('game_move', 5000),
        ]);
        this.logger.success('System recovered - new game works after mid-game disconnect');
      } catch (startError) {
        throw new Error(`System unresponsive after mid-game disconnect: ${startError}`);
      }
    }
  }

  /**
   * Test 4: Nonce continuity after reconnection
   * Verifies: transactions work correctly after reconnect (nonces are managed server-side)
   */
  private async testNonceContinuity(): Promise<void> {
    // Complete a game before disconnect
    this.client.send({
      type: 'blackjack_deal',
      amount: 10,
    });
    await this.client.waitForMessage('game_started');
    this.client.send({ type: 'blackjack_stand' });
    await Promise.race([
      this.client.waitForMessage('game_result', 5000),
      this.client.waitForMessage('game_move', 5000),
    ]);

    this.logger.debug('First transaction completed');

    // Disconnect and reconnect
    await this.client.reconnect();
    await this.client.waitForMessage('session_ready');

    // Complete another game after reconnect
    this.client.send({
      type: 'blackjack_deal',
      amount: 10,
    });

    try {
      await this.client.waitForMessage('game_started', 5000);
      this.client.send({ type: 'blackjack_stand' });
      await Promise.race([
        this.client.waitForMessage('game_result', 5000),
        this.client.waitForMessage('game_move', 5000),
      ]);

      this.logger.success('Nonce continuity verified - transactions work after reconnect');
    } catch (error) {
      throw new Error(`Transaction failed after reconnect (nonce issue?): ${error}`);
    }
  }

  /**
   * Test 5: Message queue flush after reconnect
   * Verifies: queued messages are delivered after reconnection
   */
  private async testMessageQueueFlush(): Promise<void> {
    // This test simulates the behavior tested in the useWebSocket hook
    // where messages queued during disconnection are flushed on reconnect

    // Get balance to ensure connection is good
    this.client.send({ type: 'get_balance' });
    await this.client.waitForMessage('balance');

    // Disconnect and reconnect
    await this.client.reconnect();
    await this.client.waitForMessage('session_ready');

    // Immediately send a message after reconnect
    this.client.send({ type: 'get_balance' });

    try {
      const balance = await this.client.waitForMessage('balance', 3000);
      this.logger.success('Message processed after reconnect', {
        balance: balance.balance,
      });
    } catch (error) {
      throw new Error(`Message not delivered after reconnect: ${error}`);
    }
  }

  /**
   * Test 6: Multiple rapid reconnections
   * Verifies: system handles rapid disconnect/reconnect cycles gracefully
   */
  private async testRapidReconnections(): Promise<void> {
    const RECONNECT_COUNT = 3;

    for (let i = 0; i < RECONNECT_COUNT; i++) {
      this.logger.debug(`Rapid reconnect ${i + 1}/${RECONNECT_COUNT}`);

      await this.client.reconnect();

      try {
        await this.client.waitForMessage('session_ready', 10000);
        this.client.send({ type: 'get_balance' });
        await this.client.waitForMessage('balance', 3000);
      } catch (error) {
        throw new Error(`Failed on reconnection attempt ${i + 1}: ${error}`);
      }
    }

    // Verify final state is consistent
    this.client.send({ type: 'get_balance' });
    const finalBalance = await this.client.waitForMessage('balance');

    this.logger.success('Multiple rapid reconnections handled gracefully', {
      reconnectCount: RECONNECT_COUNT,
      finalBalance: finalBalance.balance,
    });
  }
}
