use bytes::{Buf, BufMut};
use commonware_codec::{
    varint::UInt, Encode, EncodeSize, Error, FixedSize, RangeCfg, Read, ReadExt, ReadRangeExt,
    Write,
};
use commonware_consensus::threshold_simplex::types::{
    Activity as CActivity, Finalization as CFinalization, Notarization as CNotarization,
    Seed as CSeed, View,
};
use commonware_cryptography::{
    bls12381::primitives::variant::{MinSig, Variant},
    ed25519::{self, Batch, PublicKey},
    sha256::{Digest, Sha256},
    BatchVerifier, Committable, Digestible, Hasher, Signer, Verifier,
};
use commonware_utils::{modulo, union};
use std::{fmt::Debug, hash::Hash};

pub const NAMESPACE: &[u8] = b"_SUPERSOCIETY";
pub const TRANSACTION_SUFFIX: &[u8] = b"_TX";
// Phase 1 scaling: Increased from 100 to 500 for higher throughput
pub const MAX_BLOCK_TRANSACTIONS: usize = 500;

pub type Seed = CSeed<MinSig>;
pub type Notarization = CNotarization<MinSig, Digest>;
pub type Finalization = CFinalization<MinSig, Digest>;
pub type Activity = CActivity<MinSig, Digest>;

pub type Identity = <MinSig as Variant>::Public;
pub type Evaluation = Identity;
pub type Signature = <MinSig as Variant>::Signature;

#[inline]
pub fn transaction_namespace(namespace: &[u8]) -> Vec<u8> {
    union(namespace, TRANSACTION_SUFFIX)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transaction {
    pub nonce: u64,
    pub instruction: Instruction,

    pub public: ed25519::PublicKey,
    pub signature: ed25519::Signature,
}

impl Transaction {
    fn payload(nonce: &u64, instruction: &Instruction) -> Vec<u8> {
        let mut payload = Vec::new();
        nonce.write(&mut payload);
        instruction.write(&mut payload);

        payload
    }

    pub fn sign(private: &ed25519::PrivateKey, nonce: u64, instruction: Instruction) -> Self {
        let signature = private.sign(
            Some(&transaction_namespace(NAMESPACE)),
            &Self::payload(&nonce, &instruction),
        );

        Self {
            nonce,
            instruction,
            public: private.public_key(),
            signature,
        }
    }

    pub fn verify(&self) -> bool {
        self.public.verify(
            Some(&transaction_namespace(NAMESPACE)),
            &Self::payload(&self.nonce, &self.instruction),
            &self.signature,
        )
    }

    pub fn verify_batch(&self, batch: &mut Batch) {
        batch.add(
            Some(&transaction_namespace(NAMESPACE)),
            &Self::payload(&self.nonce, &self.instruction),
            &self.public,
            &self.signature,
        );
    }
}

impl Write for Transaction {
    fn write(&self, writer: &mut impl BufMut) {
        self.nonce.write(writer);
        self.instruction.write(writer);
        self.public.write(writer);
        self.signature.write(writer);
    }
}

impl Read for Transaction {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let nonce = u64::read(reader)?;
        let instruction = Instruction::read(reader)?;
        let public = ed25519::PublicKey::read(reader)?;
        let signature = ed25519::Signature::read(reader)?;

        Ok(Self {
            nonce,
            instruction,
            public,
            signature,
        })
    }
}

impl EncodeSize for Transaction {
    fn encode_size(&self) -> usize {
        self.nonce.encode_size()
            + self.instruction.encode_size()
            + self.public.encode_size()
            + self.signature.encode_size()
    }
}

impl Digestible for Transaction {
    type Digest = Digest;

