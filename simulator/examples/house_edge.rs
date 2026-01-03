use nullspace_execution::{GameRng, GameResult, init_game as exec_init_game, process_game_move as exec_process_game_move};
use nullspace_execution::casino;
use nullspace_types::casino::{GameSession, GameType, SuperModeState};
use nullspace_types::Seed;
use commonware_consensus::types::Round;
use commonware_cryptography::bls12381::primitives::group::G1;
use commonware_math::algebra::Additive;
use commonware_cryptography::ed25519;
use commonware_cryptography::Signer;
use std::collections::BTreeMap;

const TRIALS: usize = 50_000; // full run for stable estimates
const BASE_BET: u64 = 100;
const SIDE_BET: u64 = 100;
const HILO_BET: u64 = 10_000; // avoid rounding in basis points

#[derive(Default, Clone)]
struct Stats {
    trials: u64,
    total_net: f64,
    total_net_sq: f64,
    total_wagered: f64,
}

impl Stats {
    fn add(&mut self, net: i64, wagered: u64) {
        let n = net as f64;
        self.trials += 1;
        self.total_net += n;
        self.total_net_sq += n * n;
        self.total_wagered += wagered as f64;
    }

    fn merge(&mut self, other: &Stats) {
        self.trials += other.trials;
        self.total_net += other.total_net;
        self.total_net_sq += other.total_net_sq;
        self.total_wagered += other.total_wagered;
    }

    fn mean_net(&self) -> f64 {
        if self.trials == 0 {
            0.0
        } else {
            self.total_net / self.trials as f64
        }
    }

    fn mean_wagered(&self) -> f64 {
        if self.trials == 0 {
            0.0
        } else {
            self.total_wagered / self.trials as f64
        }
    }

    fn house_edge(&self) -> f64 {
        let mw = self.mean_wagered();
        if mw == 0.0 {
            0.0
        } else {
            -self.mean_net() / mw
        }
    }

    fn stderr(&self) -> f64 {
        if self.trials <= 1 {
            return 0.0;
        }
        let mean = self.mean_net();
        let var = (self.total_net_sq / self.trials as f64) - mean * mean;
        let var = if var < 0.0 { 0.0 } else { var };
        (var / self.trials as f64).sqrt()
    }
}

#[derive(Clone)]
struct ResultRow {
    game: String,
    bet: String,
    trials: u64,
    avg_wagered: f64,
    avg_net: f64,
    edge: f64,
    stderr: f64,
}

fn make_seed() -> Seed {
    Seed::new(Round::zero(), G1::zero())
}

fn make_player() -> ed25519::PublicKey {
    let pk = ed25519::PrivateKey::from_seed(1).public_key();
    pk
}

fn new_session(id: u64, player: &ed25519::PublicKey, game_type: GameType, bet: u64) -> GameSession {
    GameSession {
        id,
        player: player.clone(),
        game_type,
        bet,
        state_blob: vec![],
        move_count: 0,
        created_at: 0,
        is_complete: false,
        super_mode: SuperModeState::default(),
        is_tournament: false,
        tournament_id: None,
    }
}

fn apply_payout(net: &mut i64, wagered: &mut u64, payout: i64) {
    *net = net.saturating_add(payout);
    if payout < 0 {
        *wagered = wagered.saturating_add((-payout) as u64);
    }
}

fn apply_result(net: &mut i64, wagered: &mut u64, result: GameResult) -> bool {
    match result {
        GameResult::Continue(_) => false,
        GameResult::ContinueWithUpdate { payout, .. } => {
            apply_payout(net, wagered, payout);
            false
        }
        GameResult::Win(amount, _) => {
            apply_payout(net, wagered, amount as i64);
            true
        }
        GameResult::Push(amount, _) => {
            apply_payout(net, wagered, amount as i64);
            true
        }
        GameResult::Loss(_) => true,
        GameResult::LossPreDeducted(_, _) => true,
        GameResult::LossWithExtraDeduction(extra, _) => {
            apply_payout(net, wagered, -(extra as i64));
            true
        }
    }
}

fn init_game(session: &mut GameSession, seed: &Seed, net: &mut i64, wagered: &mut u64) {
    let mut rng = GameRng::new(seed, session.id, 0);
    let result = exec_init_game(session, &mut rng);
    let _ = apply_result(net, wagered, result);
}

fn apply_move(session: &mut GameSession, seed: &Seed, payload: &[u8], net: &mut i64, wagered: &mut u64) {
    session.move_count = session.move_count.saturating_add(1);
    let mut rng = GameRng::new(seed, session.id, session.move_count);
    let result = exec_process_game_move(session, payload, &mut rng)
        .unwrap_or_else(|e| panic!("move error: {e:?}"));
    let complete = apply_result(net, wagered, result);
    if complete {
        return;
    }
}

fn process_move(session: &mut GameSession, seed: &Seed, payload: &[u8]) -> GameResult {
    session.move_count = session.move_count.saturating_add(1);
    let mut rng = GameRng::new(seed, session.id, session.move_count);
    exec_process_game_move(session, payload, &mut rng)
        .unwrap_or_else(|e| panic!("move error: {e:?}"))
}

fn logs_from_result(result: &GameResult) -> &[String] {
    match result {
        GameResult::Continue(logs) => logs,
        GameResult::ContinueWithUpdate { logs, .. } => logs,
        GameResult::Win(_, logs) => logs,
        GameResult::Push(_, logs) => logs,
        GameResult::Loss(logs) => logs,
        GameResult::LossPreDeducted(_, logs) => logs,
        GameResult::LossWithExtraDeduction(_, logs) => logs,
    }
}

fn sum_pnl_for_labels(logs: &[String], prefixes: &[&str]) -> i64 {
    let mut total = 0i64;
    for log in logs {
        let mut idx = 0usize;
        while let Some(pos) = log[idx..].find("\"label\":\"") {
            let label_start = idx + pos + 9;
            let label_end = match log[label_start..].find('"') {
                Some(end) => label_start + end,
                None => break,
            };
            let label = &log[label_start..label_end];
            let pnl_search_start = label_end;
            let pnl_pos = match log[pnl_search_start..].find("\"pnl\":") {
                Some(pos) => pnl_search_start + pos + 6,
                None => break,
            };
            let mut pnl_end = pnl_pos;
            let bytes = log.as_bytes();
            while pnl_end < log.len() {
                let b = bytes[pnl_end];
                if (b'0'..=b'9').contains(&b) || b == b'-' {
                    pnl_end += 1;
                } else {
                    break;
                }
            }
            if pnl_end > pnl_pos {
                if let Ok(pnl) = log[pnl_pos..pnl_end].parse::<i64>() {
                    if prefixes.iter().any(|p| label.starts_with(p)) {
                        total = total.saturating_add(pnl);
                    }
                }
            }
            idx = pnl_end;
        }
    }
    total
}

fn bet_payload_u64(action: u8, amount: u64) -> Vec<u8> {
    let mut out = vec![action];
    out.extend_from_slice(&amount.to_be_bytes());
    out
}

fn bet_payload_table(action: u8, bet_type: u8, number: u8, amount: u64) -> Vec<u8> {
    let mut out = vec![action, bet_type, number];
    out.extend_from_slice(&amount.to_be_bytes());
    out
}

fn bet_payload_baccarat(bet_type: u8, amount: u64) -> Vec<u8> {
    let mut out = vec![0u8, bet_type];
    out.extend_from_slice(&amount.to_be_bytes());
    out
}

fn bet_payload_roulette(bet_type: u8, number: u8, amount: u64) -> Vec<u8> {
    bet_payload_table(0, bet_type, number, amount)
}

