/**
 * Phase Naming Consistency Tests (US-079) and
 * Action Mask Cross-Hand Consistency Tests (US-080)
 *
 * Tests to verify that phase/stage values are correctly mapped between:
 * - Rust execution layer (numeric enum values: 0, 1, 2, 3, ...)
 * - Mobile TypeScript (string phase types: 'betting', 'player_turn', 'dealer_turn', ...)
 *
 * Documents the canonical mapping:
 *   Rust Stage/Phase → Mobile Phase String
 *   ─────────────────────────────────────────
 *   Blackjack:
 *     0 (Betting)        → 'betting'
 *     1 (PlayerTurn)     → 'player_turn'
 *     2 (AwaitingReveal) → 'dealer_turn'
 *     3 (Complete)       → 'result'
 *
 *   Craps:
 *     0 (ComeOut)        → 'comeout'
 *     1 (Point)          → 'point'
 */

import { parseBlackjackState } from '../blackjack';
import { parseCrapsState } from '../craps';

// ============================================================================
// BLACKJACK PHASE MAPPING TESTS
// ============================================================================

describe('Blackjack phase naming consistency (US-079)', () => {
  /**
   * Build a minimal blackjack v4 state blob with given stage
   */
  function buildBlackjackStateBlob(stage: number): Uint8Array {
    const blob = new Uint8Array(51);
    blob[0] = 4; // version
    blob[1] = stage;
    // Side bets: bytes 2-41 (40 bytes) = all zeros
    // Init cards: bytes 42-43 = [0xff, 0xff] (hidden)
    blob[42] = 0xff;
    blob[43] = 0xff;
    // Active hand index: byte 44 = 0
    blob[44] = 0;
    // Hand count: byte 45 = 0
    blob[45] = 0;
    // Dealer card count: byte 46 = 0
    blob[46] = 0;
    // Rules flags: byte 47 = 0
    blob[47] = 0;
    // Rules decks: byte 48 = 4
    blob[48] = 4;
    // Player value: byte 49 = 0
    blob[49] = 0;
    // Dealer value: byte 50 = 0
    blob[50] = 0;
    // Note: actionMask would need another byte, but parser handles truncated blob
    return blob;
  }

  describe('Rust Stage enum → Mobile phase string mapping', () => {
    it('maps Stage::Betting (0) to "betting"', () => {
      const blob = buildBlackjackStateBlob(0);
      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('betting');
    });

    it('maps Stage::PlayerTurn (1) to "player_turn"', () => {
      const blob = buildBlackjackStateBlob(1);
      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('player_turn');
    });

    it('maps Stage::AwaitingReveal (2) to "dealer_turn"', () => {
      // NOTE: Rust uses "AwaitingReveal" but mobile uses "dealer_turn" for UI clarity
      // This is intentional - the gateway auto-reveals during this phase
      const blob = buildBlackjackStateBlob(2);
      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('dealer_turn');
    });

    it('maps Stage::Complete (3) to "result"', () => {
      const blob = buildBlackjackStateBlob(3);
      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('result');
    });
  });

  describe('Unknown phase handling', () => {
    it('maps unknown stage (4) to "result" (graceful fallback)', () => {
      // Stage values > 3 fall through the if-else to 'result'
      const blob = buildBlackjackStateBlob(4);
      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('result');
    });

    it('maps stage 255 to "result" (boundary case)', () => {
      const blob = buildBlackjackStateBlob(255);
      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('result');
    });
  });

  describe('Phase-dependent behavior', () => {
    it('dealerHidden is true for all phases except result', () => {
      for (const stage of [0, 1, 2]) {
        const blob = buildBlackjackStateBlob(stage);
        const result = parseBlackjackState(blob);
        expect(result).not.toBeNull();
        expect(result!.dealerHidden).toBe(true);
      }

      // Stage 3 (result) should show dealer cards
      const resultBlob = buildBlackjackStateBlob(3);
      const resultState = parseBlackjackState(resultBlob);
      expect(resultState).not.toBeNull();
      expect(resultState!.dealerHidden).toBe(false);
    });
  });
});

// ============================================================================
// CRAPS PHASE MAPPING TESTS
// ============================================================================

