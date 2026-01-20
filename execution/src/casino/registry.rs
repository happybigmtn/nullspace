//! Game registry for managing available games and their configurations.
//!
//! The registry provides:
//! - Centralized listing of supported games
//! - Per-game configuration with defaults and variants
//! - Active/inactive game filtering
//! - Metadata for UI display (names, descriptions, categories)
//!
//! # Example
//! ```rust,ignore
//! use nullspace_execution::casino::registry::{GameRegistry, GameInfo};
//! use nullspace_types::casino::GameType;
//!
//! let registry = GameRegistry::default();
//! assert!(registry.is_active(GameType::Blackjack));
//! let info = registry.get_info(GameType::Blackjack).unwrap();
//! assert_eq!(info.name, "Blackjack");
//! ```

use nullspace_types::casino::GameType;
use std::collections::HashMap;

/// Per-game configuration values.
///
/// Each variant holds the game-specific rules that can be customized.
/// All variants implement `Default` to provide standard casino configurations.
#[derive(Clone, Debug, PartialEq)]
pub enum GameConfig {
    /// Baccarat configuration.
    Baccarat(BaccaratConfig),
    /// Blackjack configuration.
    Blackjack(BlackjackConfig),
    /// Casino War configuration.
    CasinoWar(CasinoWarConfig),
    /// Craps configuration.
    Craps(CrapsConfig),
    /// HiLo configuration.
    HiLo(HiLoConfig),
    /// Roulette configuration.
    Roulette(RouletteConfig),
    /// Sic Bo configuration.
    SicBo(SicBoConfig),
    /// Three Card Poker configuration.
    ThreeCard(ThreeCardConfig),
    /// Ultimate Texas Hold'em configuration.
    UltimateHoldem(UltimateHoldemConfig),
    /// Video Poker configuration.
    VideoPoker(VideoPokerConfig),
}

impl GameConfig {
    /// Create a default configuration for a game type.
    pub fn default_for(game_type: GameType) -> Self {
        match game_type {
            GameType::Baccarat => Self::Baccarat(BaccaratConfig::default()),
            GameType::Blackjack => Self::Blackjack(BlackjackConfig::default()),
            GameType::CasinoWar => Self::CasinoWar(CasinoWarConfig::default()),
            GameType::Craps => Self::Craps(CrapsConfig::default()),
            GameType::HiLo => Self::HiLo(HiLoConfig::default()),
            GameType::Roulette => Self::Roulette(RouletteConfig::default()),
            GameType::SicBo => Self::SicBo(SicBoConfig::default()),
            GameType::ThreeCard => Self::ThreeCard(ThreeCardConfig::default()),
            GameType::UltimateHoldem => Self::UltimateHoldem(UltimateHoldemConfig::default()),
            GameType::VideoPoker => Self::VideoPoker(VideoPokerConfig::default()),
        }
    }

    /// Get the game type for this configuration.
    pub fn game_type(&self) -> GameType {
        match self {
            Self::Baccarat(_) => GameType::Baccarat,
            Self::Blackjack(_) => GameType::Blackjack,
            Self::CasinoWar(_) => GameType::CasinoWar,
            Self::Craps(_) => GameType::Craps,
            Self::HiLo(_) => GameType::HiLo,
            Self::Roulette(_) => GameType::Roulette,
            Self::SicBo(_) => GameType::SicBo,
            Self::ThreeCard(_) => GameType::ThreeCard,
            Self::UltimateHoldem(_) => GameType::UltimateHoldem,
            Self::VideoPoker(_) => GameType::VideoPoker,
        }
    }

