use bytes::{Buf, BufMut};
use commonware_codec::{EncodeSize, Error, FixedSize, Read, ReadExt, ReadRangeExt, Write};
use commonware_cryptography::ed25519::PublicKey;

/// Helper to write a string as length-prefixed UTF-8 bytes.
fn write_string(s: &str, writer: &mut impl BufMut) {
    let bytes = s.as_bytes();
    (bytes.len() as u32).write(writer);
    writer.put_slice(bytes);
}

/// Helper to read a string from length-prefixed UTF-8 bytes.
fn read_string(reader: &mut impl Buf, max_len: usize) -> Result<String, Error> {
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
fn string_encode_size(s: &str) -> usize {
    4 + s.len()
}

/// Maximum name length for player registration
pub const MAX_NAME_LENGTH: usize = 32;

/// Maximum payload length for game moves
pub const MAX_PAYLOAD_LENGTH: usize = 256;

/// Starting chips for new players
pub const STARTING_CHIPS: u64 = 10_000;

/// Starting shields per tournament
pub const STARTING_SHIELDS: u32 = 3;

/// Starting doubles per tournament
pub const STARTING_DOUBLES: u32 = 3;

/// Game session expiry in blocks
pub const SESSION_EXPIRY: u64 = 100;

/// Faucet deposit amount (dev mode only)
pub const FAUCET_AMOUNT: u64 = 10_000;

/// Faucet rate limit in blocks (100 blocks ≈ 5 minutes at 3s/block)
pub const FAUCET_RATE_LIMIT: u64 = 100;

/// Initial chips granted on registration
pub const INITIAL_CHIPS: u64 = 1_000;

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
    Card = 0,    // Specific card (rank+suit)
    Number = 1,  // Roulette/Craps number
    Total = 2,   // Sic Bo sum
    Rank = 3,    // Card rank only
    Suit = 4,    // Card suit only
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
    pub id: u8,            // Card (0-51), number (0-36), or total (4-17)
    pub multiplier: u16,   // 2-500x
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
    pub streak_level: u8,  // For HiLo only
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
        self.is_active.encode_size() + self.multipliers.encode_size() + self.streak_level.encode_size()
    }
}

/// Player state for casino games
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Player {
    pub nonce: u64,
    pub name: String,
    pub chips: u64,
    pub shields: u32,
    pub doubles: u32,
    pub rank: u32,
    pub active_shield: bool,
    pub active_double: bool,
    pub active_session: Option<u64>,
    pub last_deposit_block: u64,
}

impl Player {
    pub fn new(name: String) -> Self {
        Self {
            nonce: 0,
            name,
            chips: INITIAL_CHIPS,
            shields: STARTING_SHIELDS,
            doubles: STARTING_DOUBLES,
            rank: 0,
            active_shield: false,
            active_double: false,
            active_session: None,
            last_deposit_block: 0,
        }
    }

    pub fn new_with_block(name: String, block: u64) -> Self {
        Self {
            nonce: 0,
            name,
            chips: INITIAL_CHIPS,
            shields: STARTING_SHIELDS,
            doubles: STARTING_DOUBLES,
            rank: 0,
            active_shield: false,
            active_double: false,
            active_session: None,
            last_deposit_block: block,
        }
    }
}

impl Write for Player {
    fn write(&self, writer: &mut impl BufMut) {
        self.nonce.write(writer);
        write_string(&self.name, writer);
        self.chips.write(writer);
        self.shields.write(writer);
        self.doubles.write(writer);
        self.rank.write(writer);
        self.active_shield.write(writer);
        self.active_double.write(writer);
        self.active_session.write(writer);
        self.last_deposit_block.write(writer);
    }
}

impl Read for Player {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            nonce: u64::read(reader)?,
            name: read_string(reader, MAX_NAME_LENGTH)?,
            chips: u64::read(reader)?,
            shields: u32::read(reader)?,
            doubles: u32::read(reader)?,
            rank: u32::read(reader)?,
            active_shield: bool::read(reader)?,
            active_double: bool::read(reader)?,
            active_session: Option::<u64>::read(reader)?,
            last_deposit_block: u64::read(reader)?,
        })
    }
}

