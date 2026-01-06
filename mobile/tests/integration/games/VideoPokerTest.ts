/**
 * Video Poker Integration Test
 * Tests Video Poker (Jacks or Better) actions: deal, hold, draw
 */

import { BaseGameTest, GameTestConfig } from '../framework/BaseGameTest';

export class VideoPokerTest extends BaseGameTest {
  constructor(config: Omit<GameTestConfig, 'testName'>) {
    super({ ...config, testName: 'Video Poker' });
  }

  async runGameTests(): Promise<void> {
    this.logger.info('=== Running Video Poker Tests ===');

    await this.testBasicDealDraw();
    await this.testHoldAllCards();
    await this.testHoldNone();
    await this.testSelectiveHold();
  }

  /**
   * Test 1: Basic deal → draw flow
   */
  private async testBasicDealDraw(): Promise<void> {
    this.logger.info('--- Test: Basic Deal → Draw ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Deal initial hand
    this.client.send({
      type: 'video_poker_deal',
      amount: betAmount,
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    const initialCards = (gameStarted as any).state?.hand || (gameStarted as any).hand;

    this.logger.info('Initial hand dealt', {
      cards: initialCards,
    });

    // Hold first 3 cards
    this.client.send({
      type: 'video_poker_draw',
      held: [true, true, true, false, false],
    });

    // Wait for game outcome (gateway may send game_move or game_result)
    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const won = gameResult.won as boolean;
    const payout = parseFloat(gameResult.payout as string);
    const finalHand = gameResult.hand || gameResult.cards;
    const handRank = gameResult.handRank || gameResult.rank;

    this.recordGameResult(betAmount, `${handRank} (${finalHand})`, payout);

    this.logger.info('Final hand result', {
      initialCards,
      finalHand,
      handRank,
      held: 'first 3 cards',
      won,
      payout,
    });

    const balanceAfter = balanceBefore + payout - betAmount;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);
  }

  /**
   * Test 2: Hold all cards (no draw)
   */
  private async testHoldAllCards(): Promise<void> {
    this.logger.info('--- Test: Hold All Cards ---');

    const betAmount = 10;

    // Deal initial hand
    this.client.send({
      type: 'video_poker_deal',
      amount: betAmount,
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    const initialCards = (gameStarted as any).state?.hand || (gameStarted as any).hand;

    this.logger.info('Initial hand dealt (holding all)', {
      cards: initialCards,
    });

    // Hold all 5 cards
    this.client.send({
      type: 'video_poker_draw',
      held: [true, true, true, true, true],
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const finalHand = gameResult.hand || gameResult.cards;
    const handRank = gameResult.handRank || gameResult.rank;

    this.recordGameResult(betAmount, `${handRank} (held all)`, payout);

    this.logger.info('Hold all result', {
      initialCards,
      finalHand,
      handRank,
      payout,
    });

    // Verify cards didn't change
    if (JSON.stringify(initialCards) === JSON.stringify(finalHand)) {
      this.logger.success('Cards correctly unchanged (all held)');
    } else {
      this.logger.warn('Cards changed despite holding all!');
    }
  }

  /**
   * Test 3: Hold none (replace all cards)
   */
  private async testHoldNone(): Promise<void> {
    this.logger.info('--- Test: Hold None (Replace All) ---');

    const betAmount = 10;

    // Deal initial hand
    this.client.send({
      type: 'video_poker_deal',
      amount: betAmount,
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    const initialCards = (gameStarted as any).state?.hand || (gameStarted as any).hand;

    this.logger.info('Initial hand dealt (replacing all)', {
      cards: initialCards,
    });

    // Hold none (replace all)
    this.client.send({
      type: 'video_poker_draw',
      held: [false, false, false, false, false],
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const finalHand = (gameResult as any).hand || (gameResult as any).cards;
    const handRank = (gameResult as any).handRank || (gameResult as any).rank;

    this.recordGameResult(betAmount, `${handRank} (replaced all)`, payout);

    this.logger.info('Replace all result', {
      initialCards,
      finalHand,
      handRank,
      payout,
    });

    // Verify all cards changed
    const sameCards = (initialCards as any)?.filter((card: number) =>
      (finalHand as any)?.includes(card)
    ).length || 0;

    if (sameCards === 0) {
      this.logger.success('All cards correctly replaced');
    } else {
      this.logger.info(`${sameCards}/5 cards remained the same`);
    }
  }

  /**
   * Test 4: Selective hold (strategic play)
   */
  private async testSelectiveHold(): Promise<void> {
    this.logger.info('--- Test: Selective Hold ---');

    const betAmount = 10;
    const balanceBefore = this.currentBalance;

    // Deal initial hand
    this.client.send({
      type: 'video_poker_deal',
      amount: betAmount,
    });

    const gameStarted = await this.assertMessageReceived('game_started');
    const initialCards = (gameStarted as any).state?.hand || (gameStarted as any).hand;

    this.logger.info('Initial hand (selective hold)', {
      cards: initialCards,
      holding: 'positions 0, 2, 4',
    });

    // Hold cards at positions 0, 2, 4
    this.client.send({
      type: 'video_poker_draw',
      held: [true, false, true, false, true],
    });

    const outcome = await this.waitForGameOutcome();
    const gameResult = outcome.message;
    const payout = parseFloat(gameResult.payout as string);
    const finalHand = gameResult.hand || gameResult.cards;
    const handRank = gameResult.handRank || gameResult.rank;

    this.recordGameResult(betAmount, `${handRank} (selective hold)`, payout);

    this.logger.info('Selective hold result', {
      initialCards,
      finalHand,
      handRank,
      heldPositions: [0, 2, 4],
      payout,
    });

    const balanceAfter = balanceBefore + payout - betAmount;
    this.assertBalanceUpdated(balanceAfter, this.currentBalance);

    // Log payout for common hands
    if (payout >= betAmount * 800) {
      this.logger.success('ROYAL FLUSH! 800x payout!');
    } else if (payout >= betAmount * 50) {
      this.logger.success('Straight Flush! 50x payout!');
    } else if (payout >= betAmount * 25) {
      this.logger.success('Four of a Kind! 25x payout!');
    } else if (payout >= betAmount) {
      this.logger.info(`Win! ${handRank}`);
    } else {
      this.logger.info(`No win (${handRank})`);
    }
  }
}