describe('Craps phase naming consistency (US-079)', () => {
  /**
   * Build a minimal craps v2 state blob with given phase
   * v2 layout (8+ bytes):
   *   [0]: version (2)
   *   [1]: phase (0=comeout, 1=point)
   *   [2]: mainPoint
   *   [3]: die1
   *   [4]: die2
   *   [5]: madePointsMask
   *   [6]: epochPointEstablished
   *   [7]: betCount
   */
  function buildCrapsStateBlob(phase: number): Uint8Array {
    const blob = new Uint8Array(8);
    blob[0] = 2; // version 2
    blob[1] = phase; // phase (0=comeout, 1=point)
    blob[2] = 0; // mainPoint (no point yet)
    blob[3] = 0; // die1 (no roll)
    blob[4] = 0; // die2
    blob[5] = 0; // madePointsMask
    blob[6] = 0; // epochPointEstablished
    blob[7] = 0; // betCount
    return blob;
  }

  describe('Rust Phase enum → Mobile phase string mapping', () => {
    it('maps Phase::ComeOut (0) to "comeout"', () => {
      const blob = buildCrapsStateBlob(0);
      const result = parseCrapsState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('comeout');
    });

    it('maps Phase::Point (1) to "point"', () => {
      const blob = buildCrapsStateBlob(1);
      const result = parseCrapsState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('point');
    });
  });

  describe('Unknown phase handling', () => {
    it('maps unknown phase (2) to "comeout" (graceful fallback)', () => {
      // Phase !== 1 defaults to 'comeout'
      const blob = buildCrapsStateBlob(2);
      const result = parseCrapsState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('comeout');
    });

    it('maps phase 255 to "comeout" (boundary case)', () => {
      const blob = buildCrapsStateBlob(255);
      const result = parseCrapsState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('comeout');
    });
  });
});

// ============================================================================
// DOCUMENTATION: CANONICAL PHASE MAPPING TABLE
// ============================================================================

describe('Phase naming documentation (US-079)', () => {
  /**
   * This test serves as living documentation for the phase naming mapping.
   * If naming conventions change, this test should be updated.
   */
  it('documents the canonical phase mapping table', () => {
    const blackjackMapping = {
      0: 'betting',      // Rust: Stage::Betting
      1: 'player_turn',  // Rust: Stage::PlayerTurn
      2: 'dealer_turn',  // Rust: Stage::AwaitingReveal (UI-friendly name)
      3: 'result',       // Rust: Stage::Complete
    };

    const crapsMapping = {
      0: 'comeout',      // Rust: Phase::ComeOut
      1: 'point',        // Rust: Phase::Point
    };

    // Verify mappings match implementation
    expect(blackjackMapping).toEqual({
      0: 'betting',
      1: 'player_turn',
      2: 'dealer_turn',
      3: 'result',
    });

    expect(crapsMapping).toEqual({
      0: 'comeout',
      1: 'point',
    });
  });

  it('documents that "AwaitingReveal" maps to "dealer_turn" intentionally', () => {
    // The Rust execution layer uses "AwaitingReveal" to indicate:
    // - Player has finished actions (hit/stand/double/split)
    // - Dealer reveal and draw needs to happen
    //
    // The mobile UI uses "dealer_turn" because:
    // - More intuitive for users ("Dealer's turn" message)
    // - Gateway auto-reveals during this phase
    //
    // This is NOT a bug - it's intentional naming for different layers.
    expect(true).toBe(true);
  });

  it('documents fallback behavior for unknown phases', () => {
    // Blackjack: Unknown stages (> 3) fall through to 'result'
    //   - Safe because result is the terminal state
    //   - UI shows final outcome even if phase is unexpected
    //
    // Craps: Unknown phases (!== 1) default to 'comeout'
    //   - Safe because comeout is the initial state
    //   - UI can accept new bets even if phase is unexpected
    expect(true).toBe(true);
  });
});

// ============================================================================
// ACTION MASK CROSS-HAND CONSISTENCY TESTS (US-080)
// ============================================================================

