/**
 * State fixtures for game screen tests
 *
 * These byte arrays represent valid game state blobs that the real parsers can decode.
 * Generated from golden vectors in packages/protocol/test/fixtures/golden-vectors.json
 */

/**
 * Convert hex string to byte array
 */
export function hexToBytes(hex: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Write a big-endian u64 to a byte array at the given offset
 */
function writeU64BE(bytes: number[], offset: number, value: bigint): void {
  for (let i = 7; i >= 0; i--) {
    bytes[offset + (7 - i)] = Number((value >> BigInt(i * 8)) & 0xffn);
  }
}

/**
 * Write a big-endian i64 to a byte array at the given offset
 */
function writeI64BE(bytes: number[], offset: number, value: bigint): void {
  writeU64BE(bytes, offset, value);
}

/**
 * Write a big-endian u32 to a byte array at the given offset
 */
function writeU32BE(bytes: number[], offset: number, value: number): void {
  bytes[offset] = (value >> 24) & 0xff;
  bytes[offset + 1] = (value >> 16) & 0xff;
  bytes[offset + 2] = (value >> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

// ============================================================================
// BLACKJACK STATE FIXTURES
// ============================================================================

/**
 * Build a blackjack v4 state blob from components.
 * v4 header layout (46 bytes):
 *   [0]: version
 *   [1]: stage (0=betting, 1=player_turn, 2=dealer_turn, 3=result)
 *   [2-9]: sideBet21Plus3 (u64 BE)
 *   [10-17]: sideBetLuckyLadies (u64 BE)
 *   [18-25]: sideBetPerfectPairs (u64 BE)
 *   [26-33]: sideBetBustIt (u64 BE)
 *   [34-41]: sideBetRoyalMatch (u64 BE)
 *   [42-43]: initPlayerCards (2 bytes)
 *   [44]: activeHandIndex
 *   [45]: handCount
 * Then for each hand: betMult(1) + status(1) + wasSplit(1) + cardCount(1) + cards(variable)
 * Then: dealerCount(1) + dealerCards(variable)
 * Then: rulesFlags(1) + rulesDecks(1) + playerValue(1) + dealerValue(1) + actionMask(1)
 */
function buildBlackjackState(options: {
  stage: number;
  initCards: [number, number];
  activeHandIndex: number;
  hands: Array<{ betMult: number; status: number; wasSplit: number; cards: number[] }>;
  dealerCards: number[];
  playerValue: number;
  dealerValue: number;
  actionMask: number;
}): number[] {
  const result: number[] = [];

  // Version + stage (2 bytes)
  result.push(4); // version
  result.push(options.stage);

  // Side bets (5 x 8 bytes = 40 bytes, all zeros)
  for (let i = 0; i < 40; i++) result.push(0);

  // Init player cards (2 bytes)
  result.push(options.initCards[0]);
  result.push(options.initCards[1]);

  // Active hand index (1 byte)
  result.push(options.activeHandIndex);

  // Hand count (1 byte)
  result.push(options.hands.length);

  // Hands (variable)
  for (const hand of options.hands) {
    result.push(hand.betMult);
    result.push(hand.status);
    result.push(hand.wasSplit);
    result.push(hand.cards.length);
    for (const card of hand.cards) {
      result.push(card);
    }
  }

  // Dealer cards
  result.push(options.dealerCards.length);
  for (const card of options.dealerCards) {
    result.push(card);
  }

  // Rules + values + action mask (5 bytes)
  result.push(0); // rules flags
  result.push(4); // rules decks
  result.push(options.playerValue);
  result.push(options.dealerValue);
  result.push(options.actionMask);

  return result;
}

/**
 * Blackjack v4: betting stage, no hands, no cards
 * Expected parse result:
 * - phase: 'betting'
 * - playerCards: []
 * - dealerCards: []
 * - canDouble: false
 * - canSplit: false
 */
export function createBlackjackBettingState(): number[] {
  return buildBlackjackState({
    stage: 0, // betting
    initCards: [0xff, 0xff],
    activeHandIndex: 0,
    hands: [],
    dealerCards: [],
    playerValue: 0,
    dealerValue: 0,
    actionMask: 0,
  });
}

/**
 * Blackjack v4: player turn, one hand with cards (9♠ only), dealer shows K♠ hidden
 * Card IDs: 8 = 9♠ (spades suit=0, rank index 8 = '9')
 *           12 = K♠ (spades suit=0, rank index 12 = 'K')
 * Expected parse result:
 * - phase: 'player_turn'
 * - playerCards: [{suit: 'spades', rank: '9'}]
 * - dealerCards: [{suit: 'spades', rank: 'K'}]
 * - playerTotal: 9
 * - canDouble: false (bit 2 not set)
 * - canSplit: false (bit 3 not set)
 */
export function createBlackjackPlayerTurnState(): number[] {
  return buildBlackjackState({
    stage: 1, // player_turn
    initCards: [8, 0xff],
    activeHandIndex: 0,
    hands: [
      { betMult: 1, status: 0, wasSplit: 0, cards: [8] }, // 9♠
    ],
    dealerCards: [12, 0xff], // K♠ + hidden
    playerValue: 9,
    dealerValue: 10,
    actionMask: 0b00000011, // hit + stand only
  });
}

/**
 * Blackjack v4: player turn with pair of 8s (can split)
 * Card IDs: 7 = 8♠, 20 = 8♥ (hearts suit=1, rank index 7 = '8', so 13*1 + 7 = 20)
 *           8 = 9♠
 * Expected parse result:
 * - phase: 'player_turn'
 * - playerCards: [{suit: 'spades', rank: '8'}, {suit: 'hearts', rank: '8'}]
 * - dealerCards: [{suit: 'spades', rank: '9'}]
 * - playerTotal: 16
 * - canDouble: true (bit 2 set)
 * - canSplit: true (bit 3 set)
 */
export function createBlackjackSplitableState(): number[] {
  return buildBlackjackState({
    stage: 1, // player_turn
    initCards: [7, 20],
    activeHandIndex: 0,
    hands: [
      { betMult: 1, status: 0, wasSplit: 0, cards: [7, 20] }, // 8♠ + 8♥
    ],
    dealerCards: [8, 0xff], // 9♠ + hidden
    playerValue: 16,
    dealerValue: 9,
    actionMask: 0b00001111, // hit + stand + double + split
  });
}

// ============================================================================
// HI-LO STATE FIXTURES
// ============================================================================

/**
 * HiLo: card 10 (Jack ♠), accumulator 10000 basis points
 * Expected parse result:
 * - currentCard: {suit: 'spades', rank: 'J'}
 * - accumulator: 10000
 */
export function createHiLoActiveState(): number[] {
  const blob = new Array(22).fill(0);
  blob[0] = 10; // Jack of spades (card id 10)
  writeI64BE(blob, 1, 10000n); // accumulator basis points
  blob[9] = 1; // rules byte
  writeU32BE(blob, 10, 13000); // higher multiplier
  writeU32BE(blob, 14, 43333); // lower multiplier
  writeU32BE(blob, 18, 130000); // same multiplier
  return blob;
}

/**
 * HiLo: Ace ♠, base multiplier
 * Expected parse result:
 * - currentCard: {suit: 'spades', rank: 'A'}
 * - accumulator: 10000
 */
export function createHiLoAceState(): number[] {
  const blob = new Array(22).fill(0);
  blob[0] = 0; // Ace of spades (card id 0)
  writeI64BE(blob, 1, 10000n);
  blob[9] = 0; // rules byte
  writeU32BE(blob, 10, 12308);
  writeU32BE(blob, 14, 130000);
  writeU32BE(blob, 18, 130000);
  return blob;
}

// ============================================================================
// VIDEO POKER STATE FIXTURES
// ============================================================================

/**
 * VideoPoker: deal stage, 5 cards dealt (A♠, 2♠, 3♠, 4♠, 5♠)
 * Expected parse result:
 * - stage: 'deal'
 * - cards: 5 cards with suits and ranks
 */
export function createVideoPokerDealState(): number[] {
  return [0, 0, 1, 2, 3, 4, 0]; // stage=0, cards 0-4, holdMask=0
}

/**
 * VideoPoker: draw stage, royal flush hand (10♠ J♠ Q♠ K♠ A♠)
 * Card IDs: 9=10♠, 10=J♠, 11=Q♠, 12=K♠, 0=A♠
 * Expected parse result:
 * - stage: 'draw'
 * - cards: royal flush cards
 */
export function createVideoPokerDrawState(): number[] {
  return [1, 0, 9, 10, 11, 12, 0]; // stage=1, A♠ 10♠ J♠ Q♠ K♠
}

// ============================================================================
// CASINO WAR STATE FIXTURES
// ============================================================================

/**
 * CasinoWar v1: betting stage, no cards
 * Expected parse result:
 * - stage: 'betting'
 * - playerCard: null
 * - dealerCard: null
 * - tieBet: 0
 */
export function createCasinoWarBettingState(): number[] {
  const blob = new Array(12).fill(0);
  blob[0] = 1; // version
  blob[1] = 0; // betting stage
  blob[2] = 0xff; // player card (hidden)
  blob[3] = 0xff; // dealer card (hidden)
  // tieBet = 0 (bytes 4-11)
  return blob;
}

/**
 * CasinoWar v1: war stage (tie occurred), both have Aces
 * Player: A♠ (0), Dealer: A♥ (13)
 * Expected parse result:
 * - stage: 'war'
 * - playerCard: {suit: 'spades', rank: 'A'}
 * - dealerCard: {suit: 'hearts', rank: 'A'}
 * - tieBet: 10
 */
export function createCasinoWarWarState(): number[] {
  const blob = new Array(12).fill(0);
  blob[0] = 1; // version
  blob[1] = 1; // war stage
  blob[2] = 0; // player card: A♠
  blob[3] = 13; // dealer card: A♥
  writeU64BE(blob, 4, 10n); // tieBet = 10
  return blob;
}

// ============================================================================
// THREE CARD POKER STATE FIXTURES
// ============================================================================

/**
 * ThreeCard v3: betting stage, no cards
 * Expected parse result:
 * - stage: 'betting'
 * - playerCards: []
 * - dealerCards: []
 */
export function createThreeCardBettingState(): number[] {
  const blob = new Array(32).fill(0);
  blob[0] = 3; // version
  blob[1] = 0; // betting stage
  blob[2] = 0xff; // player cards hidden
  blob[3] = 0xff;
  blob[4] = 0xff;
  blob[5] = 0xff; // dealer cards hidden
  blob[6] = 0xff;
  blob[7] = 0xff;
  // Side bets all 0 (bytes 8-31)
  return blob;
}

/**
 * ThreeCard v3: decision stage, player has A♠ K♠ Q♠ (straight flush)
 * Expected parse result:
 * - stage: 'decision'
 * - playerCards: [{suit:'spades',rank:'A'}, {suit:'spades',rank:'K'}, {suit:'spades',rank:'Q'}]
 * - dealerCards: hidden (0xff)
 */
export function createThreeCardDecisionState(): number[] {
  const blob = new Array(32).fill(0);
  blob[0] = 3; // version
  blob[1] = 1; // decision stage
  blob[2] = 0; // A♠
  blob[3] = 12; // K♠
  blob[4] = 11; // Q♠
  blob[5] = 0xff; // dealer cards hidden
  blob[6] = 0xff;
  blob[7] = 0xff;
  // Side bets all 0 (bytes 8-31)
  return blob;
}

// ============================================================================
// ULTIMATE TEXAS HOLD'EM STATE FIXTURES
// ============================================================================

/**
 * UTH v3: betting stage, no cards
 * Expected parse result:
 * - stage: 'betting'
 * - playerCards: []
 * - communityCards: []
 * - dealerCards: []
 */
export function createUltimateHoldemBettingState(): number[] {
  const blob = new Array(40).fill(0);
  blob[0] = 3; // version
  blob[1] = 0; // betting stage
  blob[2] = 0xff; // player cards hidden
  blob[3] = 0xff;
  blob[4] = 0xff; // community cards hidden
  blob[5] = 0xff;
  blob[6] = 0xff;
  blob[7] = 0xff;
  blob[8] = 0xff;
  blob[9] = 0xff; // dealer cards hidden
  blob[10] = 0xff;
  blob[11] = 0; // play multiplier
  blob[12] = 0xff; // bonus cards hidden
  blob[13] = 0xff;
  blob[14] = 0xff;
  blob[15] = 0xff;
  // Side bets (bytes 16-39)
  return blob;
}

/**
 * UTH v3: preflop stage, player has A♠ K♠
 * Expected parse result:
 * - stage: 'preflop'
 * - playerCards: [{suit:'spades',rank:'A'}, {suit:'spades',rank:'K'}]
 */
export function createUltimateHoldemPreflopState(): number[] {
  const blob = new Array(40).fill(0);
  blob[0] = 3; // version
  blob[1] = 1; // preflop stage
  blob[2] = 0; // A♠
  blob[3] = 12; // K♠
  blob[4] = 0xff; // community cards hidden
  blob[5] = 0xff;
  blob[6] = 0xff;
  blob[7] = 0xff;
  blob[8] = 0xff;
  blob[9] = 0xff; // dealer cards hidden
  blob[10] = 0xff;
  blob[11] = 0; // play multiplier
  blob[12] = 0xff; // bonus cards hidden
  blob[13] = 0xff;
  blob[14] = 0xff;
  blob[15] = 0xff;
  // Side bets (bytes 16-39)
  return blob;
}

/**
 * UTH v3: river stage, community cards revealed
 * Expected parse result:
 * - stage: 'river'
 */
export function createUltimateHoldemRiverState(): number[] {
  const blob = new Array(40).fill(0);
  blob[0] = 3; // version
  blob[1] = 3; // river stage
  blob[2] = 0; // A♠
  blob[3] = 12; // K♠
  blob[4] = 1; // 2♠
  blob[5] = 2; // 3♠
  blob[6] = 3; // 4♠
  blob[7] = 4; // 5♠
  blob[8] = 5; // 6♠
  blob[9] = 0xff; // dealer cards still hidden
  blob[10] = 0xff;
  blob[11] = 0; // play multiplier
  blob[12] = 0xff;
  blob[13] = 0xff;
  blob[14] = 0xff;
  blob[15] = 0xff;
  // Side bets (bytes 16-39)
  return blob;
}