impl EncodeSize for Player {
    fn encode_size(&self) -> usize {
        self.nonce.encode_size()
            + string_encode_size(&self.name)
            + self.chips.encode_size()
            + self.shields.encode_size()
            + self.doubles.encode_size()
            + self.rank.encode_size()
            + self.active_shield.encode_size()
            + self.active_double.encode_size()
            + self.active_session.encode_size()
            + self.last_deposit_block.encode_size()
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
    }
}

/// Casino-specific instructions
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CasinoInstruction {
    /// Register a new player with a name
    /// Binary: [0] [nameLen:u32 BE] [nameBytes...]
    Register { name: String },

    /// Deposit chips (for testing/faucet)
    /// Binary: [1] [amount:u64 BE]
    Deposit { amount: u64 },

    /// Start a new game session
    /// Binary: [2] [gameType:u8] [bet:u64 BE] [sessionId:u64 BE]
    StartGame {
        game_type: GameType,
        bet: u64,
        session_id: u64,
    },

    /// Make a move in an active game
    /// Binary: [3] [sessionId:u64 BE] [payloadLen:u32 BE] [payload...]
    GameMove {
        session_id: u64,
        payload: Vec<u8>,
    },

    /// Toggle shield modifier
    /// Binary: [4]
    ToggleShield,

    /// Toggle double modifier
    /// Binary: [5]
    ToggleDouble,
}

impl Write for CasinoInstruction {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            Self::Register { name } => {
                0u8.write(writer);
                // Write name length as u32 BE, then name bytes
                (name.len() as u32).write(writer);
                writer.put_slice(name.as_bytes());
            }
            Self::Deposit { amount } => {
                1u8.write(writer);
                amount.write(writer);
            }
            Self::StartGame { game_type, bet, session_id } => {
                2u8.write(writer);
                game_type.write(writer);
                bet.write(writer);
                session_id.write(writer);
            }
            Self::GameMove { session_id, payload } => {
                3u8.write(writer);
                session_id.write(writer);
                (payload.len() as u32).write(writer);
                writer.put_slice(payload);
            }
            Self::ToggleShield => {
                4u8.write(writer);
            }
            Self::ToggleDouble => {
                5u8.write(writer);
            }
        }
    }
}

impl Read for CasinoInstruction {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let tag = u8::read(reader)?;
        match tag {
            0 => {
                let name_len = u32::read(reader)? as usize;
                if name_len > MAX_NAME_LENGTH {
                    return Err(Error::Invalid("CasinoInstruction", "name too long"));
                }
                let mut name_bytes = vec![0u8; name_len];
                reader.copy_to_slice(&mut name_bytes);
                let name = String::from_utf8(name_bytes)
                    .map_err(|_| Error::Invalid("CasinoInstruction", "invalid UTF-8 name"))?;
                Ok(Self::Register { name })
            }
            1 => {
                let amount = u64::read(reader)?;
                Ok(Self::Deposit { amount })
            }
            2 => {
                let game_type = GameType::read(reader)?;
                let bet = u64::read(reader)?;
                let session_id = u64::read(reader)?;
                Ok(Self::StartGame { game_type, bet, session_id })
            }
            3 => {
                let session_id = u64::read(reader)?;
                let payload_len = u32::read(reader)? as usize;
                if payload_len > MAX_PAYLOAD_LENGTH {
                    return Err(Error::Invalid("CasinoInstruction", "payload too long"));
                }
                let mut payload = vec![0u8; payload_len];
                reader.copy_to_slice(&mut payload);
                Ok(Self::GameMove { session_id, payload })
            }
            4 => Ok(Self::ToggleShield),
            5 => Ok(Self::ToggleDouble),
            i => Err(Error::InvalidEnum(i)),
        }
    }
}

