use bytes::{Buf, BufMut};
use commonware_codec::{EncodeSize, Error, FixedSize, Read, ReadExt, ReadRangeExt, Write};
use commonware_cryptography::ed25519::PublicKey;

/// Helper to write a string as length-prefixed UTF-8 bytes.
pub fn write_string(s: &str, writer: &mut impl BufMut) {
    let bytes = s.as_bytes();
    (bytes.len() as u32).write(writer);
    writer.put_slice(bytes);
}

/// Helper to read a string from length-prefixed UTF-8 bytes.
pub fn read_string(reader: &mut impl Buf, max_len: usize) -> Result<String, Error> {
    let len = u32::read(reader)? as usize;
    if len > max_len {
        return Err(Error::Invalid("String", "too long"));
    }
    if reader.remaining() < len {
        return Err(Error::EndOfBuffer);
    }
    let mut bytes = vec![0u8; len];
    reader.copy_to_slice(&mut bytes);
    String::from_utf8(bytes).map_err(|_| Error::Invalid("String", "invalid UTF-8"))
}

/// Helper to get encode size of a string.
pub fn string_encode_size(s: &str) -> usize {
    4 + s.len()
}

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

/// Tokenomics Constants
pub const TOTAL_SUPPLY: u64 = 1_000_000_000;
pub const ANNUAL_EMISSION_RATE_BPS: u64 = 1000; // 10%
/// Reward pool reserved for tournament emissions (50% of total supply over 5 years)
pub const REWARD_POOL_BPS: u64 = 5000;
/// Games per day given a new game every 5m15s (315s): floor(86400/315) = 274
pub const TOURNAMENTS_PER_DAY: u64 = 274;

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

/// Casino game types matching frontend GameType enum
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum GameType {
    Baccarat = 0,
    Blackjack = 1,
    CasinoWar = 2,
    Craps = 3,
    VideoPoker = 4,
    HiLo = 5,
    Roulette = 6,
    SicBo = 7,
    ThreeCard = 8,
    UltimateHoldem = 9,
}

impl Write for GameType {
    fn write(&self, writer: &mut impl BufMut) {
        (*self as u8).write(writer);
    }
}

impl Read for GameType {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let value = u8::read(reader)?;
        match value {
            0 => Ok(Self::Baccarat),
            1 => Ok(Self::Blackjack),
            2 => Ok(Self::CasinoWar),
            3 => Ok(Self::Craps),
            4 => Ok(Self::VideoPoker),
            5 => Ok(Self::HiLo),
            6 => Ok(Self::Roulette),
            7 => Ok(Self::SicBo),
            8 => Ok(Self::ThreeCard),
            9 => Ok(Self::UltimateHoldem),
            i => Err(Error::InvalidEnum(i)),
        }
    }
}

impl FixedSize for GameType {
    const SIZE: usize = 1;
}

/// Super mode multiplier type
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum SuperType {
    Card = 0,   // Specific card (rank+suit)
    Number = 1, // Roulette/Craps number
    Total = 2,  // Sic Bo sum
    Rank = 3,   // Card rank only
    Suit = 4,   // Card suit only
}

impl Write for SuperType {
    fn write(&self, writer: &mut impl BufMut) {
        (*self as u8).write(writer);
    }
}

impl Read for SuperType {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let value = u8::read(reader)?;
        match value {
            0 => Ok(Self::Card),
            1 => Ok(Self::Number),
            2 => Ok(Self::Total),
            3 => Ok(Self::Rank),
            4 => Ok(Self::Suit),
            i => Err(Error::InvalidEnum(i)),
        }
    }
}

impl FixedSize for SuperType {
    const SIZE: usize = 1;
}

/// Super mode multiplier entry
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SuperMultiplier {
    pub id: u8,          // Card (0-51), number (0-36), or total (4-17)
    pub multiplier: u16, // 2-500x
    pub super_type: SuperType,
}

impl Write for SuperMultiplier {
    fn write(&self, writer: &mut impl BufMut) {
        self.id.write(writer);
        self.multiplier.write(writer);
        self.super_type.write(writer);
    }
}

impl Read for SuperMultiplier {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            id: u8::read(reader)?,
            multiplier: u16::read(reader)?,
            super_type: SuperType::read(reader)?,
        })
    }
}

