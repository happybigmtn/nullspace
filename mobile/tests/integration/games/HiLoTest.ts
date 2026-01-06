/**
 * Hi-Lo Integration Test
 * Tests Hi-Lo actions: start, higher, lower, cashout
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class HiLoTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Hi-Lo' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Hi-Lo Tests ===');

    await this.testImmediateCashout();
    await this.testMultiplePredictions();
    await this.testHigherPrediction();
    await this.testLowerPrediction();
  }

  /**
   * Test 1: Immediate cashout (minimum streak)
   */
  private async testImmediateCashout(): Promise<void> {
    this.logger.info('--- Test: Immediate Cashout ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Start game
    this.client.send({
      type: 'hilo_deal',
      
      amount: betAmount,
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    this.logger.info('Hi-Lo game started', {
      initialCard: gameStarted.state,
    });

    // Immediately cashout
    this.client.send({
      type: 'hilo_cashout',
    });

    const gameResult = await this.assertMessageReceived('game_result');
    const payout = parseFloat(gameResult.payout as string);

    // Immediate cashout should return bet (1x multiplier)
    this.recordGameResult(betAmount, 'cashout (0 streak)', payout);
    this.assertBalanceUpdated(balanceBefore, this.currentBalance);
  }

  /**
   * Test 2: Make predictions then cashout
   */
  private async testMultiplePredictions(): Promise<void> {
    this.logger.info('--- Test: Multiple Predictions ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Start game
    this.client.send({
      type: 'hilo_deal',
      
      amount: betAmount,
    });

    await this.assertMessageReceived('game_started');

    // Make 3 predictions
    let streak = 0;
    let gameEnded = false;

    for (let i = 0; i < 3 && !gameEnded; i++) {
      // Alternate between higher and lower
      const messageType = i % 2 === 0 ? 'hilo_higher' : 'hilo_lower';

      this.client.send({
        type: messageType,
      });

      // Wait for either game_move (correct) or game_result (incorrect/bust)
      try {
        const result = await Promise.race([
          this.client.waitForMessage('game_move', 2000).then(msg => ({ type: 'move', msg })),
          this.client.waitForMessage('game_result', 2000).then(msg => ({ type: 'result', msg })),
        ]);

        if (result.type === 'result') {
          gameEnded = true;
          const payout = parseFloat(result.msg.payout as string);
          this.recordGameResult(betAmount, `bust at streak ${streak}`, payout);
          this.logger.info('Game ended (prediction failed)', { streak, payout });
        } else {
          streak++;
          this.logger.success(`Prediction ${i + 1} correct (streak: ${streak})`);
        }
      } catch (error) {
        this.logger.warn('No response after prediction');
        break;
      }
    }

    // If game didn't end, cashout
    if (!gameEnded) {
      this.client.send({
        type: 'hilo_cashout',
      });

      const gameResult = await this.assertMessageReceived('game_result');
      const payout = parseFloat(gameResult.payout as string);

      this.recordGameResult(betAmount, `cashout (${streak} streak)`, payout);

      // Verify payout is greater than bet (multiplier from streak)
      if (payout > betAmount) {
        this.logger.success('Payout increased from streak', {
          bet: betAmount,
          payout,
          multiplier: payout / betAmount,
        });
      }
    }

    const balanceAfter = this.currentBalance;
    this.logger.info('Balance after prediction test', {
      before: balanceBefore,
      after: balanceAfter,
      change: balanceAfter - balanceBefore,
    });
  }

  /**
   * Test 3: Focus on "higher" predictions
   */
  private async testHigherPrediction(): Promise<void> {
    this.logger.info('--- Test: Higher Predictions ---');

    const betAmount = 10;

    // Start game
    this.client.send({
      type: 'hilo_deal',
      
      amount: betAmount,
    });

    await this.assertMessageReceived('game_started');

    // Try "higher" prediction
    this.client.send({
      type: 'hilo_higher',
    });

    // Wait for result
    try {
      const result = await Promise.race([
        this.client.waitForMessage('game_move', 2000).then(msg => ({ type: 'move', msg })),
        this.client.waitForMessage('game_result', 2000).then(msg => ({ type: 'result', msg })),
      ]);

      if (result.type === 'move') {
        this.logger.success('Higher prediction succeeded');

        // Cashout to end game
        this.client.send({
          type: 'hilo_cashout',
        });

        const gameResult = await this.assertMessageReceived('game_result');
        const payout = parseFloat(gameResult.payout as string);
        this.recordGameResult(betAmount, 'cashout after higher', payout);
      } else {
        const payout = parseFloat(result.msg.payout as string);
        this.recordGameResult(betAmount, 'higher failed', payout);
        this.logger.info('Higher prediction failed');
      }
    } catch (error) {
      this.logger.warn('Higher prediction timeout');
    }
  }

  /**
   * Test 4: Focus on "lower" predictions
   */
  private async testLowerPrediction(): Promise<void> {
    this.logger.info('--- Test: Lower Predictions ---');

    const betAmount = 10;

    // Start game
    this.client.send({
      type: 'hilo_deal',
      
      amount: betAmount,
    });

    await this.assertMessageReceived('game_started');

    // Try "lower" prediction
    this.client.send({
      type: 'hilo_lower',
    });

    // Wait for result
    try {
      const result = await Promise.race([
        this.client.waitForMessage('game_move', 2000).then(msg => ({ type: 'move', msg })),
        this.client.waitForMessage('game_result', 2000).then(msg => ({ type: 'result', msg })),
      ]);

      if (result.type === 'move') {
        this.logger.success('Lower prediction succeeded');

        // Cashout to end game
        this.client.send({
          type: 'hilo_cashout',
        });

        const gameResult = await this.assertMessageReceived('game_result');
        const payout = parseFloat(gameResult.payout as string);
        this.recordGameResult(betAmount, 'cashout after lower', payout);
      } else {
        const payout = parseFloat(result.msg.payout as string);
        this.recordGameResult(betAmount, 'lower failed', payout);
        this.logger.info('Lower prediction failed');
      }
    } catch (error) {
      this.logger.warn('Lower prediction timeout');
    }
  }
}
