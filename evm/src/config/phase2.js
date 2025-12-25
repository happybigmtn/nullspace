const RNG_DECIMALS = 18n;
const RNG_UNIT = 10n ** RNG_DECIMALS;
const USDT_DECIMALS = 6n;
const USDT_UNIT = 10n ** USDT_DECIMALS;

const TOTAL_SUPPLY = 1_000_000_000n * RNG_UNIT;

const ALLOCATIONS = {
  auction: 20n,
  liquidity: 10n,
  bonus: 15n,
  player: 35n,
  treasury: 15n,
  team: 5n
};

function allocationAmount(percent) {
  return (TOTAL_SUPPLY * percent) / 100n;
}

const AUCTION_ALLOCATION = allocationAmount(ALLOCATIONS.auction);
const LIQUIDITY_ALLOCATION = allocationAmount(ALLOCATIONS.liquidity);
const BONUS_ALLOCATION = allocationAmount(ALLOCATIONS.bonus);
const PLAYER_ALLOCATION = allocationAmount(ALLOCATIONS.player);
const TREASURY_ALLOCATION = allocationAmount(ALLOCATIONS.treasury);
const TEAM_ALLOCATION = allocationAmount(ALLOCATIONS.team);

const LBP_TOTAL = AUCTION_ALLOCATION + LIQUIDITY_ALLOCATION;
const RECOVERY_POOL_TARGET = 20_000_000n * USDT_UNIT;

function tokenSplitMps() {
  if (LBP_TOTAL === 0n) return 0;
  return Number((AUCTION_ALLOCATION * 10_000_000n) / LBP_TOTAL);
}

module.exports = {
  RNG_DECIMALS,
  RNG_UNIT,
  USDT_DECIMALS,
  USDT_UNIT,
  TOTAL_SUPPLY,
  ALLOCATIONS,
  AUCTION_ALLOCATION,
  LIQUIDITY_ALLOCATION,
  BONUS_ALLOCATION,
  PLAYER_ALLOCATION,
  TREASURY_ALLOCATION,
  TEAM_ALLOCATION,
  LBP_TOTAL,
  RECOVERY_POOL_TARGET,
  allocationAmount,
  tokenSplitMps
};