impl EncodeSize for SuperMultiplier {
    fn encode_size(&self) -> usize {
        self.id.encode_size() + self.multiplier.encode_size() + self.super_type.encode_size()
    }
}

/// Super mode state
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SuperModeState {
    pub is_active: bool,
    pub multipliers: Vec<SuperMultiplier>,
    pub streak_level: u8, // For HiLo only
}

impl Write for SuperModeState {
    fn write(&self, writer: &mut impl BufMut) {
        self.is_active.write(writer);
        self.multipliers.write(writer);
        self.streak_level.write(writer);
    }
}

impl Read for SuperModeState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            is_active: bool::read(reader)?,
            multipliers: Vec::<SuperMultiplier>::read_range(reader, 0..=10)?,
            streak_level: u8::read(reader)?,
        })
    }
}

impl EncodeSize for SuperModeState {
    fn encode_size(&self) -> usize {
        self.is_active.encode_size()
            + self.multipliers.encode_size()
            + self.streak_level.encode_size()
    }
}

/// Player state for casino games
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Player {
    pub nonce: u64,
    pub name: String,
    pub chips: u64,
    pub vusdt_balance: u64, // Virtual USDT balance
    pub shields: u32,
    pub doubles: u32,
    pub tournament_chips: u64,
    pub tournament_shields: u32,
    pub tournament_doubles: u32,
    pub active_tournament: Option<u64>,
    pub rank: u32,
    pub active_shield: bool,
    pub active_double: bool,
    pub active_session: Option<u64>,
    pub last_deposit_block: u64,
    /// Aura Meter for Super Mode (0-5 segments).
    /// Increments on near-misses, triggers Super Aura Round at 5.
    pub aura_meter: u8,
    // Tournament tracking
    pub tournaments_played_today: u8,
    pub last_tournament_ts: u64,
    pub is_kyc_verified: bool,
}

impl Player {
    pub fn new(name: String) -> Self {
        Self {
            nonce: 0,
            name,
            chips: INITIAL_CHIPS,
            vusdt_balance: 0,
            shields: STARTING_SHIELDS,
            doubles: STARTING_DOUBLES,
            tournament_chips: 0,
            tournament_shields: 0,
            tournament_doubles: 0,
            active_tournament: None,
            rank: 0,
            active_shield: false,
            active_double: false,
            active_session: None,
            // Allow an immediate first faucet deposit
            last_deposit_block: 0,
            aura_meter: 0,
            tournaments_played_today: 0,
            last_tournament_ts: 0,
            is_kyc_verified: false,
        }
    }

    pub fn new_with_block(name: String, block: u64) -> Self {
        Self {
            nonce: 0,
            name,
            chips: INITIAL_CHIPS,
            vusdt_balance: 0,
            shields: STARTING_SHIELDS,
            doubles: STARTING_DOUBLES,
            tournament_chips: 0,
            tournament_shields: 0,
            tournament_doubles: 0,
            active_tournament: None,
            rank: 0,
            active_shield: false,
            active_double: false,
            active_session: None,
            // Seed as if last faucet was sufficiently far in the past so the first deposit is allowed
            last_deposit_block: block.saturating_sub(FAUCET_RATE_LIMIT + 1),
            aura_meter: 0,
            tournaments_played_today: 0,
            last_tournament_ts: 0,
            is_kyc_verified: false,
        }
    }
}

impl Write for Player {
    fn write(&self, writer: &mut impl BufMut) {
        self.nonce.write(writer);
        write_string(&self.name, writer);
        self.chips.write(writer);
        self.vusdt_balance.write(writer);
        self.shields.write(writer);
        self.doubles.write(writer);
        self.tournament_chips.write(writer);
        self.tournament_shields.write(writer);
        self.tournament_doubles.write(writer);
        self.active_tournament.write(writer);
        self.rank.write(writer);
        self.active_shield.write(writer);
        self.active_double.write(writer);
        self.active_session.write(writer);
        self.last_deposit_block.write(writer);
        self.aura_meter.write(writer);
        self.tournaments_played_today.write(writer);
        self.last_tournament_ts.write(writer);
        self.is_kyc_verified.write(writer);
    }
}

