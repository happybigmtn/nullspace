# Game State Parser - Usage Examples

This document provides examples of how to use the game state parsers with the casino chain service.

## Overview

The `gameStateParser.ts` module provides functions to parse binary state blobs from on-chain casino games into typed TypeScript objects. All parsers use Big Endian byte order to match the chain's serialization format.

## Basic Usage

```typescript
import { parseGameState } from './utils/gameStateParser';
import { GameType } from './types/casino';
import { CasinoChainService } from './services/CasinoChainService';

// Subscribe to game events
const chainService = new CasinoChainService(client);

chainService.onGameStarted((event) => {
  // Parse the initial game state
  const parsed = parseGameState(event.gameType, event.initialState);

  console.log('Game started:', parsed);
});

chainService.onGameMoved((event) => {
  // Parse the updated game state
  const parsed = parseGameState(event.gameType, event.newState);

  console.log('Game state updated:', parsed);
});
```

## Game-Specific Examples

### Blackjack

```typescript
import { parseBlackjackState, getBlackjackValue } from './utils/gameStateParser';

chainService.onGameStarted((event) => {
  if (event.gameType === GameType.Blackjack) {
    const state = parseBlackjackState(event.initialState);

    console.log('Player hand:', state.playerHand);
    console.log('Dealer hand:', state.dealerHand);
    console.log('Stage:', state.stage);

    // Calculate hand values
    const playerValue = getBlackjackValue(state.playerHand);
    const dealerValue = getBlackjackValue(state.dealerHand);

    console.log(`Player: ${playerValue}, Dealer: ${dealerValue}`);
  }
});
```

**State Format:**
- `playerHand`: Array of Card objects for the player
- `dealerHand`: Array of Card objects for the dealer
- `stage`: 'PLAYER_TURN' | 'DEALER_TURN' | 'COMPLETE'

### Roulette

```typescript
import { parseRouletteState } from './utils/gameStateParser';

chainService.onGameMoved((event) => {
  if (event.gameType === GameType.Roulette) {
    const state = parseRouletteState(event.newState);

    if (state.result !== null) {
      console.log('Ball landed on:', state.result);

      // Determine color
      const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
      const color = state.result === 0 ? 'GREEN' :
                    redNumbers.includes(state.result) ? 'RED' : 'BLACK';

      console.log('Color:', color);
    }
  }
});
```

**State Format:**
- `result`: number (0-36) or null if not yet spun

### Baccarat

```typescript
import { parseBaccaratState, getBaccaratValue } from './utils/gameStateParser';

chainService.onGameStarted((event) => {
  if (event.gameType === GameType.Baccarat) {
    const state = parseBaccaratState(event.initialState);

    const playerValue = getBaccaratValue(state.playerHand);
    const bankerValue = getBaccaratValue(state.bankerHand);

    console.log(`Player: ${playerValue} (${state.playerHand.length} cards)`);
    console.log(`Banker: ${bankerValue} (${state.bankerHand.length} cards)`);

    // Determine winner
    if (playerValue > bankerValue) {
      console.log('Player wins!');
    } else if (bankerValue > playerValue) {
      console.log('Banker wins!');
    } else {
      console.log('Tie!');
    }
  }
});
```

**State Format:**
- `playerHand`: Array of 2-3 Card objects
- `bankerHand`: Array of 2-3 Card objects

### Sic Bo

```typescript
import { parseSicBoState } from './utils/gameStateParser';

chainService.onGameMoved((event) => {
  if (event.gameType === GameType.SicBo) {
    const state = parseSicBoState(event.newState);

    console.log('Dice:', state.dice); // [1-6, 1-6, 1-6]

    const total = state.dice[0] + state.dice[1] + state.dice[2];
    const isTriple = state.dice[0] === state.dice[1] && state.dice[1] === state.dice[2];

    console.log('Total:', total);
    console.log('Triple:', isTriple);
  }
});
```

**State Format:**
- `dice`: Tuple of three numbers [1-6, 1-6, 1-6]

### Video Poker

