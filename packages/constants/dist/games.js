/**
 * Game display constants
 * Pure display mappings - no game logic
 */
import { GameType } from '@nullspace/types';
/**
 * Maps GameType enum to GameId string
 * Uses enum members explicitly per Kieran review - DO NOT use numeric keys
 */
export const GAME_TYPE_TO_ID = {
    [GameType.Baccarat]: 'baccarat',
    [GameType.Blackjack]: 'blackjack',
    [GameType.CasinoWar]: 'casino_war',
    [GameType.Craps]: 'craps',
    [GameType.VideoPoker]: 'video_poker',
    [GameType.HiLo]: 'hi_lo',
    [GameType.Roulette]: 'roulette',
    [GameType.SicBo]: 'sic_bo',
    [GameType.ThreeCard]: 'three_card_poker',
    [GameType.UltimateHoldem]: 'ultimate_texas_holdem',
};
export const GAME_DISPLAY_NAMES = {
    baccarat: 'Baccarat',
    blackjack: 'Blackjack',
    casino_war: 'Casino War',
    craps: 'Craps',
    video_poker: 'Video Poker',
    hi_lo: 'Hi-Lo',
    roulette: 'Roulette',
    sic_bo: 'Sic Bo',
    three_card_poker: 'Three Card Poker',
    ultimate_texas_holdem: "Ultimate Texas Hold'em",
};
export const GAME_EMOJIS = {
    baccarat: '\u{1F451}',
    blackjack: '\u{1F0CF}',
    casino_war: '\u2694\uFE0F',
    craps: '\u{1F3AF}',
    video_poker: '\u{1F3B0}',
    hi_lo: '\u{1F3B2}',
    roulette: '\u{1F3A1}',
    sic_bo: '\u{1F004}',
    three_card_poker: '\u{1F3B4}',
    ultimate_texas_holdem: '\u{1F920}',
};
//# sourceMappingURL=games.js.map