impl Read for Player {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            nonce: u64::read(reader)?,
            name: read_string(reader, MAX_NAME_LENGTH)?,
            chips: u64::read(reader)?,
            vusdt_balance: u64::read(reader)?,
            shields: u32::read(reader)?,
            doubles: u32::read(reader)?,
            tournament_chips: u64::read(reader)?,
            tournament_shields: u32::read(reader)?,
            tournament_doubles: u32::read(reader)?,
            active_tournament: Option::<u64>::read(reader)?,
            rank: u32::read(reader)?,
            active_shield: bool::read(reader)?,
            active_double: bool::read(reader)?,
            active_session: Option::<u64>::read(reader)?,
            last_deposit_block: u64::read(reader)?,
            aura_meter: u8::read(reader)?,
            tournaments_played_today: u8::read(reader)?,
            last_tournament_ts: u64::read(reader)?,
            is_kyc_verified: bool::read(reader)?,
        })
    }
}

impl EncodeSize for Player {
    fn encode_size(&self) -> usize {
        self.nonce.encode_size()
            + string_encode_size(&self.name)
            + self.chips.encode_size()
            + self.vusdt_balance.encode_size()
            + self.shields.encode_size()
            + self.doubles.encode_size()
            + self.tournament_chips.encode_size()
            + self.tournament_shields.encode_size()
            + self.tournament_doubles.encode_size()
            + self.active_tournament.encode_size()
            + self.rank.encode_size()
            + self.active_shield.encode_size()
            + self.active_double.encode_size()
            + self.active_session.encode_size()
            + self.last_deposit_block.encode_size()
            + self.aura_meter.encode_size()
            + self.tournaments_played_today.encode_size()
            + self.last_tournament_ts.encode_size()
            + self.is_kyc_verified.encode_size()
    }
}

/// Game session state
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameSession {
    pub id: u64,
    pub player: PublicKey,
    pub game_type: GameType,
    pub bet: u64,
    pub state_blob: Vec<u8>,
    pub move_count: u32,
    pub created_at: u64,
    pub is_complete: bool,
    pub super_mode: SuperModeState,
    pub is_tournament: bool,
    pub tournament_id: Option<u64>,
}

impl Write for GameSession {
    fn write(&self, writer: &mut impl BufMut) {
        self.id.write(writer);
        self.player.write(writer);
        self.game_type.write(writer);
        self.bet.write(writer);
        self.state_blob.write(writer);
        self.move_count.write(writer);
        self.created_at.write(writer);
        self.is_complete.write(writer);
        self.super_mode.write(writer);
        self.is_tournament.write(writer);
        self.tournament_id.write(writer);
    }
}

impl Read for GameSession {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            id: u64::read(reader)?,
            player: PublicKey::read(reader)?,
            game_type: GameType::read(reader)?,
            bet: u64::read(reader)?,
            state_blob: Vec::<u8>::read_range(reader, 0..=1024)?,
            move_count: u32::read(reader)?,
            created_at: u64::read(reader)?,
            is_complete: bool::read(reader)?,
            super_mode: SuperModeState::read(reader)?,
            is_tournament: bool::read(reader)?,
            tournament_id: Option::<u64>::read(reader)?,
        })
    }
}

impl EncodeSize for GameSession {
    fn encode_size(&self) -> usize {
        self.id.encode_size()
            + self.player.encode_size()
            + self.game_type.encode_size()
            + self.bet.encode_size()
            + self.state_blob.encode_size()
            + self.move_count.encode_size()
            + self.created_at.encode_size()
            + self.is_complete.encode_size()
            + self.super_mode.encode_size()
            + self.is_tournament.encode_size()
            + self.tournament_id.encode_size()
    }
}

/// Casino leaderboard entry
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LeaderboardEntry {
    pub player: PublicKey,
    pub name: String,
    pub chips: u64,
    pub rank: u32,
}

impl Write for LeaderboardEntry {
    fn write(&self, writer: &mut impl BufMut) {
        self.player.write(writer);
        write_string(&self.name, writer);
        self.chips.write(writer);
        self.rank.write(writer);
    }
}

impl Read for LeaderboardEntry {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            player: PublicKey::read(reader)?,
            name: read_string(reader, MAX_NAME_LENGTH)?,
            chips: u64::read(reader)?,
            rank: u32::read(reader)?,
        })
    }
}