```typescript
import { parseVideoPokerState } from './utils/gameStateParser';

chainService.onGameStarted((event) => {
  if (event.gameType === GameType.VideoPoker) {
    const state = parseVideoPokerState(event.initialState);

    console.log('Initial hand:', state.cards);
    console.log('Stage:', state.stage); // 'DEAL'

    // Display cards with indices for hold selection
    state.cards.forEach((card, i) => {
      console.log(`[${i}] ${card.rank}${card.suit}`);
    });
  }
});

chainService.onGameMoved((event) => {
  if (event.gameType === GameType.VideoPoker) {
    const state = parseVideoPokerState(event.newState);

    if (state.stage === 'DRAW') {
      console.log('Final hand:', state.cards);
      // Evaluate poker hand here
    }
  }
});
```

**State Format:**
- `cards`: Tuple of exactly 5 Card objects
- `stage`: 'DEAL' | 'DRAW'

### Three Card Poker

```typescript
import { parseThreeCardState } from './utils/gameStateParser';

chainService.onGameStarted((event) => {
  if (event.gameType === GameType.ThreeCard) {
    const state = parseThreeCardState(event.initialState);

    console.log('Your hand:', state.playerCards);
    console.log('Dealer hand:', state.dealerCards);
    console.log('Stage:', state.stage); // 'ANTE'
  }
});
```

**State Format:**
- `playerCards`: Tuple of 3 Card objects
- `dealerCards`: Tuple of 3 Card objects
- `stage`: 'ANTE' | 'COMPLETE'

### Ultimate Hold'em

```typescript
import { parseUltimateHoldemState } from './utils/gameStateParser';

chainService.onGameStarted((event) => {
  if (event.gameType === GameType.UltimateHoldem) {
    const state = parseUltimateHoldemState(event.initialState);

    console.log('Hole cards:', state.playerCards);
    console.log('Stage:', state.stage); // 'PREFLOP'
    console.log('Play bet multiplier:', state.playBetMultiplier); // 0 initially
  }
});

chainService.onGameMoved((event) => {
  if (event.gameType === GameType.UltimateHoldem) {
    const state = parseUltimateHoldemState(event.newState);

    if (state.stage === 'FLOP') {
      console.log('Flop:', state.communityCards.slice(0, 3));
    } else if (state.stage === 'RIVER') {
      console.log('Board:', state.communityCards);
    } else if (state.stage === 'SHOWDOWN') {
      console.log('Dealer:', state.dealerCards);
      console.log('Final board:', state.communityCards);
    }
  }
});
```

**State Format:**
- `stage`: 'PREFLOP' | 'FLOP' | 'RIVER' | 'SHOWDOWN'
- `playerCards`: Tuple of 2 Card objects
- `communityCards`: Tuple of 5 Card objects
- `dealerCards`: Tuple of 2 Card objects
- `playBetMultiplier`: 0 (not bet) | 1 | 2 | 4

### Casino War

```typescript
import { parseCasinoWarState } from './utils/gameStateParser';

chainService.onGameStarted((event) => {
  if (event.gameType === GameType.CasinoWar) {
    const state = parseCasinoWarState(event.initialState);

    console.log('Your card:', state.playerCard);
    console.log('Dealer card:', state.dealerCard);
    console.log('Stage:', state.stage); // 'INITIAL'

    // Compare ranks (Ace is high in war)
    const playerRank = getWarRank(state.playerCard);
    const dealerRank = getWarRank(state.dealerCard);

    if (playerRank === dealerRank) {
      console.log('WAR! You can surrender or go to war.');
    }
  }
});

function getWarRank(card: Card): number {
  if (card.rank === 'A') return 14;
  if (card.rank === 'K') return 13;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'J') return 11;
  return parseInt(card.rank);
}
```

**State Format:**
- `playerCard`: Single Card object
- `dealerCard`: Single Card object
- `stage`: 'INITIAL' | 'WAR'

### HiLo

```typescript
import { parseHiLoState, getHiLoRank, hiloAccumulatorToMultiplier } from './utils/gameStateParser';

chainService.onGameStarted((event) => {
  if (event.gameType === GameType.HiLo) {
    const state = parseHiLoState(event.initialState);

    const rank = getHiLoRank(state.currentCard);
    const multiplier = hiloAccumulatorToMultiplier(state.accumulator);

    console.log('Current card:', state.currentCard);
    console.log('Rank:', rank, '(1=Ace, 13=King)');
    console.log('Multiplier:', `${multiplier.toFixed(2)}x`);

    // Calculate potential payout
    const bet = 100; // example
    const currentValue = bet * multiplier;
    console.log('Current value:', currentValue);
  }
});

chainService.onGameMoved((event) => {
  if (event.gameType === GameType.HiLo) {
    const state = parseHiLoState(event.newState);

    const multiplier = hiloAccumulatorToMultiplier(state.accumulator);

    if (state.accumulator === 0) {
      console.log('Lost! Guessed wrong.');
    } else {
      console.log('Correct! New card:', state.currentCard);
      console.log('New multiplier:', `${multiplier.toFixed(2)}x`);
    }
  }
});
```

