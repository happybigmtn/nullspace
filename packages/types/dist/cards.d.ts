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
export declare const SUIT_SYMBOLS: {
    readonly hearts: "♥";
    readonly diamonds: "♦";
    readonly clubs: "♣";
    readonly spades: "♠";
};
export declare const SUIT_COLORS: {
    readonly hearts: "red";
    readonly diamonds: "red";
    readonly clubs: "black";
    readonly spades: "black";
};
//# sourceMappingURL=cards.d.ts.map