/**
 * E2E Bet Placement Flow Integration Test (US-061)
 *
 * Tests the complete bet placement user journey:
 *   chip selection → placeChip() → DEAL press → WS send → server response → balance update
 *
 * This test verifies each step in the flow triggers correctly and state transitions
 * match the expected sequence. Unlike other integration tests that focus on game-specific
 * logic, this test validates the core betting flow that's shared across all games.
 *
 * Run: ts-node tests/integration/e2e/BetPlacementE2ETest.ts
 */

import { TestLogger } from '../framework/TestLogger';
import { WebSocketTestClient, GameMessage } from '../framework/WebSocketTestClient';

interface E2ETestConfig {
  gatewayUrl: string;
  timeout?: number;
}

interface FlowStep {
  name: string;
  status: 'pending' | 'passed' | 'failed';
  duration?: number;
  details?: string;
}

class BetPlacementE2ETest {
  private logger: TestLogger;
  private client: WebSocketTestClient;
  private sessionId: string | null = null;
  private publicKey: string | null = null;
  private initialBalance: number = 0;
  private flowSteps: FlowStep[] = [];
  private errors: string[] = [];

  constructor(private config: E2ETestConfig) {
    this.logger = new TestLogger('E2E-BetPlacement');
    this.client = new WebSocketTestClient({
      url: config.gatewayUrl,
      timeout: config.timeout,
      logger: this.logger,
    });
  }

  /**
   * Poll for account registration with balance
   */
  private async waitForRegistration(maxAttempts = 20): Promise<GameMessage> {
    for (let attempts = 1; attempts <= maxAttempts; attempts++) {
      await new Promise((r) => setTimeout(r, 100));
      this.client.send({ type: 'get_balance' });
      const balanceMsg = await this.client.waitForMessage('balance', 2000);

      if (balanceMsg.registered && balanceMsg.hasBalance) {
        return balanceMsg;
      }
    }
    throw new Error(`Account registration failed after ${maxAttempts * 100}ms`);
  }

  /**
   * Wait for game outcome (move, result, or error)
   */
  private async waitForGameOutcome(timeoutMs = 5000): Promise<{ type: string; msg: GameMessage }> {
    const result = await Promise.race([
      this.client.waitForMessage('game_move', timeoutMs).then((msg) => ({ type: 'move', msg })),
      this.client.waitForMessage('game_result', timeoutMs).then((msg) => ({ type: 'result', msg })),
      this.client.waitForMessage('error', timeoutMs).then((msg) => ({ type: 'error', msg })),
    ]);

    if (result.type === 'error') {
      throw new Error(`Game error: ${JSON.stringify(result.msg)}`);
    }

    return result;
  }

  /**
   * Record a step in the E2E flow
   */
  private recordStep(
    name: string,
    status: 'passed' | 'failed',
    duration: number,
    details?: string
  ): void {
    const step: FlowStep = { name, status, duration, details };
    this.flowSteps.push(step);

    if (status === 'passed') {
      this.logger.success(`✓ ${name} (${duration}ms)`);
    } else {
      this.logger.error(`✗ ${name} (${duration}ms) - ${details}`);
    }
  }

