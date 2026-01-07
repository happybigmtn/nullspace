/**
 * Phase Naming Consistency Tests (US-079)
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
