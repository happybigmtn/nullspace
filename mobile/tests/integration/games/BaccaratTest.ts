/**
 * Baccarat Integration Test
 * Tests Baccarat actions: single bet (Player/Banker/Tie), multiple bets (atomic batch), side bets
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class BaccaratTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Baccarat' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Baccarat Tests ===');

    await this.testPlayerBet();
    await this.testBankerBet();
    await this.testTieBet();
    await this.testMultipleBets();
  }

  /**
   * Test 1: Player bet (main bet type)
   */
  private async testPlayerBet(): Promise<void> {
    this.logger.info('--- Test: Player Bet ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Deal with Player bet
    this.client.send({
      type: 'baccarat_deal',
      bets: [
        {
          type: 'PLAYER',
          amount: betAmount,
        },
      ],
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    this.logger.info('Baccarat game started');

    // Wait for game outcome (gateway may send game_move or game_result)
    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);
    const playerCards = gameResult.playerHand;
    const bankerCards = gameResult.bankerHand;

    this.recordGameResult(betAmount, `player (P:${playerCards} B:${bankerCards})`, payout);

    this.logger.info('Player bet result', {
      playerCards,
      bankerCards,
      won,
      payout,
    });

    const balanceAfter = balanceBefore + payout - betAmount;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 2: Banker bet
   */
  private async testBankerBet(): Promise<void> {
    this.logger.info('--- Test: Banker Bet ---');

    const betAmount = 10;

    // Deal with Banker bet
    this.client.send({
      type: 'baccarat_deal',
      bets: [
        {
          type: 'BANKER',
          amount: betAmount,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const playerCards = gameResult.playerHand;
    const bankerCards = gameResult.bankerHand;

    this.recordGameResult(betAmount, `banker (P:${playerCards} B:${bankerCards})`, payout);

    this.logger.info('Banker bet result', {
      playerCards,
      bankerCards,
      payout,
    });
  }

  /**
   * Test 3: Tie bet (high payout side bet)
   */
  private async testTieBet(): Promise<void> {
    this.logger.info('--- Test: Tie Bet ---');

    const betAmount = 5;

    // Deal with Tie bet
    this.client.send({
      type: 'baccarat_deal',
      bets: [
        {
          type: 'TIE',
          amount: betAmount,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const playerCards = gameResult.playerHand;
    const bankerCards = gameResult.bankerHand;

    this.recordGameResult(betAmount, `tie (P:${playerCards} B:${bankerCards})`, payout);

    this.logger.info('Tie bet result', {
      playerCards,
      bankerCards,
      payout,
    });

    // Tie bet pays 9:1 (8:1 winnings + original stake)
    if (payout > betAmount) {
      this.logger.success('Tie hit! 9:1 payout');
      this.assertBalanceUpdated(betAmount * 9, payout);
    } else {
      this.logger.info('Tie lost');
    }
  }

  /**
   * Test 4: Multiple bets in one hand (atomic batch)
   */
  private async testMultipleBets(): Promise<void> {
    this.logger.info('--- Test: Multiple Bets (Atomic Batch) ---');

    const betPerPosition = 5;
    const totalBet = betPerPosition * 4; // 4 bets
    const balanceBefore = this.currentBalance;

    // Place multiple bets using baccarat_deal
    this.client.send({
      type: 'baccarat_deal',
      bets: [
        {
          type: 'PLAYER',
          amount: betPerPosition,
        },
        {
          type: 'BANKER',
          amount: betPerPosition,
        },
        {
          type: 'TIE',
          amount: betPerPosition,
        },
        {
          type: 'P_PAIR',
          amount: betPerPosition,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const playerCards = gameResult.playerHand;
    const bankerCards = gameResult.bankerHand;

    this.recordGameResult(totalBet, `multi-bet (P:${playerCards} B:${bankerCards})`, payout);

    this.logger.info('Multi-bet result', {
      playerCards,
      bankerCards,
      totalBet,
      payout,
      profit: payout - totalBet,
    });

    const balanceAfter = balanceBefore + payout - totalBet;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);

    // Log which bets won
    this.logger.info('Individual bet results', {
      player: payout > totalBet * 0.2 ? 'POSSIBLE WIN' : 'LIKELY LOST',
      banker: payout > totalBet * 0.2 ? 'POSSIBLE WIN' : 'LIKELY LOST',
      tie: payout > totalBet ? 'POSSIBLE WIN' : 'LIKELY LOST',
      player_pair: payout > totalBet ? 'POSSIBLE WIN' : 'LIKELY LOST',
    });
  }
}