fn bet_payload_sicbo(bet_type: u8, number: u8, amount: u64) -> Vec<u8> {
    bet_payload_table(0, bet_type, number, amount)
}

fn bet_payload_craps(bet_type: u8, target: u8, amount: u64) -> Vec<u8> {
    bet_payload_table(0, bet_type, target, amount)
}

// --- Simple card helpers (avoid depending on crate-private helpers) ---
fn card_rank_one_based(card: u8) -> u8 {
    (card % 13) + 1
}

fn card_rank_ace_high(card: u8) -> u8 {
    let r = card_rank_one_based(card);
    if r == 1 { 14 } else { r }
}

fn card_suit(card: u8) -> u8 {
    card / 13
}

// --- Video Poker hold strategy ---
fn is_straight(ranks: &mut [u8; 5]) -> bool {
    ranks.sort_unstable();
    let is_wheel = *ranks == [2, 3, 4, 5, 14];
    is_wheel || (ranks[4] - ranks[0] == 4 && (1..5).all(|i| ranks[i] - ranks[i - 1] == 1))
}

fn video_poker_hold_mask(cards: &[u8; 5]) -> u8 {
    let mut ranks = [0u8; 5];
    let mut suits = [0u8; 5];
    for i in 0..5 {
        ranks[i] = card_rank_ace_high(cards[i]);
        suits[i] = card_suit(cards[i]);
    }
    let is_flush = suits.iter().all(|&s| s == suits[0]);
    let mut ranks_for_straight = ranks;
    let is_straight = is_straight(&mut ranks_for_straight);

    // Count ranks
    let mut counts = [0u8; 15];
    for &r in &ranks {
        counts[r as usize] += 1;
    }
    let mut num_pairs = 0;
    let mut trip_rank = 0u8;
    let mut quad_rank = 0u8;
    let mut pair_ranks = [0u8; 2];
    for r in (2..=14).rev() {
        match counts[r as usize] {
            4 => quad_rank = r as u8,
            3 => trip_rank = r as u8,
            2 => {
                if num_pairs < 2 {
                    pair_ranks[num_pairs] = r as u8;
                }
                num_pairs += 1;
            }
            _ => {}
        }
    }

    if is_straight && is_flush {
        return 0b1_1111;
    }
    if quad_rank > 0 {
        return mask_for_ranks(cards, &[quad_rank]);
    }
    if trip_rank > 0 && num_pairs > 0 {
        return 0b1_1111; // full house
    }
    if is_flush || is_straight {
        return 0b1_1111;
    }
    if trip_rank > 0 {
        return mask_for_ranks(cards, &[trip_rank]);
    }
    if num_pairs >= 2 {
        return mask_for_ranks(cards, &pair_ranks);
    }
    if num_pairs == 1 {
        return mask_for_ranks(cards, &pair_ranks[..1]);
    }

    // Hold high cards J,Q,K,A
    let mut mask = 0u8;
    for (i, &card) in cards.iter().enumerate() {
        let r = card_rank_one_based(card);
        if r == 1 || r >= 11 {
            mask |= 1u8 << i;
        }
    }
    mask
}

fn mask_for_ranks(cards: &[u8; 5], ranks: &[u8]) -> u8 {
    let mut mask = 0u8;
    for (i, &card) in cards.iter().enumerate() {
        let r = card_rank_ace_high(card);
        if ranks.iter().any(|&x| x == r) {
            mask |= 1u8 << i;
        }
    }
    mask
}

// --- Simple cursor for parsing state blobs ---
struct Cursor<'a> {
    buf: &'a [u8],
    idx: usize,
}

impl<'a> Cursor<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, idx: 0 }
    }

    fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.idx)
    }

    fn read_u8(&mut self) -> Option<u8> {
        if self.idx >= self.buf.len() {
            return None;
        }
        let v = self.buf[self.idx];
        self.idx += 1;
        Some(v)
    }

    fn read_u64_be(&mut self) -> Option<u64> {
        if self.idx + 8 > self.buf.len() {
            return None;
        }
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&self.buf[self.idx..self.idx + 8]);
        self.idx += 8;
        Some(u64::from_be_bytes(bytes))
    }

    fn read_i64_be(&mut self) -> Option<i64> {
        if self.idx + 8 > self.buf.len() {
            return None;
        }
        let mut bytes = [0u8; 8];
        bytes.copy_from_slice(&self.buf[self.idx..self.idx + 8]);
        self.idx += 8;
        Some(i64::from_be_bytes(bytes))
    }

    fn read_bytes(&mut self, n: usize) -> Option<&'a [u8]> {
        if self.idx + n > self.buf.len() {
            return None;
        }
        let out = &self.buf[self.idx..self.idx + n];
        self.idx += n;
        Some(out)
    }
}

// --- Blackjack parsing/strategy ---
#[derive(Clone)]
struct BjHand {
    cards: Vec<u8>,
    bet_mult: u8,
    was_split: bool,
    status: u8,
}

#[derive(Clone)]
struct BjState {
    stage: u8,
    active_hand_idx: usize,
    hands: Vec<BjHand>,
    dealer_cards: Vec<u8>,
    rules_flags: u8,
}

fn parse_blackjack_state(blob: &[u8]) -> Option<BjState> {
    const UI_EXTRA_LEN: usize = 3;
    let mut cur = Cursor::new(blob);
    let version = cur.read_u8()?;
    let stage = cur.read_u8()?;
    let side_bet_fields = match version {
        2 => 1,
        3 => 4,
        4 => 5,
        _ => return None,
    };
    for _ in 0..side_bet_fields {
        let _ = cur.read_u64_be()?;
    }
    let _initial = cur.read_bytes(2)?;
    let active_hand_idx = cur.read_u8()? as usize;
    let hand_count = cur.read_u8()? as usize;
    let mut hands = Vec::with_capacity(hand_count);
    for _ in 0..hand_count {
        let bet_mult = cur.read_u8()?;
        let status = cur.read_u8()?;
        let was_split = cur.read_u8()? != 0;
        let c_len = cur.read_u8()? as usize;
        let cards = cur.read_bytes(c_len)?.to_vec();
        hands.push(BjHand { cards, bet_mult, was_split, status });
    }
    let d_len = cur.read_u8()? as usize;
    let dealer_cards = cur.read_bytes(d_len)?.to_vec();
    let mut rules_flags = 0u8;
    if cur.remaining() >= 2 {
        rules_flags = cur.read_u8()?;
        let _decks = cur.read_u8()?;
    }
    if cur.remaining() == UI_EXTRA_LEN {
        let _ = cur.read_bytes(UI_EXTRA_LEN)?;
    }
    Some(BjState { stage, active_hand_idx, hands, dealer_cards, rules_flags })
}

fn bj_double_allowed(hand: &BjHand, rules_flags: u8) -> bool {
    let double_after_split = rules_flags & 0x08 != 0;
    hand.cards.len() == 2 && hand.bet_mult == 1 && (!hand.was_split || double_after_split)
}

fn bj_should_split(pair_value: u8, dealer_up: u8) -> bool {
    match pair_value {
        1 => true, // Aces
        2 | 3 => (2..=7).contains(&dealer_up),
        4 => (5..=6).contains(&dealer_up),
        5 => false,
        6 => (2..=6).contains(&dealer_up),
        7 => (2..=7).contains(&dealer_up),
        8 => true,
        9 => (2..=6).contains(&dealer_up) || dealer_up == 8 || dealer_up == 9,
        10 => false,
        _ => false,
    }
}

