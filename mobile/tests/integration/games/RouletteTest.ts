/**
 * Roulette Integration Test
 * Tests Roulette actions: single bet, multiple bets (atomic batch), spin
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class RouletteTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Roulette' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Roulette Tests ===');

    await this.testSingleBet();
    await this.testMultipleBets();
    await this.testColorBets();
    await this.testNumberBets();
    await this.testAdvancedBets();
  }

  /**
   * Test 1: Single bet (e.g., bet on red)
   */
  private async testSingleBet(): Promise<void> {
    this.logger.info('--- Test: Single Bet (Red) ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Start game with single bet on red
    this.client.send({
      type: 'roulette_spin',
      bets: [
        {
          type: 'red',
          amount: betAmount,
        },
      ],
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    this.logger.info('Roulette game started');

    // Wait for game outcome (game_move or game_result)
    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);
    const winningNumber = gameResult.winningNumber;

    this.recordGameResult(betAmount, `red (number: ${winningNumber})`, payout);

    this.logger.info('Spin result', {
      number: winningNumber,
      won,
      payout,
    });

    const balanceAfter = balanceBefore + payout - betAmount;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 2: Multiple bets in single game (atomic batch)
   */
  private async testMultipleBets(): Promise<void> {
    this.logger.info('--- Test: Multiple Bets (Atomic Batch) ---');

    const betPerPosition = 5;
    const totalBet = betPerPosition * 3; // 3 bets
    const balanceBefore = this.currentBalance;

    // Place bets on red, black, and green (0)
    this.client.send({
      type: 'roulette_spin',
      bets: [
        {
          type: 'red',
          amount: betPerPosition,
        },
        {
          type: 'black',
          amount: betPerPosition,
        },
        {
          type: 'number',
          number: 0,
          amount: betPerPosition,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const winningNumber = gameResult.winningNumber;

    this.recordGameResult(totalBet, `multi-bet (number: ${winningNumber})`, payout);

    this.logger.info('Multi-bet result', {
      number: winningNumber,
      totalBet,
      payout,
      profit: payout - totalBet,
    });

    const balanceAfter = balanceBefore + payout - totalBet;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 3: Color bets (red, black)
   */
  private async testColorBets(): Promise<void> {
    this.logger.info('--- Test: Color Bets ---');

    const betAmount = 10;

    // Test black
    this.client.send({
      type: 'roulette_spin',
      bets: [
        {
          type: 'black',
          amount: betAmount,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const winningNumber = gameResult.winningNumber;

    this.recordGameResult(betAmount, `black (number: ${winningNumber})`, payout);

    // Verify payout is 2x if won (color bets pay 1:1)
    if (payout === betAmount * 2) {
      this.logger.success('Black won with 1:1 payout');
    } else if (payout === 0) {
      this.logger.info('Black lost');
    }
  }

  /**
   * Test 4: Number bets (straight up)
   */
  private async testNumberBets(): Promise<void> {
    this.logger.info('--- Test: Number Bets ---');

    const betAmount = 5;

    // Bet on number 7 (lucky number)
    this.client.send({
      type: 'roulette_spin',
      bets: [
        {
          type: 'number',
          number: 7,
          amount: betAmount,
        },
      ],
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const winningNumber = gameResult.winningNumber as number;

    this.recordGameResult(betAmount, `number 7 (won: ${winningNumber})`, payout);

    // Verify payout is 36x if won (number bets pay 35:1)
    if (winningNumber === 7) {
      this.logger.success('Lucky 7 hit! 35:1 payout');
      this.assertBalanceUpdated(betAmount * 36, payout);
    } else {
      this.logger.info(`Number 7 missed (winning: ${winningNumber})`);
    }

    // Also test a few more numbers for coverage
    for (const num of [13, 21]) {
      this.client.send({
        type: 'roulette_spin',
        bets: [
          {
            type: 'number',
            number: num,
            amount: betAmount,
          },
        ],
      });

      await this.assertMessageReceived('game_started');

      const loopOutcome = await this.waitForGameOutcome();
      const result = loopOutcome.message;
      const resultPayout = parseFloat(result.payout as string);
      const resultNumber = result.winningNumber as number;

      this.recordGameResult(betAmount, `number ${num} (won: ${resultNumber})`, resultPayout);

      this.logger.debug(`Bet on ${num}, result: ${resultNumber}`);
    }
  }

  /**
   * Test 5: Advanced bet types (dozens/columns/layout bets)
   */
  private async testAdvancedBets(): Promise<void> {
    this.logger.info('--- Test: Advanced Bet Types ---');

    const betAmount = 5;
    const bets = [
      { type: 'dozen_1', amount: betAmount },
      { type: 'col_1', amount: betAmount },
      { type: 'split_h', target: 1, amount: betAmount },   // 1-2
      { type: 'split_v', target: 1, amount: betAmount },   // 1-4
      { type: 'street', target: 1, amount: betAmount },    // 1-2-3
      { type: 'corner', target: 1, amount: betAmount },    // 1-2-4-5
      { type: 'six_line', target: 1, amount: betAmount },  // 1-6
      { type: 'zero', amount: betAmount },                 // straight on zero
    ];

    this.client.send({
      type: 'roulette_spin',
      bets,
    });

    await this.assertMessageReceived('game_started');

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const winningNumber = gameResult.winningNumber as number;

    this.recordGameResult(
      bets.length * betAmount,
      `advanced bets (number: ${winningNumber})`,
      payout,
    );

    this.logger.info('Advanced bet result', {
      number: winningNumber,
      payout,
    });
  }
}
