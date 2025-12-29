/**
 * Game type definitions
 * MUST match Rust enum in types/src/casino/game.rs
 */
export var GameType;
(function (GameType) {
    GameType[GameType["Baccarat"] = 0] = "Baccarat";
    GameType[GameType["Blackjack"] = 1] = "Blackjack";
    GameType[GameType["CasinoWar"] = 2] = "CasinoWar";
    GameType[GameType["Craps"] = 3] = "Craps";
    GameType[GameType["VideoPoker"] = 4] = "VideoPoker";
    GameType[GameType["HiLo"] = 5] = "HiLo";
    GameType[GameType["Roulette"] = 6] = "Roulette";
    GameType[GameType["SicBo"] = 7] = "SicBo";
    GameType[GameType["ThreeCard"] = 8] = "ThreeCard";
    GameType[GameType["UltimateHoldem"] = 9] = "UltimateHoldem";
})(GameType || (GameType = {}));
//# sourceMappingURL=game.js.map