fn bj_decide_action(state: &BjState) -> u8 {
    const MOVE_HIT: u8 = 0;
    const MOVE_STAND: u8 = 1;
    const MOVE_DOUBLE: u8 = 2;
    const MOVE_SPLIT: u8 = 3;

    let Some(hand) = state.hands.get(state.active_hand_idx) else {
        return MOVE_STAND;
    };
    if hand.status != 0 { // Playing
        return MOVE_STAND;
    }

    let dealer_up = state.dealer_cards.first().copied().unwrap_or(0);
    let dealer_rank = card_rank_one_based(dealer_up);
    let dealer_val = if dealer_rank == 1 { 11 } else if dealer_rank >= 10 { 10 } else { dealer_rank };

    if hand.cards.len() == 2 {
        let r1 = card_rank_one_based(hand.cards[0]);
        let r2 = card_rank_one_based(hand.cards[1]);
        let pair_rank_raw = if r1 == r2 { r1 } else { 0 };
        if pair_rank_raw > 0 {
            let pair_value = if pair_rank_raw == 1 { 1 } else if pair_rank_raw >= 10 { 10 } else { pair_rank_raw };
            let can_split = state.hands.len() < 4; // MAX_HANDS
            if can_split && bj_should_split(pair_value, dealer_val) {
                return MOVE_SPLIT;
            }
        }
    }

    let (total, is_soft) = casino::blackjack::hand_value(&hand.cards);

    if is_soft {
        match total {
            13 | 14 => {
                if (5..=6).contains(&dealer_val) && bj_double_allowed(hand, state.rules_flags) {
                    return MOVE_DOUBLE;
                }
                return MOVE_HIT;
            }
            15 | 16 => {
                if (4..=6).contains(&dealer_val) && bj_double_allowed(hand, state.rules_flags) {
                    return MOVE_DOUBLE;
                }
                return MOVE_HIT;
            }
            17 => {
                if (3..=6).contains(&dealer_val) && bj_double_allowed(hand, state.rules_flags) {
                    return MOVE_DOUBLE;
                }
                return MOVE_HIT;
            }
            18 => {
                if (3..=6).contains(&dealer_val) && bj_double_allowed(hand, state.rules_flags) {
                    return MOVE_DOUBLE;
                }
                if dealer_val == 2 || dealer_val == 7 || dealer_val == 8 {
                    return MOVE_STAND;
                }
                return MOVE_HIT;
            }
            19 | 20 => return MOVE_STAND,
            _ => return MOVE_STAND,
        }
    }

    // Hard totals
    match total {
        17..=21 => MOVE_STAND,
        13..=16 => {
            if (2..=6).contains(&dealer_val) { MOVE_STAND } else { MOVE_HIT }
        }
        12 => {
            if (4..=6).contains(&dealer_val) { MOVE_STAND } else { MOVE_HIT }
        }
        11 => {
            if (2..=10).contains(&dealer_val) && bj_double_allowed(hand, state.rules_flags) {
                MOVE_DOUBLE
            } else {
                MOVE_HIT
            }
        }
        10 => {
            if (2..=9).contains(&dealer_val) && bj_double_allowed(hand, state.rules_flags) {
                MOVE_DOUBLE
            } else {
                MOVE_HIT
            }
        }
        9 => {
            if (3..=6).contains(&dealer_val) && bj_double_allowed(hand, state.rules_flags) {
                MOVE_DOUBLE
            } else {
                MOVE_HIT
            }
        }
        _ => MOVE_HIT,
    }
}

// --- Three Card parsing ---
#[derive(Clone)]
struct TcState {
    stage: u8,
    player: [u8; 3],
}

fn parse_three_card_state(blob: &[u8]) -> Option<TcState> {
    const STATE_VERSION: u8 = 3;
    let mut cur = Cursor::new(blob);
    let version = cur.read_u8()?;
    if version != STATE_VERSION {
        return None;
    }
    let stage = cur.read_u8()?;
    let player = cur.read_bytes(3)?.try_into().ok()?;
    // skip dealer
    let _dealer = cur.read_bytes(3)?;
    // skip bets
    let _pairplus = cur.read_u64_be()?;
    let _six = cur.read_u64_be()?;
    let _prog = cur.read_u64_be()?;
    Some(TcState { stage, player })
}

// --- Ultimate Hold'em parsing ---
#[derive(Clone)]
struct UthStateParsed {
    stage: u8,
    player: [u8; 2],
    community: [u8; 5],
}

fn parse_uth_state(blob: &[u8]) -> Option<UthStateParsed> {
    const STATE_VERSION: u8 = 3;
    let mut cur = Cursor::new(blob);
    let version = cur.read_u8()?;
    if version != STATE_VERSION {
        return None;
    }
    let stage = cur.read_u8()?;
    let player = cur.read_bytes(2)?.try_into().ok()?;
    let community = cur.read_bytes(5)?.try_into().ok()?;
    // skip dealer
    let _dealer = cur.read_bytes(2)?;
    // skip play_mult + bonuses
    let _play = cur.read_u8()?;
    let _bonus = cur.read_bytes(4)?;
    // skip bets
    let _trips = cur.read_u64_be()?;
    let _six = cur.read_u64_be()?;
    let _prog = cur.read_u64_be()?;
    Some(UthStateParsed { stage, player, community })
}

// --- Video Poker parsing ---
#[derive(Clone)]
struct VpState {
    stage: u8,
    cards: [u8; 5],
}

fn parse_video_poker_state(blob: &[u8]) -> Option<VpState> {
    let mut cur = Cursor::new(blob);
    let stage = cur.read_u8()?;
    let cards: [u8; 5] = cur.read_bytes(5)?.try_into().ok()?;
    Some(VpState { stage, cards })
}

// --- HiLo parsing ---
#[derive(Clone)]
struct HiLoStateParsed {
    current_card: u8,
}

fn parse_hilo_state(blob: &[u8]) -> Option<HiLoStateParsed> {
    let mut cur = Cursor::new(blob);
    let current = cur.read_u8()?;
    let _acc = cur.read_i64_be()?;
    Some(HiLoStateParsed { current_card: current })
}

// --- Simulations ---
fn run_trials<F>(trials: usize, f: F) -> Stats
where
    F: Fn(u64) -> (i64, u64) + Sync,
{
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .max(1);

    if trials == 0 {
        return Stats::default();
    }

    if threads == 1 {
        let mut stats = Stats::default();
        for i in 0..trials {
            let (net, wagered) = f(i as u64 + 1);
            stats.add(net, wagered);
        }
        return stats;
    }

    let threads = threads.min(trials);
    let chunk = (trials + threads - 1) / threads;
    let mut stats = Stats::default();

    std::thread::scope(|scope| {
        let f_ref = &f;
        let mut handles = Vec::new();
        for t in 0..threads {
            let start = t * chunk;
            if start >= trials {
                break;
            }
            let end = ((t + 1) * chunk).min(trials);
            let f_ref = f_ref;
            let handle = scope.spawn(move || {
                let mut local = Stats::default();
                for i in start..end {
                    let (net, wagered) = f_ref(i as u64 + 1);
                    local.add(net, wagered);
                }
                local
            });
            handles.push(handle);
        }

        for handle in handles {
            let local = handle.join().expect("worker thread failed");
            stats.merge(&local);
        }
    });

    stats
}

fn sim_baccarat(bet_type: u8, amount: u64, trials: usize, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::Baccarat, 0);
        let mut net = 0i64;
        let mut wagered = 0u64;
        init_game(&mut session, seed, &mut net, &mut wagered);
        let payload = bet_payload_baccarat(bet_type, amount);
        apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered);
        (net, wagered)
    })
}