    fn digest(&self) -> Digest {
        let mut hasher = Sha256::new();
        hasher.update(self.nonce.to_be_bytes().as_ref());
        hasher.update(self.instruction.encode().as_ref());
        hasher.update(self.public.as_ref());
        // We don't include the signature as part of the digest (any valid
        // signature will be valid for the transaction)
        hasher.finalize()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum Instruction {
    // Casino instructions (tags 10-17)
    /// Register a new casino player with a name.
    /// Binary: [10] [nameLen:u32 BE] [nameBytes...]
    CasinoRegister { name: String },

    /// Deposit chips (for testing/faucet).
    /// Binary: [11] [amount:u64 BE]
    CasinoDeposit { amount: u64 },

    /// Start a new casino game session.
    /// Binary: [12] [gameType:u8] [bet:u64 BE] [sessionId:u64 BE]
    CasinoStartGame {
        game_type: crate::casino::GameType,
        bet: u64,
        session_id: u64,
    },

    /// Make a move in an active casino game.
    /// Binary: [13] [sessionId:u64 BE] [payloadLen:u32 BE] [payload...]
    CasinoGameMove { session_id: u64, payload: Vec<u8> },

    /// Toggle shield modifier for next game.
    /// Binary: [14]
    CasinoToggleShield,

    /// Toggle double modifier for next game.
    /// Binary: [15]
    CasinoToggleDouble,

    /// Join a tournament.
    /// Binary: [16] [tournamentId:u64 BE]
    CasinoJoinTournament { tournament_id: u64 },

    /// Start a tournament (transitions from Registration to Active phase).
    /// Also resets all joined players' chips/shields/doubles to starting values.
    /// Binary: [17] [tournamentId:u64 BE] [startTimeMs:u64 BE] [endTimeMs:u64 BE]
    CasinoStartTournament {
        tournament_id: u64,
        start_time_ms: u64,
        end_time_ms: u64,
    },

    // Staking & House Instructions (tags 18-21)
    /// Stake chips for voting power and rewards.
    /// Binary: [18] [amount:u64 BE] [duration:u64 BE]
    Stake { amount: u64, duration: u64 },

    /// Unstake chips after lockup period.
    /// Binary: [19]
    Unstake,

    /// Claim staking rewards.
    /// Binary: [20]
    ClaimRewards,

    /// Trigger end-of-epoch processing (admin/keeper only).
    /// Binary: [21]
    ProcessEpoch,

    // Virtual Liquidity / Vault Instructions (tags 22-25)
    /// Create a new Vault (CDP).
    /// Binary: [22]
    CreateVault,

    /// Deposit RNG collateral into vault.
    /// Binary: [23] [amount:u64 BE]
    DepositCollateral { amount: u64 },

    /// Borrow vUSDT against collateral.
    /// Binary: [24] [amount:u64 BE]
    BorrowUSDT { amount: u64 },

    /// Repay vUSDT debt.
    /// Binary: [25] [amount:u64 BE]
    RepayUSDT { amount: u64 },

    // AMM Instructions (tags 26-28)
    /// Swap tokens on the AMM.
    /// Binary: [26] [amountIn:u64 BE] [minAmountOut:u64 BE] [isBuyingRng:u8]
    Swap {
        amount_in: u64,
        min_amount_out: u64,
        is_buying_rng: bool,
    },

    /// Add liquidity to AMM.
    /// Binary: [27] [rngAmount:u64 BE] [usdtAmount:u64 BE]
    AddLiquidity { rng_amount: u64, usdt_amount: u64 },

    /// Remove liquidity from AMM.
    /// Binary: [28] [shares:u64 BE]
    RemoveLiquidity { shares: u64 },

    /// End a tournament and distribute prizes.
    /// Binary: [29] [tournamentId:u64 BE]
    CasinoEndTournament { tournament_id: u64 },
}

impl Write for Instruction {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            // Casino instructions (tags 10-17)
            Self::CasinoRegister { name } => {
                10u8.write(writer);
                (name.len() as u32).write(writer);
                writer.put_slice(name.as_bytes());
            }
            Self::CasinoDeposit { amount } => {
                11u8.write(writer);
                amount.write(writer);
            }
            Self::CasinoStartGame {
                game_type,
                bet,
                session_id,
            } => {
                12u8.write(writer);
                game_type.write(writer);
                bet.write(writer);
                session_id.write(writer);
            }
            Self::CasinoGameMove {
                session_id,
                payload,
            } => {
                13u8.write(writer);
                session_id.write(writer);
                (payload.len() as u32).write(writer);
                writer.put_slice(payload);
            }
            Self::CasinoToggleShield => 14u8.write(writer),
            Self::CasinoToggleDouble => 15u8.write(writer),
            Self::CasinoJoinTournament { tournament_id } => {
                16u8.write(writer);
                tournament_id.write(writer);
            }
            Self::CasinoStartTournament {
                tournament_id,
                start_time_ms,
                end_time_ms,
            } => {
                17u8.write(writer);
                tournament_id.write(writer);
                start_time_ms.write(writer);
                end_time_ms.write(writer);
            }

            // Staking (18-21)
            Self::Stake { amount, duration } => {
                18u8.write(writer);
                amount.write(writer);
                duration.write(writer);
            }
            Self::Unstake => 19u8.write(writer),
            Self::ClaimRewards => 20u8.write(writer),
            Self::ProcessEpoch => 21u8.write(writer),

            // Vaults (22-25)
            Self::CreateVault => 22u8.write(writer),
            Self::DepositCollateral { amount } => {
                23u8.write(writer);
                amount.write(writer);
            }
            Self::BorrowUSDT { amount } => {
                24u8.write(writer);
                amount.write(writer);
            }
            Self::RepayUSDT { amount } => {
                25u8.write(writer);
                amount.write(writer);
            }

            // AMM (26-28)
            Self::Swap {
                amount_in,
                min_amount_out,
                is_buying_rng,
            } => {
                26u8.write(writer);
                amount_in.write(writer);
                min_amount_out.write(writer);
                is_buying_rng.write(writer);
            }
            Self::AddLiquidity {
                rng_amount,
                usdt_amount,
            } => {
                27u8.write(writer);
                rng_amount.write(writer);
                usdt_amount.write(writer);
            }
            Self::RemoveLiquidity { shares } => {
                28u8.write(writer);
                shares.write(writer);
            }
            Self::CasinoEndTournament { tournament_id } => {
                29u8.write(writer);
                tournament_id.write(writer);
            }
        }
    }
}

/// Maximum name length for casino player registration
pub const CASINO_MAX_NAME_LENGTH: usize = 32;

/// Maximum payload length for casino game moves
pub const CASINO_MAX_PAYLOAD_LENGTH: usize = 256;

impl Read for Instruction {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let instruction = match reader.get_u8() {
            // Casino instructions (tags 10-17)
            10 => {
                let name_len = u32::read(reader)? as usize;
                if name_len > CASINO_MAX_NAME_LENGTH {
                    return Err(Error::Invalid("Instruction", "casino name too long"));
                }
                if reader.remaining() < name_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut name_bytes = vec![0u8; name_len];
                reader.copy_to_slice(&mut name_bytes);
                let name = String::from_utf8(name_bytes)
                    .map_err(|_| Error::Invalid("Instruction", "invalid UTF-8 in casino name"))?;
                Self::CasinoRegister { name }
            }
            11 => Self::CasinoDeposit {
                amount: u64::read(reader)?,
            },
            12 => Self::CasinoStartGame {
                game_type: crate::casino::GameType::read(reader)?,
                bet: u64::read(reader)?,
                session_id: u64::read(reader)?,
            },
            13 => {
                let session_id = u64::read(reader)?;
                let payload_len = u32::read(reader)? as usize;
                if payload_len > CASINO_MAX_PAYLOAD_LENGTH {
                    return Err(Error::Invalid("Instruction", "casino payload too long"));
                }
                if reader.remaining() < payload_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut payload = vec![0u8; payload_len];
                reader.copy_to_slice(&mut payload);
                Self::CasinoGameMove {
                    session_id,
                    payload,
                }
            }
            14 => Self::CasinoToggleShield,
            15 => Self::CasinoToggleDouble,
            16 => Self::CasinoJoinTournament {
                tournament_id: u64::read(reader)?,
            },
            17 => Self::CasinoStartTournament {
                tournament_id: u64::read(reader)?,
                start_time_ms: u64::read(reader)?,
                end_time_ms: u64::read(reader)?,
            },

            // Staking (18-21)
            18 => Self::Stake {
                amount: u64::read(reader)?,
                duration: u64::read(reader)?,
            },
            19 => Self::Unstake,
            20 => Self::ClaimRewards,
            21 => Self::ProcessEpoch,

