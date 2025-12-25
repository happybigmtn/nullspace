use bytes::{Buf, BufMut};
use commonware_codec::{EncodeSize, Error, Read, ReadExt, ReadRangeExt, Write};
use commonware_cryptography::ed25519::PublicKey;
use thiserror::Error as ThisError;

use super::{
    read_string, string_encode_size, write_string, GameType, SuperModeState,
    FREEROLL_DAILY_LIMIT_FREE, INITIAL_CHIPS, MAX_NAME_LENGTH, STARTING_DOUBLES, STARTING_SHIELDS,
};

const MAX_AURA_METER: u8 = 5;

#[derive(Debug, ThisError, PartialEq, Eq)]
pub enum PlayerInvariantError {
    #[error("player name too long (len={len}, max={max})")]
    NameTooLong { len: usize, max: usize },
    #[error("aura_meter out of range (got={got}, max={max})")]
    AuraMeterOutOfRange { got: u8, max: u8 },
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlayerProfile {
    pub name: String,
    pub rank: u32,
    pub is_kyc_verified: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlayerBalances {
    pub chips: u64,
    pub vusdt_balance: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlayerModifiers {
    pub shields: u32,
    pub doubles: u32,
    pub active_shield: bool,
    pub active_double: bool,
    pub active_super: bool,
    /// Aura Meter for Super Mode (0-5 segments).
    /// Increments on near-misses, triggers Super Aura Round at 5.
    pub aura_meter: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlayerTournamentState {
    pub chips: u64,
    pub shields: u32,
    pub doubles: u32,
    pub active_tournament: Option<u64>,
    pub tournaments_played_today: u8,
    pub last_tournament_ts: u64,
    pub daily_limit: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlayerSessionState {
    pub active_session: Option<u64>,
    pub last_deposit_block: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct PlayerBalanceSnapshot {
    pub chips: u64,
    pub vusdt_balance: u64,
    pub shields: u32,
    pub doubles: u32,
    pub tournament_chips: u64,
    pub tournament_shields: u32,
    pub tournament_doubles: u32,
    pub active_tournament: Option<u64>,
}

/// Player state for casino games.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Player {
    pub nonce: u64,
    pub profile: PlayerProfile,
    pub balances: PlayerBalances,
    pub modifiers: PlayerModifiers,
    pub tournament: PlayerTournamentState,
    pub session: PlayerSessionState,
}

impl Player {
    pub fn new(name: String) -> Self {
        Self {
            nonce: 0,
            profile: PlayerProfile {
                name,
                rank: 0,
                is_kyc_verified: false,
            },
            balances: PlayerBalances {
                chips: INITIAL_CHIPS,
                vusdt_balance: 0,
            },
            modifiers: PlayerModifiers {
                shields: STARTING_SHIELDS,
                doubles: STARTING_DOUBLES,
                active_shield: false,
                active_double: false,
                active_super: false,
                aura_meter: 0,
            },
            tournament: PlayerTournamentState {
                chips: 0,
                shields: 0,
                doubles: 0,
                active_tournament: None,
                tournaments_played_today: 0,
                last_tournament_ts: 0,
                daily_limit: FREEROLL_DAILY_LIMIT_FREE,
            },
            session: PlayerSessionState {
                active_session: None,
                // Allow an immediate first faucet deposit
                last_deposit_block: 0,
            },
        }
    }

    pub fn validate_invariants(&self) -> Result<(), PlayerInvariantError> {
        if self.profile.name.len() > MAX_NAME_LENGTH {
            return Err(PlayerInvariantError::NameTooLong {
                len: self.profile.name.len(),
                max: MAX_NAME_LENGTH,
            });
        }
        if self.modifiers.aura_meter > MAX_AURA_METER {
            return Err(PlayerInvariantError::AuraMeterOutOfRange {
                got: self.modifiers.aura_meter,
                max: MAX_AURA_METER,
            });
        }
        Ok(())
    }

    pub fn new_with_block(name: String, _block: u64) -> Self {
        // Backwards-compat shim: the executor enforces faucet/tournament rate limits based on
        // on-chain state, so the provided block is not needed to construct the initial player.
        Self::new(name)
    }

    /// Clear all active modifiers (shield, double, super) after game completion.
    pub fn clear_active_modifiers(&mut self) {
        self.modifiers.active_shield = false;
        self.modifiers.active_double = false;
        self.modifiers.active_super = false;
    }
}

impl PlayerBalanceSnapshot {
    pub fn from_player(player: &Player) -> Self {
        Self {
            chips: player.balances.chips,
            vusdt_balance: player.balances.vusdt_balance,
            shields: player.modifiers.shields,
            doubles: player.modifiers.doubles,
            tournament_chips: player.tournament.chips,
            tournament_shields: player.tournament.shields,
            tournament_doubles: player.tournament.doubles,
            active_tournament: player.tournament.active_tournament,
        }
    }
}

impl Write for PlayerBalanceSnapshot {
    fn write(&self, writer: &mut impl BufMut) {
        self.chips.write(writer);
        self.vusdt_balance.write(writer);
        self.shields.write(writer);
        self.doubles.write(writer);
        self.tournament_chips.write(writer);
        self.tournament_shields.write(writer);
        self.tournament_doubles.write(writer);
        self.active_tournament.write(writer);
    }
}

impl Read for PlayerBalanceSnapshot {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            chips: u64::read(reader)?,
            vusdt_balance: u64::read(reader)?,
            shields: u32::read(reader)?,
            doubles: u32::read(reader)?,
            tournament_chips: u64::read(reader)?,
            tournament_shields: u32::read(reader)?,
            tournament_doubles: u32::read(reader)?,
            active_tournament: Option::<u64>::read(reader)?,
        })
    }
}

impl EncodeSize for PlayerBalanceSnapshot {
    fn encode_size(&self) -> usize {
        self.chips.encode_size()
            + self.vusdt_balance.encode_size()
            + self.shields.encode_size()
            + self.doubles.encode_size()
            + self.tournament_chips.encode_size()
            + self.tournament_shields.encode_size()
            + self.tournament_doubles.encode_size()
            + self.active_tournament.encode_size()
    }
}

impl Write for Player {
    fn write(&self, writer: &mut impl BufMut) {
        self.nonce.write(writer);
        write_string(&self.profile.name, writer);
        self.balances.chips.write(writer);
        self.balances.vusdt_balance.write(writer);
        self.modifiers.shields.write(writer);
        self.modifiers.doubles.write(writer);
        self.tournament.chips.write(writer);
        self.tournament.shields.write(writer);
        self.tournament.doubles.write(writer);
        self.tournament.active_tournament.write(writer);
        self.profile.rank.write(writer);
        self.modifiers.active_shield.write(writer);
        self.modifiers.active_double.write(writer);
        self.modifiers.active_super.write(writer);
        self.session.active_session.write(writer);
        self.session.last_deposit_block.write(writer);
        self.modifiers.aura_meter.write(writer);
        self.tournament.tournaments_played_today.write(writer);
        self.tournament.last_tournament_ts.write(writer);
        self.profile.is_kyc_verified.write(writer);
        self.tournament.daily_limit.write(writer);
    }
}

impl Read for Player {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let nonce = u64::read(reader)?;
        let name = read_string(reader, MAX_NAME_LENGTH)?;
        let chips = u64::read(reader)?;
        let vusdt_balance = u64::read(reader)?;
        let shields = u32::read(reader)?;
        let doubles = u32::read(reader)?;
        let tournament_chips = u64::read(reader)?;
        let tournament_shields = u32::read(reader)?;
        let tournament_doubles = u32::read(reader)?;
        let active_tournament = Option::<u64>::read(reader)?;
        let rank = u32::read(reader)?;
        let active_shield = bool::read(reader)?;
        let active_double = bool::read(reader)?;
        let active_super = bool::read(reader)?;
        let active_session = Option::<u64>::read(reader)?;
        let last_deposit_block = u64::read(reader)?;
        let aura_meter = u8::read(reader)?;
        let tournaments_played_today = u8::read(reader)?;
        let last_tournament_ts = u64::read(reader)?;
        let is_kyc_verified = bool::read(reader)?;
        let daily_limit = if reader.remaining() > 0 {
            u8::read(reader)?
        } else {
            FREEROLL_DAILY_LIMIT_FREE
        };

        Ok(Self {
            nonce,
            profile: PlayerProfile {
                name,
                rank,
                is_kyc_verified,
            },
            balances: PlayerBalances {
                chips,
                vusdt_balance,
            },
            modifiers: PlayerModifiers {
                shields,
                doubles,
                active_shield,
                active_double,
                active_super,
                aura_meter,
            },
            tournament: PlayerTournamentState {
                chips: tournament_chips,
                shields: tournament_shields,
                doubles: tournament_doubles,
                active_tournament,
                tournaments_played_today,
                last_tournament_ts,
                daily_limit,
            },
            session: PlayerSessionState {
                active_session,
                last_deposit_block,
            },
        })
    }
}

impl EncodeSize for Player {
    fn encode_size(&self) -> usize {
        self.nonce.encode_size()
            + string_encode_size(&self.profile.name)
            + self.balances.chips.encode_size()
            + self.balances.vusdt_balance.encode_size()
            + self.modifiers.shields.encode_size()
            + self.modifiers.doubles.encode_size()
            + self.tournament.chips.encode_size()
            + self.tournament.shields.encode_size()
            + self.tournament.doubles.encode_size()
            + self.tournament.active_tournament.encode_size()
            + self.profile.rank.encode_size()
            + self.modifiers.active_shield.encode_size()
            + self.modifiers.active_double.encode_size()
            + self.modifiers.active_super.encode_size()
            + self.session.active_session.encode_size()
            + self.session.last_deposit_block.encode_size()
            + self.modifiers.aura_meter.encode_size()
            + self.tournament.tournaments_played_today.encode_size()
            + self.tournament.last_tournament_ts.encode_size()
            + self.profile.is_kyc_verified.encode_size()
            + self.tournament.daily_limit.encode_size()
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