fn sim_roulette(bet_type: u8, number: u8, amount: u64, zero_rule: u8, trials: usize, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::Roulette, 0);
        let mut net = 0i64;
        let mut wagered = 0u64;
        init_game(&mut session, seed, &mut net, &mut wagered);
        if zero_rule != 0 {
            let payload = [3u8, zero_rule];
            apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        }
        let payload = bet_payload_roulette(bet_type, number, amount);
        apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        // Spin until complete (En Prison variants can require multiple spins)
        loop {
            apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered);
            if session.is_complete {
                break;
            }
        }
        (net, wagered)
    })
}

fn sim_sicbo(bet_type: u8, number: u8, amount: u64, trials: usize, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::SicBo, 0);
        let mut net = 0i64;
        let mut wagered = 0u64;
        init_game(&mut session, seed, &mut net, &mut wagered);
        let payload = bet_payload_sicbo(bet_type, number, amount);
        apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered);
        (net, wagered)
    })
}

fn sim_craps_simple(bet_type: u8, target: u8, amount: u64, trials: usize, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::Craps, 0);
        let mut net = 0i64;
        let mut wagered = 0u64;
        init_game(&mut session, seed, &mut net, &mut wagered);
        let payload = bet_payload_craps(bet_type, target, amount);
        apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        let mut rolls = 0;
        while !session.is_complete {
            apply_move(&mut session, seed, &[2u8], &mut net, &mut wagered);
            rolls += 1;
            if rolls > 500 {
                panic!("craps roll overflow");
            }
        }
        (net, wagered)
    })
}

fn sim_craps_come_bet(
    is_dont: bool,
    amount: u64,
    trials: usize,
    seed: &Seed,
    player: &ed25519::PublicKey,
) -> Stats {
    // Uses a Pass/DontPass bet to establish point, then places Come/DontCome.
    // Tracks ONLY the Come/DontCome bet PnL via roll logs to avoid conditioning bias.
    let pass_bet_type = if is_dont { 1u8 } else { 0u8 }; // DontPass / Pass
    let come_bet_type = if is_dont { 3u8 } else { 2u8 }; // DontCome / Come
    let label_prefix = if is_dont { "DONT_COME" } else { "COME" };

    run_trials(trials, |id| {
        let mut attempt: u64 = 0;
        loop {
            let session_id = (id << 32) | (attempt & 0xffff_ffff);
            attempt = attempt.wrapping_add(1);
            let mut session = new_session(session_id, player, GameType::Craps, 0);
            let mut net = 0i64;
            let mut wagered = 0u64;
            init_game(&mut session, seed, &mut net, &mut wagered);

            // Place pass/don't pass to allow rolling until a point is established.
            let payload = bet_payload_craps(pass_bet_type, 0, amount);
            let _ = process_move(&mut session, seed, &payload);

            let mut placed_come = false;
            let mut come_net = 0i64;
            let mut come_wagered = 0u64;
            let mut safety = 0;

            while !session.is_complete {
                if !placed_come {
                    let payload = bet_payload_craps(come_bet_type, 0, amount);
                    let mut test_session = session.clone();
                    // Try the move on a copy; if it succeeds, use it.
                    test_session.move_count = test_session.move_count.saturating_add(1);
                    let mut rng = GameRng::new(seed, test_session.id, test_session.move_count);
                    let res = casino::process_game_move(&mut test_session, &payload, &mut rng);
                    if res.is_ok() {
                        let result = process_move(&mut session, seed, &payload);
                        come_net = come_net.saturating_add(
                            sum_pnl_for_labels(logs_from_result(&result), &[label_prefix]),
                        );
                        come_wagered = come_wagered.saturating_add(amount);
                        placed_come = true;
                    }
                }

                let result = process_move(&mut session, seed, &[2u8]);
                come_net = come_net.saturating_add(
                    sum_pnl_for_labels(logs_from_result(&result), &[label_prefix]),
                );

                safety += 1;
                if safety > 500 {
                    panic!("craps come loop overflow");
                }
            }

            if placed_come {
                return (come_net, come_wagered);
            }
            if attempt > 10_000 {
                panic!("craps come placement failed after many attempts");
            }
        }
    })
}

fn sim_blackjack_main(trials: usize, bet: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::Blackjack, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        // StartGame deducts base bet
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        // Deal
        apply_move(&mut session, seed, &[4u8], &mut net, &mut wagered);

        while !session.is_complete {
            let state = parse_blackjack_state(&session.state_blob).expect("bj parse");
            match state.stage {
                1 => { // PlayerTurn
                    let action = bj_decide_action(&state);
                    apply_move(&mut session, seed, &[action], &mut net, &mut wagered);
                }
                2 => { // AwaitingReveal
                    apply_move(&mut session, seed, &[6u8], &mut net, &mut wagered);
                }
                _ => break,
            }
        }
        (net, wagered)
    })
}

fn sim_blackjack_with_side(trials: usize, bet: u64, side_bet: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::Blackjack, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        // Set side bet 21+3
        let payload = bet_payload_u64(5u8, side_bet);
        apply_move(&mut session, seed, &payload, &mut net, &mut wagered);

        // Deal
        apply_move(&mut session, seed, &[4u8], &mut net, &mut wagered);

        while !session.is_complete {
            let state = parse_blackjack_state(&session.state_blob).expect("bj parse");
            match state.stage {
                1 => {
                    let action = bj_decide_action(&state);
                    apply_move(&mut session, seed, &[action], &mut net, &mut wagered);
                }
                2 => {
                    apply_move(&mut session, seed, &[6u8], &mut net, &mut wagered);
                }
                _ => break,
            }
        }
        (net, wagered)
    })
}

fn sim_casino_war_main(trials: usize, bet: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::CasinoWar, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        // Play
        apply_move(&mut session, seed, &[0u8], &mut net, &mut wagered);
        if !session.is_complete {
            // Tie -> go to war
            apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered);
        }
        (net, wagered)
    })
}

fn sim_casino_war_tie(trials: usize, bet: u64, side_bet: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::CasinoWar, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        // Set tie bet
        let payload = bet_payload_u64(3u8, side_bet);
        apply_move(&mut session, seed, &payload, &mut net, &mut wagered);

        // Play
        apply_move(&mut session, seed, &[0u8], &mut net, &mut wagered);
        if !session.is_complete {
            apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered);
        }
        (net, wagered)
    })
}

fn sim_video_poker(trials: usize, bet: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::VideoPoker, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        let state = parse_video_poker_state(&session.state_blob).expect("vp parse");
        let mask = video_poker_hold_mask(&state.cards);
        let payload = [mask];
        apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        (net, wagered)
    })
}

#[derive(Default, Clone)]
struct VpDiag {
    count: u64,
    total_return: u64,
    total_net: i64,
}

#[derive(Default, Clone)]
struct VpDiagSummary {
    duplicate_hands: u64,
    invalid_cards: u64,
}