            // Vaults (22-25)
            22 => Self::CreateVault,
            23 => Self::DepositCollateral {
                amount: u64::read(reader)?,
            },
            24 => Self::BorrowUSDT {
                amount: u64::read(reader)?,
            },
            25 => Self::RepayUSDT {
                amount: u64::read(reader)?,
            },

            // AMM (26-28)
            26 => Self::Swap {
                amount_in: u64::read(reader)?,
                min_amount_out: u64::read(reader)?,
                is_buying_rng: bool::read(reader)?,
            },
            27 => Self::AddLiquidity {
                rng_amount: u64::read(reader)?,
                usdt_amount: u64::read(reader)?,
            },
            28 => Self::RemoveLiquidity {
                shares: u64::read(reader)?,
            },
            29 => Self::CasinoEndTournament {
                tournament_id: u64::read(reader)?,
            },

            i => return Err(Error::InvalidEnum(i)),
        };

        Ok(instruction)
    }
}

impl EncodeSize for Instruction {
    fn encode_size(&self) -> usize {
        u8::SIZE
            + match self {
                // Casino
                Self::CasinoRegister { name } => 4 + name.len(),
                Self::CasinoDeposit { .. } => 8,
                Self::CasinoStartGame { .. } => 1 + 8 + 8,
                Self::CasinoGameMove { payload, .. } => 8 + 4 + payload.len(),
                Self::CasinoToggleShield | Self::CasinoToggleDouble => 0,
                Self::CasinoJoinTournament { .. } => 8,
                Self::CasinoStartTournament { .. } => 8 + 8 + 8,

                // Staking
                Self::Stake { amount, duration } => amount.encode_size() + duration.encode_size(),
                Self::Unstake | Self::ClaimRewards | Self::ProcessEpoch => 0,

                // Vaults
                Self::CreateVault => 0,
                Self::DepositCollateral { amount }
                | Self::BorrowUSDT { amount }
                | Self::RepayUSDT { amount } => amount.encode_size(),

                // AMM
                Self::Swap {
                    amount_in,
                    min_amount_out,
                    is_buying_rng,
                } => {
                    amount_in.encode_size()
                        + min_amount_out.encode_size()
                        + is_buying_rng.encode_size()
                }
                Self::AddLiquidity {
                    rng_amount,
                    usdt_amount,
                } => rng_amount.encode_size() + usdt_amount.encode_size(),
                Self::RemoveLiquidity { shares } => shares.encode_size(),
                Self::CasinoEndTournament { tournament_id } => tournament_id.encode_size(),
            }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Block {
    pub parent: Digest,

    pub view: View,
    pub height: u64,

    pub transactions: Vec<Transaction>,

    digest: Digest,
}

impl Block {
    fn compute_digest(
        parent: &Digest,
        view: View,
        height: u64,
        transactions: &[Transaction],
    ) -> Digest {
        let mut hasher = Sha256::new();
        hasher.update(parent);
        hasher.update(&view.to_be_bytes());
        hasher.update(&height.to_be_bytes());
        for transaction in transactions {
            hasher.update(&transaction.digest());
        }
        hasher.finalize()
    }

    pub fn new(parent: Digest, view: View, height: u64, transactions: Vec<Transaction>) -> Self {
        assert!(transactions.len() <= MAX_BLOCK_TRANSACTIONS);
        let digest = Self::compute_digest(&parent, view, height, &transactions);
        Self {
            parent,
            view,
            height,
            transactions,
            digest,
        }
    }
}

/// The canonical genesis block used by the node.
pub fn genesis_block() -> Block {
    // Use a deterministic, stable parent digest so the genesis commitment is constant.
    // (Digest does not implement Default.)
    let parent = Sha256::hash(b"NULLSPACE_GENESIS");
    Block::new(parent, 0, 0, Vec::new())
}

/// The digest/commitment of the canonical genesis block.
pub fn genesis_digest() -> Digest {
    genesis_block().digest()
}

impl Write for Block {
    fn write(&self, writer: &mut impl BufMut) {
        self.parent.write(writer);
        UInt(self.view).write(writer);
        UInt(self.height).write(writer);
        self.transactions.write(writer);
    }
}

impl Read for Block {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let parent = Digest::read(reader)?;
        let view = UInt::read(reader)?.into();
        let height = UInt::read(reader)?.into();
        let transactions = Vec::<Transaction>::read_cfg(
            reader,
            &(RangeCfg::from(0..=MAX_BLOCK_TRANSACTIONS), ()),
        )?;

        // Pre-compute the digest
        let digest = Self::compute_digest(&parent, view, height, &transactions);
        Ok(Self {
            parent,
            view,
            height,
            transactions,
            digest,
        })
    }
}

impl EncodeSize for Block {
    fn encode_size(&self) -> usize {
        self.parent.encode_size()
            + UInt(self.view).encode_size()
            + UInt(self.height).encode_size()
            + self.transactions.encode_size()
    }
}

impl Digestible for Block {
    type Digest = Digest;

    fn digest(&self) -> Digest {
        self.digest
    }
}

impl Committable for Block {
    type Commitment = Digest;

    fn commitment(&self) -> Digest {
        self.digest
    }
}

impl commonware_consensus::Block for Block {
    fn parent(&self) -> Digest {
        self.parent
    }

