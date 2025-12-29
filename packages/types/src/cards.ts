/**
 * Canonical card representations
 * Decision: Use string literals for JSON compatibility across all platforms
 */

export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  suit: Suit;
  rank: Rank;
  faceUp?: boolean;
}

/** Unicode symbols for display (derived from Suit) */
export const SUIT_SYMBOLS = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
} as const satisfies Record<Suit, string>;

export const SUIT_COLORS = {
  hearts: 'red',
  diamonds: 'red',
  clubs: 'black',
  spades: 'black',
} as const satisfies Record<Suit, 'red' | 'black'>;
