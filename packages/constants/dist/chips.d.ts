/**
 * Chip denominations for UI display (button amounts)
 * These are display-only - actual bet validation happens on-chain
 */
export declare const CHIP_VALUES: readonly [1, 5, 25, 100, 500, 1000];
export type ChipValue = typeof CHIP_VALUES[number];
/**
 * NO MIN_BET / MAX_BET here!
 *
 * Bet limits are chain-enforced rules. Fetch them at runtime:
 * - Website: GET /api/config -> { minBet, maxBet, ... }
 * - Mobile: WebSocket config message from gateway
 * - Gateway: Read from chain config at startup
 *
 * Example usage in frontend:
 *   const { minBet, maxBet } = useCasinoConfig();
 *   <Slider min={minBet} max={maxBet} />
 */
export declare const BET_LIMIT_FALLBACKS: {
    readonly minBet: 1n;
    readonly maxBet: 10000n;
    readonly defaultBet: 10n;
};
//# sourceMappingURL=chips.d.ts.map