    fn height(&self) -> u64 {
        self.height
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Notarized {
    pub proof: CNotarization<MinSig, Digest>,
    pub block: Block,
}

impl Notarized {
    pub fn new(proof: CNotarization<MinSig, Digest>, block: Block) -> Self {
        Self { proof, block }
    }

    pub fn verify(&self, namespace: &[u8], identity: &<MinSig as Variant>::Public) -> bool {
        self.proof.verify(namespace, identity)
    }
}

impl Write for Notarized {
    fn write(&self, buf: &mut impl BufMut) {
        self.proof.write(buf);
        self.block.write(buf);
    }
}

impl Read for Notarized {
    type Cfg = ();

    fn read_cfg(buf: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let proof = CNotarization::<MinSig, Digest>::read(buf)?;
        let block = Block::read(buf)?;

        // Ensure the proof is for the block
        if proof.proposal.payload != block.digest() {
            return Err(Error::Invalid(
                "types::Notarized",
                "Proof payload does not match block digest",
            ));
        }
        Ok(Self { proof, block })
    }
}

impl EncodeSize for Notarized {
    fn encode_size(&self) -> usize {
        self.proof.encode_size() + self.block.encode_size()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finalized {
    pub proof: CFinalization<MinSig, Digest>,
    pub block: Block,
}

impl Finalized {
    pub fn new(proof: CFinalization<MinSig, Digest>, block: Block) -> Self {
        Self { proof, block }
    }

    pub fn verify(&self, namespace: &[u8], identity: &<MinSig as Variant>::Public) -> bool {
        self.proof.verify(namespace, identity)
    }
}

impl Write for Finalized {
    fn write(&self, buf: &mut impl BufMut) {
        self.proof.write(buf);
        self.block.write(buf);
    }
}

impl Read for Finalized {
    type Cfg = ();

    fn read_cfg(buf: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let proof = Finalization::read(buf)?;
        let block = Block::read(buf)?;

        // Ensure the proof is for the block
        if proof.proposal.payload != block.digest() {
            return Err(Error::Invalid(
                "types::Finalized",
                "Proof payload does not match block digest",
            ));
        }
        Ok(Self { proof, block })
    }
}

impl EncodeSize for Finalized {
    fn encode_size(&self) -> usize {
        self.proof.encode_size() + self.block.encode_size()
    }
}

/// The leader for a given seed is determined by the modulo of the seed with the number of participants.
pub fn leader_index(seed: &[u8], participants: usize) -> usize {
    modulo(seed, participants as u64) as usize
}

/// Minimal account structure for transaction nonce tracking.
/// Used for replay protection across all transaction types.
#[derive(Clone, Default, Eq, PartialEq, Debug)]
pub struct Account {
    pub nonce: u64,
}

impl Write for Account {
    fn write(&self, writer: &mut impl BufMut) {
        self.nonce.write(writer);
    }
}

impl Read for Account {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            nonce: u64::read(reader)?,
        })
    }
}

impl EncodeSize for Account {
    fn encode_size(&self) -> usize {
        self.nonce.encode_size()
    }
}

#[derive(Hash, Eq, PartialEq, Ord, PartialOrd, Clone)]
pub enum Key {
    /// Account for nonce tracking (tag 0)
    Account(PublicKey),

    // Casino keys (tags 10-13)
    CasinoPlayer(PublicKey),
    CasinoSession(u64),
    CasinoLeaderboard,
    Tournament(u64),

    // Staking & House keys (tags 14-15)
    House,
    Staker(PublicKey),

    // Virtual Liquidity keys (tags 16-17)
    Vault(PublicKey),
    AmmPool,

    // LP Balance (Tag 18)
    LpBalance(PublicKey),
}

impl Write for Key {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            // Account key (tag 0)
            Self::Account(pk) => {
                0u8.write(writer);
                pk.write(writer);
            }

            // Casino keys (tags 10-13)
            Self::CasinoPlayer(pk) => {
                10u8.write(writer);
                pk.write(writer);
            }
            Self::CasinoSession(id) => {
                11u8.write(writer);
                id.write(writer);
            }
            Self::CasinoLeaderboard => 12u8.write(writer),
            Self::Tournament(id) => {
                13u8.write(writer);
                id.write(writer);
            }

            // Staking & House
            Self::House => 14u8.write(writer),
            Self::Staker(pk) => {
                15u8.write(writer);
                pk.write(writer);
            }

            // Virtual Liquidity
            Self::Vault(pk) => {
                16u8.write(writer);
                pk.write(writer);
            }
            Self::AmmPool => 17u8.write(writer),
            Self::LpBalance(pk) => {
                18u8.write(writer);
                pk.write(writer);
            }
        }
    }
}

impl Read for Key {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let key = match reader.get_u8() {
            // Account key (tag 0)
            0 => Self::Account(PublicKey::read(reader)?),

            // Casino keys (tags 10-13)
            10 => Self::CasinoPlayer(PublicKey::read(reader)?),
            11 => Self::CasinoSession(u64::read(reader)?),
            12 => Self::CasinoLeaderboard,
            13 => Self::Tournament(u64::read(reader)?),

            // Staking & House
            14 => Self::House,
            15 => Self::Staker(PublicKey::read(reader)?),

            // Virtual Liquidity
            16 => Self::Vault(PublicKey::read(reader)?),
            17 => Self::AmmPool,
            18 => Self::LpBalance(PublicKey::read(reader)?),

            i => return Err(Error::InvalidEnum(i)),
        };

        Ok(key)
    }
}

impl EncodeSize for Key {
    fn encode_size(&self) -> usize {
        u8::SIZE
            + match self {
                // Account key
                Self::Account(_) => PublicKey::SIZE,

                // Casino keys
                Self::CasinoPlayer(_) => PublicKey::SIZE,
                Self::CasinoSession(_) => u64::SIZE,
                Self::CasinoLeaderboard => 0,
                Self::Tournament(_) => u64::SIZE,

                // Staking & House
                Self::House => 0,
                Self::Staker(_) => PublicKey::SIZE,

                // Virtual Liquidity
                Self::Vault(_) => PublicKey::SIZE,
                Self::AmmPool => 0,
                Self::LpBalance(_) => PublicKey::SIZE,
            }
    }
}

#[derive(Clone, Eq, PartialEq, Debug)]
#[allow(clippy::large_enum_variant)]
pub enum Value {
    /// Account for nonce tracking (tag 0)
    Account(Account),

    // System values
    Commit {
        height: u64,
        start: u64,
    },

    // Casino values (tags 10-13)
    CasinoPlayer(crate::casino::Player),
    CasinoSession(crate::casino::GameSession),
    CasinoLeaderboard(crate::casino::CasinoLeaderboard),
    Tournament(crate::casino::Tournament),

    // Staking & House values (tags 14-15)
    House(crate::casino::HouseState),
    Staker(crate::casino::Staker),

    // Virtual Liquidity values (tags 16-17)
    Vault(crate::casino::Vault),
    AmmPool(crate::casino::AmmPool),

    // LP Balance (Tag 18)
    LpBalance(u64),
}

impl Write for Value {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            // Account value (tag 0)
            Self::Account(account) => {
                0u8.write(writer);
                account.write(writer);
            }