impl EncodeSize for LeaderboardEntry {
    fn encode_size(&self) -> usize {
        self.player.encode_size()
            + string_encode_size(&self.name)
            + self.chips.encode_size()
            + self.rank.encode_size()
    }
}

/// Casino leaderboard
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct CasinoLeaderboard {
    pub entries: Vec<LeaderboardEntry>,
}

impl CasinoLeaderboard {
    pub fn update(&mut self, player: PublicKey, name: String, chips: u64) {
        // Find and remove existing entry for this player
        let mut existing_idx = None;
        for (i, e) in self.entries.iter().enumerate() {
            if e.player == player {
                existing_idx = Some(i);
                break;
            }
        }
        if let Some(idx) = existing_idx {
            self.entries.remove(idx);
        }

        // Early exit: if we have 10 entries and new chips is <= lowest, skip
        if self.entries.len() >= 10 {
            if let Some(last) = self.entries.last() {
                if chips <= last.chips {
                    return;
                }
            }
        }

        // Find insertion point using binary search (entries sorted descending by chips)
        // FIXED: Use chips.cmp(&e.chips) for descending order (higher chips first)
        // This reverses the comparison so higher values come before lower values
        let insert_pos = self
            .entries
            .binary_search_by(|e| chips.cmp(&e.chips))
            .unwrap_or_else(|pos| pos);

        // Insert at correct position
        self.entries.insert(
            insert_pos,
            LeaderboardEntry {
                player,
                name,
                chips,
                rank: 0,
            },
        );

        // Truncate to 10 and update ranks only for affected entries
        self.entries.truncate(10);
        for (i, entry) in self.entries.iter_mut().enumerate() {
            entry.rank = (i + 1) as u32;
        }
    }
}

impl Write for CasinoLeaderboard {
    fn write(&self, writer: &mut impl BufMut) {
        self.entries.write(writer);
    }
}

impl Read for CasinoLeaderboard {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            // Read up to 10 entries (matches truncate(10) in update())
            // FIXED: Use inclusive range 0..=10 to allow exactly 10 entries
            entries: Vec::<LeaderboardEntry>::read_range(reader, 0..=10)?,
        })
    }
}

impl EncodeSize for CasinoLeaderboard {
    fn encode_size(&self) -> usize {
        self.entries.encode_size()
    }
}

/// Tournament phases
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum TournamentPhase {
    #[default]
    Registration = 0, // 1 minute (~20 blocks at 3s/block)
    Active = 1, // 5 minutes (~100 blocks)
    Complete = 2,
}

impl Write for TournamentPhase {
    fn write(&self, writer: &mut impl BufMut) {
        (*self as u8).write(writer);
    }
}

impl Read for TournamentPhase {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        match u8::read(reader)? {
            0 => Ok(Self::Registration),
            1 => Ok(Self::Active),
            2 => Ok(Self::Complete),
            i => Err(Error::InvalidEnum(i)),
        }
    }
}

impl FixedSize for TournamentPhase {
    const SIZE: usize = 1;
}

/// Tournament duration in seconds (5 minutes)
pub const TOURNAMENT_DURATION_SECS: u64 = 5 * 60;

/// Tournament state
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Tournament {
    pub id: u64,
    pub phase: TournamentPhase,
    pub start_block: u64,
    /// Unix timestamp (milliseconds) when the tournament started
    pub start_time_ms: u64,
    /// Unix timestamp (milliseconds) when the tournament ends
    pub end_time_ms: u64,
    pub players: Vec<PublicKey>,
    pub prize_pool: u64,
    pub starting_chips: u64,   // 1000
    pub starting_shields: u32, // 3
    pub starting_doubles: u32, // 3
    pub leaderboard: CasinoLeaderboard,
}

impl Write for Tournament {
    fn write(&self, writer: &mut impl BufMut) {
        self.id.write(writer);
        self.phase.write(writer);
        self.start_block.write(writer);
        self.start_time_ms.write(writer);
        self.end_time_ms.write(writer);
        self.players.write(writer);
        self.prize_pool.write(writer);
        self.starting_chips.write(writer);
        self.starting_shields.write(writer);
        self.starting_doubles.write(writer);
        self.leaderboard.write(writer);
    }
}