fn sim_video_poker_diag(
    trials: usize,
    bet: u64,
    seed: &Seed,
    player: &ed25519::PublicKey,
) -> (
    Stats,
    BTreeMap<casino::video_poker::Hand, VpDiag>,
    BTreeMap<casino::video_poker::Hand, VpDiag>,
    VpDiagSummary,
) {
    let mut stats = Stats::default();
    let mut by_hand_initial: BTreeMap<casino::video_poker::Hand, VpDiag> = BTreeMap::new();
    let mut by_hand: BTreeMap<casino::video_poker::Hand, VpDiag> = BTreeMap::new();
    let mut summary = VpDiagSummary::default();
    for i in 0..trials {
        let id = i as u64 + 1;
        let mut session = new_session(id, player, GameType::VideoPoker, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        let state = parse_video_poker_state(&session.state_blob).expect("vp parse");
        let initial_hand = casino::video_poker::evaluate_hand(&state.cards);
        let initial_entry = by_hand_initial.entry(initial_hand).or_default();
        initial_entry.count = initial_entry.count.saturating_add(1);
        let mask = video_poker_hold_mask(&state.cards);
        let result = process_move(&mut session, seed, &[mask]);
        let _ = apply_result(&mut net, &mut wagered, result);

        let final_state = parse_video_poker_state(&session.state_blob).expect("vp parse final");
        let mut seen = [false; 52];
        let mut dup = false;
        for &card in &final_state.cards {
            if card >= 52 {
                summary.invalid_cards = summary.invalid_cards.saturating_add(1);
            } else if seen[card as usize] {
                dup = true;
            } else {
                seen[card as usize] = true;
            }
        }
        if dup {
            summary.duplicate_hands = summary.duplicate_hands.saturating_add(1);
        }
        let hand = casino::video_poker::evaluate_hand(&final_state.cards);
        let entry = by_hand.entry(hand).or_default();
        entry.count = entry.count.saturating_add(1);
        let total_return = net.saturating_add(bet as i64).max(0) as u64;
        entry.total_return = entry.total_return.saturating_add(total_return);
        entry.total_net = entry.total_net.saturating_add(net);

        stats.add(net, wagered);
    }
    (stats, by_hand, by_hand_initial, summary)
}

fn video_poker_hand_label(hand: casino::video_poker::Hand) -> &'static str {
    match hand {
        casino::video_poker::Hand::HighCard => "HIGH_CARD",
        casino::video_poker::Hand::JacksOrBetter => "JACKS_OR_BETTER",
        casino::video_poker::Hand::TwoPair => "TWO_PAIR",
        casino::video_poker::Hand::ThreeOfAKind => "THREE_OF_A_KIND",
        casino::video_poker::Hand::Straight => "STRAIGHT",
        casino::video_poker::Hand::Flush => "FLUSH",
        casino::video_poker::Hand::FullHouse => "FULL_HOUSE",
        casino::video_poker::Hand::FourOfAKind => "FOUR_OF_A_KIND",
        casino::video_poker::Hand::StraightFlush => "STRAIGHT_FLUSH",
        casino::video_poker::Hand::RoyalFlush => "ROYAL_FLUSH",
    }
}

fn sim_hilo(trials: usize, bet: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::HiLo, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        let state = parse_hilo_state(&session.state_blob).expect("hilo parse");
        let rank = card_rank_one_based(state.current_card);
        let guess = if rank <= 7 { 0u8 } else { 1u8 }; // Higher or Lower
        apply_move(&mut session, seed, &[guess], &mut net, &mut wagered);
        if !session.is_complete {
            apply_move(&mut session, seed, &[2u8], &mut net, &mut wagered); // Cashout
        }
        (net, wagered)
    })
}

fn sim_three_card_main(trials: usize, bet: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::ThreeCard, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        // Deal
        apply_move(&mut session, seed, &[2u8], &mut net, &mut wagered);
        let state = parse_three_card_state(&session.state_blob).expect("tc parse");
        if state.stage != 1 {
            return (net, wagered);
        }

        let (rank, kickers) = casino::three_card::evaluate_hand(&state.player);
        let play = if rank > casino::three_card::HandRank::HighCard {
            true
        } else {
            kickers >= [12, 6, 4]
        };

        if play {
            apply_move(&mut session, seed, &[0u8], &mut net, &mut wagered); // Play
            apply_move(&mut session, seed, &[4u8], &mut net, &mut wagered); // Reveal
        } else {
            apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered); // Fold
        }
        (net, wagered)
    })
}

fn sim_three_card_with_side(trials: usize, bet: u64, pairplus: u64, six: u64, prog: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::ThreeCard, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered);

        // Set side bets (pairplus, six-card, progressive)
        if pairplus > 0 {
            let payload = bet_payload_u64(3u8, pairplus); // SetPairPlus
            apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        }
        if six > 0 {
            let payload = bet_payload_u64(5u8, six); // SetSixCardBonus
            apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        }
        if prog > 0 {
            let payload = bet_payload_u64(6u8, prog); // SetProgressive
            apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        }

        // Deal
        apply_move(&mut session, seed, &[2u8], &mut net, &mut wagered);
        let state = parse_three_card_state(&session.state_blob).expect("tc parse");
        if state.stage != 1 {
            return (net, wagered);
        }

        let (rank, kickers) = casino::three_card::evaluate_hand(&state.player);
        let play = if rank > casino::three_card::HandRank::HighCard {
            true
        } else {
            kickers >= [12, 6, 4]
        };

        if play {
            apply_move(&mut session, seed, &[0u8], &mut net, &mut wagered); // Play
            apply_move(&mut session, seed, &[4u8], &mut net, &mut wagered); // Reveal
        } else {
            apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered); // Fold
        }
        (net, wagered)
    })
}

fn has_pair_or_better(cards: &[u8]) -> bool {
    let mut counts = [0u8; 15];
    for &card in cards {
        let r = card_rank_ace_high(card);
        counts[r as usize] += 1;
        if counts[r as usize] >= 2 {
            return true;
        }
    }
    false
}

fn sim_uth_main(trials: usize, bet: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::UltimateHoldem, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        // StartGame deducts ante
        apply_payout(&mut net, &mut wagered, -(bet as i64));
        init_game(&mut session, seed, &mut net, &mut wagered); // deducts blind

        // Deal
        apply_move(&mut session, seed, &[5u8], &mut net, &mut wagered);
        let mut state = parse_uth_state(&session.state_blob).expect("uth parse");

        // Preflop decision
        let r1 = card_rank_ace_high(state.player[0]);
        let r2 = card_rank_ace_high(state.player[1]);
        let is_pair = r1 == r2;
        let is_ak = (r1 == 14 && r2 == 13) || (r1 == 13 && r2 == 14);
        if is_pair || is_ak {
            apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered); // Bet4x
            apply_move(&mut session, seed, &[7u8], &mut net, &mut wagered); // Reveal
            return (net, wagered);
        }

        // Check to flop
        apply_move(&mut session, seed, &[0u8], &mut net, &mut wagered);
        state = parse_uth_state(&session.state_blob).expect("uth parse");

        // Flop decision: bet 2x if pair+ in hole+flop
        let mut flop_cards = Vec::with_capacity(5);
        flop_cards.push(state.player[0]);
        flop_cards.push(state.player[1]);
        flop_cards.extend_from_slice(&state.community[0..3]);
        if has_pair_or_better(&flop_cards) {
            apply_move(&mut session, seed, &[2u8], &mut net, &mut wagered); // Bet2x
            apply_move(&mut session, seed, &[7u8], &mut net, &mut wagered); // Reveal
            return (net, wagered);
        }

        // Check to river
        apply_move(&mut session, seed, &[0u8], &mut net, &mut wagered);
        state = parse_uth_state(&session.state_blob).expect("uth parse");
        let mut river_cards = [0u8; 7];
        river_cards[0] = state.player[0];
        river_cards[1] = state.player[1];
        river_cards[2..7].copy_from_slice(&state.community);
        let (rank, _) = casino::ultimate_holdem::evaluate_best_hand(&river_cards);
        if rank >= casino::ultimate_holdem::HandRank::Pair {
            apply_move(&mut session, seed, &[3u8], &mut net, &mut wagered); // Bet1x
            apply_move(&mut session, seed, &[7u8], &mut net, &mut wagered); // Reveal
        } else {
            apply_move(&mut session, seed, &[4u8], &mut net, &mut wagered); // Fold
        }
        (net, wagered)
    })
}