            // System values
            Self::Commit { height, start } => {
                3u8.write(writer);
                height.write(writer);
                start.write(writer);
            }

            // Casino values (tags 10-13)
            Self::CasinoPlayer(player) => {
                10u8.write(writer);
                player.write(writer);
            }
            Self::CasinoSession(session) => {
                11u8.write(writer);
                session.write(writer);
            }
            Self::CasinoLeaderboard(leaderboard) => {
                12u8.write(writer);
                leaderboard.write(writer);
            }
            Self::Tournament(tournament) => {
                13u8.write(writer);
                tournament.write(writer);
            }

            // Staking & House
            Self::House(house) => {
                14u8.write(writer);
                house.write(writer);
            }
            Self::Staker(staker) => {
                15u8.write(writer);
                staker.write(writer);
            }

            // Virtual Liquidity
            Self::Vault(vault) => {
                16u8.write(writer);
                vault.write(writer);
            }
            Self::AmmPool(pool) => {
                17u8.write(writer);
                pool.write(writer);
            }
            Self::LpBalance(bal) => {
                18u8.write(writer);
                bal.write(writer);
            }
        }
    }
}

impl Read for Value {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let value = match reader.get_u8() {
            // Account value (tag 0)
            0 => Self::Account(Account::read(reader)?),

            // System values
            3 => Self::Commit {
                height: u64::read(reader)?,
                start: u64::read(reader)?,
            },

            // Casino values (tags 10-13)
            10 => Self::CasinoPlayer(crate::casino::Player::read(reader)?),
            11 => Self::CasinoSession(crate::casino::GameSession::read(reader)?),
            12 => Self::CasinoLeaderboard(crate::casino::CasinoLeaderboard::read(reader)?),
            13 => Self::Tournament(crate::casino::Tournament::read(reader)?),

            // Staking & House
            14 => Self::House(crate::casino::HouseState::read(reader)?),
            15 => Self::Staker(crate::casino::Staker::read(reader)?),

            // Virtual Liquidity
            16 => Self::Vault(crate::casino::Vault::read(reader)?),
            17 => Self::AmmPool(crate::casino::AmmPool::read(reader)?),
            18 => Self::LpBalance(u64::read(reader)?),

            i => return Err(Error::InvalidEnum(i)),
        };

        Ok(value)
    }
}

impl EncodeSize for Value {
    fn encode_size(&self) -> usize {
        u8::SIZE
            + match self {
                // Account value
                Self::Account(account) => account.encode_size(),

                // System values
                Self::Commit { height, start } => height.encode_size() + start.encode_size(),

                // Casino values
                Self::CasinoPlayer(player) => player.encode_size(),
                Self::CasinoSession(session) => session.encode_size(),
                Self::CasinoLeaderboard(leaderboard) => leaderboard.encode_size(),
                Self::Tournament(tournament) => tournament.encode_size(),

                // Staking & House
                Self::House(house) => house.encode_size(),
                Self::Staker(staker) => staker.encode_size(),

                // Virtual Liquidity
                Self::Vault(vault) => vault.encode_size(),
                Self::AmmPool(pool) => pool.encode_size(),
                Self::LpBalance(bal) => bal.encode_size(),
            }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(clippy::large_enum_variant)]
pub enum Event {
    // Casino events (tags 20-24)
    CasinoPlayerRegistered {
        player: PublicKey,
        name: String,
    },
    CasinoGameStarted {
        session_id: u64,
        player: PublicKey,
        game_type: crate::casino::GameType,
        bet: u64,
        initial_state: Vec<u8>,
    },
    CasinoGameMoved {
        session_id: u64,
        move_number: u32,
        new_state: Vec<u8>,
    },
    CasinoGameCompleted {
        session_id: u64,
        player: PublicKey,
        game_type: crate::casino::GameType,
        payout: i64,
        final_chips: u64,
        was_shielded: bool,
        was_doubled: bool,
    },
    CasinoLeaderboardUpdated {
        leaderboard: crate::casino::CasinoLeaderboard,
    },

    // Error event (tag 29)
    CasinoError {
        player: PublicKey,
        session_id: Option<u64>,
        error_code: u8,
        message: String,
    },

    // Tournament events (tags 25-28)
    TournamentStarted {
        id: u64,
        start_block: u64,
    },
    PlayerJoined {
        tournament_id: u64,
        player: PublicKey,
    },
    TournamentPhaseChanged {
        id: u64,
        phase: crate::casino::TournamentPhase,
    },
    TournamentEnded {
        id: u64,
        rankings: Vec<(PublicKey, u64)>,
    },

    // Vault & AMM events (tags 30-36)
    VaultCreated {
        player: PublicKey,
    },
    CollateralDeposited {
        player: PublicKey,
        amount: u64,
        new_collateral: u64,
    },
    VusdtBorrowed {
        player: PublicKey,
        amount: u64,
        new_debt: u64,
    },
    VusdtRepaid {
        player: PublicKey,
        amount: u64,
        new_debt: u64,
    },
    AmmSwapped {
        player: PublicKey,
        is_buying_rng: bool,
        amount_in: u64,
        amount_out: u64,
        fee_amount: u64,
        burned_amount: u64,
        reserve_rng: u64,
        reserve_vusdt: u64,
    },
    LiquidityAdded {
        player: PublicKey,
        rng_amount: u64,
        vusdt_amount: u64,
        shares_minted: u64,
        total_shares: u64,
        reserve_rng: u64,
        reserve_vusdt: u64,
        lp_balance: u64,
    },
    LiquidityRemoved {
        player: PublicKey,
        rng_amount: u64,
        vusdt_amount: u64,
        shares_burned: u64,
        total_shares: u64,
        reserve_rng: u64,
        reserve_vusdt: u64,
        lp_balance: u64,
    },

