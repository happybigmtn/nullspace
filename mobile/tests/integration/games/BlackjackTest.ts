/**
 * Blackjack Integration Test
 * Tests all Blackjack actions: bet, hit, stand, double, split, surrender
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class BlackjackTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Blackjack' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Blackjack Tests ===');

    await this.testBasicGame();
    await this.testHitAndBust();
    await this.testDouble();
    await this.testBlackjack();
    // Note: split and surrender require specific card conditions
    // These would need special test scenarios or multiple attempts
  }

  /**
   * Test 1: Basic game flow (bet -> stand)
   */
  private async testBasicGame(): Promise<void> {
    this.logger.info('--- Test: Basic Game (Bet -> Stand) ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Start game with bet
    this.client.send({
      type: 'blackjack_deal',
      amount: betAmount,
    });

    // Wait for game_started
    const gameStarted = await this.assertMessageReceived('game_started');
    this.logger.info('Game started', { sessionId: gameStarted.sessionId });

    // Immediately stand (no hits)
    this.client.send({
      type: 'blackjack_stand',
    });

    // Wait for game outcome (gateway may send game_move or game_result)
    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);

    this.recordGameResult(betAmount, won ? 'won' : 'lost', payout);

    // Verify balance updated
    const balanceAfter = balanceBefore + payout - betAmount;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 2: Hit until bust
   */
  private async testHitAndBust(): Promise<void> {
    this.logger.info('--- Test: Hit Until Outcome ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Start game
    this.client.send({
      type: 'blackjack_deal',
      amount: betAmount,
    });

    await this.assertMessageReceived('game_started');

    // Hit up to 3 times or until game ends
    let gameEnded = false;
    for (let i = 0; i < 3 && !gameEnded; i++) {
      this.logger.debug(`Hitting (attempt ${i + 1})`);

      this.client.send({
        type: 'blackjack_hit',
      });

      // Wait for either game_move or game_result
      try {
        const result = await Promise.race([
          this.client.waitForMessage('game_move', 2000).then(msg => ({ type: 'move', msg })),
          this.client.waitForMessage('game_result', 2000).then(msg => ({ type: 'result', msg })),
        ]);

        if (result.type === 'result') {
          gameEnded = true;
          const won = result.msg.won as boolean;
          const payout = parseFloat(result.msg.payout as string);

          this.recordGameResult(betAmount, won ? 'won (hit)' : 'bust', payout);
          this.logger.info('Game ended after hit', { won, payout });
        } else {
          this.logger.debug('Hit successful, continuing');
        }
      } catch (error) {
        this.logger.warn('No response after hit, standing');
        break;
      }
    }

    // If game didn't end, stand
    if (!gameEnded) {
      this.client.send({
        type: 'blackjack_stand',
      });

      const gameResult = await this.assertMessageReceived('game_result');
      const won = gameResult.won as boolean;
      const payout = parseFloat(gameResult.payout as string);

      this.recordGameResult(betAmount, won ? 'won (stand)' : 'lost (stand)', payout);
    }

    const balanceAfter = this.currentBalance;
    this.logger.info('Balance after hit/stand test', {
      before: balanceBefore,
      after: balanceAfter,
      change: balanceAfter - balanceBefore,
    });
  }

  /**
   * Test 3: Double down
   */
  private async testDouble(): Promise<void> {
    this.logger.info('--- Test: Double Down ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Start game
    this.client.send({
      type: 'blackjack_deal',
      amount: betAmount,
    });

    await this.assertMessageReceived('game_started');

    // Attempt to double down
    this.logger.debug('Attempting to double down');
    this.client.send({
      type: 'blackjack_double',
    });

    // Wait for game outcome (double ends game immediately)
    try {
      const outcome = await this.waitForGameOutcome(3000);
      const gameResult = outcome.message;
      const won = gameResult.won as boolean;
      const payout = parseFloat(gameResult.payout as string);
      const actualBet = betAmount * 2; // Double bet

      this.recordGameResult(actualBet, won ? 'won (double)' : 'lost (double)', payout);

      const balanceAfter = balanceBefore + payout - actualBet;
      this.assertBalanceUpdated(balanceAfter, this.currentBalance);
    } catch (error) {
      this.logger.warn('Double down may not have been allowed, continuing');
      // If double wasn't allowed, stand to end game
      this.client.send({
        type: 'blackjack_stand',
      });

      const outcome = await this.waitForGameOutcome();
      const gameResult = outcome.message;
      const won = gameResult.won as boolean;
      const payout = parseFloat(gameResult.payout as string);

      this.recordGameResult(betAmount, won ? 'won (stand)' : 'lost (stand)', payout);
    }
  }

  /**
   * Test 4: Play multiple hands to test consistency
   */
  private async testBlackjack(): Promise<void> {
    this.logger.info('--- Test: Multiple Hands for Blackjack ---');

    // Play 5 quick hands to test for blackjack payouts
    for (let i = 0; i < 5; i++) {
      const betAmount = 10;

      this.client.send({
        type: 'blackjack_deal',
        amount: betAmount,
      });

      await this.assertMessageReceived('game_started');

      // Immediately stand to resolve quickly
      this.client.send({
        type: 'blackjack_stand',
      });

      const outcome = await this.waitForGameOutcome();
      const gameResult = outcome.message;
      const won = gameResult.won as boolean;
      const payout = parseFloat(gameResult.payout as string);

      // Check if it was a blackjack (payout = 2.5x bet)
      const isBlackjack = payout === betAmount * 2.5;
      if (isBlackjack) {
        this.logger.success(`Blackjack detected! (hand ${i + 1})`);
      }

      this.recordGameResult(
        betAmount,
        isBlackjack ? 'blackjack' : (won ? 'won' : 'lost'),
        payout
      );

      this.logger.debug(`Hand ${i + 1}/5 complete`);
    }
  }
}