impl EncodeSize for CasinoInstruction {
    fn encode_size(&self) -> usize {
        1 + match self {
            Self::Register { name } => 4 + name.len(),
            Self::Deposit { .. } => 8,
            Self::StartGame { .. } => 1 + 8 + 8,
            Self::GameMove { payload, .. } => 8 + 4 + payload.len(),
            Self::ToggleShield => 0,
            Self::ToggleDouble => 0,
        }
    }
}

/// Casino state keys
#[derive(Hash, Eq, PartialEq, Ord, PartialOrd, Clone, Debug)]
pub enum CasinoKey {
    Player(PublicKey),
    Session(u64),
    Leaderboard,
}

impl Write for CasinoKey {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            Self::Player(pk) => {
                0u8.write(writer);
                pk.write(writer);
            }
            Self::Session(id) => {
                1u8.write(writer);
                id.write(writer);
            }
            Self::Leaderboard => {
                2u8.write(writer);
            }
        }
    }
}

impl Read for CasinoKey {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let tag = u8::read(reader)?;
        match tag {
            0 => Ok(Self::Player(PublicKey::read(reader)?)),
            1 => Ok(Self::Session(u64::read(reader)?)),
            2 => Ok(Self::Leaderboard),
            i => Err(Error::InvalidEnum(i)),
        }
    }
}

impl EncodeSize for CasinoKey {
    fn encode_size(&self) -> usize {
        1 + match self {
            Self::Player(_) => PublicKey::SIZE,
            Self::Session(_) => 8,
            Self::Leaderboard => 0,
        }
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
        // Remove existing entry for this player
        self.entries.retain(|e| e.player != player);

        // Add new entry
        self.entries.push(LeaderboardEntry {
            player,
            name,
            chips,
            rank: 0,
        });

        // Sort by chips descending
        self.entries.sort_by(|a, b| b.chips.cmp(&a.chips));

        // Keep top 10 and update ranks
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
            entries: Vec::<LeaderboardEntry>::read_range(reader, 0..=10)?,
        })
    }
}

impl EncodeSize for CasinoLeaderboard {
    fn encode_size(&self) -> usize {
        self.entries.encode_size()
    }
}

/// Casino state values
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CasinoValue {
    Player(Player),
    Session(GameSession),
    Leaderboard(CasinoLeaderboard),
}

impl Write for CasinoValue {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            Self::Player(p) => {
                0u8.write(writer);
                p.write(writer);
            }
            Self::Session(s) => {
                1u8.write(writer);
                s.write(writer);
            }
            Self::Leaderboard(l) => {
                2u8.write(writer);
                l.write(writer);
            }
        }
    }
}

impl Read for CasinoValue {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let tag = u8::read(reader)?;
        match tag {
            0 => Ok(Self::Player(Player::read(reader)?)),
            1 => Ok(Self::Session(GameSession::read(reader)?)),
            2 => Ok(Self::Leaderboard(CasinoLeaderboard::read(reader)?)),
            i => Err(Error::InvalidEnum(i)),
        }
    }
}

impl EncodeSize for CasinoValue {
    fn encode_size(&self) -> usize {
        1 + match self {
            Self::Player(p) => p.encode_size(),
            Self::Session(s) => s.encode_size(),
            Self::Leaderboard(l) => l.encode_size(),
        }
    }
}

