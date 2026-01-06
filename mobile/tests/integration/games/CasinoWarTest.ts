/**
 * Casino War Integration Test
 * Tests Casino War actions: deal, war, surrender
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class CasinoWarTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Casino War' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Casino War Tests ===');

    await this.testBasicDeal();
    await this.testWarOnTie();
    await this.testSurrenderOnTie();
    await this.testTieBet();
  }

  /**
   * Test 1: Basic deal (no tie scenario)
   */
  private async testBasicDeal(): Promise<void> {
    this.logger.info('--- Test: Basic Deal ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Deal cards
    this.client.send({
      type: 'casino_war_deal',
      amount: betAmount,
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    this.logger.info('Casino War game started');

    // Wait for game outcome (gateway may send game_move for tie, or game_result for immediate resolution)
    const outcome = await this.waitForGameOutcome(3000);
    const gameResult = outcome.message;

    // Check if this is a tie requiring action (game_move indicates tie state)
    if (outcome.type === 'move') {
      // Got a tie - need to surrender or go to war
      this.logger.info('Got tie (state update received)');

      // For testing, let's surrender
      this.client.send({
        type: 'casino_war_surrender',
      });

      const surrenderOutcome = await this.waitForGameOutcome();
      const surrenderResult = surrenderOutcome.message;
      const payout = parseFloat(surrenderResult.payout as string);

      this.recordGameResult(betAmount, 'surrender (tie)', payout);
      this.logger.info('Surrendered on tie', { payout });
    } else {
      // Immediate result (no tie)
      const won = gameResult.won as boolean;
      const payout = parseFloat(gameResult.payout as string);
      const playerCard = gameResult.playerCard;
      const dealerCard = gameResult.dealerCard;

      this.recordGameResult(betAmount, `deal (P:${playerCard} D:${dealerCard})`, payout);

      this.logger.info('Deal result', {
        playerCard,
        dealerCard,
        won,
        payout,
      });

      const balanceAfter = balanceBefore + payout - betAmount;
      this.assertBalanceUpdated(balanceAfter, this.currentBalance);
    }
  }

  /**
   * Test 2: Go to war on tie
   */
  private async testWarOnTie(): Promise<void> {
    this.logger.info('--- Test: War on Tie ---');

    const betAmount = 10;

    // Play until we get a tie (or timeout after a few tries)
    for (let attempt = 0; attempt < 5; attempt++) {
      this.client.send({
        type: 'casino_war_deal',
        amount: betAmount,
      });

      await this.assertMessageReceived('game_started');

      // Wait for game outcome
      const outcome = await this.waitForGameOutcome(2000);
      const gameResult = outcome.message;

      if (outcome.type === 'move') {
        // Got a tie! Go to war
        this.logger.info('Tie detected - going to WAR!');

        this.client.send({
          type: 'casino_war_war',
        });

        const warOutcome = await this.waitForGameOutcome();
        const warResult = warOutcome.message;
        const payout = parseFloat(warResult.payout as string);
        const playerCard = warResult.playerCard;
        const dealerCard = warResult.dealerCard;

        this.recordGameResult(betAmount, `war (P:${playerCard} D:${dealerCard})`, payout);

        this.logger.info('War result', {
          playerCard,
          dealerCard,
          payout,
        });

        // War payouts: win = 2x (1:1), tie = push, lose = 0
        return; // Successfully tested war, exit
      } else {
        // No tie, immediate result
        const payout = parseFloat(gameResult.payout as string);

        this.recordGameResult(betAmount, 'no tie (skipped war test)', payout);
        this.logger.debug(`Attempt ${attempt + 1}: No tie`);
      }
    }

    this.logger.warn('Could not test war scenario (no tie in 5 attempts)');
  }

  /**
   * Test 3: Surrender on tie
   */
  private async testSurrenderOnTie(): Promise<void> {
    this.logger.info('--- Test: Surrender on Tie ---');

    const betAmount = 10;

    // Play until we get a tie (or timeout after a few tries)
    for (let attempt = 0; attempt < 5; attempt++) {
      this.client.send({
        type: 'casino_war_deal',
        amount: betAmount,
      });

      await this.assertMessageReceived('game_started');

      // Wait for game outcome
      const outcome = await this.waitForGameOutcome(2000);
      const gameResult = outcome.message;

      if (outcome.type === 'move') {
        // Got a tie! Surrender
        this.logger.info('Tie detected - surrendering');

        this.client.send({
          type: 'casino_war_surrender',
        });

        const surrenderOutcome = await this.waitForGameOutcome();
        const surrenderResult = surrenderOutcome.message;
        const payout = parseFloat(surrenderResult.payout as string);

        this.recordGameResult(betAmount, 'surrender', payout);

        this.logger.info('Surrender result', {
          payout,
        });

        // Surrender returns half bet
        this.assertBalanceUpdated(betAmount / 2, payout);
        return; // Successfully tested surrender, exit
      } else {
        // No tie, immediate result
        const payout = parseFloat(gameResult.payout as string);

        this.recordGameResult(betAmount, 'no tie (skipped surrender test)', payout);
        this.logger.debug(`Attempt ${attempt + 1}: No tie`);
      }
    }

    this.logger.warn('Could not test surrender scenario (no tie in 5 attempts)');
  }

  /**
   * Test 4: Tie bet (side bet)
   */
  private async testTieBet(): Promise<void> {
    this.logger.info('--- Test: Tie Bet (Side Bet) ---');

    const mainBet = 10;
    const tieBet = 5;

    // Deal with tie bet
    this.client.send({
      type: 'casino_war_deal',
      amount: mainBet,
      tieBet: tieBet,
    });

    await this.assertMessageReceived('game_started');

    // Wait for game outcome
    const outcome = await this.waitForGameOutcome(3000);
    const gameResult = outcome.message;

    if (outcome.type === 'move') {
      // Got a tie, need to choose action
      this.logger.info('Tie occurred with tie bet');
      this.client.send({
        type: 'casino_war_surrender',
      });

      const surrenderOutcome = await this.waitForGameOutcome();
      const surrenderResult = surrenderOutcome.message;
      const payout = parseFloat(surrenderResult.payout as string);

      this.recordGameResult(mainBet + tieBet, 'tie bet (surrendered)', payout);
      this.logger.info('Surrendered with tie bet active', { payout });
    } else {
      const won = gameResult.won as boolean;
      const payout = parseFloat(gameResult.payout as string);
      const playerCard = gameResult.playerCard;
      const dealerCard = gameResult.dealerCard;

      this.recordGameResult(mainBet + tieBet, `tie bet (P:${playerCard} D:${dealerCard})`, payout);

      this.logger.info('Tie bet result', {
        playerCard,
        dealerCard,
        won,
        payout,
        tieBetActive: true,
      });

      // Tie bet pays 10:1 or 11:1 if cards tie
      if (playerCard === dealerCard) {
        this.logger.success('Tie bet WON! (10:1 or 11:1 payout)');
      } else {
        this.logger.info('Tie bet lost (cards did not match)');
      }
    }
  }
}
