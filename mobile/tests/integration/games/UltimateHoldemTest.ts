/**
 * Ultimate Texas Hold'em Integration Test
 * Tests Ultimate Hold'em actions: ante+blind, check, bet (4x, 3x, 2x, 1x), fold, trips side bet
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class UltimateHoldemTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Ultimate Hold\'em' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Ultimate Hold\'em Tests ===');

    await this.testPreflop4x();
    await this.testCheckToFlop2x();
    await this.testCheckToRiver1x();
    await this.testFold();
  }

  /**
   * Test 1: Bet 4x preflop (aggressive play)
   */
  private async testPreflop4x(): Promise<void> {
    this.logger.info('--- Test: Bet 4x Preflop ---');

    const anteBet = 10;
    const blindBet = 10;
    const totalInitialBet = anteBet + blindBet;
    const balanceBefore = this.currentBalance;

    // Deal with ante and blind bets
    this.client.send({
      type: 'ultimate_tx_deal',
      ante: anteBet,
      blind: blindBet,
    });

    // game_started includes the dealt hole cards (no separate game_state message)
    const gameStarted = await this.assertMessageReceived('game_started');
    const holeCards = (gameStarted as any).state?.holeCards ||
                      (gameStarted as any).holeCards ||
                      (gameStarted as any).hand;

    this.logger.info('Ultimate Hold\'em game started (ante + blind)', {
      holeCards,
    });

    // Bet 4x preflop
    this.client.send({
      type: 'ultimate_tx_bet',
      multiplier: 4,
    });

    // Wait for game outcome (gateway may send game_move or game_result)
    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);
    const communityCards = gameResult.communityCards || gameResult.board;
    const dealerCards = gameResult.dealerCards || gameResult.dealerHand;

    const playBet = anteBet * 4;
    const totalBet = totalInitialBet + playBet;

    this.recordGameResult(totalBet, `4x preflop (H:${holeCards} B:${communityCards})`, payout);

    this.logger.info('Preflop 4x result', {
      holeCards,
      communityCards,
      dealerCards,
      won,
      payout,
    });

    const balanceAfter = balanceBefore + payout - totalBet;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 2: Check preflop, bet 2x on flop
   */
  private async testCheckToFlop2x(): Promise<void> {
    this.logger.info('--- Test: Check → Flop Bet 2x ---');

    const anteBet = 10;
    const blindBet = 10;
    const totalInitialBet = anteBet + blindBet;

    // Deal with ante and blind bets
    this.client.send({
      type: 'ultimate_tx_deal',
      ante: anteBet,
      blind: blindBet,
    });

    // game_started includes the dealt hole cards
    const gameStarted = await this.assertMessageReceived('game_started');
    const holeCards = (gameStarted as any).state?.holeCards ||
                      (gameStarted as any).holeCards ||
                      (gameStarted as any).hand;

    this.logger.info('Hole cards dealt (will check preflop)', {
      holeCards,
    });

    // Check preflop
    this.client.send({
      type: 'ultimate_tx_check',
    });

    // Flop is revealed via game_move message
    const flopRevealed = await this.assertMessageReceived('game_move');
    const flop = (flopRevealed as any).state?.communityCards ||
                 (flopRevealed as any).communityCards ||
                 (flopRevealed as any).board;

    this.logger.info('Flop revealed', {
      flop,
    });

    // Bet 2x on flop
    this.client.send({
      type: 'ultimate_tx_bet',
      multiplier: 2,
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const communityCards = gameResult.communityCards || gameResult.board;

    const playBet = anteBet * 2;
    const totalBet = totalInitialBet + playBet;

    this.recordGameResult(totalBet, `check→2x flop (H:${holeCards} B:${communityCards})`, payout);

    this.logger.info('Check→Flop 2x result', {
      holeCards,
      communityCards,
      payout,
    });
  }

  /**
   * Test 3: Check to river, bet 1x
   */
  private async testCheckToRiver1x(): Promise<void> {
    this.logger.info('--- Test: Check → Check → River Bet 1x ---');

    const anteBet = 10;
    const blindBet = 10;
    const totalInitialBet = anteBet + blindBet;
    const balanceBefore = this.currentBalance;

    // Deal with ante and blind bets
    this.client.send({
      type: 'ultimate_tx_deal',
      ante: anteBet,
      blind: blindBet,
    });

    // game_started includes the dealt hole cards
    const gameStarted = await this.assertMessageReceived('game_started');
    const holeCards = (gameStarted as any).state?.holeCards ||
                      (gameStarted as any).holeCards ||
                      (gameStarted as any).hand;

    this.logger.info('Hole cards dealt (will check all streets)', {
      holeCards,
    });

    // Check preflop
    this.client.send({
      type: 'ultimate_tx_check',
    });

    // Flop revealed via game_move
    await this.assertMessageReceived('game_move');

    // Check flop
    this.client.send({
      type: 'ultimate_tx_check',
    });

    // Turn and river revealed via game_move
    const riverRevealed = await this.assertMessageReceived('game_move');
    const board = (riverRevealed as any).state?.communityCards ||
                  (riverRevealed as any).communityCards ||
                  (riverRevealed as any).board;

    this.logger.info('All community cards revealed', {
      board,
    });

    // Bet 1x on river
    this.client.send({
      type: 'ultimate_tx_bet',
      multiplier: 1,
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const communityCards = gameResult.communityCards || gameResult.board;
    const dealerCards = gameResult.dealerCards || gameResult.dealerHand;

    const playBet = anteBet * 1;
    const totalBet = totalInitialBet + playBet;

    this.recordGameResult(totalBet, `check→check→1x river (H:${holeCards})`, payout);

    this.logger.info('Check→Check→River 1x result', {
      holeCards,
      communityCards,
      dealerCards,
      payout,
    });

    const balanceAfter = balanceBefore + payout - totalBet;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 4: Fold at river (lose ante + blind)
   */
  private async testFold(): Promise<void> {
    this.logger.info('--- Test: Fold at River ---');

    const anteBet = 10;
    const blindBet = 10;
    const totalInitialBet = anteBet + blindBet;

    // Deal with ante and blind bets
    this.client.send({
      type: 'ultimate_tx_deal',
      ante: anteBet,
      blind: blindBet,
    });

    // game_started includes the dealt hole cards
    const gameStarted = await this.assertMessageReceived('game_started');
    const holeCards = (gameStarted as any).state?.holeCards ||
                      (gameStarted as any).holeCards ||
                      (gameStarted as any).hand;

    this.logger.info('Hole cards dealt (will fold at river)', {
      holeCards,
    });

    // Check preflop
    this.client.send({
      type: 'ultimate_tx_check',
    });

    // Flop revealed via game_move
    await this.assertMessageReceived('game_move');

    // Check flop
    this.client.send({
      type: 'ultimate_tx_check',
    });

    // River revealed via game_move
    await this.assertMessageReceived('game_move');

    // Fold at river
    this.client.send({
      type: 'ultimate_tx_fold',
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);

    this.recordGameResult(totalInitialBet, `fold (H:${holeCards})`, payout);

    this.logger.info('Fold result', {
      holeCards,
      payout,
    });

    // Folding loses ante + blind, payout should be 0
    this.assertBalanceUpdated(0, payout);
  }
}