/// Tournament phases
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum TournamentPhase {
    #[default]
    Registration = 0,  // 1 minute (~20 blocks at 3s/block)
    Active = 1,        // 5 minutes (~100 blocks)
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

/// Tournament state
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Tournament {
    pub id: u64,
    pub phase: TournamentPhase,
    pub start_block: u64,
    pub players: Vec<PublicKey>,
    pub starting_chips: u64,        // 10000
    pub starting_shields: u32,      // 3
    pub starting_doubles: u32,      // 3
}

impl Write for Tournament {
    fn write(&self, writer: &mut impl BufMut) {
        self.id.write(writer);
        self.phase.write(writer);
        self.start_block.write(writer);
        self.players.write(writer);
        self.starting_chips.write(writer);
        self.starting_shields.write(writer);
        self.starting_doubles.write(writer);
    }
}

impl Read for Tournament {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            id: u64::read(reader)?,
            phase: TournamentPhase::read(reader)?,
            start_block: u64::read(reader)?,
            players: Vec::<PublicKey>::read_range(reader, 0..=1000)?,
            starting_chips: u64::read(reader)?,
            starting_shields: u32::read(reader)?,
            starting_doubles: u32::read(reader)?,
        })
    }
}

impl EncodeSize for Tournament {
    fn encode_size(&self) -> usize {
        self.id.encode_size()
            + self.phase.encode_size()
            + self.start_block.encode_size()
            + self.players.encode_size()
            + self.starting_chips.encode_size()
            + self.starting_shields.encode_size()
            + self.starting_doubles.encode_size()
    }
}

/// Casino events
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CasinoEvent {
    /// Player registered
    PlayerRegistered {
        player: PublicKey,
        name: String,
    },

    /// Game session started
    GameStarted {
        session_id: u64,
        player: PublicKey,
        game_type: GameType,
        bet: u64,
        initial_state: Vec<u8>,
    },

    /// Game move made
    GameMoved {
        session_id: u64,
        move_number: u32,
        new_state: Vec<u8>,
    },

    /// Game completed
    GameCompleted {
        session_id: u64,
        player: PublicKey,
        game_type: GameType,
        payout: i64,
        final_chips: u64,
        was_shielded: bool,
        was_doubled: bool,
    },

    /// Leaderboard updated
    LeaderboardUpdated {
        leaderboard: CasinoLeaderboard,
    },
}

impl Write for CasinoEvent {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            Self::PlayerRegistered { player, name } => {
                0u8.write(writer);
                player.write(writer);
                write_string(name, writer);
            }
            Self::GameStarted { session_id, player, game_type, bet, initial_state } => {
                1u8.write(writer);
                session_id.write(writer);
                player.write(writer);
                game_type.write(writer);
                bet.write(writer);
                initial_state.write(writer);
            }
            Self::GameMoved { session_id, move_number, new_state } => {
                2u8.write(writer);
                session_id.write(writer);
                move_number.write(writer);
                new_state.write(writer);
            }
            Self::GameCompleted { session_id, player, game_type, payout, final_chips, was_shielded, was_doubled } => {
                3u8.write(writer);
                session_id.write(writer);
                player.write(writer);
                game_type.write(writer);
                payout.write(writer);
                final_chips.write(writer);
                was_shielded.write(writer);
                was_doubled.write(writer);
            }
            Self::LeaderboardUpdated { leaderboard } => {
                4u8.write(writer);
                leaderboard.write(writer);
            }
        }
    }
}

impl Read for CasinoEvent {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let tag = u8::read(reader)?;
        match tag {
            0 => Ok(Self::PlayerRegistered {
                player: PublicKey::read(reader)?,
                name: read_string(reader, MAX_NAME_LENGTH)?,
            }),
            1 => Ok(Self::GameStarted {
                session_id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
                game_type: GameType::read(reader)?,
                bet: u64::read(reader)?,
                initial_state: Vec::<u8>::read_range(reader, 0..=1024)?,
            }),
            2 => Ok(Self::GameMoved {
                session_id: u64::read(reader)?,
                move_number: u32::read(reader)?,
                new_state: Vec::<u8>::read_range(reader, 0..=1024)?,
            }),
            3 => Ok(Self::GameCompleted {
                session_id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
                game_type: GameType::read(reader)?,
                payout: i64::read(reader)?,
                final_chips: u64::read(reader)?,
                was_shielded: bool::read(reader)?,
                was_doubled: bool::read(reader)?,
            }),
            4 => Ok(Self::LeaderboardUpdated {
                leaderboard: CasinoLeaderboard::read(reader)?,
            }),
            i => Err(Error::InvalidEnum(i)),
        }
    }
}