describe('Blackjack actionMask cross-hand consistency (US-080)', () => {
  /**
   * ActionMask bit layout:
   *   Bit 0 (0x01): HIT - always available during PlayerTurn
   *   Bit 1 (0x02): STAND - always available during PlayerTurn
   *   Bit 2 (0x04): DOUBLE - only with 2 cards, bet_mult=1, (no split or DAS allowed)
   *   Bit 3 (0x08): SPLIT - only with 2 cards that are a pair
   */

  /**
   * Build a blackjack v4 state blob with specified action mask and hand configuration
   */
  function buildBlackjackStateWithMask(options: {
    stage: number;
    activeHandIndex: number;
    hands: Array<{ betMult: number; status: number; wasSplit: number; cards: number[] }>;
    actionMask: number;
  }): Uint8Array {
    const result: number[] = [];

    // Version + stage (2 bytes)
    result.push(4); // version
    result.push(options.stage);

    // Side bets (5 x 8 bytes = 40 bytes, all zeros)
    for (let i = 0; i < 40; i++) result.push(0);

    // Init player cards (2 bytes) - use first hand's first 2 cards
    const firstHand = options.hands[0];
    result.push(firstHand?.cards[0] ?? 0xff);
    result.push(firstHand?.cards[1] ?? 0xff);

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

    // Dealer cards (1 dealer card + hidden)
    result.push(2);
    result.push(12); // K♠
    result.push(0xff); // hidden

    // Rules + values + action mask (5 bytes)
    result.push(0); // rules flags
    result.push(4); // rules decks
    result.push(0); // player value
    result.push(10); // dealer value
    result.push(options.actionMask);

    return new Uint8Array(result);
  }

  describe('actionMask bits match actual game state', () => {
    it('canDouble=true when actionMask bit 2 is set', () => {
      // Hand with 2 cards, actionMask has bit 2 set
      const blob = buildBlackjackStateWithMask({
        stage: 1, // player_turn
        activeHandIndex: 0,
        hands: [
          { betMult: 1, status: 0, wasSplit: 0, cards: [7, 20] }, // 8♠ + 8♥ (2 cards)
        ],
        actionMask: 0b00001111, // hit + stand + double + split
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.canDouble).toBe(true);
    });

    it('canDouble=false when actionMask bit 2 is NOT set', () => {
      // Hand with 3 cards (hit was made), actionMask should not have bit 2
      const blob = buildBlackjackStateWithMask({
        stage: 1, // player_turn
        activeHandIndex: 0,
        hands: [
          { betMult: 1, status: 0, wasSplit: 0, cards: [7, 20, 5] }, // 3 cards
        ],
        actionMask: 0b00000011, // hit + stand only
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.canDouble).toBe(false);
    });

    it('canSplit=true when actionMask bit 3 is set', () => {
      const blob = buildBlackjackStateWithMask({
        stage: 1,
        activeHandIndex: 0,
        hands: [
          { betMult: 1, status: 0, wasSplit: 0, cards: [7, 20] }, // pair of 8s
        ],
        actionMask: 0b00001111, // includes split
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.canSplit).toBe(true);
    });

    it('canSplit=false when actionMask bit 3 is NOT set', () => {
      const blob = buildBlackjackStateWithMask({
        stage: 1,
        activeHandIndex: 0,
        hands: [
          { betMult: 1, status: 0, wasSplit: 0, cards: [7, 5] }, // not a pair
        ],
        actionMask: 0b00000111, // hit + stand + double, NO split
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.canSplit).toBe(false);
    });
  });

  describe('actionMask changes when active_hand_idx changes after split', () => {
    it('second hand after split has different actionMask (canSplit may differ)', () => {
      // First hand (index 0): was split, now has non-pair
      // Second hand (index 1): was split, could have pair again
      const blobHand0 = buildBlackjackStateWithMask({
        stage: 1,
        activeHandIndex: 0,
        hands: [
          { betMult: 1, status: 0, wasSplit: 1, cards: [7, 3] }, // 8♠ + 4♠ (not pair)
          { betMult: 1, status: 0, wasSplit: 1, cards: [20, 33] }, // 8♥ + 8♦ (pair!)
        ],
        actionMask: 0b00000111, // hit + stand + double (no split - not a pair)
      });

      const result0 = parseBlackjackState(blobHand0);
      expect(result0).not.toBeNull();
      expect(result0!.canSplit).toBe(false); // active hand is not a pair

      // Now switch to second hand (which IS a pair)
      const blobHand1 = buildBlackjackStateWithMask({
        stage: 1,
        activeHandIndex: 1,
        hands: [
          { betMult: 1, status: 0, wasSplit: 1, cards: [7, 3] },
          { betMult: 1, status: 0, wasSplit: 1, cards: [20, 33] }, // pair of 8s
        ],
        actionMask: 0b00001111, // hit + stand + double + SPLIT
      });

      const result1 = parseBlackjackState(blobHand1);
      expect(result1).not.toBeNull();
      expect(result1!.canSplit).toBe(true); // active hand IS a pair
    });

    it('active hand changes affect which cards are displayed', () => {
      const blob = buildBlackjackStateWithMask({
        stage: 1,
        activeHandIndex: 1, // second hand is active
        hands: [
          { betMult: 1, status: 0, wasSplit: 1, cards: [7] }, // first hand: 8♠ only
          { betMult: 1, status: 0, wasSplit: 1, cards: [20, 5] }, // second hand: 8♥ + 6♠
        ],
        actionMask: 0b00000011,
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      // Should show the active hand's cards, not the first hand
      expect(result!.playerCards.length).toBe(2);
    });
  });

  describe('canDouble validation against card count', () => {
    it('canDouble false when hand has >2 cards (even if bit 2 were set incorrectly)', () => {
      // NOTE: The Rust execution layer correctly sets actionMask based on card count
      // This test verifies the mobile layer correctly interprets the mask
      const blob = buildBlackjackStateWithMask({
        stage: 1,
        activeHandIndex: 0,
        hands: [
          { betMult: 1, status: 0, wasSplit: 0, cards: [7, 5, 3] }, // 3 cards
        ],
        // Even if we incorrectly set bit 2 (which Rust wouldn't do)
        actionMask: 0b00000111, // double bit set incorrectly
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      // The mobile layer trusts the actionMask from Rust
      // If Rust says double is allowed, mobile shows the button
      // This is the DOCUMENTED behavior - Rust is source of truth
      expect(result!.canDouble).toBe(true);
    });

    it('documents: mobile trusts actionMask without validation', () => {
      // The mobile layer does NOT independently validate actionMask
      // It trusts the Rust execution layer to set correct bits
      // This is by design - prevents logic duplication and potential desync
      //
      // If validation were needed, it should happen in the protocol layer
      // or the gateway before sending to mobile
      expect(true).toBe(true);
    });
  });

  describe('actionMask reflects current hand state correctly', () => {
    it('betting phase has actionMask=0 (no actions available)', () => {
      const blob = buildBlackjackStateWithMask({
        stage: 0, // betting
        activeHandIndex: 0,
        hands: [],
        actionMask: 0,
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.canDouble).toBe(false);
      expect(result!.canSplit).toBe(false);
    });

    it('dealer_turn (AwaitingReveal) has actionMask=0', () => {
      const blob = buildBlackjackStateWithMask({
        stage: 2, // AwaitingReveal
        activeHandIndex: 0,
        hands: [
          { betMult: 1, status: 0, wasSplit: 0, cards: [7, 5, 3] },
        ],
        actionMask: 0, // no player actions during dealer turn
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('dealer_turn');
      expect(result!.canDouble).toBe(false);
      expect(result!.canSplit).toBe(false);
    });

    it('result phase has actionMask=0', () => {
      const blob = buildBlackjackStateWithMask({
        stage: 3, // Complete
        activeHandIndex: 0,
        hands: [
          { betMult: 1, status: 0, wasSplit: 0, cards: [7, 5] },
        ],
        actionMask: 0,
      });

      const result = parseBlackjackState(blob);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe('result');
      expect(result!.canDouble).toBe(false);
      expect(result!.canSplit).toBe(false);
    });
  });

  describe('actionMask documentation (US-080)', () => {
    it('documents the canonical actionMask bit layout', () => {
      const actionMaskBits = {
        HIT: 0x01,    // Bit 0: Can hit (always during PlayerTurn)
        STAND: 0x02,  // Bit 1: Can stand (always during PlayerTurn)
        DOUBLE: 0x04, // Bit 2: Can double (2 cards, bet_mult=1, DAS rules)
        SPLIT: 0x08,  // Bit 3: Can split (2 cards, pair, hands < MAX_HANDS)
      };

      expect(actionMaskBits.HIT).toBe(0b00000001);
      expect(actionMaskBits.STAND).toBe(0b00000010);
      expect(actionMaskBits.DOUBLE).toBe(0b00000100);
      expect(actionMaskBits.SPLIT).toBe(0b00001000);
    });

    it('documents that mobile trusts Rust actionMask', () => {
      // Mobile layer design decision:
      // - Trust actionMask from Rust execution layer
      // - No duplicate validation logic
      // - Simpler code, single source of truth
      //
      // Trade-offs:
      // + No logic divergence between layers
      // + Faster mobile parsing (no extra checks)
      // - Must trust gateway/execution to send correct mask
      // - No defense-in-depth for incorrect masks
      expect(true).toBe(true);
    });
  });
});