    // Staking events (tags 37-40)
    Staked {
        player: PublicKey,
        amount: u64,
        duration: u64,
        new_balance: u64,
        unlock_ts: u64,
        voting_power: u128,
    },
    Unstaked {
        player: PublicKey,
        amount: u64,
    },
    EpochProcessed {
        epoch: u64,
    },
    RewardsClaimed {
        player: PublicKey,
        amount: u64,
    },
}

impl Write for Event {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            // Casino events (tags 20-24)
            Self::CasinoPlayerRegistered { player, name } => {
                20u8.write(writer);
                player.write(writer);
                (name.len() as u32).write(writer);
                writer.put_slice(name.as_bytes());
            }
            Self::CasinoGameStarted {
                session_id,
                player,
                game_type,
                bet,
                initial_state,
            } => {
                21u8.write(writer);
                session_id.write(writer);
                player.write(writer);
                game_type.write(writer);
                bet.write(writer);
                initial_state.write(writer);
            }
            Self::CasinoGameMoved {
                session_id,
                move_number,
                new_state,
            } => {
                22u8.write(writer);
                session_id.write(writer);
                move_number.write(writer);
                new_state.write(writer);
            }
            Self::CasinoGameCompleted {
                session_id,
                player,
                game_type,
                payout,
                final_chips,
                was_shielded,
                was_doubled,
            } => {
                23u8.write(writer);
                session_id.write(writer);
                player.write(writer);
                game_type.write(writer);
                payout.write(writer);
                final_chips.write(writer);
                was_shielded.write(writer);
                was_doubled.write(writer);
            }
            Self::CasinoLeaderboardUpdated { leaderboard } => {
                24u8.write(writer);
                leaderboard.write(writer);
            }
            Self::CasinoError {
                player,
                session_id,
                error_code,
                message,
            } => {
                29u8.write(writer);
                player.write(writer);
                session_id.write(writer);
                error_code.write(writer);
                (message.len() as u32).write(writer);
                writer.put_slice(message.as_bytes());
            }

            // Tournament events (tags 25-28)
            Self::TournamentStarted { id, start_block } => {
                25u8.write(writer);
                id.write(writer);
                start_block.write(writer);
            }
            Self::PlayerJoined {
                tournament_id,
                player,
            } => {
                26u8.write(writer);
                tournament_id.write(writer);
                player.write(writer);
            }
            Self::TournamentPhaseChanged { id, phase } => {
                27u8.write(writer);
                id.write(writer);
                phase.write(writer);
            }
            Self::TournamentEnded { id, rankings } => {
                28u8.write(writer);
                id.write(writer);
                rankings.write(writer);
            }

            // Vault & AMM events (tags 30-36)
            Self::VaultCreated { player } => {
                30u8.write(writer);
                player.write(writer);
            }
            Self::CollateralDeposited {
                player,
                amount,
                new_collateral,
            } => {
                31u8.write(writer);
                player.write(writer);
                amount.write(writer);
                new_collateral.write(writer);
            }
            Self::VusdtBorrowed {
                player,
                amount,
                new_debt,
            } => {
                32u8.write(writer);
                player.write(writer);
                amount.write(writer);
                new_debt.write(writer);
            }
            Self::VusdtRepaid {
                player,
                amount,
                new_debt,
            } => {
                33u8.write(writer);
                player.write(writer);
                amount.write(writer);
                new_debt.write(writer);
            }
            Self::AmmSwapped {
                player,
                is_buying_rng,
                amount_in,
                amount_out,
                fee_amount,
                burned_amount,
                reserve_rng,
                reserve_vusdt,
            } => {
                34u8.write(writer);
                player.write(writer);
                is_buying_rng.write(writer);
                amount_in.write(writer);
                amount_out.write(writer);
                fee_amount.write(writer);
                burned_amount.write(writer);
                reserve_rng.write(writer);
                reserve_vusdt.write(writer);
            }
            Self::LiquidityAdded {
                player,
                rng_amount,
                vusdt_amount,
                shares_minted,
                total_shares,
                reserve_rng,
                reserve_vusdt,
                lp_balance,
            } => {
                35u8.write(writer);
                player.write(writer);
                rng_amount.write(writer);
                vusdt_amount.write(writer);
                shares_minted.write(writer);
                total_shares.write(writer);
                reserve_rng.write(writer);
                reserve_vusdt.write(writer);
                lp_balance.write(writer);
            }
            Self::LiquidityRemoved {
                player,
                rng_amount,
                vusdt_amount,
                shares_burned,
                total_shares,
                reserve_rng,
                reserve_vusdt,
                lp_balance,
            } => {
                36u8.write(writer);
                player.write(writer);
                rng_amount.write(writer);
                vusdt_amount.write(writer);
                shares_burned.write(writer);
                total_shares.write(writer);
                reserve_rng.write(writer);
                reserve_vusdt.write(writer);
                lp_balance.write(writer);
            }

            // Staking events (tags 37-40)
            Self::Staked {
                player,
                amount,
                duration,
                new_balance,
                unlock_ts,
                voting_power,
            } => {
                37u8.write(writer);
                player.write(writer);
                amount.write(writer);
                duration.write(writer);
                new_balance.write(writer);
                unlock_ts.write(writer);
                voting_power.write(writer);
            }
            Self::Unstaked { player, amount } => {
                38u8.write(writer);
                player.write(writer);
                amount.write(writer);
            }
            Self::EpochProcessed { epoch } => {
                39u8.write(writer);
                epoch.write(writer);
            }
            Self::RewardsClaimed { player, amount } => {
                40u8.write(writer);
                player.write(writer);
                amount.write(writer);
            }
        }
    }
}

