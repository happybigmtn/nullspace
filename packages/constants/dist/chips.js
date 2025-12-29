/**
 * Chip denominations for UI display (button amounts)
 * These are display-only - actual bet validation happens on-chain
 */
export const CHIP_VALUES = [1, 5, 25, 100, 500, 1000];
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
// Default fallbacks ONLY for initial render before config loads
// These are NOT authoritative - chain values override
export const BET_LIMIT_FALLBACKS = {
    minBet: 1n,
    maxBet: 10000n,
    defaultBet: 10n,
};
//# sourceMappingURL=chips.js.map