    /// Encode configuration to bytes for state storage.
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            Self::Baccarat(c) => c.to_bytes(),
            Self::Blackjack(c) => c.to_bytes(),
            Self::CasinoWar(c) => c.to_bytes(),
            Self::Craps(c) => c.to_bytes(),
            Self::HiLo(c) => c.to_bytes(),
            Self::Roulette(c) => c.to_bytes(),
            Self::SicBo(c) => c.to_bytes(),
            Self::ThreeCard(c) => c.to_bytes(),
            Self::UltimateHoldem(c) => c.to_bytes(),
            Self::VideoPoker(c) => c.to_bytes(),
        }
    }

    /// Decode configuration from bytes.
    pub fn from_bytes(game_type: GameType, bytes: &[u8]) -> Option<Self> {
        match game_type {
            GameType::Baccarat => BaccaratConfig::from_bytes(bytes).map(Self::Baccarat),
            GameType::Blackjack => BlackjackConfig::from_bytes(bytes).map(Self::Blackjack),
            GameType::CasinoWar => CasinoWarConfig::from_bytes(bytes).map(Self::CasinoWar),
            GameType::Craps => CrapsConfig::from_bytes(bytes).map(Self::Craps),
            GameType::HiLo => HiLoConfig::from_bytes(bytes).map(Self::HiLo),
            GameType::Roulette => RouletteConfig::from_bytes(bytes).map(Self::Roulette),
            GameType::SicBo => SicBoConfig::from_bytes(bytes).map(Self::SicBo),
            GameType::ThreeCard => ThreeCardConfig::from_bytes(bytes).map(Self::ThreeCard),
            GameType::UltimateHoldem => {
                UltimateHoldemConfig::from_bytes(bytes).map(Self::UltimateHoldem)
            }
            GameType::VideoPoker => VideoPokerConfig::from_bytes(bytes).map(Self::VideoPoker),
        }
    }
}

// ============================================================================
// Per-game configuration structs
// ============================================================================

/// Baccarat configuration.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BaccaratConfig {
    /// Number of decks in the shoe (6 or 8).
    pub decks: u8,
    /// Commission percentage on banker wins (typically 5%).
    pub banker_commission_pct: u8,
}

impl BaccaratConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        vec![self.decks, self.banker_commission_pct]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 2 {
            return Some(Self::default());
        }
        Some(Self {
            decks: bytes[0],
            banker_commission_pct: bytes[1],
        })
    }
}

/// Blackjack configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlackjackConfig {
    /// Dealer hits on soft 17.
    pub dealer_hits_soft_17: bool,
    /// Blackjack pays 6:5 instead of 3:2.
    pub blackjack_pays_six_five: bool,
    /// Late surrender allowed.
    pub late_surrender: bool,
    /// Double after split allowed.
    pub double_after_split: bool,
    /// Maximum number of splits.
    pub max_splits: u8,
    /// Resplit aces allowed.
    pub resplit_aces: bool,
    /// Hit split aces allowed.
    pub hit_split_aces: bool,
    /// Number of decks (1, 2, 4, 6, or 8).
    pub decks: u8,
}

impl Default for BlackjackConfig {
    fn default() -> Self {
        Self {
            dealer_hits_soft_17: true,
            blackjack_pays_six_five: false,
            late_surrender: false,
            double_after_split: true,
            max_splits: 3,
            resplit_aces: false,
            hit_split_aces: false,
            decks: 6,
        }
    }
}

impl BlackjackConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        let flags: u8 = (self.dealer_hits_soft_17 as u8)
            | ((self.blackjack_pays_six_five as u8) << 1)
            | ((self.late_surrender as u8) << 2)
            | ((self.double_after_split as u8) << 3)
            | ((self.resplit_aces as u8) << 4)
            | ((self.hit_split_aces as u8) << 5);
        vec![flags, self.max_splits, self.decks]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 3 {
            return Some(Self::default());
        }
        let flags = bytes[0];
        Some(Self {
            dealer_hits_soft_17: flags & 0x01 != 0,
            blackjack_pays_six_five: flags & 0x02 != 0,
            late_surrender: flags & 0x04 != 0,
            double_after_split: flags & 0x08 != 0,
            resplit_aces: flags & 0x10 != 0,
            hit_split_aces: flags & 0x20 != 0,
            max_splits: bytes[1],
            decks: bytes[2],
        })
    }
}

/// Casino War configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CasinoWarConfig {
    /// Tie bet payout multiplier (typically 10:1).
    pub tie_bet_payout: u8,
    /// Bonus for winning war after tie.
    pub tie_after_tie_bonus: bool,
}

impl Default for CasinoWarConfig {
    fn default() -> Self {
        Self {
            tie_bet_payout: 10,
            tie_after_tie_bonus: true,
        }
    }
}

impl CasinoWarConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        vec![self.tie_bet_payout, self.tie_after_tie_bonus as u8]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 2 {
            return Some(Self::default());
        }
        Some(Self {
            tie_bet_payout: bytes[0],
            tie_after_tie_bonus: bytes[1] != 0,
        })
    }
}

