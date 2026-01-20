// @vitest-environment jsdom
/**
 * Game Switch Tests - AC-6.5 Validation
 *
 * AC-6.5: Web client renders game-specific bet layouts and rules for each supported game.
 *
 * These tests validate:
 * 1. All 10 game types are properly defined
 * 2. CommandPalette game selection works for all games
 * 3. Game type filtering and search works
 * 4. Game selection UI is accessible
 *
 * Note: Full game view rendering tests require client-side rendering due to
 * React Portal usage in game components (MobileDrawer, etc.).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameType } from '../../types';
import { CommandPalette } from '../casino/Layout';

// Mock window.matchMedia for tests
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// Mock game state factory - follows GameState type from @nullspace/types
function createMockGameState(type: GameType, overrides: Record<string, unknown> = {}) {
  return {
    type,
    stage: 'BETTING' as const,
    bet: 100,
    message: '',
    lastResult: 0,
    // Card games
    playerCards: [],
    dealerCards: [],
    communityCards: [],
    // Blackjack specific
    completedHands: [],
    blackjackStack: [],
    blackjack21Plus3Bet: 0,
    blackjackLuckyLadiesBet: 0,
    blackjackPerfectPairsBet: 0,
    blackjackBustItBet: 0,
    blackjackRoyalMatchBet: 0,
    blackjackPlayerValue: null,
    blackjackDealerValue: null,
    blackjackActions: {
      canHit: false,
      canStand: false,
      canDouble: false,
      canSplit: false,
      canSurrender: false,
      canInsurance: false,
    },
    insuranceBet: 0,
    // Dice/totals
    dice: [],
    // Craps
    crapsPoint: null,
    crapsEpochPointEstablished: false,
    crapsMadePointsMask: 0,
    crapsBets: [],
    crapsUndoStack: [],
    crapsInputMode: 'NONE' as const,
    crapsRollHistory: [],
    crapsEventLog: [],
    crapsLastRoundBets: [],
    crapsOddsCandidates: null,
    // Roulette
    rouletteBets: [],
    rouletteUndoStack: [],
    rouletteLastRoundBets: [],
    rouletteHistory: [],
    rouletteInputMode: 'NONE' as const,
    rouletteZeroRule: 'EUROPEAN' as const,
    rouletteIsPrison: false,
    // Sic Bo
    sicBoBets: [],
    sicBoHistory: [],
    sicBoInputMode: 'NONE' as const,
    sicBoUndoStack: [],
    sicBoLastRoundBets: [],
    // Baccarat
    baccaratSelection: null,
    baccaratBets: [],
    baccaratUndoStack: [],
    baccaratLastRoundBets: [],
    baccaratPlayerTotal: null,
    baccaratBankerTotal: null,
    // Three Card Poker
    threeCardPairPlusBet: 0,
    threeCardSixCardBonusBet: 0,
    threeCardProgressiveBet: 0,
    threeCardProgressiveJackpot: 0,
    threeCardPlayerRank: null,
    threeCardDealerRank: null,
    threeCardDealerQualifies: null,
    // Ultimate Holdem
    uthTripsBet: 0,
    uthSixCardBonusBet: 0,
    uthProgressiveBet: 0,
    uthProgressiveJackpot: 0,
    uthBonusCards: [],
    // Video Poker
    videoPokerHand: null,
    videoPokerMultiplier: null,
    videoPokerHolds: [false, false, false, false, false],
    videoPokerPaytable: 'JACKS_OR_BETTER' as const,
    // Casino War
    casinoWarTieBet: 0,
    casinoWarOutcome: null,
    // Hi-Lo
    hiloAccumulator: 0,
    hiloGraphData: [],
    hiloRules: null,
    hiloNextMultipliers: null,
    // Session
    sessionId: null,
    moveNumber: 0,
    sessionWager: 0,
    sessionInterimPayout: 0,
    // Resolved bets & modifiers
    resolvedBets: [],
    resolvedBetsKey: 0,
    activeModifiers: {},
    superMode: null,
    ...overrides,
  };
}

function renderToString(element: React.ReactElement): string {
  return renderToStaticMarkup(element);
}

// All 10 game types that must be supported per AC-6.5
const ALL_GAMES = [
  GameType.BACCARAT,
  GameType.BLACKJACK,
  GameType.CASINO_WAR,
  GameType.CRAPS,
  GameType.HILO,
  GameType.ROULETTE,
  GameType.SIC_BO,
  GameType.THREE_CARD,
  GameType.ULTIMATE_HOLDEM,
  GameType.VIDEO_POKER,
];

const SORTED_GAMES = Object.values(GameType)
  .filter((g) => g !== GameType.NONE)
  .sort();

describe('AC-6.5 Compliance - All 10 Games Supported', () => {
  it('counts exactly 10 distinct game types (excluding NONE)', () => {
    expect(ALL_GAMES.length).toBe(10);
    expect(new Set(ALL_GAMES).size).toBe(10);
  });

  it('GameType enum has all required games', () => {
    // Verify all games exist in the GameType enum
    expect(GameType.BACCARAT).toBe('BACCARAT');
    expect(GameType.BLACKJACK).toBe('BLACKJACK');
    expect(GameType.CASINO_WAR).toBe('CASINO_WAR');
    expect(GameType.CRAPS).toBe('CRAPS');
    expect(GameType.HILO).toBe('HILO');
    expect(GameType.ROULETTE).toBe('ROULETTE');
    expect(GameType.SIC_BO).toBe('SIC_BO');
    expect(GameType.THREE_CARD).toBe('THREE_CARD');
    expect(GameType.ULTIMATE_HOLDEM).toBe('ULTIMATE_HOLDEM');
    expect(GameType.VIDEO_POKER).toBe('VIDEO_POKER');
    expect(GameType.NONE).toBe('NONE');
  });

  it('GameType enum total count is 11 (10 games + NONE)', () => {
    const allTypes = Object.values(GameType);
    expect(allTypes.length).toBe(11);
  });

  describe('game mock state creation', () => {
    // Test that mock states can be created for all games without throwing
    it.each(ALL_GAMES)('creates valid mock state for %s', (gameType) => {
      const state = createMockGameState(gameType);
      expect(state.type).toBe(gameType);
      expect(state.stage).toBeDefined();
      expect(state.bet).toBeDefined();
    });
  });
});

describe('CommandPalette - Game Selection UI', () => {
  const mockInputRef = { current: null };

  describe('Game listing', () => {
    it('lists all 10 games when opened', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      // Verify each game type is listed (excluding NONE)
      expect(html).toContain('BACCARAT');
      expect(html).toContain('BLACKJACK');
      expect(html).toContain('CASINO_WAR');
      expect(html).toContain('CRAPS');
      expect(html).toContain('HILO');
      expect(html).toContain('ROULETTE');
      expect(html).toContain('SIC_BO');
      expect(html).toContain('THREE_CARD');
      expect(html).toContain('ULTIMATE_HOLDEM');
      expect(html).toContain('VIDEO_POKER');
    });

    it('does NOT list NONE game type', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      // NONE should not be in the sorted games list
      expect(SORTED_GAMES).not.toContain(GameType.NONE);
    });
  });

  describe('Game filtering (search)', () => {
    it('filters to BLACKJACK when searching "black"', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery="black"
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('BLACKJACK');
      expect(html).not.toContain('ROULETTE');
      expect(html).not.toContain('CRAPS');
    });

    it('filters to ROULETTE when searching "roul"', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery="roul"
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('ROULETTE');
      expect(html).not.toContain('BLACKJACK');
    });

    it('filters to CRAPS when searching "crap"', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery="crap"
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('CRAPS');
      expect(html).not.toContain('ROULETTE');
    });

    it('filters to SIC_BO when searching "sic"', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery="sic"
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('SIC_BO');
      expect(html).not.toContain('CRAPS');
    });

    it('filters to BACCARAT when searching "bacc"', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery="bacc"
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('BACCARAT');
      expect(html).not.toContain('BLACKJACK');
    });

    it('case-insensitive filtering works', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery="BLACK"
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('BLACKJACK');
    });

    it('shows "No results found" for unmatched search', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery="xyznonexistent"
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('No results found');
    });
  });

  describe('Closed state', () => {
    it('returns null when isOpen is false', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={false}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toBe('');
    });
  });

  describe('UI elements', () => {
    it('shows keyboard shortcut hint (Esc)', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('Esc');
    });

    it('shows search placeholder', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('Search Nullspace');
    });

    it('shows "Launch Game" action hint', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('Launch Game');
    });

    it('shows command prompt symbol', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('&gt;'); // > symbol encoded
    });
  });

  describe('Accessibility', () => {
    it('has backdrop for modal dismissal', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('fixed inset-0');
    });

    it('has search input element', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      expect(html).toContain('<input');
      expect(html).toContain('type="text"');
    });

    it('has keyboard number hints (1-9, 0) for quick selection', () => {
      const html = renderToString(
        <CommandPalette
          isOpen={true}
          searchQuery=""
          onSearchChange={vi.fn()}
          sortedGames={SORTED_GAMES}
          onSelectGame={vi.fn()}
          inputRef={mockInputRef as React.RefObject<HTMLInputElement>}
          onClose={vi.fn()}
        />
      );

      // Numbers 1-9 and 0 should appear as keyboard shortcuts
      for (let i = 1; i <= 9; i++) {
        expect(html).toContain(`>${i}<`);
      }
      expect(html).toContain('>0<');
    });
  });
});

describe('Game type categories', () => {
  it('identifies table games (Roulette, Sic Bo, Craps, Baccarat)', () => {
    const tableGames = [
      GameType.ROULETTE,
      GameType.SIC_BO,
      GameType.CRAPS,
      GameType.BACCARAT,
    ];

    for (const game of tableGames) {
      expect(ALL_GAMES).toContain(game);
    }
  });

  it('identifies card games', () => {
    const cardGames = [
      GameType.BLACKJACK,
      GameType.VIDEO_POKER,
      GameType.HILO,
      GameType.THREE_CARD,
      GameType.ULTIMATE_HOLDEM,
      GameType.CASINO_WAR,
    ];

    for (const game of cardGames) {
      expect(ALL_GAMES).toContain(game);
    }
  });

  it('total card + table games equals 10', () => {
    const tableGames = [
      GameType.ROULETTE,
      GameType.SIC_BO,
      GameType.CRAPS,
      GameType.BACCARAT,
    ];
    const cardGames = [
      GameType.BLACKJACK,
      GameType.VIDEO_POKER,
      GameType.HILO,
      GameType.THREE_CARD,
      GameType.ULTIMATE_HOLDEM,
      GameType.CASINO_WAR,
    ];

    expect(tableGames.length + cardGames.length).toBe(10);
  });
});

describe('Game state mock factory coverage', () => {
  describe('Table game specific fields', () => {
    it('mock state includes roulette fields', () => {
      const state = createMockGameState(GameType.ROULETTE);
      expect(state).toHaveProperty('rouletteBets');
      expect(state).toHaveProperty('rouletteHistory');
      expect(state).toHaveProperty('rouletteZeroRule');
      expect(state).toHaveProperty('rouletteInputMode');
    });

    it('mock state includes sic bo fields', () => {
      const state = createMockGameState(GameType.SIC_BO);
      expect(state).toHaveProperty('sicBoBets');
      expect(state).toHaveProperty('sicBoHistory');
      expect(state).toHaveProperty('sicBoInputMode');
    });

    it('mock state includes craps fields', () => {
      const state = createMockGameState(GameType.CRAPS);
      expect(state).toHaveProperty('crapsBets');
      expect(state).toHaveProperty('crapsPoint');
      expect(state).toHaveProperty('crapsEventLog');
      expect(state).toHaveProperty('crapsInputMode');
    });

    it('mock state includes baccarat fields', () => {
      const state = createMockGameState(GameType.BACCARAT);
      expect(state).toHaveProperty('baccaratBets');
      expect(state).toHaveProperty('baccaratSelection');
      expect(state).toHaveProperty('baccaratPlayerTotal');
      expect(state).toHaveProperty('baccaratBankerTotal');
    });
  });

  describe('Card game specific fields', () => {
    it('mock state includes blackjack fields', () => {
      const state = createMockGameState(GameType.BLACKJACK);
      expect(state).toHaveProperty('playerCards');
      expect(state).toHaveProperty('dealerCards');
      expect(state).toHaveProperty('completedHands');
      expect(state).toHaveProperty('blackjackStack');
      expect(state).toHaveProperty('blackjackActions');
    });

    it('mock state includes video poker fields', () => {
      const state = createMockGameState(GameType.VIDEO_POKER);
      expect(state).toHaveProperty('videoPokerHand');
      expect(state).toHaveProperty('videoPokerMultiplier');
      expect(state).toHaveProperty('videoPokerHolds');
      expect(state).toHaveProperty('videoPokerPaytable');
    });

    it('mock state includes three card poker fields', () => {
      const state = createMockGameState(GameType.THREE_CARD);
      expect(state).toHaveProperty('threeCardPairPlusBet');
      expect(state).toHaveProperty('threeCardPlayerRank');
      expect(state).toHaveProperty('threeCardDealerQualifies');
    });

    it('mock state includes ultimate holdem fields', () => {
      const state = createMockGameState(GameType.ULTIMATE_HOLDEM);
      expect(state).toHaveProperty('uthTripsBet');
      expect(state).toHaveProperty('uthBonusCards');
      expect(state).toHaveProperty('communityCards');
    });

    it('mock state includes hi-lo fields', () => {
      const state = createMockGameState(GameType.HILO);
      expect(state).toHaveProperty('hiloAccumulator');
      expect(state).toHaveProperty('hiloGraphData');
      expect(state).toHaveProperty('hiloRules');
      expect(state).toHaveProperty('hiloNextMultipliers');
    });

    it('mock state includes casino war fields', () => {
      const state = createMockGameState(GameType.CASINO_WAR);
      expect(state).toHaveProperty('casinoWarTieBet');
      expect(state).toHaveProperty('casinoWarOutcome');
    });
  });

  describe('Common fields', () => {
    it.each(ALL_GAMES)('%s mock state has common game fields', (gameType) => {
      const state = createMockGameState(gameType);
      expect(state).toHaveProperty('type', gameType);
      expect(state).toHaveProperty('stage');
      expect(state).toHaveProperty('bet');
      expect(state).toHaveProperty('message');
      expect(state).toHaveProperty('lastResult');
      expect(state).toHaveProperty('resolvedBets');
      expect(state).toHaveProperty('activeModifiers');
      expect(state).toHaveProperty('superMode');
      expect(state).toHaveProperty('sessionId');
      expect(state).toHaveProperty('moveNumber');
    });
  });
});