impl EncodeSize for CasinoEvent {
    fn encode_size(&self) -> usize {
        1 + match self {
            Self::PlayerRegistered { player, name } => {
                player.encode_size() + string_encode_size(name)
            }
            Self::GameStarted { session_id, player, game_type, bet, initial_state } => {
                session_id.encode_size()
                    + player.encode_size()
                    + game_type.encode_size()
                    + bet.encode_size()
                    + initial_state.encode_size()
            }
            Self::GameMoved { session_id, move_number, new_state } => {
                session_id.encode_size()
                    + move_number.encode_size()
                    + new_state.encode_size()
            }
            Self::GameCompleted { session_id, player, game_type, payout, final_chips, was_shielded, was_doubled } => {
                session_id.encode_size()
                    + player.encode_size()
                    + game_type.encode_size()
                    + payout.encode_size()
                    + final_chips.encode_size()
                    + was_shielded.encode_size()
                    + was_doubled.encode_size()
            }
            Self::LeaderboardUpdated { leaderboard } => {
                leaderboard.encode_size()
            }
        }
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
    fn test_register_instruction_binary_format() {
        let instruction = CasinoInstruction::Register { name: "Alice".to_string() };
        let encoded = instruction.encode();

        // Verify binary format: [0] [nameLen:u32 BE] [nameBytes...]
        assert_eq!(encoded[0], 0); // Tag
        assert_eq!(&encoded[1..5], &[0, 0, 0, 5]); // Name length as u32 BE
        assert_eq!(&encoded[5..], b"Alice"); // Name bytes
    }

    #[test]
    fn test_start_game_instruction_binary_format() {
        let instruction = CasinoInstruction::StartGame {
            game_type: GameType::Blackjack,
            bet: 100,
            session_id: 1,
        };
        let encoded = instruction.encode();

        // Verify binary format: [2] [gameType:u8] [bet:u64 BE] [sessionId:u64 BE]
        assert_eq!(encoded[0], 2); // Tag
        assert_eq!(encoded[1], 1); // Blackjack = 1
        assert_eq!(&encoded[2..10], &[0, 0, 0, 0, 0, 0, 0, 100]); // Bet as u64 BE
        assert_eq!(&encoded[10..18], &[0, 0, 0, 0, 0, 0, 0, 1]); // SessionId as u64 BE
    }

    #[test]
    fn test_game_move_instruction_binary_format() {
        let instruction = CasinoInstruction::GameMove {
            session_id: 42,
            payload: vec![0, 1, 2],
        };
        let encoded = instruction.encode();

        // Verify binary format: [3] [sessionId:u64 BE] [payloadLen:u32 BE] [payload...]
        assert_eq!(encoded[0], 3); // Tag
        assert_eq!(&encoded[1..9], &[0, 0, 0, 0, 0, 0, 0, 42]); // SessionId as u64 BE
        assert_eq!(&encoded[9..13], &[0, 0, 0, 3]); // Payload length as u32 BE
        assert_eq!(&encoded[13..], &[0, 1, 2]); // Payload bytes
    }

    #[test]
    fn test_instruction_roundtrip() {
        let instructions = vec![
            CasinoInstruction::Register { name: "TestPlayer".to_string() },
            CasinoInstruction::Deposit { amount: 5000 },
            CasinoInstruction::StartGame {
                game_type: GameType::HiLo,
                bet: 50,
                session_id: 123,
            },
            CasinoInstruction::GameMove {
                session_id: 123,
                payload: vec![0], // Higher
            },
            CasinoInstruction::ToggleShield,
            CasinoInstruction::ToggleDouble,
        ];

        for instruction in instructions {
            let encoded = instruction.encode();
            let decoded = CasinoInstruction::read(&mut &encoded[..]).unwrap();
            assert_eq!(instruction, decoded);
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
