/**
 * Color tokens for Nullspace design system
 * Consumed by Tailwind (web) and StyleSheet (mobile)
 *
 * NO platform-specific code - raw values only
 */
/**
 * Titanium color palette - Jony Ive inspired neutral scale
 * Used for backgrounds, text, and UI chrome
 */
export declare const TITANIUM: {
    readonly 50: "#FAFAFA";
    readonly 100: "#F5F5F5";
    readonly 200: "#E5E5E5";
    readonly 300: "#D4D4D4";
    readonly 400: "#A3A3A3";
    readonly 500: "#737373";
    readonly 600: "#525252";
    readonly 700: "#404040";
    readonly 800: "#262626";
    readonly 900: "#171717";
    readonly 950: "#0A0A0A";
};
/**
 * Action colors for interactive elements and states
 * Indigo is the Nullspace brand color
 */
export declare const ACTION: {
    readonly indigo: "#5E5CE6";
    readonly indigoHover: "#4B4ACE";
    readonly indigoMuted: "rgba(94, 92, 230, 0.15)";
    readonly success: "#34C759";
    readonly successMuted: "rgba(52, 199, 89, 0.15)";
    readonly error: "#FF3B30";
    readonly errorMuted: "rgba(255, 59, 48, 0.15)";
    readonly warning: "#FF9500";
};
/**
 * Game-specific color schemes
 * Each game has a primary (background) and accent (highlights) color
 */
export declare const GAME: {
    readonly blackjack: {
        readonly primary: "#1E3A5F";
        readonly accent: "#4A90D9";
    };
    readonly roulette: {
        readonly primary: "#2D5016";
        readonly accent: "#8B0000";
    };
    readonly craps: {
        readonly primary: "#4A2C0A";
        readonly accent: "#D4AF37";
    };
    readonly baccarat: {
        readonly primary: "#2C1810";
        readonly accent: "#C5A572";
    };
    readonly videoPoker: {
        readonly primary: "#1A1A2E";
        readonly accent: "#E94560";
    };
    readonly hiLo: {
        readonly primary: "#16213E";
        readonly accent: "#0F3460";
    };
    readonly sicBo: {
        readonly primary: "#3D0C02";
        readonly accent: "#FF6B35";
    };
    readonly threeCard: {
        readonly primary: "#1B4332";
        readonly accent: "#52B788";
    };
    readonly ultimateHoldem: {
        readonly primary: "#2D3436";
        readonly accent: "#00B894";
    };
    readonly casinoWar: {
        readonly primary: "#2C3E50";
        readonly accent: "#E74C3C";
    };
};
export type TitaniumShade = keyof typeof TITANIUM;
export type TitaniumColor = (typeof TITANIUM)[TitaniumShade];
export type ActionColor = keyof typeof ACTION;
export type ActionColorValue = (typeof ACTION)[ActionColor];
export type GameId = keyof typeof GAME;
export type GameColorScheme = (typeof GAME)[GameId];
//# sourceMappingURL=colors.d.ts.map