fn sim_uth_with_side(trials: usize, bet: u64, trips: u64, six: u64, prog: u64, seed: &Seed, player: &ed25519::PublicKey) -> Stats {
    run_trials(trials, |id| {
        let mut session = new_session(id, player, GameType::UltimateHoldem, bet);
        let mut net = 0i64;
        let mut wagered = 0u64;
        apply_payout(&mut net, &mut wagered, -(bet as i64)); // ante
        init_game(&mut session, seed, &mut net, &mut wagered); // blind

        // Set side bets before deal
        if trips > 0 {
            let payload = bet_payload_u64(6u8, trips); // SetTrips
            apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        }
        if six > 0 {
            let payload = bet_payload_u64(9u8, six); // SetSixCardBonus
            apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        }
        if prog > 0 {
            let payload = bet_payload_u64(10u8, prog); // SetProgressive
            apply_move(&mut session, seed, &payload, &mut net, &mut wagered);
        }

        // Deal
        apply_move(&mut session, seed, &[5u8], &mut net, &mut wagered);
        let mut state = parse_uth_state(&session.state_blob).expect("uth parse");

        let r1 = card_rank_ace_high(state.player[0]);
        let r2 = card_rank_ace_high(state.player[1]);
        let is_pair = r1 == r2;
        let is_ak = (r1 == 14 && r2 == 13) || (r1 == 13 && r2 == 14);
        if is_pair || is_ak {
            apply_move(&mut session, seed, &[1u8], &mut net, &mut wagered); // Bet4x
            apply_move(&mut session, seed, &[7u8], &mut net, &mut wagered); // Reveal
            return (net, wagered);
        }

        // Check to flop
        apply_move(&mut session, seed, &[0u8], &mut net, &mut wagered);
        state = parse_uth_state(&session.state_blob).expect("uth parse");

        let mut flop_cards = Vec::with_capacity(5);
        flop_cards.push(state.player[0]);
        flop_cards.push(state.player[1]);
        flop_cards.extend_from_slice(&state.community[0..3]);
        if has_pair_or_better(&flop_cards) {
            apply_move(&mut session, seed, &[2u8], &mut net, &mut wagered); // Bet2x
            apply_move(&mut session, seed, &[7u8], &mut net, &mut wagered); // Reveal
            return (net, wagered);
        }

        // Check to river
        apply_move(&mut session, seed, &[0u8], &mut net, &mut wagered);
        state = parse_uth_state(&session.state_blob).expect("uth parse");
        let mut river_cards = [0u8; 7];
        river_cards[0] = state.player[0];
        river_cards[1] = state.player[1];
        river_cards[2..7].copy_from_slice(&state.community);
        let (rank, _) = casino::ultimate_holdem::evaluate_best_hand(&river_cards);
        if rank >= casino::ultimate_holdem::HandRank::Pair {
            apply_move(&mut session, seed, &[3u8], &mut net, &mut wagered); // Bet1x
            apply_move(&mut session, seed, &[7u8], &mut net, &mut wagered); // Reveal
        } else {
            apply_move(&mut session, seed, &[4u8], &mut net, &mut wagered); // Fold
        }
        (net, wagered)
    })
}