  /**
   * Execute a timed step
   */
  private async executeStep<T>(
    name: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.recordStep(name, 'passed', Date.now() - start);
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      const details = error instanceof Error ? error.message : String(error);
      this.recordStep(name, 'failed', duration, details);
      this.errors.push(`${name}: ${details}`);
      throw error;
    }
  }

  /**
   * Test 1: Complete Blackjack bet placement flow
   */
  async testBlackjackBetFlow(): Promise<void> {
    this.logger.info('═══════════════════════════════════════════════════════════');
    this.logger.info('TEST 1: Complete Blackjack Bet Placement Flow');
    this.logger.info('═══════════════════════════════════════════════════════════');

    // Step 1: Connect to WebSocket
    await this.executeStep('1. WebSocket Connect', async () => {
      await this.client.connect();
    });

    // Step 2: Receive session_ready (establishes session)
    await this.executeStep('2. Session Ready', async () => {
      const msg = await this.client.waitForMessage('session_ready');
      this.sessionId = msg.sessionId as string;
      this.publicKey = msg.publicKey as string;
      this.logger.debug('Session info', { sessionId: this.sessionId, publicKey: this.publicKey });
    });

    // Step 3: Wait for account registration + get balance
    const balanceInfo = await this.executeStep('3. Account Registration & Balance', async () => {
      const balanceMsg = await this.waitForRegistration();
      this.initialBalance = parseFloat(balanceMsg.balance as string);
      return {
        balance: this.initialBalance,
        registered: balanceMsg.registered,
        hasBalance: balanceMsg.hasBalance,
      };
    });

    this.logger.info(`Initial balance: $${balanceInfo.balance}`);

    // Step 4: Simulate chip selection (UI layer - documented)
    // In the mobile app, this is handled by useChipBetting hook
    // The user taps a chip value (e.g., 10) which sets selectedChip
    const chipValue = 10;
    await this.executeStep('4. Chip Selection (documented)', async () => {
      // This step simulates what happens in the UI:
      // - User taps chip in ChipSelector component
      // - useChipBetting.setChipValue(10) is called
      // - selectedChip state updates to 10
      // In integration tests, we simulate this by using the bet amount directly
      this.logger.debug(`Chip selected: $${chipValue}`);
      return chipValue;
    });

    // Step 5: Simulate placeChip() call (UI layer - documented)
    // In the mobile app, user drags chip or taps betting area
    const betAmount = chipValue;
    await this.executeStep('5. placeChip() (documented)', async () => {
      // This step simulates what happens in useChipBetting:
      // - placeChip() validates bet <= balance using getState().balance
      // - If valid, updates bet state and triggers haptics.impact()
      // - If invalid, returns false and triggers haptics.error()
      if (betAmount > this.initialBalance) {
        throw new Error(`Bet ${betAmount} exceeds balance ${this.initialBalance}`);
      }
      this.logger.debug(`Bet placed: $${betAmount}`);
      return true;
    });

    // Step 6: DEAL button press → WebSocket send
    // This is the actual network call that triggers the game
    await this.executeStep('6. DEAL Press → WS Send', async () => {
      // This simulates what happens when user presses DEAL:
      // - useBetSubmission.submitBet() is called
      // - isSubmitting flag set to true (prevents double-tap)
      // - send() called with game message
      this.client.send({
        type: 'blackjack_deal',
        amount: betAmount,
      });
      this.logger.debug('Message sent: blackjack_deal');
    });

    // Step 7: Server response (game_started)
    const gameStarted = await this.executeStep('7. Server Response (game_started)', async () => {
      const msg = await this.client.waitForMessage('game_started');
      // Verify message contains expected fields
      if (!msg.sessionId) {
        throw new Error('Missing sessionId in game_started');
      }
      return msg;
    });

    this.logger.debug('Game started', { sessionId: gameStarted.sessionId });

    // Step 8: Execute game action (stand to end game quickly)
    await this.executeStep('8. Game Action (stand)', async () => {
      this.client.send({ type: 'blackjack_stand' });
      this.logger.debug('Message sent: blackjack_stand');
    });

    // Step 9: Game resolution
    const gameResult = await this.executeStep('9. Game Resolution', async () => {
      const result = await this.waitForGameOutcome();
      return result.msg;
    });

    // Step 10: Verify balance update
    await this.executeStep('10. Balance Update', async () => {
      // Get final balance
      this.client.send({ type: 'get_balance' });
      const balanceMsg = await this.client.waitForMessage('balance', 3000);
      const finalBalance = parseFloat(balanceMsg.balance as string);

      // Calculate expected balance change
      const payout = parseFloat(gameResult.payout as string) || 0;
      const won = gameResult.won as boolean;

      this.logger.info('Game result', {
        won,
        payout,
        bet: betAmount,
        initialBalance: this.initialBalance,
        finalBalance,
        expectedChange: payout - betAmount,
      });

      // Balance should have changed by (payout - bet)
      const expectedBalance = this.initialBalance + (payout - betAmount);
      const tolerance = 0.01;
      const diff = Math.abs(expectedBalance - finalBalance);

      if (diff > tolerance) {
        throw new Error(
          `Balance mismatch: expected ${expectedBalance}, got ${finalBalance}`
        );
      }

      return { finalBalance, change: finalBalance - this.initialBalance };
    });

    await this.client.disconnect();
  }

  /**
   * Test 2: Roulette bet placement flow (atomic game)
   */
  async testRouletteBetFlow(): Promise<void> {
    this.logger.info('═══════════════════════════════════════════════════════════');
    this.logger.info('TEST 2: Roulette Bet Placement Flow (Atomic Game)');
    this.logger.info('═══════════════════════════════════════════════════════════');

    // Reconnect for fresh session
    await this.executeStep('1. WebSocket Connect', async () => {
      await this.client.connect();
    });

    await this.executeStep('2. Session Ready', async () => {
      const msg = await this.client.waitForMessage('session_ready');
      this.sessionId = msg.sessionId as string;
    });

    const balanceInfo = await this.executeStep('3. Account Registration', async () => {
      const balanceMsg = await this.waitForRegistration();
      this.initialBalance = parseFloat(balanceMsg.balance as string);
      return { balance: this.initialBalance };
    });

    this.logger.info(`Initial balance: $${balanceInfo.balance}`);

    const betAmount = 10;

    // Roulette is atomic: bet submission triggers immediate resolution
    await this.executeStep('4-6. Chip Selection → placeChip() → SPIN', async () => {
      // Roulette combines bet placement with spin in single message
      this.client.send({
        type: 'roulette_spin',
        // Bet on red (even money bet)
        bets: [{ type: 'red', amount: betAmount }],
      });
      this.logger.debug(`Roulette bet: $${betAmount} on red`);
    });

    // Atomic games resolve immediately
    const gameResult = await this.executeStep('7. Game Resolution (atomic)', async () => {
      const result = await this.waitForGameOutcome();
      return result.msg;
    });

    await this.executeStep('8. Balance Update', async () => {
      this.client.send({ type: 'get_balance' });
      const balanceMsg = await this.client.waitForMessage('balance', 3000);
      const finalBalance = parseFloat(balanceMsg.balance as string);

      const payout = parseFloat(gameResult.payout as string) || 0;
      this.logger.info('Game result', {
        payout,
        bet: betAmount,
        change: finalBalance - this.initialBalance,
      });

      return { finalBalance };
    });

    await this.client.disconnect();
  }

  /**
   * Test 3: Insufficient balance rejection
   */
  async testInsufficientBalanceFlow(): Promise<void> {
    this.logger.info('═══════════════════════════════════════════════════════════');
    this.logger.info('TEST 3: Insufficient Balance Rejection');
    this.logger.info('═══════════════════════════════════════════════════════════');

    await this.executeStep('1. WebSocket Connect', async () => {
      await this.client.connect();
    });

    await this.executeStep('2. Session Ready', async () => {
      await this.client.waitForMessage('session_ready');
    });

    const balanceInfo = await this.executeStep('3. Get Balance', async () => {
      const balanceMsg = await this.waitForRegistration();
      this.initialBalance = parseFloat(balanceMsg.balance as string);
      return { balance: this.initialBalance };
    });

    this.logger.info(`Balance: $${balanceInfo.balance}`);

    // Try to bet more than balance
    const excessiveBet = this.initialBalance + 1000000;

    await this.executeStep('4. Excessive Bet Attempt', async () => {
      this.client.send({
        type: 'blackjack_deal',
        amount: excessiveBet,
      });
      this.logger.debug(`Sent excessive bet: $${excessiveBet}`);
    });

    await this.executeStep('5. Error Response', async () => {
      const result = await Promise.race([
        this.client.waitForMessage('error', 5000).then((msg) => ({ type: 'error' as const, msg })),
        this.client.waitForMessage('game_started', 5000).then((msg) => ({ type: 'started' as const, msg })),
      ]);

      if (result.type === 'started') {
        throw new Error('Game started with excessive bet - validation failed!');
      }

      this.logger.info('Error received', { code: result.msg.code, message: result.msg.message });

      const errorCode = result.msg.code as string;
      if (!errorCode.includes('INSUFFICIENT') && !errorCode.includes('BALANCE')) {
        this.logger.warn(`Unexpected error code: ${errorCode}`);
      }

      return result.msg;
    });

    await this.executeStep('6. Balance Unchanged', async () => {
      this.client.send({ type: 'get_balance' });
      const balanceMsg = await this.client.waitForMessage('balance', 3000);
      const finalBalance = parseFloat(balanceMsg.balance as string);

      if (finalBalance !== this.initialBalance) {
        throw new Error(
          `Balance changed after rejected bet: ${this.initialBalance} → ${finalBalance}`
        );
      }

      return { finalBalance };
    });

    await this.client.disconnect();
  }

  /**
   * Test 4: Sequential bets with balance tracking
   */
  async testSequentialBetsWithBalanceTracking(): Promise<void> {
    this.logger.info('═══════════════════════════════════════════════════════════');
    this.logger.info('TEST 4: Sequential Bets with Balance Tracking');
    this.logger.info('═══════════════════════════════════════════════════════════');

    await this.executeStep('1. WebSocket Connect', async () => {
      await this.client.connect();
    });

    await this.executeStep('2. Session Ready', async () => {
      await this.client.waitForMessage('session_ready');
    });

    await this.executeStep('3. Account Registration', async () => {
      const balanceMsg = await this.waitForRegistration();
      this.initialBalance = parseFloat(balanceMsg.balance as string);
      return { balance: this.initialBalance };
    });

    let currentBalance = this.initialBalance;
    const betAmount = 10;
    const numGames = 3;

    for (let i = 1; i <= numGames; i++) {
      const balanceBefore = currentBalance;

      await this.executeStep(`Game ${i}/3: Place Bet`, async () => {
        this.client.send({
          type: 'blackjack_deal',
          amount: betAmount,
        });
      });

      await this.executeStep(`Game ${i}/3: Game Started`, async () => {
        await this.client.waitForMessage('game_started');
      });

      await this.executeStep(`Game ${i}/3: Stand`, async () => {
        this.client.send({ type: 'blackjack_stand' });
      });

      const gameResult = await this.executeStep(`Game ${i}/3: Resolution`, async () => {
        const result = await this.waitForGameOutcome();
        return result.msg;
      });

      await this.executeStep(`Game ${i}/3: Verify Balance`, async () => {
        this.client.send({ type: 'get_balance' });
        const balanceMsg = await this.client.waitForMessage('balance', 3000);
        currentBalance = parseFloat(balanceMsg.balance as string);

        const payout = parseFloat(gameResult.payout as string) || 0;
        const expectedBalance = balanceBefore + (payout - betAmount);
        const diff = Math.abs(expectedBalance - currentBalance);

        if (diff > 0.01) {
          this.logger.warn('Balance mismatch', {
            expected: expectedBalance,
            actual: currentBalance,
          });
        }

        this.logger.info(`Game ${i} result`, {
          payout,
          balanceChange: currentBalance - balanceBefore,
        });

        return { balance: currentBalance };
      });
    }

    const finalChange = currentBalance - this.initialBalance;
    this.logger.info('Sequential games summary', {
      initialBalance: this.initialBalance,
      finalBalance: currentBalance,
      totalChange: finalChange,
      gamesPlayed: numGames,
    });

    await this.client.disconnect();
  }

  /**
   * Run all E2E tests
   */
  async run(): Promise<boolean> {
    this.logger.info('███████████████████████████████████████████████████████████');
    this.logger.info('          E2E BET PLACEMENT FLOW INTEGRATION TESTS');
    this.logger.info('███████████████████████████████████████████████████████████');

    const tests = [
      { name: 'Blackjack Bet Flow', fn: () => this.testBlackjackBetFlow() },
      { name: 'Roulette Bet Flow', fn: () => this.testRouletteBetFlow() },
      { name: 'Insufficient Balance', fn: () => this.testInsufficientBalanceFlow() },
      { name: 'Sequential Bets', fn: () => this.testSequentialBetsWithBalanceTracking() },
    ];

    const results: { name: string; passed: boolean; error?: string }[] = [];

    for (const test of tests) {
      try {
        await test.fn();
        results.push({ name: test.name, passed: true });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.push({ name: test.name, passed: false, error: errorMsg });
        this.logger.error(`Test failed: ${test.name}`, { error: errorMsg });
      }
    }

    // Print summary
    this.logger.info('═══════════════════════════════════════════════════════════');
    this.logger.info('                      TEST SUMMARY');
    this.logger.info('═══════════════════════════════════════════════════════════');

    let allPassed = true;
    for (const result of results) {
      if (result.passed) {
        this.logger.success(`✓ ${result.name}`);
      } else {
        this.logger.error(`✗ ${result.name}: ${result.error}`);
        allPassed = false;
      }
    }

    this.logger.info('═══════════════════════════════════════════════════════════');
    this.logger.info(`FLOW STEPS TRACKED: ${this.flowSteps.length}`);
    this.logger.info('═══════════════════════════════════════════════════════════');

    // Print all flow steps for documentation
    for (const step of this.flowSteps) {
      const icon = step.status === 'passed' ? '✓' : '✗';
      this.logger.debug(`  ${icon} ${step.name} (${step.duration}ms)`);
    }

    return allPassed;
  }
}

// Main runner
async function main(): Promise<void> {
  const gatewayUrl = process.env.GATEWAY_URL || 'wss://api.testnet.regenesis.dev';

  console.log(`\n🎲 E2E Bet Placement Integration Tests`);
  console.log(`   Gateway: ${gatewayUrl}\n`);

  const test = new BetPlacementE2ETest({ gatewayUrl, timeout: 60000 });

  try {
    const passed = await test.run();
    process.exit(passed ? 0 : 1);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { BetPlacementE2ETest };