impl Read for Tournament {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            id: u64::read(reader)?,
            phase: TournamentPhase::read(reader)?,
            start_block: u64::read(reader)?,
            start_time_ms: u64::read(reader)?,
            end_time_ms: u64::read(reader)?,
            players: Vec::<PublicKey>::read_range(reader, 0..=1000)?,
            prize_pool: u64::read(reader)?,
            starting_chips: u64::read(reader)?,
            starting_shields: u32::read(reader)?,
            starting_doubles: u32::read(reader)?,
            leaderboard: CasinoLeaderboard::read(reader)?,
        })
    }
}

impl EncodeSize for Tournament {
    fn encode_size(&self) -> usize {
        self.id.encode_size()
            + self.phase.encode_size()
            + self.start_block.encode_size()
            + self.start_time_ms.encode_size()
            + self.end_time_ms.encode_size()
            + self.players.encode_size()
            + self.prize_pool.encode_size()
            + self.starting_chips.encode_size()
            + self.starting_shields.encode_size()
            + self.starting_doubles.encode_size()
            + self.leaderboard.encode_size()
    }
}

impl Tournament {
    /// Check if a player is already in the tournament.
    /// Currently O(n), prepared for future HashSet optimization.
    pub fn contains_player(&self, player: &PublicKey) -> bool {
        self.players.contains(player)
    }

    /// Add a player to the tournament.
    /// Returns true if the player was added, false if they were already present.
    pub fn add_player(&mut self, player: PublicKey) -> bool {
        if self.contains_player(&player) {
            return false;
        }
        self.players.push(player);
        true
    }
}

/// House state for the "Central Bank" model
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HouseState {
    pub current_epoch: u64,
    pub epoch_start_ts: u64,
    pub net_pnl: i128, // Net Profit/Loss for current epoch (House Edge - Player Wins)
    pub total_staked_amount: u64,
    pub total_voting_power: u128,
    pub accumulated_fees: u64, // Fees from AMM or other sources
    pub total_burned: u64,     // Total RNG burned via Sell Tax
    pub total_issuance: u64,   // Total RNG minted (Inflation)
}

impl HouseState {
    pub fn new(start_ts: u64) -> Self {
        Self {
            current_epoch: 0,
            epoch_start_ts: start_ts,
            net_pnl: 0,
            total_staked_amount: 0,
            total_voting_power: 0,
            accumulated_fees: 0,
            total_burned: 0,
            total_issuance: 0,
        }
    }
}

impl Write for HouseState {
    fn write(&self, writer: &mut impl BufMut) {
        self.current_epoch.write(writer);
        self.epoch_start_ts.write(writer);
        self.net_pnl.write(writer);
        self.total_staked_amount.write(writer);
        self.total_voting_power.write(writer);
        self.accumulated_fees.write(writer);
        self.total_burned.write(writer);
        self.total_issuance.write(writer);
    }
}

impl Read for HouseState {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            current_epoch: u64::read(reader)?,
            epoch_start_ts: u64::read(reader)?,
            net_pnl: i128::read(reader)?,
            total_staked_amount: u64::read(reader)?,
            total_voting_power: u128::read(reader)?,
            accumulated_fees: u64::read(reader)?,
            total_burned: u64::read(reader)?,
            total_issuance: u64::read(reader)?,
        })
    }
}

impl EncodeSize for HouseState {
    fn encode_size(&self) -> usize {
        self.current_epoch.encode_size()
            + self.epoch_start_ts.encode_size()
            + self.net_pnl.encode_size()
            + self.total_staked_amount.encode_size()
            + self.total_voting_power.encode_size()
            + self.accumulated_fees.encode_size()
            + self.total_burned.encode_size()
            + self.total_issuance.encode_size()
    }
}

/// Staker state
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Staker {
    pub balance: u64,
    pub unlock_ts: u64,
    pub last_claim_epoch: u64,
    pub voting_power: u128,
}

impl Write for Staker {
    fn write(&self, writer: &mut impl BufMut) {
        self.balance.write(writer);
        self.unlock_ts.write(writer);
        self.last_claim_epoch.write(writer);
        self.voting_power.write(writer);
    }
}

impl Read for Staker {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            balance: u64::read(reader)?,
            unlock_ts: u64::read(reader)?,
            last_claim_epoch: u64::read(reader)?,
            voting_power: u128::read(reader)?,
        })
    }
}

