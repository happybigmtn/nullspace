/**
 * Craps Integration Test
 * Tests Craps actions: single bet (PASS/DON'T_PASS), multiple bets (atomic batch), various bet types
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class CrapsTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Craps' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Craps Tests ===');

    await this.testPassLine();
    await this.testDontPass();
    await this.testFieldBet();
    await this.testMultipleBets();
  }

  /**
   * Test 1: Pass line bet (most basic bet in craps)
   */
  private async testPassLine(): Promise<void> {
    this.logger.info('--- Test: Pass Line Bet ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Place PASS bet using craps_bet message
    this.client.send({
      type: 'craps_bet',
      betType: 'PASS',
      amount: betAmount,
    });

    // Wait for game_started
    const gameStarted = await this.assertMessageReceived('game_started');
    this.logger.info('Craps game started');

    // Wait for game outcome (gateway may send game_move or game_result)
    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number];
    const total = dice[0] + dice[1];

    this.recordGameResult(betAmount, `PASS (roll: ${total})`, payout);

    this.logger.info('Roll result', {
      dice,
      total,
      won,
      payout,
    });

    const balanceAfter = balanceBefore + payout - betAmount;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 2: Don't Pass bet (opposite of Pass)
   */
  private async testDontPass(): Promise<void> {
    this.logger.info('--- Test: Don\'t Pass Bet ---');

    const betAmount = 10;

    this.client.send({
      type: 'craps_bet',
      betType: 'DONT_PASS',
      amount: betAmount,
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number];
    const total = dice[0] + dice[1];

    this.recordGameResult(betAmount, `DONT_PASS (roll: ${total})`, payout);

    this.logger.info('Don\'t Pass result', {
      dice,
      total,
      payout,
    });
  }

  /**
   * Test 3: Field bet (single roll bet)
   */
  private async testFieldBet(): Promise<void> {
    this.logger.info('--- Test: Field Bet ---');

    const betAmount = 10;

    this.client.send({
      type: 'craps_bet',
      betType: 'FIELD',
      amount: betAmount,
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number];
    const total = dice[0] + dice[1];

    this.recordGameResult(betAmount, `FIELD (roll: ${total})`, payout);

    this.logger.info('Field bet result', {
      dice,
      total,
      payout,
      multiplier: total === 2 ? '2x' : total === 12 ? '3x' : '1x',
    });

    // Field bet wins on 2, 3, 4, 9, 10, 11, 12
    // 2 pays 2x, 12 pays 3x, others pay 1x
    if ([2, 3, 4, 9, 10, 11, 12].includes(total)) {
      if (total === 2) {
        this.assertBalanceUpdated(betAmount * 2, payout);
      } else if (total === 12) {
        this.assertBalanceUpdated(betAmount * 3, payout);
      } else {
        this.assertBalanceUpdated(betAmount * 2, payout); // bet + winnings
      }
    } else {
      this.assertBalanceUpdated(0, payout); // Lost
    }
  }

  /**
   * Test 4: Multiple bets in one roll (atomic batch)
   */
  private async testMultipleBets(): Promise<void> {
    this.logger.info('--- Test: Multiple Bets (Atomic Batch) ---');

    const betPerPosition = 5;
    const totalBet = betPerPosition * 3; // 3 bets
    const balanceBefore = this.currentBalance;

    // Place multiple bets using craps_roll message
    this.client.send({
      type: 'craps_roll',
      bets: [
        {
          type: 'PASS',
          amount: betPerPosition,
        },
        {
          type: 'FIELD',
          amount: betPerPosition,
        },
        {
          type: 'YES',
          target: 6, // Place bet on 6
          amount: betPerPosition,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number];
    const total = dice[0] + dice[1];

    this.recordGameResult(totalBet, `multi-bet (roll: ${total})`, payout);

    this.logger.info('Multi-bet result', {
      dice,
      total,
      totalBet,
      payout,
      profit: payout - totalBet,
    });

    const balanceAfter = balanceBefore + payout - totalBet;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);

    // Log which bets won
    const passWins = [7, 11].includes(total);
    const fieldWins = [2, 3, 4, 9, 10, 11, 12].includes(total);
    const yesWins = total === 6;

    this.logger.info('Individual bet results', {
      PASS: passWins ? 'WON' : 'PUSH/LOST',
      FIELD: fieldWins ? 'WON' : 'LOST',
      'YES(6)': yesWins ? 'WON' : 'LOST',
    });
  }
}