impl Read for Event {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let event = match reader.get_u8() {
            // Casino events (tags 20-24)
            20 => {
                let player = PublicKey::read(reader)?;
                let name_len = u32::read(reader)? as usize;
                if name_len > CASINO_MAX_NAME_LENGTH {
                    return Err(Error::Invalid("Event", "casino name too long"));
                }
                if reader.remaining() < name_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut name_bytes = vec![0u8; name_len];
                reader.copy_to_slice(&mut name_bytes);
                let name = String::from_utf8(name_bytes)
                    .map_err(|_| Error::Invalid("Event", "invalid UTF-8 in casino name"))?;
                Self::CasinoPlayerRegistered { player, name }
            }
            21 => Self::CasinoGameStarted {
                session_id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
                game_type: crate::casino::GameType::read(reader)?,
                bet: u64::read(reader)?,
                initial_state: Vec::<u8>::read_range(reader, 0..=1024)?,
            },
            22 => Self::CasinoGameMoved {
                session_id: u64::read(reader)?,
                move_number: u32::read(reader)?,
                new_state: Vec::<u8>::read_range(reader, 0..=1024)?,
            },
            23 => Self::CasinoGameCompleted {
                session_id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
                game_type: crate::casino::GameType::read(reader)?,
                payout: i64::read(reader)?,
                final_chips: u64::read(reader)?,
                was_shielded: bool::read(reader)?,
                was_doubled: bool::read(reader)?,
            },
            24 => Self::CasinoLeaderboardUpdated {
                leaderboard: crate::casino::CasinoLeaderboard::read(reader)?,
            },
            29 => {
                let player = PublicKey::read(reader)?;
                let session_id = Option::<u64>::read(reader)?;
                let error_code = u8::read(reader)?;
                let message_len = u32::read(reader)? as usize;
                const MAX_ERROR_MESSAGE_LENGTH: usize = 256;
                if message_len > MAX_ERROR_MESSAGE_LENGTH {
                    return Err(Error::Invalid("Event", "error message too long"));
                }
                if reader.remaining() < message_len {
                    return Err(Error::EndOfBuffer);
                }
                let mut message_bytes = vec![0u8; message_len];
                reader.copy_to_slice(&mut message_bytes);
                let message = String::from_utf8(message_bytes)
                    .map_err(|_| Error::Invalid("Event", "invalid UTF-8 in error message"))?;
                Self::CasinoError {
                    player,
                    session_id,
                    error_code,
                    message,
                }
            }

            // Tournament events (tags 25-28)
            25 => Self::TournamentStarted {
                id: u64::read(reader)?,
                start_block: u64::read(reader)?,
            },
            26 => Self::PlayerJoined {
                tournament_id: u64::read(reader)?,
                player: PublicKey::read(reader)?,
            },
            27 => Self::TournamentPhaseChanged {
                id: u64::read(reader)?,
                phase: crate::casino::TournamentPhase::read(reader)?,
            },
            28 => Self::TournamentEnded {
                id: u64::read(reader)?,
                rankings: Vec::<(PublicKey, u64)>::read_range(reader, 0..=1000)?,
            },

            // Vault & AMM events (tags 30-36)
            30 => Self::VaultCreated {
                player: PublicKey::read(reader)?,
            },
            31 => Self::CollateralDeposited {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_collateral: u64::read(reader)?,
            },
            32 => Self::VusdtBorrowed {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_debt: u64::read(reader)?,
            },
            33 => Self::VusdtRepaid {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                new_debt: u64::read(reader)?,
            },
            34 => Self::AmmSwapped {
                player: PublicKey::read(reader)?,
                is_buying_rng: bool::read(reader)?,
                amount_in: u64::read(reader)?,
                amount_out: u64::read(reader)?,
                fee_amount: u64::read(reader)?,
                burned_amount: u64::read(reader)?,
                reserve_rng: u64::read(reader)?,
                reserve_vusdt: u64::read(reader)?,
            },
            35 => Self::LiquidityAdded {
                player: PublicKey::read(reader)?,
                rng_amount: u64::read(reader)?,
                vusdt_amount: u64::read(reader)?,
                shares_minted: u64::read(reader)?,
                total_shares: u64::read(reader)?,
                reserve_rng: u64::read(reader)?,
                reserve_vusdt: u64::read(reader)?,
                lp_balance: u64::read(reader)?,
            },
            36 => Self::LiquidityRemoved {
                player: PublicKey::read(reader)?,
                rng_amount: u64::read(reader)?,
                vusdt_amount: u64::read(reader)?,
                shares_burned: u64::read(reader)?,
                total_shares: u64::read(reader)?,
                reserve_rng: u64::read(reader)?,
                reserve_vusdt: u64::read(reader)?,
                lp_balance: u64::read(reader)?,
            },
            37 => Self::Staked {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
                duration: u64::read(reader)?,
                new_balance: u64::read(reader)?,
                unlock_ts: u64::read(reader)?,
                voting_power: u128::read(reader)?,
            },
            38 => Self::Unstaked {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
            },
            39 => Self::EpochProcessed {
                epoch: u64::read(reader)?,
            },
            40 => Self::RewardsClaimed {
                player: PublicKey::read(reader)?,
                amount: u64::read(reader)?,
            },

            i => return Err(Error::InvalidEnum(i)),
        };

        Ok(event)
    }
}