impl EncodeSize for Staker {
    fn encode_size(&self) -> usize {
        self.balance.encode_size()
            + self.unlock_ts.encode_size()
            + self.last_claim_epoch.encode_size()
            + self.voting_power.encode_size()
    }
}

/// Vault state for CDP (Collateralized Debt Position)
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Vault {
    pub collateral_rng: u64,
    pub debt_vusdt: u64,
}

impl Write for Vault {
    fn write(&self, writer: &mut impl BufMut) {
        self.collateral_rng.write(writer);
        self.debt_vusdt.write(writer);
    }
}

impl Read for Vault {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            collateral_rng: u64::read(reader)?,
            debt_vusdt: u64::read(reader)?,
        })
    }
}

impl EncodeSize for Vault {
    fn encode_size(&self) -> usize {
        self.collateral_rng.encode_size() + self.debt_vusdt.encode_size()
    }
}

/// AMM Pool state (Constant Product Market Maker)
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct AmmPool {
    pub reserve_rng: u64,
    pub reserve_vusdt: u64,
    pub total_shares: u64,
    pub fee_basis_points: u16,      // e.g., 30 = 0.3%
    pub sell_tax_basis_points: u16, // e.g., 500 = 5%
}

impl AmmPool {
    pub fn new(fee_bps: u16) -> Self {
        Self {
            reserve_rng: 0,
            reserve_vusdt: 0,
            total_shares: 0,
            fee_basis_points: fee_bps,
            sell_tax_basis_points: 500, // 5% default
        }
    }
}

impl Write for AmmPool {
    fn write(&self, writer: &mut impl BufMut) {
        self.reserve_rng.write(writer);
        self.reserve_vusdt.write(writer);
        self.total_shares.write(writer);
        self.fee_basis_points.write(writer);
        self.sell_tax_basis_points.write(writer);
    }
}

impl Read for AmmPool {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            reserve_rng: u64::read(reader)?,
            reserve_vusdt: u64::read(reader)?,
            total_shares: u64::read(reader)?,
            fee_basis_points: u16::read(reader)?,
            sell_tax_basis_points: u16::read(reader)?,
        })
    }
}

impl EncodeSize for AmmPool {
    fn encode_size(&self) -> usize {
        self.reserve_rng.encode_size()
            + self.reserve_vusdt.encode_size()
            + self.total_shares.encode_size()
            + self.fee_basis_points.encode_size()
            + self.sell_tax_basis_points.encode_size()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use commonware_codec::Encode;
    use commonware_cryptography::{ed25519::PrivateKey, PrivateKeyExt, Signer};
    use rand::{rngs::StdRng, SeedableRng};

    #[test]
    fn test_game_type_roundtrip() {
        for game_type in [
            GameType::Baccarat,
            GameType::Blackjack,
            GameType::CasinoWar,
            GameType::Craps,
            GameType::VideoPoker,
            GameType::HiLo,
            GameType::Roulette,
            GameType::SicBo,
            GameType::ThreeCard,
            GameType::UltimateHoldem,
        ] {
            let encoded = game_type.encode();
            let decoded = GameType::read(&mut &encoded[..]).unwrap();
            assert_eq!(game_type, decoded);
        }
    }

    #[test]
    fn test_player_roundtrip() {
        let player = Player::new("TestPlayer".to_string());
        let encoded = player.encode();
        let decoded = Player::read(&mut &encoded[..]).unwrap();
        assert_eq!(player, decoded);
    }

    #[test]
    fn test_leaderboard_update() {
        let mut rng = StdRng::seed_from_u64(42);
        let mut leaderboard = CasinoLeaderboard::default();

        // Add some players
        for i in 0..15 {
            let pk = PrivateKey::from_rng(&mut rng).public_key();
            leaderboard.update(pk, format!("Player{}", i), (i as u64 + 1) * 1000);
        }

        // Should only keep top 10
        assert_eq!(leaderboard.entries.len(), 10);

        // Should be sorted by chips descending
        for i in 0..9 {
            assert!(leaderboard.entries[i].chips >= leaderboard.entries[i + 1].chips);
        }

        // Ranks should be 1-10
        for (i, entry) in leaderboard.entries.iter().enumerate() {
            assert_eq!(entry.rank, (i + 1) as u32);
        }
    }
}