/// Craps configuration.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CrapsConfig {
    /// Maximum odds multiplier allowed (e.g., 3x-4x-5x, 10x, or 100x).
    pub max_odds: u8,
    /// Whether field pays 3:1 on 12 (true) or 2:1 (false).
    pub field_triple_twelve: bool,
}

impl CrapsConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        vec![self.max_odds, self.field_triple_twelve as u8]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 2 {
            return Some(Self::default());
        }
        Some(Self {
            max_odds: bytes[0],
            field_triple_twelve: bytes[1] != 0,
        })
    }
}

/// HiLo configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HiLoConfig {
    /// Allow "Same" as any bet.
    pub allow_same_any: bool,
    /// Ties push (return bet) vs lose.
    pub tie_push: bool,
}

impl Default for HiLoConfig {
    fn default() -> Self {
        Self {
            allow_same_any: false,
            tie_push: true,
        }
    }
}

impl HiLoConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        vec![self.allow_same_any as u8, self.tie_push as u8]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 2 {
            return Some(Self::default());
        }
        Some(Self {
            allow_same_any: bytes[0] != 0,
            tie_push: bytes[1] != 0,
        })
    }
}

/// Roulette wheel variant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum RouletteVariant {
    /// European single-zero wheel (2.7% house edge).
    #[default]
    European = 0,
    /// European with La Partage rule (1.35% on even-money bets).
    LaPartage = 1,
    /// European with En Prison rule (1.35% on even-money bets).
    EnPrison = 2,
    /// European with Double En Prison rule.
    EnPrisonDouble = 3,
    /// American double-zero wheel (5.26% house edge).
    American = 4,
}

impl RouletteVariant {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::European),
            1 => Some(Self::LaPartage),
            2 => Some(Self::EnPrison),
            3 => Some(Self::EnPrisonDouble),
            4 => Some(Self::American),
            _ => None,
        }
    }
}

/// Roulette configuration.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RouletteConfig {
    /// Wheel variant (European, American, etc.).
    pub variant: RouletteVariant,
}

impl RouletteConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        vec![self.variant as u8]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            return Some(Self::default());
        }
        Some(Self {
            variant: RouletteVariant::from_u8(bytes[0]).unwrap_or_default(),
        })
    }
}

/// Sic Bo paytable variant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum SicBoPaytable {
    /// Standard Macau paytable.
    #[default]
    Standard = 0,
    /// Vegas paytable with different odds.
    Vegas = 1,
}

impl SicBoPaytable {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Standard),
            1 => Some(Self::Vegas),
            _ => None,
        }
    }
}

/// Sic Bo configuration.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SicBoConfig {
    /// Paytable variant.
    pub paytable: SicBoPaytable,
}

impl SicBoConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        vec![self.paytable as u8]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            return Some(Self::default());
        }
        Some(Self {
            paytable: SicBoPaytable::from_u8(bytes[0]).unwrap_or_default(),
        })
    }
}

/// Three Card Poker configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThreeCardConfig {
    /// Ante bonus paytable (affects payouts for strong hands).
    pub ante_bonus_paytable: u8,
    /// Pair Plus paytable variant.
    pub pair_plus_paytable: u8,
    /// 6-card bonus enabled.
    pub six_card_bonus: bool,
}

impl Default for ThreeCardConfig {
    fn default() -> Self {
        Self {
            ante_bonus_paytable: 0,
            pair_plus_paytable: 0,
            six_card_bonus: false,
        }
    }
}

impl ThreeCardConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        vec![
            self.ante_bonus_paytable,
            self.pair_plus_paytable,
            self.six_card_bonus as u8,
        ]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 3 {
            return Some(Self::default());
        }
        Some(Self {
            ante_bonus_paytable: bytes[0],
            pair_plus_paytable: bytes[1],
            six_card_bonus: bytes[2] != 0,
        })
    }
}

/// Ultimate Texas Hold'em configuration.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UltimateHoldemConfig {
    /// Dealer qualification (pair or better required to qualify).
    pub dealer_qualification: bool,
    /// Allow 3x pre-flop raise.
    pub allow_preflop_3x: bool,
    /// Allow 4x pre-flop raise.
    pub allow_preflop_4x: bool,
}