impl EncodeSize for Event {
    fn encode_size(&self) -> usize {
        u8::SIZE
            + match self {
                // Casino events (tags 20-24)
                Self::CasinoPlayerRegistered { player, name } => {
                    player.encode_size() + 4 + name.len()
                }
                Self::CasinoGameStarted {
                    session_id,
                    player,
                    game_type,
                    bet,
                    initial_state,
                } => {
                    session_id.encode_size()
                        + player.encode_size()
                        + game_type.encode_size()
                        + bet.encode_size()
                        + initial_state.encode_size()
                }
                Self::CasinoGameMoved {
                    session_id,
                    move_number,
                    new_state,
                } => session_id.encode_size() + move_number.encode_size() + new_state.encode_size(),
                Self::CasinoGameCompleted {
                    session_id,
                    player,
                    game_type,
                    payout,
                    final_chips,
                    was_shielded,
                    was_doubled,
                } => {
                    session_id.encode_size()
                        + player.encode_size()
                        + game_type.encode_size()
                        + payout.encode_size()
                        + final_chips.encode_size()
                        + was_shielded.encode_size()
                        + was_doubled.encode_size()
                }
                Self::CasinoLeaderboardUpdated { leaderboard } => leaderboard.encode_size(),
                Self::CasinoError {
                    player,
                    session_id,
                    error_code,
                    message,
                } => {
                    player.encode_size()
                        + session_id.encode_size()
                        + error_code.encode_size()
                        + 4
                        + message.len()
                }

                // Tournament events (tags 25-28)
                Self::TournamentStarted { id, start_block } => {
                    id.encode_size() + start_block.encode_size()
                }
                Self::PlayerJoined {
                    tournament_id,
                    player,
                } => tournament_id.encode_size() + player.encode_size(),
                Self::TournamentPhaseChanged { id, phase } => {
                    id.encode_size() + phase.encode_size()
                }
                Self::TournamentEnded { id, rankings } => id.encode_size() + rankings.encode_size(),

                // Vault & AMM events (tags 30-36)
                Self::VaultCreated { player } => player.encode_size(),
                Self::CollateralDeposited {
                    player,
                    amount,
                    new_collateral,
                } => player.encode_size() + amount.encode_size() + new_collateral.encode_size(),
                Self::VusdtBorrowed {
                    player,
                    amount,
                    new_debt,
                } => player.encode_size() + amount.encode_size() + new_debt.encode_size(),
                Self::VusdtRepaid {
                    player,
                    amount,
                    new_debt,
                } => player.encode_size() + amount.encode_size() + new_debt.encode_size(),
                Self::AmmSwapped {
                    player,
                    is_buying_rng,
                    amount_in,
                    amount_out,
                    fee_amount,
                    burned_amount,
                    reserve_rng,
                    reserve_vusdt,
                } => {
                    player.encode_size()
                        + is_buying_rng.encode_size()
                        + amount_in.encode_size()
                        + amount_out.encode_size()
                        + fee_amount.encode_size()
                        + burned_amount.encode_size()
                        + reserve_rng.encode_size()
                        + reserve_vusdt.encode_size()
                }
                Self::LiquidityAdded {
                    player,
                    rng_amount,
                    vusdt_amount,
                    shares_minted,
                    total_shares,
                    reserve_rng,
                    reserve_vusdt,
                    lp_balance,
                } => {
                    player.encode_size()
                        + rng_amount.encode_size()
                        + vusdt_amount.encode_size()
                        + shares_minted.encode_size()
                        + total_shares.encode_size()
                        + reserve_rng.encode_size()
                        + reserve_vusdt.encode_size()
                        + lp_balance.encode_size()
                }
                Self::LiquidityRemoved {
                    player,
                    rng_amount,
                    vusdt_amount,
                    shares_burned,
                    total_shares,
                    reserve_rng,
                    reserve_vusdt,
                    lp_balance,
                } => {
                    player.encode_size()
                        + rng_amount.encode_size()
                        + vusdt_amount.encode_size()
                        + shares_burned.encode_size()
                        + total_shares.encode_size()
                        + reserve_rng.encode_size()
                        + reserve_vusdt.encode_size()
                        + lp_balance.encode_size()
                }
                Self::Staked {
                    player,
                    amount,
                    duration,
                    new_balance,
                    unlock_ts,
                    voting_power,
                } => {
                    player.encode_size()
                        + amount.encode_size()
                        + duration.encode_size()
                        + new_balance.encode_size()
                        + unlock_ts.encode_size()
                        + voting_power.encode_size()
                }
                Self::Unstaked { player, amount } => player.encode_size() + amount.encode_size(),
                Self::EpochProcessed { epoch } => epoch.encode_size(),
                Self::RewardsClaimed { player, amount } => player.encode_size() + amount.encode_size(),
            }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Output {
    Event(Event),
    Transaction(Transaction),
    Commit { height: u64, start: u64 },
}

impl Write for Output {
    fn write(&self, writer: &mut impl BufMut) {
        match self {
            Self::Event(event) => {
                0u8.write(writer);
                event.write(writer);
            }
            Self::Transaction(transaction) => {
                1u8.write(writer);
                transaction.write(writer);
            }
            Self::Commit { height, start } => {
                2u8.write(writer);
                height.write(writer);
                start.write(writer);
            }
        }
    }
}

impl Read for Output {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        let kind = u8::read(reader)?;
        match kind {
            0 => Ok(Self::Event(Event::read(reader)?)),
            1 => Ok(Self::Transaction(Transaction::read(reader)?)),
            2 => Ok(Self::Commit {
                height: u64::read(reader)?,
                start: u64::read(reader)?,
            }),
            _ => Err(Error::InvalidEnum(kind)),
        }
    }
}

impl EncodeSize for Output {
    fn encode_size(&self) -> usize {
        1 + match self {
            Self::Event(event) => event.encode_size(),
            Self::Transaction(transaction) => transaction.encode_size(),
            Self::Commit { height, start } => height.encode_size() + start.encode_size(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Progress {
    pub view: View,
    pub height: u64,
    pub block_digest: Digest,
    pub state_root: Digest,
    pub state_start_op: u64,
    pub state_end_op: u64,
    pub events_root: Digest,
    pub events_start_op: u64,
    pub events_end_op: u64,
}

impl Progress {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        view: View,
        height: u64,
        block_digest: Digest,
        state_root: Digest,
        state_start_op: u64,
        state_end_op: u64,
        events_root: Digest,
        events_start_op: u64,
        events_end_op: u64,
    ) -> Self {
        Self {
            view,
            height,
            block_digest,
            state_root,
            state_start_op,
            state_end_op,
            events_root,
            events_start_op,
            events_end_op,
        }
    }
}

impl Write for Progress {
    fn write(&self, writer: &mut impl BufMut) {
        self.view.write(writer);
        self.height.write(writer);
        self.block_digest.write(writer);
        self.state_root.write(writer);
        self.state_start_op.write(writer);
        self.state_end_op.write(writer);
        self.events_root.write(writer);
        self.events_start_op.write(writer);
        self.events_end_op.write(writer);
    }
}

impl Read for Progress {
    type Cfg = ();

    fn read_cfg(reader: &mut impl Buf, _: &Self::Cfg) -> Result<Self, Error> {
        Ok(Self {
            view: View::read(reader)?,
            height: u64::read(reader)?,
            block_digest: Digest::read(reader)?,
            state_root: Digest::read(reader)?,
            state_start_op: u64::read(reader)?,
            state_end_op: u64::read(reader)?,
            events_root: Digest::read(reader)?,
            events_start_op: u64::read(reader)?,
            events_end_op: u64::read(reader)?,
        })
    }
}

impl FixedSize for Progress {
    const SIZE: usize = View::SIZE
        + u64::SIZE
        + Digest::SIZE
        + Digest::SIZE
        + u64::SIZE
        + u64::SIZE
        + Digest::SIZE
        + u64::SIZE
        + u64::SIZE;
}

impl Digestible for Progress {
    type Digest = Digest;

    fn digest(&self) -> Digest {
        Sha256::hash(&self.encode())
    }
}
