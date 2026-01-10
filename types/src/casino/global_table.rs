use bytes::{Buf, BufMut};
use commonware_codec::{EncodeSize, Error, FixedSize, Read, ReadExt, ReadRangeExt, Write};

use super::{GameSession, GameType};

const MAX_GLOBAL_TABLE_TOTALS: usize = 64;
const MAX_GLOBAL_TABLE_BETS: usize = 64;
const MAX_RNG_COMMIT_LEN: usize = 32;
const MAX_ROLL_SEED_LEN: usize = 32;

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GlobalTablePhase {
    Betting = 0,
    Locked = 1,
    Rolling = 2,
    Payout = 3,
    Cooldown = 4,
}

impl TryFrom<u8> for GlobalTablePhase {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(GlobalTablePhase::Betting),
            1 => Ok(GlobalTablePhase::Locked),
            2 => Ok(GlobalTablePhase::Rolling),
            3 => Ok(GlobalTablePhase::Payout),
            4 => Ok(GlobalTablePhase::Cooldown),
            _ => Err(()),
        }
    }
}

impl Write for GlobalTablePhase {
    fn write(&self, writer: &mut impl BufMut) {
        (*self as u8).write(writer);
    }
}

impl Read for GlobalTablePhase {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let value = u8::read(reader)?;
        GlobalTablePhase::try_from(value).map_err(|_| Error::InvalidEnum(value))
    }
}

impl EncodeSize for GlobalTablePhase {
    fn encode_size(&self) -> usize {
        u8::SIZE
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlobalTableConfig {
    pub game_type: GameType,
    pub betting_ms: u64,
    pub lock_ms: u64,
    pub payout_ms: u64,
    pub cooldown_ms: u64,
    pub min_bet: u64,
    pub max_bet: u64,
    pub max_bets_per_round: u8,
}

impl Write for GlobalTableConfig {
    fn write(&self, writer: &mut impl BufMut) {
        self.game_type.write(writer);
        self.betting_ms.write(writer);
        self.lock_ms.write(writer);
        self.payout_ms.write(writer);
        self.cooldown_ms.write(writer);
        self.min_bet.write(writer);
        self.max_bet.write(writer);
        self.max_bets_per_round.write(writer);
    }
}

impl Read for GlobalTableConfig {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            game_type: GameType::read(reader)?,
            betting_ms: u64::read(reader)?,
            lock_ms: u64::read(reader)?,
            payout_ms: u64::read(reader)?,
            cooldown_ms: u64::read(reader)?,
            min_bet: u64::read(reader)?,
            max_bet: u64::read(reader)?,
            max_bets_per_round: u8::read(reader)?,
        })
    }
}

impl EncodeSize for GlobalTableConfig {
    fn encode_size(&self) -> usize {
        self.game_type.encode_size()
            + self.betting_ms.encode_size()
            + self.lock_ms.encode_size()
            + self.payout_ms.encode_size()
            + self.cooldown_ms.encode_size()
            + self.min_bet.encode_size()
            + self.max_bet.encode_size()
            + self.max_bets_per_round.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlobalTableBet {
    pub bet_type: u8,
    pub target: u8,
    pub amount: u64,
}

impl Write for GlobalTableBet {
    fn write(&self, writer: &mut impl BufMut) {
        self.bet_type.write(writer);
        self.target.write(writer);
        self.amount.write(writer);
    }
}

impl Read for GlobalTableBet {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            bet_type: u8::read(reader)?,
            target: u8::read(reader)?,
            amount: u64::read(reader)?,
        })
    }
}

impl EncodeSize for GlobalTableBet {
    fn encode_size(&self) -> usize {
        self.bet_type.encode_size() + self.target.encode_size() + self.amount.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlobalTableTotal {
    pub bet_type: u8,
    pub target: u8,
    pub amount: u64,
}

impl Write for GlobalTableTotal {
    fn write(&self, writer: &mut impl BufMut) {
        self.bet_type.write(writer);
        self.target.write(writer);
        self.amount.write(writer);
    }
}

impl Read for GlobalTableTotal {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            bet_type: u8::read(reader)?,
            target: u8::read(reader)?,
            amount: u64::read(reader)?,
        })
    }
}

