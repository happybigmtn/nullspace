#![cfg(feature = "ts")]

use std::collections::BTreeMap;
use ts_rs::TS;

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameType {
    None,
    Baccarat,
    Blackjack,
    CasinoWar,
    Craps,
    Roulette,
    SicBo,
    ThreeCard,
    UltimateHoldem,
    VideoPoker,
    #[ts(rename = "HILO")]
    HiLo,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TournamentPhase {
    Registration,
    Active,
    Elimination,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameStage {
    Betting,
    Playing,
    Result,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct Card {
    pub suit: String,
    pub rank: String,
    pub value: i32,
    #[ts(optional)]
    pub is_hidden: Option<bool>,
    #[ts(optional)]
    pub is_held: Option<bool>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CrapsBetType {
    Pass,
    DontPass,
    Come,
    DontCome,
    Field,
    Yes,
    No,
    Next,
    Hardway,
    Fire,
    AtsSmall,
    AtsTall,
    AtsAll,
    Muggsy,
    DiffDoubles,
    RideLine,
    Replay,
    HotRoller,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CrapsBetStatus {
    Pending,
    On,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct CrapsBet {
    pub r#type: CrapsBetType,
    pub amount: i32,
    #[ts(optional)]
    pub target: Option<i32>,
    #[ts(optional)]
    pub odds_amount: Option<i32>,
    #[ts(optional)]
    pub local_odds_amount: Option<i32>,
    #[ts(optional)]
    pub progress_mask: Option<i32>,
    #[ts(optional)]
    pub status: Option<CrapsBetStatus>,
    #[ts(optional)]
    pub local: Option<bool>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BaccaratBetType {
    Tie,
    #[ts(rename = "P_PAIR")]
    PPair,
    #[ts(rename = "B_PAIR")]
    BPair,
    #[ts(rename = "LUCKY6")]
    Lucky6,
    #[ts(rename = "P_DRAGON")]
    PDragon,
    #[ts(rename = "B_DRAGON")]
    BDragon,
    #[ts(rename = "PANDA8")]
    Panda8,
    #[ts(rename = "P_PERFECT_PAIR")]
    PPerfectPair,
    #[ts(rename = "B_PERFECT_PAIR")]
    BPerfectPair,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct BaccaratBet {
    pub r#type: BaccaratBetType,
    pub amount: i32,
    #[ts(optional)]
    pub local: Option<bool>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RouletteBetType {
    Straight,
    Red,
    Black,
    Odd,
    Even,
    Low,
    High,
    #[ts(rename = "DOZEN_1")]
    Dozen1,
    #[ts(rename = "DOZEN_2")]
    Dozen2,
    #[ts(rename = "DOZEN_3")]
    Dozen3,
    #[ts(rename = "COL_1")]
    Col1,
    #[ts(rename = "COL_2")]
    Col2,
    #[ts(rename = "COL_3")]
    Col3,
    Zero,
    SplitH,
    SplitV,
    Street,
    Corner,
    SixLine,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct RouletteBet {
    pub r#type: RouletteBetType,
    #[ts(optional)]
    pub target: Option<i32>,
    pub amount: i32,
    #[ts(optional)]
    pub local: Option<bool>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SicBoBetType {
    Big,
    Small,
    Odd,
    Even,
    TripleAny,
    TripleSpecific,
    DoubleSpecific,
    Sum,
    SingleDie,
    Domino,
    #[ts(rename = "HOP3_EASY")]
    Hop3Easy,
    #[ts(rename = "HOP3_HARD")]
    Hop3Hard,
    #[ts(rename = "HOP4_EASY")]
    Hop4Easy,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct SicBoBet {
    pub r#type: SicBoBetType,
    #[ts(optional)]
    pub target: Option<i32>,
    pub amount: i32,
    #[ts(optional)]
    pub local: Option<bool>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct ResolvedBet {
    pub id: String,
    pub label: String,
    pub pnl: i32,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct CompletedHand {
    pub cards: Vec<Card>,
    pub bet: i32,
    #[ts(optional)]
    pub result: Option<i32>,
    #[ts(optional)]
    pub message: Option<String>,
    #[ts(optional)]
    pub is_doubled: Option<bool>,
    #[ts(optional)]
    pub surrendered: Option<bool>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct CrapsEventLog {
    pub dice: [i32; 2],
    pub total: i32,
    pub pnl: i32,
    pub point: Option<i32>,
    pub is_seven_out: bool,
    pub results: Vec<String>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CrapsInputMode {
    None,
    Yes,
    No,
    Next,
    Hardway,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RouletteInputMode {
    None,
    Straight,
    SplitH,
    SplitV,
    Street,
    Corner,
    SixLine,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RouletteZeroRule {
    Standard,
    #[ts(rename = "LA_PARTAGE")]
    LaPartage,
    #[ts(rename = "EN_PRISON")]
    EnPrison,
    #[ts(rename = "EN_PRISON_DOUBLE")]
    EnPrisonDouble,
    American,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SicBoInputMode {
    None,
    Single,
    Double,
    Triple,
    Sum,
    Domino,
    #[ts(rename = "HOP3_EASY")]
    Hop3Easy,
    #[ts(rename = "HOP3_HARD")]
    Hop3Hard,
    #[ts(rename = "HOP4_EASY")]
    Hop4Easy,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BaccaratSelection {
    Player,
    Banker,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct ActiveModifiers {
    pub shield: bool,
    pub double: bool,
    #[ts(optional, rename = "super")]
    pub super_active: Option<bool>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct BlackjackActionState {
    pub can_hit: bool,
    pub can_stand: bool,
    pub can_double: bool,
    pub can_split: bool,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct BlackjackSplitHand {
    pub cards: Vec<Card>,
    pub bet: i32,
    pub is_doubled: bool,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct HiLoRules {
    pub allow_same_any: bool,
    pub tie_push: bool,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct HiLoMultipliers {
    pub higher: i32,
    pub lower: i32,
    pub same: i32,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct SuperMultiplier {
    pub id: i32,
    pub multiplier: i32,
    pub super_type: String,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct SuperModeState {
    pub is_active: bool,
    pub streak_level: i32,
    pub multipliers: Vec<SuperMultiplier>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct GameState {
    pub r#type: GameType,
    pub message: String,
    pub bet: i32,
    pub stage: GameStage,
    pub player_cards: Vec<Card>,
    pub dealer_cards: Vec<Card>,
    pub community_cards: Vec<Card>,
    pub dice: Vec<i32>,
    pub craps_point: Option<i32>,
    pub craps_epoch_point_established: bool,
    pub craps_made_points_mask: i32,
    pub craps_bets: Vec<CrapsBet>,
    pub craps_undo_stack: Vec<Vec<CrapsBet>>,
    pub craps_input_mode: CrapsInputMode,
    pub craps_roll_history: Vec<i32>,
    pub craps_event_log: Vec<CrapsEventLog>,
    pub craps_last_round_bets: Vec<CrapsBet>,
    pub craps_odds_candidates: Option<Vec<i32>>,
    pub roulette_bets: Vec<RouletteBet>,
    pub roulette_undo_stack: Vec<Vec<RouletteBet>>,
    pub roulette_last_round_bets: Vec<RouletteBet>,
    pub roulette_history: Vec<i32>,
    pub roulette_input_mode: RouletteInputMode,
    pub roulette_zero_rule: RouletteZeroRule,
    pub roulette_is_prison: bool,
    pub sic_bo_bets: Vec<SicBoBet>,
    pub sic_bo_history: Vec<Vec<i32>>,
    pub sic_bo_input_mode: SicBoInputMode,
    pub sic_bo_undo_stack: Vec<Vec<SicBoBet>>,
    pub sic_bo_last_round_bets: Vec<SicBoBet>,
    pub resolved_bets: Vec<ResolvedBet>,
    pub resolved_bets_key: i32,
    pub last_result: i32,
    pub active_modifiers: ActiveModifiers,
    pub baccarat_selection: BaccaratSelection,
    pub baccarat_bets: Vec<BaccaratBet>,
    pub baccarat_undo_stack: Vec<Vec<BaccaratBet>>,
    pub baccarat_last_round_bets: Vec<BaccaratBet>,
    pub baccarat_player_total: Option<i32>,
    pub baccarat_banker_total: Option<i32>,
    pub insurance_bet: i32,
    pub blackjack_stack: Vec<BlackjackSplitHand>,
    pub completed_hands: Vec<CompletedHand>,
    pub blackjack21_plus3_bet: i32,
    pub blackjack_player_value: Option<i32>,
    pub blackjack_dealer_value: Option<i32>,
    pub blackjack_actions: BlackjackActionState,
    pub three_card_pair_plus_bet: i32,
    pub three_card_six_card_bonus_bet: i32,
    pub three_card_progressive_bet: i32,
    pub three_card_progressive_jackpot: i32,
    pub three_card_player_rank: Option<String>,
    pub three_card_dealer_rank: Option<String>,
    pub three_card_dealer_qualifies: Option<bool>,
    pub uth_trips_bet: i32,
    pub uth_six_card_bonus_bet: i32,
    pub uth_progressive_bet: i32,
    pub uth_progressive_jackpot: i32,
    pub uth_bonus_cards: Vec<Card>,
    pub video_poker_hand: Option<String>,
    pub video_poker_multiplier: Option<i32>,
    pub casino_war_tie_bet: i32,
    pub casino_war_outcome: Option<String>,
    pub hilo_accumulator: i32,
    pub hilo_graph_data: Vec<i32>,
    pub hilo_rules: Option<HiLoRules>,
    pub hilo_next_multipliers: Option<HiLoMultipliers>,
    pub session_id: Option<i32>,
    pub move_number: i32,
    pub session_wager: i32,
    pub session_interim_payout: i32,
    pub super_mode: Option<SuperModeState>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct PlayerStats {
    pub chips: i32,
    pub shields: i32,
    pub doubles: i32,
    #[ts(optional)]
    pub aura_meter: Option<i32>,
    pub rank: i32,
    pub history: Vec<String>,
    pub pnl_by_game: BTreeMap<String, i32>,
    pub pnl_history: Vec<i32>,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LeaderboardStatus {
    Alive,
    Eliminated,
}

#[derive(TS, Debug, Clone, PartialEq)]
#[ts(export, rename_all = "camelCase")]
pub struct LeaderboardEntry {
    pub name: String,
    pub chips: i32,
    pub status: LeaderboardStatus,
}

pub fn export_ts(out_dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(out_dir)?;
    GameState::export_all_to(out_dir).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    PlayerStats::export_all_to(out_dir).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    LeaderboardEntry::export_all_to(out_dir).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    Ok(())
}