impl Default for UltimateHoldemConfig {
    fn default() -> Self {
        Self {
            dealer_qualification: true,
            allow_preflop_3x: true,
            allow_preflop_4x: true,
        }
    }
}

impl UltimateHoldemConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        let flags: u8 = (self.dealer_qualification as u8)
            | ((self.allow_preflop_3x as u8) << 1)
            | ((self.allow_preflop_4x as u8) << 2);
        vec![flags]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            return Some(Self::default());
        }
        let flags = bytes[0];
        Some(Self {
            dealer_qualification: flags & 0x01 != 0,
            allow_preflop_3x: flags & 0x02 != 0,
            allow_preflop_4x: flags & 0x04 != 0,
        })
    }
}

/// Video Poker variant.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[repr(u8)]
pub enum VideoPokerVariant {
    /// Jacks or Better (standard).
    #[default]
    JacksOrBetter = 0,
    /// Deuces Wild.
    DeucesWild = 1,
    /// Bonus Poker.
    BonusPoker = 2,
    /// Double Bonus Poker.
    DoubleBonusPoker = 3,
}

impl VideoPokerVariant {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::JacksOrBetter),
            1 => Some(Self::DeucesWild),
            2 => Some(Self::BonusPoker),
            3 => Some(Self::DoubleBonusPoker),
            _ => None,
        }
    }
}

/// Video Poker configuration.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct VideoPokerConfig {
    /// Game variant.
    pub variant: VideoPokerVariant,
    /// Paytable (affects royal flush, straight flush, etc. payouts).
    pub paytable: u8,
}

impl VideoPokerConfig {
    pub fn to_bytes(&self) -> Vec<u8> {
        vec![self.variant as u8, self.paytable]
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        if bytes.len() < 2 {
            return Some(Self::default());
        }
        Some(Self {
            variant: VideoPokerVariant::from_u8(bytes[0]).unwrap_or_default(),
            paytable: bytes[1],
        })
    }
}

// ============================================================================
// Game metadata
// ============================================================================

/// Game category for UI organization.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GameCategory {
    /// Card games (Blackjack, Baccarat, etc.).
    Cards,
    /// Table games (Craps, Roulette, Sic Bo).
    Table,
    /// Poker variants (Video Poker, Three Card, UTH).
    Poker,
}

/// Metadata about a game for UI display.
#[derive(Clone, Debug)]
pub struct GameInfo {
    /// Game type identifier.
    pub game_type: GameType,
    /// Display name.
    pub name: &'static str,
    /// Short description.
    pub description: &'static str,
    /// Category for UI grouping.
    pub category: GameCategory,
    /// Minimum bet (in chips).
    pub min_bet: u64,
    /// Maximum bet (in chips).
    pub max_bet: u64,
    /// Typical house edge (as basis points, e.g., 50 = 0.50%).
    pub house_edge_bps: u16,
    /// Whether the game is currently active.
    pub active: bool,
}

impl GameInfo {
    const fn new(
        game_type: GameType,
        name: &'static str,
        description: &'static str,
        category: GameCategory,
        min_bet: u64,
        max_bet: u64,
        house_edge_bps: u16,
    ) -> Self {
        Self {
            game_type,
            name,
            description,
            category,
            min_bet,
            max_bet,
            house_edge_bps,
            active: true,
        }
    }
}

// ============================================================================
// Game registry
// ============================================================================

/// Registry of available games and their configurations.
///
/// The registry maintains:
/// - Static game metadata (names, descriptions, categories)
/// - Per-game configurations (can be customized at runtime)
/// - Active/inactive status for each game
#[derive(Clone, Debug)]
pub struct GameRegistry {
    configs: HashMap<GameType, GameConfig>,
    active: HashMap<GameType, bool>,
}

impl Default for GameRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl GameRegistry {
    /// Create a new registry with all games using default configurations.
    pub fn new() -> Self {
        let mut configs = HashMap::new();
        let mut active = HashMap::new();

        for &game_type in Self::all_game_types() {
            configs.insert(game_type, GameConfig::default_for(game_type));
            active.insert(game_type, true);
        }

        Self { configs, active }
    }