impl EncodeSize for GlobalTableTotal {
    fn encode_size(&self) -> usize {
        self.bet_type.encode_size() + self.target.encode_size() + self.amount.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlobalTableRound {
    pub game_type: GameType,
    pub round_id: u64,
    pub phase: GlobalTablePhase,
    pub phase_ends_at_ms: u64,
    pub main_point: u8,
    pub d1: u8,
    pub d2: u8,
    pub made_points_mask: u8,
    pub epoch_point_established: bool,
    pub field_paytable: u8,
    /// Commitment to the RNG seed for this round (0 or 32 bytes).
    pub rng_commit: Vec<u8>,
    /// Seed snapshot used to replay the roll deterministically (0 or 32 bytes).
    pub roll_seed: Vec<u8>,
    pub totals: Vec<GlobalTableTotal>,
}

impl Write for GlobalTableRound {
    fn write(&self, writer: &mut impl BufMut) {
        self.game_type.write(writer);
        self.round_id.write(writer);
        self.phase.write(writer);
        self.phase_ends_at_ms.write(writer);
        self.main_point.write(writer);
        self.d1.write(writer);
        self.d2.write(writer);
        self.made_points_mask.write(writer);
        self.epoch_point_established.write(writer);
        self.field_paytable.write(writer);
        self.rng_commit.write(writer);
        self.roll_seed.write(writer);
        self.totals.write(writer);
    }
}

impl Read for GlobalTableRound {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let game_type = GameType::read(reader)?;
        let round_id = u64::read(reader)?;
        let phase = GlobalTablePhase::read(reader)?;
        let phase_ends_at_ms = u64::read(reader)?;
        let main_point = u8::read(reader)?;
        let d1 = u8::read(reader)?;
        let d2 = u8::read(reader)?;
        let made_points_mask = u8::read(reader)?;
        let epoch_point_established = bool::read(reader)?;
        let field_paytable = u8::read(reader)?;
        let rng_commit = Vec::<u8>::read_range(reader, 0..=MAX_RNG_COMMIT_LEN)?;
        if !(rng_commit.is_empty() || rng_commit.len() == MAX_RNG_COMMIT_LEN) {
            return Err(Error::Invalid("GlobalTableRound", "invalid rng commit length"));
        }
        let roll_seed = Vec::<u8>::read_range(reader, 0..=MAX_ROLL_SEED_LEN)?;
        if !(roll_seed.is_empty() || roll_seed.len() == MAX_ROLL_SEED_LEN) {
            return Err(Error::Invalid("GlobalTableRound", "invalid roll seed length"));
        }
        let totals =
            Vec::<GlobalTableTotal>::read_range(reader, 0..=MAX_GLOBAL_TABLE_TOTALS)?;

        Ok(Self {
            game_type,
            round_id,
            phase,
            phase_ends_at_ms,
            main_point,
            d1,
            d2,
            made_points_mask,
            epoch_point_established,
            field_paytable,
            rng_commit,
            roll_seed,
            totals,
        })
    }
}

impl EncodeSize for GlobalTableRound {
    fn encode_size(&self) -> usize {
        self.game_type.encode_size()
            + self.round_id.encode_size()
            + self.phase.encode_size()
            + self.phase_ends_at_ms.encode_size()
            + self.main_point.encode_size()
            + self.d1.encode_size()
            + self.d2.encode_size()
            + self.made_points_mask.encode_size()
            + self.epoch_point_established.encode_size()
            + self.field_paytable.encode_size()
            + self.rng_commit.encode_size()
            + self.roll_seed.encode_size()
            + self.totals.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlobalTablePlayerSession {
    pub game_type: GameType,
    pub session: GameSession,
    pub last_settled_round: u64,
}

impl Write for GlobalTablePlayerSession {
    fn write(&self, writer: &mut impl BufMut) {
        self.game_type.write(writer);
        self.session.write(writer);
        self.last_settled_round.write(writer);
    }
}

impl Read for GlobalTablePlayerSession {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            game_type: GameType::read(reader)?,
            session: GameSession::read(reader)?,
            last_settled_round: u64::read(reader)?,
        })
    }
}

impl EncodeSize for GlobalTablePlayerSession {
    fn encode_size(&self) -> usize {
        self.game_type.encode_size()
            + self.session.encode_size()
            + self.last_settled_round.encode_size()
    }
}

pub fn global_table_bets_cfg() -> std::ops::RangeInclusive<usize> {
    0..=MAX_GLOBAL_TABLE_BETS
}
