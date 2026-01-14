/**
 * Sic Bo Integration Test
 * Tests Sic Bo actions: small/big bets, total bets, single number, multiple bets (atomic batch)
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class SicBoTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Sic Bo' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Sic Bo Tests ===');

    await this.testSmallBet();
    await this.testBigBet();
    await this.testSingleNumber();
    await this.testMultipleBets();
    await this.testAllBetTypes();
  }

  /**
   * Test 1: Small bet (4-10, most common bet)
   */
  private async testSmallBet(): Promise<void> {
    this.logger.info('--- Test: Small Bet ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Roll with small bet
    this.client.send({
      type: 'sic_bo_roll',
      bets: [
        {
          type: 'SMALL',
          amount: betAmount,
        },
      ],
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    this.logger.info('Sic Bo game started');

    // Wait for game outcome (gateway may send game_move or game_result)
    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number, number];
    const total = dice[0] + dice[1] + dice[2];

    this.recordGameResult(betAmount, `small (dice: ${dice}, total: ${total})`, payout);

    this.logger.info('Small bet result', {
      dice,
      total,
      won,
      payout,
    });

    // Small wins on 4-10, loses on triple
    const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
    if (total >= 4 && total <= 10 && !isTriple) {
      this.assertBalanceUpdated(betAmount * 2, payout); // 1:1 + original bet
    } else {
      this.assertBalanceUpdated(0, payout); // Lost
    }

    const balanceAfter = balanceBefore + payout - betAmount;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 2: Big bet (11-17)
   */
  private async testBigBet(): Promise<void> {
    this.logger.info('--- Test: Big Bet ---');

    const betAmount = 10;

    // Roll with big bet
    this.client.send({
      type: 'sic_bo_roll',
      bets: [
        {
          type: 'BIG',
          amount: betAmount,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number, number];
    const total = dice[0] + dice[1] + dice[2];

    this.recordGameResult(betAmount, `big (dice: ${dice}, total: ${total})`, payout);

    this.logger.info('Big bet result', {
      dice,
      total,
      payout,
    });

    // Big wins on 11-17, loses on triple
    const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
    if (total >= 11 && total <= 17 && !isTriple) {
      this.logger.success('Big bet won (1:1 payout)');
    } else {
      this.logger.info('Big bet lost');
    }
  }

  /**
   * Test 3: Single number bet (1-6)
   */
  private async testSingleNumber(): Promise<void> {
    this.logger.info('--- Test: Single Number Bet ---');

    const betAmount = 10;
    const luckyNumber = 4;

    // Roll with single number bet
    this.client.send({
      type: 'sic_bo_roll',
      bets: [
        {
          type: 'SINGLE',
          number: luckyNumber,
          amount: betAmount,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number, number];

    this.recordGameResult(betAmount, `single(${luckyNumber}) dice: ${dice}`, payout);

    // Count occurrences of lucky number
    const count = dice.filter((d) => d === luckyNumber).length;

    this.logger.info('Single number result', {
      dice,
      luckyNumber,
      count,
      payout,
    });

    // Single number pays:
    // 1 match: 1:1 (2x total)
    // 2 matches: 2:1 (3x total)
    // 3 matches: 3:1 (4x total)
    if (count > 0) {
      this.logger.success(`Lucky number ${luckyNumber} appeared ${count} times!`);
      const expectedPayout = betAmount * (count + 1);
      this.assertBalanceUpdated(expectedPayout, payout);
    } else {
      this.logger.info(`Lucky number ${luckyNumber} did not appear`);
    }
  }

  /**
   * Test 4: Multiple bets in one roll (atomic batch)
   */
  private async testMultipleBets(): Promise<void> {
    this.logger.info('--- Test: Multiple Bets (Atomic Batch) ---');

    const betPerPosition = 5;
    const totalBet = betPerPosition * 4; // 4 bets
    const balanceBefore = this.currentBalance;

    // Place multiple bets using sic_bo_roll
    this.client.send({
      type: 'sic_bo_roll',
      bets: [
        {
          type: 'SMALL',
          amount: betPerPosition,
        },
        {
          type: 'BIG',
          amount: betPerPosition,
        },
        {
          type: 'ODD',
          amount: betPerPosition,
        },
        {
          type: 'SINGLE',
          number: 6,
          amount: betPerPosition,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number, number];
    const total = dice[0] + dice[1] + dice[2];

    this.recordGameResult(totalBet, `multi-bet (dice: ${dice}, total: ${total})`, payout);

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
    const isTriple = dice[0] === dice[1] && dice[1] === dice[2];
    const sixCount = dice.filter((d) => d === 6).length;

    this.logger.info('Individual bet results', {
      small: total >= 4 && total <= 10 && !isTriple ? 'WON' : 'LOST',
      big: total >= 11 && total <= 17 && !isTriple ? 'WON' : 'LOST',
      odd: total % 2 === 1 ? 'WON' : 'LOST',
      'single(6)': sixCount > 0 ? `WON (${sixCount}x)` : 'LOST',
    });
  }

  /**
   * Test 5: Cover all Sic Bo bet types once
   */
  private async testAllBetTypes(): Promise<void> {
    this.logger.info('--- Test: All Sic Bo Bet Types ---');

    const betPer = 2;
    const bets = [
      { type: 'SMALL', amount: betPer },
      { type: 'BIG', amount: betPer },
      { type: 'ODD', amount: betPer },
      { type: 'EVEN', amount: betPer },
      { type: 'TRIPLE_SPECIFIC', target: 3, amount: betPer },
      { type: 'TRIPLE_ANY', amount: betPer },
      { type: 'DOUBLE_SPECIFIC', target: 3, amount: betPer },
      { type: 'SUM', target: 9, amount: betPer },
      { type: 'SINGLE_DIE', target: 5, amount: betPer },
      { type: 'DOMINO', target: 0x12, amount: betPer }, // 1-2 combo
      { type: 'HOP3_EASY', target: 0b000111, amount: betPer }, // 1/2/3
      { type: 'HOP3_HARD', target: 0x25, amount: betPer }, // double 2 + single 5
      { type: 'HOP4_EASY', target: 0b0001111, amount: betPer }, // 1/2/3/4
    ];

    this.client.send({
      type: 'sic_bo_roll',
      bets,
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const dice = gameResult.dice as [number, number, number];
    const total = dice[0] + dice[1] + dice[2];

    this.recordGameResult(bets.length * betPer, `all-bets dice:${dice} total:${total}`, payout);

    this.logger.info('All Sic Bo bet result', { dice, total, payout });
  }
}
