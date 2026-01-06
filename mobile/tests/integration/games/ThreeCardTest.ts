/**
 * Three Card Poker Integration Test
 * Tests Three Card Poker actions: ante, pairplus, play, fold
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class ThreeCardTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Three Card Poker' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Three Card Poker Tests ===');

    await this.testAnteOnly();
    await this.testAnteWithPairplus();
    await this.testFold();
    await this.testPlay();
  }

  /**
   * Test 1: Ante bet only (no side bets)
   */
  private async testAnteOnly(): Promise<void> {
    this.logger.info('--- Test: Ante Only ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Deal with ante bet
    this.client.send({
      type: 'three_card_poker_deal',
      ante: betAmount,
    });

    // game_started includes the dealt cards (no separate game_state message)
    const gameStarted = await this.assertMessageReceived('game_started');
    const playerHand = (gameStarted as any).state?.playerHand ||
                       (gameStarted as any).playerHand ||
                       (gameStarted as any).hand;

    this.logger.info('Three Card Poker game started', {
      playerHand,
    });

    // Play (bet 1x ante)
    this.client.send({
      type: 'three_card_poker_play',
    });

    // Wait for game outcome (gateway may send game_move or game_result)
    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);
    const dealerHand = gameResult.dealerHand;
    const dealerQualified = gameResult.dealerQualified;

    this.recordGameResult(betAmount * 2, `ante (P:${playerHand} D:${dealerHand})`, payout);

    this.logger.info('Ante only result', {
      playerHand,
      dealerHand,
      dealerQualified,
      won,
      payout,
    });

    const balanceAfter = balanceBefore + payout - betAmount * 2; // ante + play
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 2: Ante + Pairplus side bet
   */
  private async testAnteWithPairplus(): Promise<void> {
    this.logger.info('--- Test: Ante + Pairplus ---');

    const anteBet = 10;
    const pairplusBet = 5;
    const totalBet = anteBet + pairplusBet;

    // Deal with ante and pairplus bets
    this.client.send({
      type: 'three_card_poker_deal',
      ante: anteBet,
      pairPlus: pairplusBet,
    });

    // game_started includes the dealt cards
    const gameStarted = await this.assertMessageReceived('game_started');
    const playerHand = (gameStarted as any).state?.playerHand ||
                       (gameStarted as any).playerHand ||
                       (gameStarted as any).hand;

    this.logger.info('Player cards dealt (with pairplus)', {
      playerHand,
      pairplusBet,
    });

    // Play
    this.client.send({
      type: 'three_card_poker_play',
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const dealerHand = gameResult.dealerHand;
    const pairplusPayment = gameResult.pairplusPayment as number | undefined;

    this.recordGameResult(totalBet + anteBet, `pairplus (P:${playerHand} D:${dealerHand})`, payout);

    this.logger.info('Ante + Pairplus result', {
      playerHand,
      dealerHand,
      pairplusPayment,
      payout,
    });

    // Pairplus pays on pair or better (independent of ante/play outcome)
    if (pairplusPayment && pairplusPayment > 0) {
      this.logger.success(`Pairplus won! Payment: ${pairplusPayment}`);
    } else {
      this.logger.info('Pairplus did not qualify (no pair or better)');
    }
  }

  /**
   * Test 3: Fold (lose ante, keep pairplus)
   */
  private async testFold(): Promise<void> {
    this.logger.info('--- Test: Fold ---');

    const anteBet = 10;

    // Deal with ante bet
    this.client.send({
      type: 'three_card_poker_deal',
      ante: anteBet,
    });

    // game_started includes the dealt cards
    const gameStarted = await this.assertMessageReceived('game_started');
    const playerHand = (gameStarted as any).state?.playerHand ||
                       (gameStarted as any).playerHand ||
                       (gameStarted as any).hand;

    this.logger.info('Player cards dealt (will fold)', {
      playerHand,
    });

    // Fold (forfeit ante, no play bet)
    this.client.send({
      type: 'three_card_poker_fold',
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);

    this.recordGameResult(anteBet, `fold (P:${playerHand})`, payout);

    this.logger.info('Fold result', {
      playerHand,
      payout,
    });

    // Folding loses ante, payout should be 0
    this.assertBalanceUpdated(0, payout);
  }

  /**
   * Test 4: Play decision (bet 1x ante)
   */
  private async testPlay(): Promise<void> {
    this.logger.info('--- Test: Play Decision ---');

    const anteBet = 10;
    const balanceBefore = this.currentBalance;

    // Deal with ante bet
    this.client.send({
      type: 'three_card_poker_deal',
      ante: anteBet,
    });

    // game_started includes the dealt cards
    const gameStarted = await this.assertMessageReceived('game_started');
    const playerHand = (gameStarted as any).state?.playerHand ||
                       (gameStarted as any).playerHand ||
                       (gameStarted as any).hand;

    this.logger.info('Player cards dealt', {
      playerHand,
    });

    // Play (bet equals ante)
    this.client.send({
      type: 'three_card_poker_play',
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);
    const dealerHand = gameResult.dealerHand;
    const dealerQualified = gameResult.dealerQualified;
    const anteBonus = gameResult.anteBonus as number | undefined;

    this.recordGameResult(anteBet * 2, `play (P:${playerHand} D:${dealerHand})`, payout);

    this.logger.info('Play result', {
      playerHand,
      dealerHand,
      dealerQualified,
      anteBonus,
      won,
      payout,
    });

    const balanceAfter = balanceBefore + payout - anteBet * 2; // ante + play
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);

    // Log special outcomes
    if (anteBonus && anteBonus > 0) {
      this.logger.success(`Ante bonus won! ${anteBonus}`);
    }

    if (!dealerQualified) {
      this.logger.info('Dealer did not qualify (push on ante, play pays 1:1)');
    }
  }
}