fn main() {
    let seed = make_seed();
    let player = make_player();

    let mut results: Vec<ResultRow> = Vec::new();

    // Baccarat
    let baccarat_bets = vec![
        ("PLAYER", 0u8),
        ("BANKER", 1u8),
        ("TIE", 2u8),
        ("PLAYER_PAIR", 3u8),
        ("BANKER_PAIR", 4u8),
        ("LUCKY_6", 5u8),
        ("PLAYER_DRAGON", 6u8),
        ("BANKER_DRAGON", 7u8),
        ("PANDA_8", 8u8),
        ("PERFECT_PAIR", 9u8),
    ];
    for (label, bet_type) in baccarat_bets {
        let stats = sim_baccarat(bet_type, BASE_BET, TRIALS, &seed, &player);
        results.push(ResultRow {
            game: "Baccarat".to_string(),
            bet: label.to_string(),
            trials: stats.trials,
            avg_wagered: stats.mean_wagered(),
            avg_net: stats.mean_net(),
            edge: stats.house_edge(),
            stderr: stats.stderr(),
        });
    }

    // Roulette (zero rules: 0=Standard,1=LaPartage,2=EnPrison,3=EnPrisonDouble,4=American)
    let roulette_bets = vec![
        ("STRAIGHT", 0u8, 1u8),
        ("RED", 1u8, 0u8),
        ("BLACK", 2u8, 0u8),
        ("EVEN", 3u8, 0u8),
        ("ODD", 4u8, 0u8),
        ("LOW", 5u8, 0u8),
        ("HIGH", 6u8, 0u8),
        ("DOZEN", 7u8, 0u8),
        ("COLUMN", 8u8, 0u8),
        ("SPLIT_H", 9u8, 1u8),
        ("SPLIT_V", 10u8, 1u8),
        ("STREET", 11u8, 1u8),
        ("CORNER", 12u8, 1u8),
        ("SIX_LINE", 13u8, 1u8),
    ];
    let zero_rules = vec![
        ("STANDARD", 0u8),
        ("LA_PARTAGE", 1u8),
        ("EN_PRISON", 2u8),
        ("EN_PRISON_DOUBLE", 3u8),
        ("AMERICAN", 4u8),
    ];
    for (rule_label, rule) in zero_rules {
        for (bet_label, bet_type, number) in &roulette_bets {
            let label = format!("{} ({})", bet_label, rule_label);
            let stats = sim_roulette(*bet_type, *number, BASE_BET, rule, TRIALS, &seed, &player);
            results.push(ResultRow {
                game: "Roulette".to_string(),
                bet: label,
                trials: stats.trials,
                avg_wagered: stats.mean_wagered(),
                avg_net: stats.mean_net(),
                edge: stats.house_edge(),
                stderr: stats.stderr(),
            });
        }
    }

    // Sic Bo
    let sicbo_bets = vec![
        ("SMALL", 0u8, 0u8),
        ("BIG", 1u8, 0u8),
        ("ODD", 2u8, 0u8),
        ("EVEN", 3u8, 0u8),
        ("SPECIFIC_TRIPLE", 4u8, 1u8),
        ("ANY_TRIPLE", 5u8, 0u8),
        ("SPECIFIC_DOUBLE", 6u8, 1u8),
        ("SINGLE", 8u8, 1u8),
        ("DOMINO(1-2)", 9u8, (1u8 << 4) | 2u8),
        ("HOP3_EASY(1,2,3)", 10u8, 0b000111),
        ("HOP3_HARD(2-2-3)", 11u8, (2u8 << 4) | 3u8),
        ("HOP4_EASY(1,2,3,4)", 12u8, 0b001111),
    ];
    for (label, bet_type, number) in sicbo_bets {
        let stats = sim_sicbo(bet_type, number, BASE_BET, TRIALS, &seed, &player);
        results.push(ResultRow {
            game: "SicBo".to_string(),
            bet: label.to_string(),
            trials: stats.trials,
            avg_wagered: stats.mean_wagered(),
            avg_net: stats.mean_net(),
            edge: stats.house_edge(),
            stderr: stats.stderr(),
        });
    }
    for total in 3u8..=18u8 {
        let label = format!("TOTAL_{}", total);
        let stats = sim_sicbo(7u8, total, BASE_BET, TRIALS, &seed, &player);
        results.push(ResultRow {
            game: "SicBo".to_string(),
            bet: label,
            trials: stats.trials,
            avg_wagered: stats.mean_wagered(),
            avg_net: stats.mean_net(),
            edge: stats.house_edge(),
            stderr: stats.stderr(),
        });
    }

    // Craps
    let mut pass_stats = sim_craps_simple(0u8, 0u8, BASE_BET, TRIALS, &seed, &player);
    results.push(ResultRow {
        game: "Craps".to_string(),
        bet: "PASS".to_string(),
        trials: pass_stats.trials,
        avg_wagered: pass_stats.mean_wagered(),
        avg_net: pass_stats.mean_net(),
        edge: pass_stats.house_edge(),
        stderr: pass_stats.stderr(),
    });
    let mut dont_pass_stats = sim_craps_simple(1u8, 0u8, BASE_BET, TRIALS, &seed, &player);
    results.push(ResultRow {
        game: "Craps".to_string(),
        bet: "DONT_PASS".to_string(),
        trials: dont_pass_stats.trials,
        avg_wagered: dont_pass_stats.mean_wagered(),
        avg_net: dont_pass_stats.mean_net(),
        edge: dont_pass_stats.house_edge(),
        stderr: dont_pass_stats.stderr(),
    });

    // Come / Don't Come (standalone PnL tracking)
    let come_stats = sim_craps_come_bet(false, BASE_BET, TRIALS, &seed, &player);
    results.push(ResultRow {
        game: "Craps".to_string(),
        bet: "COME".to_string(),
        trials: come_stats.trials,
        avg_wagered: come_stats.mean_wagered(),
        avg_net: come_stats.mean_net(),
        edge: come_stats.house_edge(),
        stderr: come_stats.stderr(),
    });

    let dont_come_stats = sim_craps_come_bet(true, BASE_BET, TRIALS, &seed, &player);
    results.push(ResultRow {
        game: "Craps".to_string(),
        bet: "DONT_COME".to_string(),
        trials: dont_come_stats.trials,
        avg_wagered: dont_come_stats.mean_wagered(),
        avg_net: dont_come_stats.mean_net(),
        edge: dont_come_stats.house_edge(),
        stderr: dont_come_stats.stderr(),
    });

    // Field
    let stats = sim_craps_simple(4u8, 0u8, BASE_BET, TRIALS, &seed, &player);
    results.push(ResultRow {
        game: "Craps".to_string(),
        bet: "FIELD".to_string(),
        trials: stats.trials,
        avg_wagered: stats.mean_wagered(),
        avg_net: stats.mean_net(),
        edge: stats.house_edge(),
        stderr: stats.stderr(),
    });

    // Yes/No (Place/Lay) for targets 2..12 except 7
    for target in 2u8..=12u8 {
        if target == 7 { continue; }
        let label = format!("YES_{}", target);
        let stats = sim_craps_simple(5u8, target, BASE_BET, TRIALS, &seed, &player);
        results.push(ResultRow {
            game: "Craps".to_string(),
            bet: label,
            trials: stats.trials,
            avg_wagered: stats.mean_wagered(),
            avg_net: stats.mean_net(),
            edge: stats.house_edge(),
            stderr: stats.stderr(),
        });
    }
    for target in 2u8..=12u8 {
        if target == 7 { continue; }
        let label = format!("NO_{}", target);
        let stats = sim_craps_simple(6u8, target, BASE_BET, TRIALS, &seed, &player);
        results.push(ResultRow {
            game: "Craps".to_string(),
            bet: label,
            trials: stats.trials,
            avg_wagered: stats.mean_wagered(),
            avg_net: stats.mean_net(),
            edge: stats.house_edge(),
            stderr: stats.stderr(),
        });
    }

    // Next (Hop) bets
    for target in 2u8..=12u8 {
        let label = format!("NEXT_{}", target);
        let stats = sim_craps_simple(7u8, target, BASE_BET, TRIALS, &seed, &player);
        results.push(ResultRow {
            game: "Craps".to_string(),
            bet: label,
            trials: stats.trials,
            avg_wagered: stats.mean_wagered(),
            avg_net: stats.mean_net(),
            edge: stats.house_edge(),
            stderr: stats.stderr(),
        });
    }

    // Hardways
    let hardways = vec![
        ("HARDWAY_4", 8u8),
        ("HARDWAY_6", 9u8),
        ("HARDWAY_8", 10u8),
        ("HARDWAY_10", 11u8),
    ];
    for (label, bet_type) in hardways {
        let stats = sim_craps_simple(bet_type, 0u8, BASE_BET, TRIALS, &seed, &player);
        results.push(ResultRow {
            game: "Craps".to_string(),
            bet: label.to_string(),
            trials: stats.trials,
            avg_wagered: stats.mean_wagered(),
            avg_net: stats.mean_net(),
            edge: stats.house_edge(),
            stderr: stats.stderr(),
        });
    }

    // Bonus bets
    let bonus_bets = vec![
        ("FIRE", 12u8),
        ("ATS_SMALL", 15u8),
        ("ATS_TALL", 16u8),
        ("ATS_ALL", 17u8),
        ("MUGGSY", 18u8),
        ("DIFF_DOUBLES", 19u8),
        ("RIDE_LINE", 20u8),
        ("REPLAY", 21u8),
        ("HOT_ROLLER", 22u8),
    ];
    for (label, bet_type) in bonus_bets {
        let stats = sim_craps_simple(bet_type, 0u8, BASE_BET, TRIALS, &seed, &player);
        results.push(ResultRow {
            game: "Craps".to_string(),
            bet: label.to_string(),
            trials: stats.trials,
            avg_wagered: stats.mean_wagered(),
            avg_net: stats.mean_net(),
            edge: stats.house_edge(),
            stderr: stats.stderr(),
        });
    }

    // Blackjack main + side bet
    let bj_main = sim_blackjack_main(TRIALS, BASE_BET, &seed, &player);
    results.push(ResultRow {
        game: "Blackjack".to_string(),
        bet: "MAIN".to_string(),
        trials: bj_main.trials,
        avg_wagered: bj_main.mean_wagered(),
        avg_net: bj_main.mean_net(),
        edge: bj_main.house_edge(),
        stderr: bj_main.stderr(),
    });

    let bj_with_side = sim_blackjack_with_side(TRIALS, BASE_BET, SIDE_BET, &seed, &player);
    let side_ev = bj_with_side.mean_net() - bj_main.mean_net();
    let side_edge = -side_ev / (SIDE_BET as f64);
    results.push(ResultRow {
        game: "Blackjack".to_string(),
        bet: "21+3".to_string(),
        trials: bj_with_side.trials,
        avg_wagered: SIDE_BET as f64,
        avg_net: side_ev,
        edge: side_edge,
        stderr: bj_with_side.stderr(),
    });

    // Casino War
    let cw_main = sim_casino_war_main(TRIALS, BASE_BET, &seed, &player);
    results.push(ResultRow {
        game: "CasinoWar".to_string(),
        bet: "MAIN".to_string(),
        trials: cw_main.trials,
        avg_wagered: cw_main.mean_wagered(),
        avg_net: cw_main.mean_net(),
        edge: cw_main.house_edge(),
        stderr: cw_main.stderr(),
    });

    let cw_with_tie = sim_casino_war_tie(TRIALS, BASE_BET, SIDE_BET, &seed, &player);
    let tie_ev = cw_with_tie.mean_net() - cw_main.mean_net();
    let tie_edge = -tie_ev / (SIDE_BET as f64);
    results.push(ResultRow {
        game: "CasinoWar".to_string(),
        bet: "TIE".to_string(),
        trials: cw_with_tie.trials,
        avg_wagered: SIDE_BET as f64,
        avg_net: tie_ev,
        edge: tie_edge,
        stderr: cw_with_tie.stderr(),
    });

    // Video Poker
    let vp = sim_video_poker(TRIALS, BASE_BET, &seed, &player);
    results.push(ResultRow {
        game: "VideoPoker".to_string(),
        bet: "MAIN".to_string(),
        trials: vp.trials,
        avg_wagered: vp.mean_wagered(),
        avg_net: vp.mean_net(),
        edge: vp.house_edge(),
        stderr: vp.stderr(),
    });

    // Hi-Lo
    let hilo = sim_hilo(TRIALS, HILO_BET, &seed, &player);
    results.push(ResultRow {
        game: "HiLo".to_string(),
        bet: "ONE_GUESS_CASHOUT".to_string(),
        trials: hilo.trials,
        avg_wagered: hilo.mean_wagered(),
        avg_net: hilo.mean_net(),
        edge: hilo.house_edge(),
        stderr: hilo.stderr(),
    });

    // Three Card Poker
    let tc_main = sim_three_card_main(TRIALS, BASE_BET, &seed, &player);
    results.push(ResultRow {
        game: "ThreeCard".to_string(),
        bet: "MAIN".to_string(),
        trials: tc_main.trials,
        avg_wagered: tc_main.mean_wagered(),
        avg_net: tc_main.mean_net(),
        edge: tc_main.house_edge(),
        stderr: tc_main.stderr(),
    });

    let tc_pairplus = sim_three_card_with_side(TRIALS, BASE_BET, SIDE_BET, 0, 0, &seed, &player);
    let pp_ev = tc_pairplus.mean_net() - tc_main.mean_net();
    results.push(ResultRow {
        game: "ThreeCard".to_string(),
        bet: "PAIRPLUS".to_string(),
        trials: tc_pairplus.trials,
        avg_wagered: SIDE_BET as f64,
        avg_net: pp_ev,
        edge: -pp_ev / (SIDE_BET as f64),
        stderr: tc_pairplus.stderr(),
    });

    let tc_six = sim_three_card_with_side(TRIALS, BASE_BET, 0, SIDE_BET, 0, &seed, &player);
    let six_ev = tc_six.mean_net() - tc_main.mean_net();
    results.push(ResultRow {
        game: "ThreeCard".to_string(),
        bet: "SIX_CARD_BONUS".to_string(),
        trials: tc_six.trials,
        avg_wagered: SIDE_BET as f64,
        avg_net: six_ev,
        edge: -six_ev / (SIDE_BET as f64),
        stderr: tc_six.stderr(),
    });

    let tc_prog = sim_three_card_with_side(TRIALS, BASE_BET, 0, 0, 1, &seed, &player);
    let prog_ev = tc_prog.mean_net() - tc_main.mean_net();
    results.push(ResultRow {
        game: "ThreeCard".to_string(),
        bet: "PROGRESSIVE".to_string(),
        trials: tc_prog.trials,
        avg_wagered: 1.0,
        avg_net: prog_ev,
        edge: -prog_ev / 1.0,
        stderr: tc_prog.stderr(),
    });

    // Ultimate Hold'em
    let uth_main = sim_uth_main(TRIALS, BASE_BET, &seed, &player);
    results.push(ResultRow {
        game: "UltimateHoldem".to_string(),
        bet: "MAIN".to_string(),
        trials: uth_main.trials,
        avg_wagered: uth_main.mean_wagered(),
        avg_net: uth_main.mean_net(),
        edge: uth_main.house_edge(),
        stderr: uth_main.stderr(),
    });

    let uth_trips = sim_uth_with_side(TRIALS, BASE_BET, SIDE_BET, 0, 0, &seed, &player);
    let trips_ev = uth_trips.mean_net() - uth_main.mean_net();
    results.push(ResultRow {
        game: "UltimateHoldem".to_string(),
        bet: "TRIPS".to_string(),
        trials: uth_trips.trials,
        avg_wagered: SIDE_BET as f64,
        avg_net: trips_ev,
        edge: -trips_ev / (SIDE_BET as f64),
        stderr: uth_trips.stderr(),
    });

    let uth_six = sim_uth_with_side(TRIALS, BASE_BET, 0, SIDE_BET, 0, &seed, &player);
    let uth_six_ev = uth_six.mean_net() - uth_main.mean_net();
    results.push(ResultRow {
        game: "UltimateHoldem".to_string(),
        bet: "SIX_CARD_BONUS".to_string(),
        trials: uth_six.trials,
        avg_wagered: SIDE_BET as f64,
        avg_net: uth_six_ev,
        edge: -uth_six_ev / (SIDE_BET as f64),
        stderr: uth_six.stderr(),
    });

    let uth_prog = sim_uth_with_side(TRIALS, BASE_BET, 0, 0, 1, &seed, &player);
    let uth_prog_ev = uth_prog.mean_net() - uth_main.mean_net();
    results.push(ResultRow {
        game: "UltimateHoldem".to_string(),
        bet: "PROGRESSIVE".to_string(),
        trials: uth_prog.trials,
        avg_wagered: 1.0,
        avg_net: uth_prog_ev,
        edge: -uth_prog_ev / 1.0,
        stderr: uth_prog.stderr(),
    });

    if std::env::var("VIDEO_POKER_DIAG").is_ok() {
        let diag_trials = std::env::var("VIDEO_POKER_DIAG_TRIALS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(TRIALS);
        let (vp_stats, vp_by_hand, vp_by_hand_initial, vp_summary) =
            sim_video_poker_diag(diag_trials, BASE_BET, &seed, &player);
        eprintln!(
            "VIDEO_POKER_DIAG trials={} edge={:.4}% avg_net={:.4} avg_wagered={:.4}",
            vp_stats.trials,
            vp_stats.house_edge() * 100.0,
            vp_stats.mean_net(),
            vp_stats.mean_wagered()
        );
        eprintln!(
            "VIDEO_POKER_DIAG duplicates={} invalid_cards={}",
            vp_summary.duplicate_hands, vp_summary.invalid_cards
        );
        eprintln!("hand,count,frequency,avg_return,avg_net");
        for (hand, diag) in vp_by_hand {
            let freq = if vp_stats.trials == 0 {
                0.0
            } else {
                diag.count as f64 / vp_stats.trials as f64
            };
            let avg_return = if diag.count == 0 {
                0.0
            } else {
                diag.total_return as f64 / diag.count as f64
            };
            let avg_net = if diag.count == 0 {
                0.0
            } else {
                diag.total_net as f64 / diag.count as f64
            };
            eprintln!(
                "{},{},{:.6},{:.4},{:.4}",
                video_poker_hand_label(hand),
                diag.count,
                freq,
                avg_return,
                avg_net
            );
        }
        eprintln!("hand_initial,count,frequency");
        for (hand, diag) in vp_by_hand_initial {
            let freq = if vp_stats.trials == 0 {
                0.0
            } else {
                diag.count as f64 / vp_stats.trials as f64
            };
            eprintln!(
                "{},{},{:.6}",
                video_poker_hand_label(hand),
                diag.count,
                freq
            );
        }
    }

    // Print CSV
    println!("game,bet,trials,avg_wagered,avg_net,house_edge,stderr");
    for row in results {
        println!(
            "{},{},{},{:.4},{:.4},{:.6},{:.6}",
            row.game,
            row.bet,
            row.trials,
            row.avg_wagered,
            row.avg_net,
            row.edge,
            row.stderr
        );
    }
}