**State Format:**
- `currentCard`: Single Card object
- `accumulator`: Multiplier in basis points (10000 = 1.0x, 15000 = 1.5x)

## Integration Example

Here's a complete example showing how to use the parser in a React component:

```typescript
import React, { useEffect, useState } from 'react';
import { CasinoChainService } from '../services/CasinoChainService';
import { parseGameState, BlackjackState } from '../utils/gameStateParser';
import { GameType } from '../types/casino';

function BlackjackGame({ chainService }: { chainService: CasinoChainService }) {
  const [gameState, setGameState] = useState<BlackjackState | null>(null);
  const [sessionId, setSessionId] = useState<bigint | null>(null);

  useEffect(() => {
    // Subscribe to game events
    const unsubStarted = chainService.onGameStarted((event) => {
      if (event.gameType === GameType.Blackjack) {
        const parsed = parseGameState(event.gameType, event.initialState);
        if (parsed.type === GameType.Blackjack) {
          setGameState(parsed.state);
          setSessionId(event.sessionId);
        }
      }
    });

    const unsubMoved = chainService.onGameMoved((event) => {
      if (event.sessionId === sessionId) {
        // Parse the new state for this session
        const parsed = parseGameState(GameType.Blackjack, event.newState);
        if (parsed.type === GameType.Blackjack) {
          setGameState(parsed.state);
        }
      }
    });

    return () => {
      unsubStarted();
      unsubMoved();
    };
  }, [chainService, sessionId]);

  if (!gameState) {
    return <div>No active game</div>;
  }

  return (
    <div>
      <h2>Blackjack</h2>
      <div>
        <h3>Your Hand</h3>
        {gameState.playerHand.map((card, i) => (
          <span key={i}>{card.rank}{card.suit} </span>
        ))}
      </div>
      <div>
        <h3>Dealer Hand</h3>
        {gameState.dealerHand.map((card, i) => (
          <span key={i}>{card.rank}{card.suit} </span>
        ))}
      </div>
      <div>Stage: {gameState.stage}</div>
    </div>
  );
}
```

## Card Object Structure

All card-based games use the same `Card` interface:

```typescript
interface Card {
  suit: '♠' | '♥' | '♦' | '♣';  // Spades, Hearts, Diamonds, Clubs
  rank: 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
  value: number;  // Numeric value for display (Ace=11, Face=10, others=rank)
}
```

Card encoding in binary (0-51):
- Suit = `cardByte / 13`: 0=♠, 1=♥, 2=♦, 3=♣
- Rank = `cardByte % 13`: 0=A, 1=2, ..., 12=K

Examples:
- `0` = Ace of Spades (A♠)
- `12` = King of Spades (K♠)
- `13` = Ace of Hearts (A♥)
- `51` = King of Clubs (K♣)

## Utility Functions

The module provides game-specific utility functions:

- `getBlackjackValue(cards: Card[]): number` - Calculate blackjack hand value (handles soft aces)
- `getBaccaratValue(cards: Card[]): number` - Calculate baccarat hand value (mod 10)
- `getHiLoRank(card: Card): number` - Get HiLo rank (1-13, Ace=1)
- `hiloAccumulatorToMultiplier(accumulator: number): number` - Convert basis points to decimal multiplier

## Error Handling

The parser will throw an error if:
1. The state blob is too short for the expected format
2. An unknown game type is provided
3. Card bytes are invalid (>51)

Always wrap parser calls in try-catch blocks in production:

```typescript
try {
  const parsed = parseGameState(gameType, stateBlob);
  // Use parsed state
} catch (error) {
  console.error('Failed to parse game state:', error);
  // Handle error (show error UI, retry, etc.)
}
```
