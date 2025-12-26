/// Maximum name length for player registration
pub const MAX_NAME_LENGTH: usize = 32;

/// Maximum payload length for game moves
pub const MAX_PAYLOAD_LENGTH: usize = 256;

/// Starting chips for new players
pub const STARTING_CHIPS: u64 = 1_000;

/// Starting shields per tournament
pub const STARTING_SHIELDS: u32 = 3;

/// Starting doubles per tournament
pub const STARTING_DOUBLES: u32 = 3;

/// Game session expiry in blocks
pub const SESSION_EXPIRY: u64 = 100;

/// Faucet deposit amount (dev mode only)
pub const FAUCET_AMOUNT: u64 = 1_000;

/// Faucet rate limit in blocks (100 blocks ≈ 5 minutes at 3s/block)
pub const FAUCET_RATE_LIMIT: u64 = 100;

/// Initial chips granted on registration
pub const INITIAL_CHIPS: u64 = 1_000;

/// Daily freeroll entry limits.
pub const FREEROLL_DAILY_LIMIT_FREE: u8 = 1;
pub const FREEROLL_DAILY_LIMIT_MEMBER: u8 = 10;
/// Trial cap for new accounts before the membership perk fully unlocks.
pub const FREEROLL_DAILY_LIMIT_TRIAL: u8 = 3;

/// Minimum cooldown between tournament joins (anti-churn).
pub const TOURNAMENT_JOIN_COOLDOWN_SECS: u64 = 5 * 60;

/// Proof-of-play thresholds for freeroll weighting.
pub const PROOF_OF_PLAY_MIN_SESSIONS: u64 = 10;
pub const PROOF_OF_PLAY_MIN_SECONDS: u64 = 30 * 60;

/// Faucet unlock requirements (reduce churn on new accounts).
pub const FAUCET_MIN_ACCOUNT_AGE_SECS: u64 = 24 * 60 * 60;
pub const FAUCET_MIN_SESSIONS: u64 = 3;

/// Tokenomics Constants
pub const TOTAL_SUPPLY: u64 = 1_000_000_000;
/// Annual emission rate (basis points) used for freeroll credit awards.
/// 3% per year with a 15% total cap.
pub const ANNUAL_EMISSION_RATE_BPS: u64 = 300;
/// Reward pool reserved for tournament credit emissions.
/// Target: distribute 15% of total supply over ~5 years.
pub const REWARD_POOL_BPS: u64 = 1500;
/// Tournaments per day (registration 60s + active 300s = 360s): floor(86400/360) = 240
pub const TOURNAMENTS_PER_DAY: u64 = 240;

/// Freeroll credit vesting and expiry controls.
pub const FREEROLL_CREDIT_IMMEDIATE_BPS: u16 = 2000; // 20% immediate
pub const FREEROLL_CREDIT_VEST_SECS: u64 = 180 * 24 * 60 * 60; // 180 days
pub const FREEROLL_CREDIT_EXPIRY_SECS: u64 = 180 * 24 * 60 * 60; // 180 days

/// Account tier thresholds.
pub const ACCOUNT_TIER_NEW_SECS: u64 = 7 * 24 * 60 * 60;
pub const ACCOUNT_TIER_MATURE_SECS: u64 = 30 * 24 * 60 * 60;
pub const ACCOUNT_TIER2_STAKE_MIN: u64 = 1_000;

// Progressive base jackpots (chip-denominated; meters, if enabled, reset to these values).
pub const THREE_CARD_PROGRESSIVE_BASE_JACKPOT: u64 = 10_000;
pub const UTH_PROGRESSIVE_BASE_JACKPOT: u64 = 10_000;

/// Error codes for CasinoError events
pub const ERROR_PLAYER_ALREADY_REGISTERED: u8 = 1;
pub const ERROR_PLAYER_NOT_FOUND: u8 = 2;
pub const ERROR_INSUFFICIENT_FUNDS: u8 = 3;
pub const ERROR_INVALID_BET: u8 = 4;
pub const ERROR_SESSION_EXISTS: u8 = 5;
pub const ERROR_SESSION_NOT_FOUND: u8 = 6;
pub const ERROR_SESSION_NOT_OWNED: u8 = 7;
pub const ERROR_SESSION_COMPLETE: u8 = 8;
pub const ERROR_INVALID_MOVE: u8 = 9;
pub const ERROR_RATE_LIMITED: u8 = 10;
pub const ERROR_TOURNAMENT_NOT_REGISTERING: u8 = 11;
pub const ERROR_ALREADY_IN_TOURNAMENT: u8 = 12;
pub const ERROR_TOURNAMENT_LIMIT_REACHED: u8 = 13;
/// Error when trying to use tournament-only features (shield/double) outside a tournament
pub const ERROR_NOT_IN_TOURNAMENT: u8 = 14;
/// Error for unauthorized admin instructions.
pub const ERROR_UNAUTHORIZED: u8 = 15;

/// Tournament duration in seconds (5 minutes)
pub const TOURNAMENT_DURATION_SECS: u64 = 5 * 60;

/// Fixed-point scale used for staking reward accounting (`reward_per_voting_power`).
pub const STAKING_REWARD_SCALE: u128 = 1_000_000_000_000_000_000;

/// AMM defaults.
pub const AMM_DEFAULT_FEE_BASIS_POINTS: u16 = 30; // 0.30%
pub const AMM_DEFAULT_SELL_TAX_BASIS_POINTS: u16 = 500; // 5.00%
/// Default bootstrap price used when the AMM has no reserves (1 RNG = 1 vUSDT).
pub const AMM_BOOTSTRAP_PRICE_VUSDT_NUMERATOR: u64 = 1;
pub const AMM_BOOTSTRAP_PRICE_RNG_DENOMINATOR: u64 = 1;