    /// List all supported game types.
    pub fn all_game_types() -> &'static [GameType] {
        &[
            GameType::Baccarat,
            GameType::Blackjack,
            GameType::CasinoWar,
            GameType::Craps,
            GameType::HiLo,
            GameType::Roulette,
            GameType::SicBo,
            GameType::ThreeCard,
            GameType::UltimateHoldem,
            GameType::VideoPoker,
        ]
    }

    /// Get static metadata for a game type.
    pub fn get_info(game_type: GameType) -> GameInfo {
        match game_type {
            GameType::Baccarat => GameInfo::new(
                GameType::Baccarat,
                "Baccarat",
                "Classic card comparison game. Bet on Player, Banker, or Tie.",
                GameCategory::Cards,
                1,
                10_000,
                106, // 1.06% on Banker
            ),
            GameType::Blackjack => GameInfo::new(
                GameType::Blackjack,
                "Blackjack",
                "Beat the dealer to 21 without going bust.",
                GameCategory::Cards,
                1,
                5_000,
                50, // 0.50% with basic strategy
            ),
            GameType::CasinoWar => GameInfo::new(
                GameType::CasinoWar,
                "Casino War",
                "Simple high-card game against the dealer.",
                GameCategory::Cards,
                1,
                5_000,
                229, // 2.29%
            ),
            GameType::Craps => GameInfo::new(
                GameType::Craps,
                "Craps",
                "Dice game with multiple betting options.",
                GameCategory::Table,
                1,
                10_000,
                141, // 1.41% on pass line
            ),
            GameType::HiLo => GameInfo::new(
                GameType::HiLo,
                "Hi-Lo",
                "Predict if the next card is higher or lower.",
                GameCategory::Cards,
                1,
                1_000,
                300, // ~3.00% varies by card
            ),
            GameType::Roulette => GameInfo::new(
                GameType::Roulette,
                "Roulette",
                "Spin the wheel and bet on numbers or colors.",
                GameCategory::Table,
                1,
                10_000,
                270, // 2.70% European
            ),
            GameType::SicBo => GameInfo::new(
                GameType::SicBo,
                "Sic Bo",
                "Ancient Chinese dice game with multiple bets.",
                GameCategory::Table,
                1,
                5_000,
                278, // 2.78% on Small/Big
            ),
            GameType::ThreeCard => GameInfo::new(
                GameType::ThreeCard,
                "Three Card Poker",
                "Fast-paced poker variant with Ante and Pair Plus bets.",
                GameCategory::Poker,
                1,
                5_000,
                336, // 3.36% on Ante
            ),
            GameType::UltimateHoldem => GameInfo::new(
                GameType::UltimateHoldem,
                "Ultimate Texas Hold'em",
                "Texas Hold'em against the dealer with multiple raise options.",
                GameCategory::Poker,
                1,
                5_000,
                218, // 2.18%
            ),
            GameType::VideoPoker => GameInfo::new(
                GameType::VideoPoker,
                "Video Poker",
                "Draw poker with paytable-based payouts.",
                GameCategory::Poker,
                1,
                1_000,
                46, // 0.46% Jacks or Better 9/6
            ),
        }
    }

    /// Check if a game is active.
    pub fn is_active(&self, game_type: GameType) -> bool {
        self.active.get(&game_type).copied().unwrap_or(false)
    }

    /// Set a game's active status.
    pub fn set_active(&mut self, game_type: GameType, active: bool) {
        self.active.insert(game_type, active);
    }

    /// Get all active games.
    pub fn active_games(&self) -> Vec<GameType> {
        Self::all_game_types()
            .iter()
            .copied()
            .filter(|gt| self.is_active(*gt))
            .collect()
    }

    /// Get configuration for a game.
    pub fn get_config(&self, game_type: GameType) -> Option<&GameConfig> {
        self.configs.get(&game_type)
    }

    /// Set configuration for a game.
    pub fn set_config(&mut self, config: GameConfig) {
        let game_type = config.game_type();
        self.configs.insert(game_type, config);
    }

    /// Get all game info with current active status.
    pub fn all_games_info(&self) -> Vec<GameInfo> {
        Self::all_game_types()
            .iter()
            .map(|&gt| {
                let mut info = Self::get_info(gt);
                info.active = self.is_active(gt);
                info
            })
            .collect()
    }

    /// Get games by category.
    pub fn games_by_category(&self, category: GameCategory) -> Vec<GameType> {
        Self::all_game_types()
            .iter()
            .copied()
            .filter(|&gt| Self::get_info(gt).category == category)
            .collect()
    }

    /// Load configuration from bytes (for persistence).
    pub fn load_config(&mut self, game_type: GameType, bytes: &[u8]) -> bool {
        if let Some(config) = GameConfig::from_bytes(game_type, bytes) {
            self.configs.insert(game_type, config);
            true
        } else {
            false
        }
    }

    /// Export configuration to bytes (for persistence).
    pub fn export_config(&self, game_type: GameType) -> Option<Vec<u8>> {
        self.configs.get(&game_type).map(|c| c.to_bytes())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_default() {
        let registry = GameRegistry::default();

        // All games should be active by default
        for game_type in GameRegistry::all_game_types() {
            assert!(registry.is_active(*game_type), "{:?} should be active", game_type);
        }

        // All games should have configs
        for game_type in GameRegistry::all_game_types() {
            assert!(
                registry.get_config(*game_type).is_some(),
                "{:?} should have config",
                game_type
            );
        }
    }

    #[test]
    fn test_set_active() {
        let mut registry = GameRegistry::new();

        assert!(registry.is_active(GameType::Blackjack));
        registry.set_active(GameType::Blackjack, false);
        assert!(!registry.is_active(GameType::Blackjack));
        registry.set_active(GameType::Blackjack, true);
        assert!(registry.is_active(GameType::Blackjack));
    }

    #[test]
    fn test_active_games() {
        let mut registry = GameRegistry::new();

        let active = registry.active_games();
        assert_eq!(active.len(), 10);

        registry.set_active(GameType::Blackjack, false);
        registry.set_active(GameType::Roulette, false);

        let active = registry.active_games();
        assert_eq!(active.len(), 8);
        assert!(!active.contains(&GameType::Blackjack));
        assert!(!active.contains(&GameType::Roulette));
    }

    #[test]
    fn test_game_info() {
        let info = GameRegistry::get_info(GameType::Blackjack);
        assert_eq!(info.name, "Blackjack");
        assert_eq!(info.category, GameCategory::Cards);
        assert!(info.house_edge_bps > 0);
    }

    #[test]
    fn test_games_by_category() {
        let registry = GameRegistry::new();

        let card_games = registry.games_by_category(GameCategory::Cards);
        assert!(card_games.contains(&GameType::Blackjack));
        assert!(card_games.contains(&GameType::Baccarat));
        assert!(card_games.contains(&GameType::CasinoWar));
        assert!(card_games.contains(&GameType::HiLo));

        let table_games = registry.games_by_category(GameCategory::Table);
        assert!(table_games.contains(&GameType::Craps));
        assert!(table_games.contains(&GameType::Roulette));
        assert!(table_games.contains(&GameType::SicBo));

        let poker_games = registry.games_by_category(GameCategory::Poker);
        assert!(poker_games.contains(&GameType::VideoPoker));
        assert!(poker_games.contains(&GameType::ThreeCard));
        assert!(poker_games.contains(&GameType::UltimateHoldem));
    }

    #[test]
    fn test_config_roundtrip() {
        let registry = GameRegistry::new();

        for game_type in GameRegistry::all_game_types() {
            let config = registry.get_config(*game_type).unwrap();
            let bytes = config.to_bytes();
            let decoded = GameConfig::from_bytes(*game_type, &bytes).unwrap();
            assert_eq!(config, &decoded, "{:?} config roundtrip failed", game_type);
        }
    }

    #[test]
    fn test_blackjack_config() {
        let config = BlackjackConfig {
            dealer_hits_soft_17: true,
            blackjack_pays_six_five: true,
            late_surrender: true,
            double_after_split: false,
            max_splits: 2,
            resplit_aces: true,
            hit_split_aces: true,
            decks: 8,
        };

        let bytes = config.to_bytes();
        let decoded = BlackjackConfig::from_bytes(&bytes).unwrap();

        assert_eq!(config.dealer_hits_soft_17, decoded.dealer_hits_soft_17);
        assert_eq!(config.blackjack_pays_six_five, decoded.blackjack_pays_six_five);
        assert_eq!(config.late_surrender, decoded.late_surrender);
        assert_eq!(config.double_after_split, decoded.double_after_split);
        assert_eq!(config.max_splits, decoded.max_splits);
        assert_eq!(config.resplit_aces, decoded.resplit_aces);
        assert_eq!(config.hit_split_aces, decoded.hit_split_aces);
        assert_eq!(config.decks, decoded.decks);
    }

    #[test]
    fn test_roulette_variants() {
        for variant in [
            RouletteVariant::European,
            RouletteVariant::LaPartage,
            RouletteVariant::EnPrison,
            RouletteVariant::EnPrisonDouble,
            RouletteVariant::American,
        ] {
            let config = RouletteConfig { variant };
            let bytes = config.to_bytes();
            let decoded = RouletteConfig::from_bytes(&bytes).unwrap();
            assert_eq!(config.variant, decoded.variant);
        }
    }

    #[test]
    fn test_set_config() {
        let mut registry = GameRegistry::new();

        let custom_config = GameConfig::Roulette(RouletteConfig {
            variant: RouletteVariant::American,
        });

        registry.set_config(custom_config.clone());

        let retrieved = registry.get_config(GameType::Roulette).unwrap();
        assert_eq!(retrieved, &custom_config);
    }

    #[test]
    fn test_load_export_config() {
        let mut registry = GameRegistry::new();

        let custom_config = BlackjackConfig {
            dealer_hits_soft_17: false,
            decks: 8,
            ..Default::default()
        };

        registry.set_config(GameConfig::Blackjack(custom_config.clone()));

        // Export
        let bytes = registry.export_config(GameType::Blackjack).unwrap();

        // Load into new registry
        let mut new_registry = GameRegistry::new();
        assert!(new_registry.load_config(GameType::Blackjack, &bytes));

        // Verify
        let loaded = new_registry.get_config(GameType::Blackjack).unwrap();
        if let GameConfig::Blackjack(c) = loaded {
            assert_eq!(c.dealer_hits_soft_17, false);
            assert_eq!(c.decks, 8);
        } else {
            panic!("Expected Blackjack config");
        }
    }

    #[test]
    fn test_all_games_info() {
        let mut registry = GameRegistry::new();
        registry.set_active(GameType::Craps, false);

        let infos = registry.all_games_info();
        assert_eq!(infos.len(), 10);

        let craps_info = infos.iter().find(|i| i.game_type == GameType::Craps).unwrap();
        assert!(!craps_info.active);

        let blackjack_info = infos.iter().find(|i| i.game_type == GameType::Blackjack).unwrap();
        assert!(blackjack_info.active);
    }

    #[test]
    fn test_video_poker_variants() {
        for variant in [
            VideoPokerVariant::JacksOrBetter,
            VideoPokerVariant::DeucesWild,
            VideoPokerVariant::BonusPoker,
            VideoPokerVariant::DoubleBonusPoker,
        ] {
            let config = VideoPokerConfig {
                variant,
                paytable: 1,
            };
            let bytes = config.to_bytes();
            let decoded = VideoPokerConfig::from_bytes(&bytes).unwrap();
            assert_eq!(config.variant, decoded.variant);
            assert_eq!(config.paytable, decoded.paytable);
        }
    }

    #[test]
    fn test_empty_bytes_returns_default() {
        // All configs should gracefully handle empty bytes by returning defaults
        assert!(BlackjackConfig::from_bytes(&[]).is_some());
        assert!(RouletteConfig::from_bytes(&[]).is_some());
        assert!(SicBoConfig::from_bytes(&[]).is_some());
        assert!(BaccaratConfig::from_bytes(&[]).is_some());
        assert!(CrapsConfig::from_bytes(&[]).is_some());
        assert!(HiLoConfig::from_bytes(&[]).is_some());
        assert!(CasinoWarConfig::from_bytes(&[]).is_some());
        assert!(ThreeCardConfig::from_bytes(&[]).is_some());
        assert!(UltimateHoldemConfig::from_bytes(&[]).is_some());
        assert!(VideoPokerConfig::from_bytes(&[]).is_some());
    }

    #[test]
    fn test_game_config_game_type() {
        for game_type in GameRegistry::all_game_types() {
            let config = GameConfig::default_for(*game_type);
            assert_eq!(config.game_type(), *game_type);
        }
    }
}
