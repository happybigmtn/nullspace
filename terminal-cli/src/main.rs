use std::collections::{BTreeMap, HashMap, HashSet};
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use argon2::{password_hash::SaltString, Argon2};
use base64::{engine::general_purpose, Engine as _};
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use chrono::Local;
use clap::Parser;
use crossterm::event::{Event as CEvent, EventStream, KeyCode, KeyEvent, KeyModifiers};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode};
use hex;
use directories::ProjectDirs;
use ed25519_dalek::{SigningKey, VerifyingKey};
use futures::{SinkExt, StreamExt};
use lazy_static::lazy_static;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap};
use ratatui::Terminal;
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::select;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

/// CLI flags (user-provided override persisted config)
#[derive(Parser, Debug)]
#[command(name = "nullspace-terminal", about = "Nullspace ratatui CLI (real gateway)")]
struct Args {
    /// Gateway WS URL (wss://api.testnet.regenesis.dev)
    #[arg(long)]
    gateway: Option<String>,

    /// Optional startup faucet amount
    #[arg(long)]
    faucet_amount: Option<u64>,

    /// Print raw JSON in log pane
    #[arg(long)]
    verbose: bool,
}

#[derive(Clone)]
struct CommandDef {
    name: &'static str,
    usage: &'static str,
    desc: &'static str,
    group: &'static str,
}

const fn cmd(name: &'static str, usage: &'static str, desc: &'static str, group: &'static str) -> CommandDef {
    CommandDef { name, usage, desc, group }
}

lazy_static! {
    static ref COMMANDS: Vec<CommandDef> = vec![
        // Session
        cmd("help", "/help", "Show grouped palette", "Session"),
        cmd("status", "/status", "Show connection + balance", "Session"),
        cmd("balance", "/balance", "Fetch on-chain balance", "Session"),
        cmd("faucet", "/faucet [amt]", "Claim faucet (rate limited)", "Session"),
        cmd("reconnect", "/reconnect", "Force reconnect", "Session"),
        cmd("quit", "/quit", "Exit", "Session"),
        cmd("vault", "/vault [status|unlock|create|lock|delete]", "Manage local vault", "Session"),
        // Blackjack
        cmd("bj", "/bj deal <amt> [side]|hit|stand|double|split", "Blackjack actions", "Blackjack"),
        cmd("hit", "/hit", "Shortcut hit", "Blackjack"),
        cmd("stand", "/stand", "Shortcut stand", "Blackjack"),
        cmd("double", "/double", "Shortcut double", "Blackjack"),
        cmd("split", "/split", "Shortcut split", "Blackjack"),
        // Roulette
        cmd("roulette", "/roulette <red|black|odd|even|high|low|number N> <amt>", "Spin with bets", "Roulette"),
        // Craps
        cmd("craps", "/craps <PASS|DONT_PASS|FIELD|YES|NO> <amt> [target]", "Single bet + roll", "Craps"),
        // Sic Bo
        cmd("sicbo", "/sicbo <SMALL|BIG|ODD|EVEN|SINGLE N> <amt>", "Sic Bo roll", "Sic Bo"),
        // Baccarat
        cmd("baccarat", "/baccarat <PLAYER|BANKER|TIE> <amt>", "Baccarat deal", "Baccarat"),
        // Hi-Lo
        cmd("hilo", "/hilo <amt> <higher|lower|same>", "Hi-Lo bet + guess", "Hi-Lo"),
        cmd("hilo_cashout", "/hilo_cashout", "Cash out streak", "Hi-Lo"),
        // Casino War
        cmd("war", "/war deal <amt> [tie]|go|surrender", "Casino War flow", "Casino War"),
        // Video Poker
        cmd("vp", "/vp deal <amt>|hold <binaryMask>", "Video Poker deal/draw", "Video Poker"),
    ];
    static ref COMPLETIONS: HashSet<String> = COMMANDS.iter().map(|c| format!("/{}", c.name)).collect();
    static ref GROUPS: Vec<&'static str> = {
        let mut g: Vec<_> = COMMANDS.iter().map(|c| c.group).collect();
        g.sort();
        g.dedup();
        g
    };
    static ref HINTS: HashMap<String, String> = COMMANDS
        .iter()
        .map(|c| (format!("/{}", c.name), format!("{} — {}", c.usage, c.desc)))
        .collect();
    static ref TEMPLATES: HashMap<&'static str, &'static str> = HashMap::from([
        ("roulette", "/roulette number 7 10   | /roulette red 25"),
        ("craps", "/craps PASS 10   | /craps YES 5 6"),
        ("sicbo", "/sicbo SMALL 10  | /sicbo SINGLE 3 5"),
        ("bj", "/bj deal 25 5  | /hit /stand"),
        ("war", "/war deal 20 5 | /war go"),
        ("hilo", "/hilo 10 higher"),
        ("baccarat", "/baccarat PLAYER 20"),
        ("vp", "/vp deal 10 | /vp hold 10100"),
    ]);
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedConfig {
    gateway: Option<String>,
    faucet_amount: Option<u64>,
    verbose: Option<bool>,
}

struct AppState {
    input: String,
    logs: Vec<String>,
    status: String,
    hint: String,
    vault: VaultStatus,
    current_game: Game,
    chip_value: u64,
    board: BoardState,
    completion: CompletionState,
    verbose: bool,
}

enum UiEvent {
    WsLog(String),
    WsRaw(String),
    UpdateBoard(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Game {
    Baccarat,
    Blackjack,
    CasinoWar,
    Craps,
    HiLo,
    Roulette,
    SicBo,
    ThreeCardPoker,
    UltimateHoldem,
}

const GAME_ORDER: [Game; 9] = [
    Game::Baccarat,
    Game::Blackjack,
    Game::CasinoWar,
    Game::Craps,
    Game::HiLo,
    Game::Roulette,
    Game::SicBo,
    Game::ThreeCardPoker,
    Game::UltimateHoldem,
];

impl Game {
    fn name(&self) -> &'static str {
        match self {
            Game::Baccarat => "Baccarat",
            Game::Blackjack => "Blackjack",
            Game::CasinoWar => "Casino War",
            Game::Craps => "Craps",
            Game::HiLo => "Hi-Lo",
            Game::Roulette => "Roulette",
            Game::SicBo => "Sic Bo",
            Game::ThreeCardPoker => "Three Card",
            Game::UltimateHoldem => "Ultimate Hold'em",
        }
    }
}

fn set_game_by_index(app: &mut AppState, idx: usize) {
    if let Some(g) = GAME_ORDER.get(idx) {
        app.current_game = *g;
        app.hint = format!("Switched to {}", app.current_game.name());
    }
}

fn game_from_str(name: &str) -> Option<Game> {
    let n = name.to_lowercase();
    let val = match n.as_str() {
        "baccarat" => Game::Baccarat,
        "blackjack" | "bj" => Game::Blackjack,
        "casinowar" | "war" => Game::CasinoWar,
        "craps" => Game::Craps,
        "hilo" | "hi-lo" => Game::HiLo,
        "roulette" => Game::Roulette,
        "sicbo" | "sic_bo" => Game::SicBo,
        "threecard" | "three_card" | "3card" => Game::ThreeCardPoker,
        "ultimate" | "holdem" | "ultimateholdem" => Game::UltimateHoldem,
        _ => return None,
    };
    Some(val)
}

#[derive(Clone, Default)]
struct BoardState {
    last_result: String,
    last_bet: String,
    balance: String,
    last_payout: String,
}

#[derive(Default)]
struct CompletionState {
    filtered: Vec<usize>,
    selected: usize,
}

fn render_games_line(app: &AppState) -> String {
    let mut parts = Vec::new();
    for (i, g) in GAME_ORDER.iter().enumerate() {
        let label = format!("{}{}", i + 1, g.name());
        if *g == app.current_game {
            parts.push(format!("[{}]", label));
        } else {
            parts.push(label);
        }
    }
    format!("Games: {}", parts.join("  "))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VaultStatus {
    Missing,
    Locked,
    Unlocked,
}

#[derive(Debug)]
enum CommandAction {
    Send(String),
    Local(String),
    Quit,
    Reconnect,
    VaultStatus,
    VaultUnlock(String),
    VaultCreate(String),
    VaultLock,
    VaultDelete,
    SetGame(Game),
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let mut cfg = load_config().unwrap_or_default();

    let gateway = args
        .gateway
        .clone()
        .or_else(|| cfg.gateway.clone())
        .unwrap_or_else(|| "wss://api.testnet.regenesis.dev".to_string());
    let faucet_amount = args
        .faucet_amount
        .or(cfg.faucet_amount)
        .unwrap_or(1000);
    let verbose = args.verbose || cfg.verbose.unwrap_or(false);

    cfg.gateway = Some(gateway.clone());
    cfg.faucet_amount = Some(faucet_amount);
    cfg.verbose = Some(verbose);
    save_config(&cfg)?;

    let (ws_tx, ws_rx) = mpsc::unbounded_channel::<Message>();
    let (ui_tx, mut ui_rx) = mpsc::unbounded_channel::<UiEvent>();

    // WebSocket loop
    tokio::spawn(ws_loop(
        gateway.clone(),
        faucet_amount,
        verbose,
        ws_rx,
        ui_tx.clone(),
    ));

    // TUI setup
    enable_raw_mode().context("enable raw mode")?;
    let mut stdout = io::stdout();
    crossterm::execute!(stdout, crossterm::terminal::EnterAlternateScreen)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    let mut app = AppState {
        input: String::new(),
        logs: vec!["Connected… waiting for session_ready".to_string()],
        status: format!("Gateway: {gateway} | Faucet: {faucet_amount} | Verbose: {verbose}"),
        hint: String::from("Type /help or Tab for completions"),
        vault: vault_status(),
        current_game: Game::Blackjack,
        chip_value: 10,
        board: BoardState::default(),
        completion: CompletionState::default(),
        verbose,
    };

    let mut events = EventStream::new();
    let mut last_tick = Instant::now();
    let tick_rate = Duration::from_millis(200);

    loop {
        terminal.draw(|f| draw_ui(f, &app))?;

        let timeout = tick_rate
            .checked_sub(last_tick.elapsed())
            .unwrap_or(Duration::from_millis(0));

        select! {
            maybe_ev = events.next() => {
                if let Some(Ok(ev)) = maybe_ev {
                    if handle_key_event(ev, &mut app, &ws_tx)? {
                        break;
                    }
                }
            }
            Some(ui_msg) = ui_rx.recv() => {
                match ui_msg {
            UiEvent::WsLog(line) => push_log(&mut app, line),
            UiEvent::WsRaw(raw) => {
                if app.verbose { push_log(&mut app, raw); }
            }
            UiEvent::UpdateBoard(raw) => {
                update_board_from_json(&raw, &mut app);
            }
        }
            }
            _ = tokio::time::sleep(timeout) => {
                last_tick = Instant::now();
            }
        }
    }

    disable_raw_mode()?;
    crossterm::execute!(
        terminal.backend_mut(),
        crossterm::terminal::LeaveAlternateScreen,
        crossterm::cursor::Show
    )?;
    terminal.show_cursor()?;
    Ok(())
}

fn draw_ui(f: &mut ratatui::Frame, app: &AppState) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(2), Constraint::Min(1), Constraint::Length(3)].as_ref())
        .split(f.area());

    // Status line
    let status = Paragraph::new(format!(
        "{} | Game {} | Chip {} | Vault {}",
        app.status,
        app.current_game.name(),
        app.chip_value,
        match app.vault {
            VaultStatus::Missing => "MISSING",
            VaultStatus::Locked => "LOCKED",
            VaultStatus::Unlocked => "UNLOCKED",
        }
    ))
    .style(Style::default().fg(Color::Gray));
    f.render_widget(status, chunks[0]);
    let games_line = Paragraph::new(render_games_line(app))
        .style(Style::default().fg(Color::Gray));
    f.render_widget(games_line, Rect {
        x: chunks[0].x,
        y: chunks[0].y.saturating_add(1),
        width: chunks[0].width,
        height: 1,
    });

    // Main area split into board + log
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)].as_ref())
        .split(chunks[1]);

    // Game state board
    let board_lines = render_board(app);
    let board_list = List::new(board_lines)
        .block(Block::default().borders(Borders::ALL).title(format!("Board: {}", app.current_game.name())));
    f.render_widget(board_list, main_chunks[0]);

    // Log pane
    let log_lines: Vec<Line> = app
        .logs
        .iter()
        .rev()
        .take((main_chunks[1].height.saturating_sub(2)) as usize)
        .rev()
        .map(|l| Line::raw(l.clone()))
        .collect();
    let log = Paragraph::new(log_lines)
        .block(Block::default().borders(Borders::ALL).title("Log"))
        .wrap(Wrap { trim: true });
    f.render_widget(log, main_chunks[1]);

    // Input + hint + completions
    let bottom_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(if app.completion.filtered.is_empty() { 0 } else { (app.completion.filtered.len() as u16).min(6) }),
        ].as_ref())
        .split(chunks[2]);

    let input_block = Block::default().borders(Borders::ALL).title("Input");
    f.render_widget(Clear, bottom_chunks[0]);
    f.render_widget(input_block, bottom_chunks[0]);

    let prompt = format!("casino $ {}", app.input);
    let input_para = Paragraph::new(prompt);
    f.render_widget(input_para, bottom_chunks[0]);

    // Hint overlay
    if !app.hint.is_empty() {
        let hint = Paragraph::new(app.hint.as_str())
            .style(Style::default().fg(Color::Gray));
        f.render_widget(hint, bottom_chunks[0]);
    }

    if !app.completion.filtered.is_empty() && bottom_chunks.len() > 1 {
        let items: Vec<ListItem> = app.completion.filtered.iter().map(|&idx| {
            let cmd = &COMMANDS[idx];
            ListItem::new(Line::from(vec![
                Span::styled(format!("/{}", cmd.name), Style::default().fg(Color::Cyan)),
                Span::raw("  "),
                Span::styled(cmd.desc, Style::default().fg(Color::Gray)),
            ]))
        }).collect();
        let mut state = ListState::default();
        state.select(Some(app.completion.selected.min(items.len().saturating_sub(1))));
        let list = List::new(items)
            .block(Block::default().borders(Borders::ALL).title("Commands"))
            .highlight_style(Style::default().fg(Color::Yellow));
        f.render_stateful_widget(list, bottom_chunks[1], &mut state);
    }
}

fn render_board(app: &AppState) -> Vec<ListItem<'static>> {
    let mut lines: Vec<ListItem> = Vec::new();
    let add = |lines: &mut Vec<ListItem>, label: &str, value: String| {
        lines.push(ListItem::new(Line::from(vec![
            Span::styled(format!("{label}: "), Style::default().fg(Color::Yellow)),
            Span::raw(value),
        ])));
    };

    match app.current_game {
        Game::Blackjack => {
            add(&mut lines, "Last", app.board.last_result.clone());
            add(&mut lines, "Last Bet", app.board.last_bet.clone());
            add(&mut lines, "Payout", app.board.last_payout.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
            add(&mut lines, "Next", "Hit(H) / Stand(S) / Double(D) / Split(P)".into());
        }
        Game::Roulette => {
            add(&mut lines, "Last Spin", app.board.last_result.clone());
            add(&mut lines, "Bet", app.board.last_bet.clone());
            add(&mut lines, "Payout", app.board.last_payout.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
            add(&mut lines, "Quick", "Ctrl-1..9 to switch games; /b for bets".into());
        }
        Game::Craps => {
            add(&mut lines, "Last Roll", app.board.last_result.clone());
            add(&mut lines, "Bet", app.board.last_bet.clone());
            add(&mut lines, "Payout", app.board.last_payout.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
            add(&mut lines, "Shortcuts", "/b y 6 (YES 6), /b n 8 (NO 8), /b x 5 (NEXT 5), /b c c (COME 12)".into());
        }
        Game::SicBo => {
            add(&mut lines, "Last Dice", app.board.last_result.clone());
            add(&mut lines, "Bet", app.board.last_bet.clone());
            add(&mut lines, "Payout", app.board.last_payout.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
            add(&mut lines, "Quick", "SMALL/BIG/ODD/EVEN/SINGLE".into());
        }
        Game::Baccarat => {
            add(&mut lines, "Last Hand", app.board.last_result.clone());
            add(&mut lines, "Bet", app.board.last_bet.clone());
            add(&mut lines, "Payout", app.board.last_payout.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
            add(&mut lines, "Quick", "PLAYER / BANKER / TIE / PAIRS".into());
        }
        Game::CasinoWar => {
            add(&mut lines, "Last Hand", app.board.last_result.clone());
            add(&mut lines, "Bet", app.board.last_bet.clone());
            add(&mut lines, "Payout", app.board.last_payout.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
            add(&mut lines, "Quick", "/war deal <amt> [tie], then /war go".into());
        }
        Game::HiLo => {
            add(&mut lines, "Last Card", app.board.last_result.clone());
            add(&mut lines, "Payout", app.board.last_payout.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
            add(&mut lines, "Quick", "/hilo <amt> higher|lower|same".into());
        }
        Game::ThreeCardPoker => {
            add(&mut lines, "State", app.board.last_result.clone());
            add(&mut lines, "Bet", app.board.last_bet.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
        }
        Game::UltimateHoldem => {
            add(&mut lines, "State", app.board.last_result.clone());
            add(&mut lines, "Bet", app.board.last_bet.clone());
            add(&mut lines, "Chip", app.chip_value.to_string());
        }
    }

    if lines.is_empty() {
        lines.push(ListItem::new(Line::raw("Waiting for game data…")));
    }
    lines
}

fn centered_rect(width: u16, height: u16, r: Rect) -> Rect {
    let x = r.x + 1;
    let y = r.y + 1;
    Rect::new(x, y, width.saturating_sub(2), height.saturating_sub(2))
}

fn handle_key_event(ev: CEvent, app: &mut AppState, ws_tx: &mpsc::UnboundedSender<Message>) -> Result<bool> {
    if let CEvent::Key(KeyEvent { code, modifiers, .. }) = ev {
        match (code, modifiers) {
            (KeyCode::Char('c'), KeyModifiers::CONTROL) => return Ok(true),
            (KeyCode::Char('d'), KeyModifiers::CONTROL) => return Ok(true),
            (KeyCode::Char(c @ '1'..='9'), m) if m.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                let idx = (c as u8 - b'1') as usize;
                set_game_by_index(app, idx);
            }
            (KeyCode::Char('1'), KeyModifiers::NONE) => { app.chip_value = 5; update_hint(app); }
            (KeyCode::Char('2'), KeyModifiers::NONE) => { app.chip_value = 10; update_hint(app); }
            (KeyCode::Char('3'), KeyModifiers::NONE) => { app.chip_value = 25; update_hint(app); }
            (KeyCode::Char('4'), KeyModifiers::NONE) => { app.chip_value = 50; update_hint(app); }
            (KeyCode::Char('5'), KeyModifiers::NONE) => { app.chip_value = 100; update_hint(app); }
            (KeyCode::Char('6'), KeyModifiers::NONE) => { app.chip_value = 250; update_hint(app); }
            (KeyCode::Char('7'), KeyModifiers::NONE) => { app.chip_value = 500; update_hint(app); }
            (KeyCode::Char('8'), KeyModifiers::NONE) => { app.chip_value = 1000; update_hint(app); }
            (KeyCode::Char('9'), KeyModifiers::NONE) => { app.chip_value = 5000; update_hint(app); }
            (KeyCode::Char('0'), KeyModifiers::NONE) => { app.hint = "Custom chip: type /chip <amount>".into(); }
            (KeyCode::Up, _) => {
                let len = app.completion.filtered.len();
                if len > 0 {
                    app.completion.selected = app.completion.selected.saturating_add(len - 1) % len;
                }
            }
            (KeyCode::Down, _) => {
                let len = app.completion.filtered.len();
                if len > 0 {
                    app.completion.selected = (app.completion.selected + 1) % len;
                }
            }
            (KeyCode::Tab, _) => {
                if !app.completion.filtered.is_empty() {
                    let idx = app.completion.filtered[app.completion.selected.min(app.completion.filtered.len() - 1)];
                    let cmd = &COMMANDS[idx];
                    app.input = format!("/{} ", cmd.name);
                    update_hint(app);
                } else {
                    autocomplete(app);
                    update_hint(app);
                }
            }
            (KeyCode::Enter, _) => {
                let line = app.input.trim().to_string();
                app.input.clear();
                if line.is_empty() {
                    return Ok(false);
                }
                match handle_line(&line) {
                    Ok(CommandAction::Send(msg)) => {
                        push_log(app, format!("→ {}", line));
                        let _ = ws_tx.send(Message::Text(msg));
                    }
                    Ok(CommandAction::Local(msg)) => push_log(app, msg),
                    Ok(CommandAction::VaultStatus) => push_log(app, vault_status_string()),
                    Ok(CommandAction::VaultUnlock(pw)) => {
                        match vault_unlock(&pw) {
                            Ok(public) => {
                                app.vault = VaultStatus::Unlocked;
                                push_log(app, format!("Vault unlocked · pub {}", public));
                            }
                            Err(e) => push_log(app, format!("Vault unlock failed: {e}")),
                        }
                    }
                    Ok(CommandAction::VaultCreate(pw)) => {
                        match vault_create(&pw) {
                            Ok(public) => {
                                app.vault = VaultStatus::Unlocked;
                                push_log(app, format!("Vault created & unlocked · pub {}", public));
                            }
                            Err(e) => push_log(app, format!("Vault create failed: {e}")),
                        }
                    }
                    Ok(CommandAction::VaultLock) => {
                        vault_lock();
                        app.vault = vault_status();
                        push_log(app, "Vault locked".into());
                    }
                    Ok(CommandAction::VaultDelete) => {
                        match vault_delete() {
                            Ok(_) => {
                                app.vault = vault_status();
                                push_log(app, "Vault deleted".into());
                            }
                            Err(e) => push_log(app, format!("Vault delete failed: {e}")),
                        }
                    }
                    Ok(CommandAction::Reconnect) => {
                        push_log(app, "Reconnect requested…".into());
                        let _ = ws_tx.send(Message::Close(None));
                    }
                    Ok(CommandAction::SetGame(g)) => {
                        app.current_game = g;
                        app.hint = format!("Switched to {}", app.current_game.name());
                    }
                    Ok(CommandAction::Quit) => return Ok(true),
                    Err(e) => push_log(app, format!("⚠️ {}", e)),
                }
                update_hint(app);
            }
            (KeyCode::Char(c), _) => {
                app.input.push(c);
                update_hint(app);
            }
            (KeyCode::Backspace, _) => {
                app.input.pop();
                update_hint(app);
            }
            (KeyCode::Esc, _) => {
                app.input.clear();
                update_hint(app);
            }
            _ => {}
        }
        // Auto-fire contextual bet shortcuts
        let input_ref = app.input.clone();
        maybe_autofire(input_ref, app, ws_tx)?;
    }
    Ok(false)
}

fn autocomplete(app: &mut AppState) {
    let trimmed = app.input.trim_start();
    let (head, tail) = if let Some(space) = trimmed.find(' ') {
        (&trimmed[..space], Some(&trimmed[space + 1..]))
    } else {
        (trimmed, None)
    };
    let mut matches: Vec<&String> = COMPLETIONS
        .iter()
        .filter(|c| c.starts_with(head))
        .collect();
    matches.sort();
    if let Some(first) = matches.first() {
        if let Some(rest) = tail {
            app.input = format!("{first} {rest}");
        } else {
            app.input = first.to_string();
        }
    }
}

fn update_hint(app: &mut AppState) {
    let trimmed_owned = app.input.trim().to_string();
    update_completions(app, &trimmed_owned);
    if trimmed_owned.is_empty() {
        app.hint = "Type /help or Tab for completions".into();
        return;
    }
    let first = trimmed_owned.split_whitespace().next().unwrap_or("");
    if let Some(h) = HINTS.get(&first.to_lowercase()) {
        let tpl = TEMPLATES
            .get(first.trim_start_matches('/'))
            .copied()
            .unwrap_or("");
        if tpl.is_empty() {
            app.hint = h.clone();
        } else {
            app.hint = format!("{h} | {tpl}");
        }
    } else if trimmed_owned.starts_with("/b") {
        app.hint = match app.current_game {
            Game::Craps => "Bet shortcuts: /b y <pt> (YES), /b n <pt> (NO), /b x <pt> (NEXT), letters a/b/c map to 10/11/12".into(),
            Game::Roulette => "Bet: /b r (red) /b k (black) /b o (odd) /b e (even) /b h (high) /b l (low) /b # <n> (number)".into(),
            Game::SicBo => "Bet: /b s (SMALL) /b b (BIG) /b o (ODD) /b e (EVEN) /b d <n> (SINGLE n)".into(),
            Game::Baccarat => "Bet: /b p (PLAYER) /b b (BANKER) /b t (TIE) /b l (LUCKY6)".into(),
            _ => "Bet: type /b then game-specific shortcut".into(),
        };
    } else if trimmed_owned.starts_with("/game") {
        app.hint = "Select game: /game blackjack|roulette|craps... or use Ctrl+1..9 / game list above".into();
    } else {
        app.hint = String::new();
    }
}

fn update_completions(app: &mut AppState, trimmed: &str) {
    app.completion.filtered.clear();
    app.completion.selected = 0;
    if !trimmed.starts_with('/') {
        return;
    }
    let needle = trimmed.trim_start_matches('/').to_lowercase();
    for (idx, cmd) in COMMANDS.iter().enumerate() {
        if cmd.name.starts_with(&needle) {
            app.completion.filtered.push(idx);
        }
    }
}

fn maybe_autofire(current_input: String, app: &mut AppState, ws_tx: &mpsc::UnboundedSender<Message>) -> Result<()> {
    let trimmed = current_input.trim();
    if trimmed.starts_with("/b") {
        let parts: Vec<String> = trimmed[2..].trim().split_whitespace().map(str::to_string).collect();
        if let Ok(action) = handle_bet_shortcut(parts.clone()) {
            if let CommandAction::Send(msg) = action {
                push_log(app, format!("→ {}", trimmed));
                let _ = ws_tx.send(Message::Text(msg));
                // clear the live input buffer
                app.input.clear();
            }
        }
    }
    Ok(())
}

fn push_log(app: &mut AppState, line: String) {
    let ts = Local::now().format("%H:%M:%S");
    app.logs.push(format!("{ts} {line}"));
    if app.logs.len() > 300 {
        let excess = app.logs.len() - 300;
        app.logs.drain(0..excess);
    }
}

fn handle_line(line: &str) -> Result<CommandAction> {
    if !line.starts_with('/') {
        return Err(anyhow!("Commands start with '/'"));
    }
    let mut parts = line[1..].split_whitespace().map(str::to_string).collect::<Vec<_>>();
    if parts.is_empty() {
        return Ok(CommandAction::Local(String::new()));
    }
    let cmd = parts.remove(0).to_lowercase();
    match cmd.as_str() {
        "quit" | "exit" => Ok(CommandAction::Quit),
        "help" => Ok(CommandAction::Local(render_help())),
        "status" => Ok(CommandAction::Local("Connected; use /balance for on-chain value".into())),
        "game" => {
            if let Some(name) = parts.get(0) {
                if let Some(g) = game_from_str(name) {
                    return Ok(CommandAction::SetGame(g));
                }
            }
            return Ok(CommandAction::Local(format!("Games: {}", GAME_ORDER.iter().enumerate().map(|(i,g)| format!("{}={}", i+1, g.name())).collect::<Vec<_>>().join(" | "))));
        }
        "vault" => handle_vault(parts),
        "balance" => Ok(CommandAction::Send(json!({"type":"get_balance"}).to_string())),
        "faucet" => {
            let amt = parts.get(0).and_then(|n| n.parse::<u64>().ok()).unwrap_or(1000);
            Ok(CommandAction::Send(json!({"type":"faucet_claim","amount":amt}).to_string()))
        }
        "chip" => {
            let amt = parts.get(0).and_then(|n| n.parse::<u64>().ok()).ok_or_else(|| anyhow!("Usage: /chip <amount>"))?;
            return Ok(CommandAction::Local(format!("Chip set to {amt}")));
        }
        "reconnect" => Ok(CommandAction::Reconnect),
        "bj" => handle_blackjack(parts),
        "hit" | "stand" | "double" | "split" => handle_blackjack(vec![cmd]),
        "b" => handle_bet_shortcut(parts),
        "roulette" => handle_roulette(parts),
        "craps" => handle_craps(parts),
        "sicbo" | "sic_bo" => handle_sicbo(parts),
        "baccarat" => handle_baccarat(parts),
        "hilo" | "hi-lo" => handle_hilo(parts),
        "hilo_cashout" => Ok(CommandAction::Send(json!({"type":"hilo_cashout"}).to_string())),
        "war" => handle_war(parts),
        "vp" => handle_vp(parts),
        _ => Err(anyhow!("Unknown command /{cmd}")),
    }
}

fn handle_blackjack(args: Vec<String>) -> Result<CommandAction> {
    if args.is_empty() {
        return Err(anyhow!("Usage: /bj deal <amt> [side] | hit | stand | double | split"));
    }
    match args[0].as_str() {
        "deal" | "bjdeal" => {
            let amt: u64 = args.get(1).ok_or_else(|| anyhow!("Provide bet amount"))?.parse()?;
            let side = args.get(2).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            Ok(CommandAction::Send(
                json!({ "type": "blackjack_deal", "amount": amt, "sideBet21p3": side }).to_string(),
            ))
        }
        "hit" => Ok(CommandAction::Send(json!({ "type": "blackjack_hit" }).to_string())),
        "stand" => Ok(CommandAction::Send(json!({ "type": "blackjack_stand" }).to_string())),
        "double" => Ok(CommandAction::Send(json!({ "type": "blackjack_double" }).to_string())),
        "split" => Ok(CommandAction::Send(json!({ "type": "blackjack_split" }).to_string())),
        other => Err(anyhow!("Unknown blackjack action: {other}")),
    }
}

fn handle_roulette(args: Vec<String>) -> Result<CommandAction> {
    if args.len() < 2 {
        return Err(anyhow!("Usage: /roulette <red|black|odd|even|high|low|number N> <amt>"));
    }
    let bet_type = args[0].to_lowercase();
    let amt: u64 = args[1].parse().context("amount")?;
    let mut bet = json!({ "type": bet_type.clone(), "amount": amt });
    if bet_type == "number" {
        let num: u8 = args.get(2).ok_or_else(|| anyhow!("number target required"))?.parse()?;
        bet["number"] = json!(num);
    }
    Ok(CommandAction::Send(json!({ "type": "roulette_spin", "bets": [bet] }).to_string()))
}

fn handle_craps(args: Vec<String>) -> Result<CommandAction> {
    if args.len() < 2 {
        return Err(anyhow!("Usage: /craps <PASS|DONT_PASS|FIELD|YES|NO> <amt> [target]"));
    }
    let bet_type = args[0].to_uppercase();
    let amt: u64 = args[1].parse().context("amount")?;
    let target = args.get(2).and_then(|t| t.parse::<u8>().ok());
    Ok(CommandAction::Send(
        json!({ "type": "craps_bet", "betType": bet_type, "amount": amt, "target": target }).to_string(),
    ))
}

fn handle_bet_shortcut(args: Vec<String>) -> Result<CommandAction> {
    // parse quick bet shortcuts based on first token
    if args.is_empty() {
        return Err(anyhow!("Usage: /b <shortcut> ..."));
    }
    let first = args[0].to_lowercase();
    match first.as_str() {
        // Craps shortcuts
        "y" | "n" | "x" | "a" | "b" | "c" | "come" => {
            let (bet_type, target) = match first.as_str() {
                "y" => ("YES".to_string(), args.get(1).and_then(|v| v.parse::<u8>().ok()).unwrap_or(6)),
                "n" => ("NO".to_string(), args.get(1).and_then(|v| v.parse::<u8>().ok()).unwrap_or(6)),
                "x" => ("NEXT".to_string(), args.get(1).and_then(|v| v.parse::<u8>().ok()).unwrap_or(6)),
                "a" => ("YES".to_string(), 10),
                "b" => ("YES".to_string(), 11),
                "c" => ("YES".to_string(), 12),
                "come" => ("COME".to_string(), args.get(1).and_then(|v| v.parse::<u8>().ok()).unwrap_or(0)),
                _ => ("YES".to_string(), 6),
            };
            let amt = args
                .iter()
                .find_map(|v| v.parse::<u64>().ok())
                .unwrap_or(10);
            return Ok(CommandAction::Send(
                json!({ "type": "craps_bet", "betType": bet_type, "amount": amt, "target": target }).to_string(),
            ));
        }
        // Roulette shortcuts
        "r" => Ok(CommandAction::Send(json!({ "type": "roulette_spin", "bets": [ { "type": "red", "amount": args.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(10) } ] }).to_string())),
        "k" => Ok(CommandAction::Send(json!({ "type": "roulette_spin", "bets": [ { "type": "black", "amount": args.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(10) } ] }).to_string())),
        "#" => {
            let number = args.get(1).and_then(|v| v.parse::<u8>().ok()).unwrap_or(7);
            let amt = args.get(2).and_then(|v| v.parse::<u64>().ok()).unwrap_or(10);
            Ok(CommandAction::Send(json!({ "type": "roulette_spin", "bets": [ { "type": "number", "number": number, "amount": amt } ] }).to_string()))
        }
        // Sic Bo shortcuts
        "s" => Ok(CommandAction::Send(json!({ "type": "sic_bo_roll", "bets": [ { "type": "SMALL", "amount": args.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(10) } ] }).to_string())),
        "b_big" | "bb" | "big" => Ok(CommandAction::Send(json!({ "type": "sic_bo_roll", "bets": [ { "type": "BIG", "amount": args.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(10) } ] }).to_string())),
        "o" => Ok(CommandAction::Send(json!({ "type": "sic_bo_roll", "bets": [ { "type": "ODD", "amount": args.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(10) } ] }).to_string())),
        "e" => Ok(CommandAction::Send(json!({ "type": "sic_bo_roll", "bets": [ { "type": "EVEN", "amount": args.get(1).and_then(|v| v.parse::<u64>().ok()).unwrap_or(10) } ] }).to_string())),
        _ => Err(anyhow!("Unknown bet shortcut")),
    }
}

fn handle_sicbo(args: Vec<String>) -> Result<CommandAction> {
    if args.len() < 2 {
        return Err(anyhow!("Usage: /sicbo <SMALL|BIG|ODD|EVEN|SINGLE N> <amt>"));
    }
    let t = args[0].to_uppercase();
    let amt: u64 = args[1].parse().context("amount")?;
    let mut bet = json!({ "type": t.clone(), "amount": amt });
    if t == "SINGLE" {
        let num: u8 = args.get(2).ok_or_else(|| anyhow!("need single number 1-6"))?.parse()?;
        bet["number"] = json!(num);
    }
    Ok(CommandAction::Send(json!({ "type": "sic_bo_roll", "bets": [bet] }).to_string()))
}

fn handle_baccarat(args: Vec<String>) -> Result<CommandAction> {
    if args.len() < 2 {
        return Err(anyhow!("Usage: /baccarat <PLAYER|BANKER|TIE> <amt>"));
    }
    let bet_type = args[0].to_uppercase();
    let amt: u64 = args[1].parse().context("amount")?;
    Ok(CommandAction::Send(
        json!({ "type": "baccarat_deal", "bets": [ { "type": bet_type, "amount": amt } ] }).to_string(),
    ))
}

fn handle_hilo(args: Vec<String>) -> Result<CommandAction> {
    if args.len() < 2 {
        return Err(anyhow!("Usage: /hilo <amt> <higher|lower|same>"));
    }
    let amt: u64 = args[0].parse().context("amount")?;
    let choice = args[1].to_lowercase();
    if !["higher", "lower", "same"].contains(&choice.as_str()) {
        return Err(anyhow!("choice must be higher|lower|same"));
    }
    Ok(CommandAction::Send(
        json!({ "type": "hilo_bet", "amount": amt, "choice": choice }).to_string(),
    ))
}

fn handle_war(args: Vec<String>) -> Result<CommandAction> {
    if args.is_empty() {
        return Err(anyhow!("Usage: /war deal <amt> [tie] | /war go | /war surrender"));
    }
    match args[0].as_str() {
        "deal" => {
            let amt: u64 = args.get(1).ok_or_else(|| anyhow!("provide amount"))?.parse()?;
            let tie = args.get(2).and_then(|t| t.parse::<u64>().ok()).unwrap_or(0);
            Ok(CommandAction::Send(
                json!({ "type": "casinowar_deal", "amount": amt, "tieBet": tie }).to_string(),
            ))
        }
        "go" | "war" => Ok(CommandAction::Send(json!({ "type": "casinowar_war" }).to_string())),
        "surrender" => Ok(CommandAction::Send(json!({ "type": "casinowar_surrender" }).to_string())),
        other => Err(anyhow!("Unknown /war action {other}")),
    }
}

fn handle_vp(args: Vec<String>) -> Result<CommandAction> {
    if args.is_empty() {
        return Err(anyhow!("Usage: /vp deal <amt> | /vp hold <binaryMask>"));
    }
    match args[0].as_str() {
        "deal" => {
            let amt: u64 = args.get(1).ok_or_else(|| anyhow!("provide amount"))?.parse()?;
            Ok(CommandAction::Send(json!({ "type": "video_poker_deal", "amount": amt }).to_string()))
        }
        "hold" => {
            let mask = args.get(1).ok_or_else(|| anyhow!("provide hold mask e.g. 10100"))?;
            Ok(CommandAction::Send(json!({ "type": "video_poker_draw", "held": mask }).to_string()))
        }
        other => Err(anyhow!("Unknown /vp action {other}")),
    }
}

fn render_help() -> String {
    let mut by_group: BTreeMap<&str, Vec<&CommandDef>> = BTreeMap::new();
    for c in COMMANDS.iter() {
        by_group.entry(c.group).or_default().push(c);
    }
    let mut out = String::new();
    for (group, cmds) in by_group {
        out.push_str(&format!("\n[{group}]\n"));
        for c in cmds {
            out.push_str(&format!("  {:<22} {}\n", c.usage, c.desc));
        }
    }
    out
}

fn handle_vault(args: Vec<String>) -> Result<CommandAction> {
    if args.is_empty() {
        return Ok(CommandAction::VaultStatus);
    }
    match args[0].as_str() {
        "status" => Ok(CommandAction::VaultStatus),
        "unlock" => {
            let pw = args.get(1).ok_or_else(|| anyhow!("Usage: /vault unlock <password>"))?;
            Ok(CommandAction::VaultUnlock(pw.clone()))
        }
        "create" => {
            let pw = args.get(1).ok_or_else(|| anyhow!("Usage: /vault create <password>"))?;
            Ok(CommandAction::VaultCreate(pw.clone()))
        }
        "lock" => Ok(CommandAction::VaultLock),
        "delete" => Ok(CommandAction::VaultDelete),
        _ => Err(anyhow!("Usage: /vault [status|unlock <pw>|create <pw>|lock|delete]")),
    }
}

async fn ws_loop(
    gateway: String,
    faucet_amount: u64,
    verbose: bool,
    mut outbound: mpsc::UnboundedReceiver<Message>,
    ui_tx: mpsc::UnboundedSender<UiEvent>,
) {
    loop {
        match connect_async(&gateway).await {
            Ok((ws_stream, _)) => {
                let _ = ui_tx.send(UiEvent::WsLog(format!("Connected to {gateway}")));
                let (mut sink, mut stream) = ws_stream.split();

                // Kick off faucet + balance
                let _ = sink
                    .send(Message::Text(
                        json!({"type":"faucet_claim","amount": faucet_amount}).to_string(),
                    ))
                    .await;
                let _ = sink.send(Message::Text(json!({"type":"get_balance"}).to_string())).await;

                loop {
                    select! {
                        Some(msg) = outbound.recv() => {
                            if let Err(err) = sink.send(msg).await {
                                let _ = ui_tx.send(UiEvent::WsLog(format!("send failed: {err}")));
                                break;
                            }
                        }
                        Some(in_msg) = stream.next() => {
                            match in_msg {
                                Ok(Message::Text(text)) => {
                                    if verbose { let _ = ui_tx.send(UiEvent::WsRaw(text.clone())); }
                                    let summary = summarize_json(&text);
                                    let _ = ui_tx.send(UiEvent::UpdateBoard(text));
                                    let _ = ui_tx.send(UiEvent::WsLog(summary));
                                }
                                Ok(Message::Binary(_)) => {
                                    let _ = ui_tx.send(UiEvent::WsLog("← <binary message>".into()));
                                }
                                Ok(Message::Close(_)) => {
                                    let _ = ui_tx.send(UiEvent::WsLog("Connection closed by server".into()));
                                    break;
                                }
                                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => {}
                                Err(err) => {
                                    let _ = ui_tx.send(UiEvent::WsLog(format!("read error: {err}")));
                                    break;
                                }
                                Ok(Message::Frame(_)) => {}
                            }
                        }
                        else => break,
                    }
                }
            }
            Err(err) => {
                let _ = ui_tx.send(UiEvent::WsLog(format!("connect error: {err}")));
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn summarize_json(raw: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(raw) {
        Ok(v) => {
            let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("?");
            match ty {
                "session_ready" => format!(
                    "session ready · pk={} registered={} balance={}",
                    v.get("publicKey").and_then(|x| x.as_str()).unwrap_or("?"),
                    v.get("registered").unwrap_or(&json!(false)),
                    v.get("balance").unwrap_or(&json!(0))
                ),
                "balance" => format!(
                    "balance {} (registered={} hasBalance={})",
                    v.get("balance").unwrap_or(&json!(0)),
                    v.get("registered").unwrap_or(&json!(false)),
                    v.get("hasBalance").unwrap_or(&json!(false))
                ),
                "game_started" => format!(
                    "game_started {:?} bet={}",
                    v.get("gameType"),
                    v.get("bet").unwrap_or(&json!(0))
                ),
                "game_result" => format!(
                    "game_result won={} payout={} result={:?}",
                    v.get("won").unwrap_or(&json!(false)),
                    v.get("payout").unwrap_or(&json!(0)),
                    v.get("result").or_else(|| v.get("winningNumber")).or_else(|| v.get("dice"))
                ),
                "error" => format!(
                    "error {}: {}",
                    v.get("code").unwrap_or(&json!("?")),
                    v.get("message").unwrap_or(&json!("?"))
                ),
                other => other.to_string(),
            }
        }
        Err(_) => format!("← {raw}"),
    }
}

fn update_board_from_json(raw: &str, app: &mut AppState) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "balance" => {
                if let Some(bal) = v.get("balance") {
                    app.board.balance = bal.to_string();
                }
            }
            "game_result" | "game_move" => {
                if let Some(payout) = v.get("payout") {
                    app.board.last_payout = payout.to_string();
                }
                if let Some(result) = v.get("result")
                    .or_else(|| v.get("winningNumber"))
                    .or_else(|| v.get("dice"))
                    .or_else(|| v.get("card"))
                {
                    app.board.last_result = result.to_string();
                }
            }
            _ => {}
        }
    }
}

fn load_config() -> Option<PersistedConfig> {
    let path = config_path()?;
    let data = std::fs::read(path).ok()?;
    serde_json::from_slice(&data).ok()
}

fn save_config(cfg: &PersistedConfig) -> Result<()> {
    if let Some(path) = config_path() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let data = serde_json::to_vec_pretty(cfg)?;
        std::fs::write(path, data)?;
    }
    Ok(())
}

fn config_path() -> Option<PathBuf> {
    ProjectDirs::from("dev", "nullspace", "terminal-cli").map(|d| d.config_dir().join("config.json"))
}

// ---------- Vault helpers ----------

#[derive(Clone)]
struct UnlockedVault {
    secret: [u8; 32],
    public_hex: String,
}

lazy_static! {
    static ref UNLOCKED_VAULT: Mutex<Option<UnlockedVault>> = Mutex::new(None);
}

fn vault_path() -> Option<PathBuf> {
    ProjectDirs::from("dev", "nullspace", "terminal-cli").map(|d| d.config_dir().join("vault.json"))
}

fn vault_status() -> VaultStatus {
    if let Some(path) = vault_path() {
        if path.exists() {
            if let Ok(guard) = UNLOCKED_VAULT.lock() {
                if guard.is_some() {
                    return VaultStatus::Unlocked;
                }
            }
            return VaultStatus::Locked;
        }
    }
    VaultStatus::Missing
}

fn vault_status_string() -> String {
    match vault_status() {
        VaultStatus::Missing => "Vault missing (create with /vault create <password>)".into(),
        VaultStatus::Locked => "Vault locked (unlock with /vault unlock <password>)".into(),
        VaultStatus::Unlocked => {
            if let Ok(guard) = UNLOCKED_VAULT.lock() {
                if let Some(v) = guard.as_ref() {
                    return format!("Vault unlocked · pub {}", v.public_hex);
                }
            }
            "Vault unlocked".into()
        }
    }
}

#[derive(Serialize, Deserialize)]
struct StoredVault {
    salt: String,
    nonce: String,
    ciphertext: String,
    public_hex: String,
}

fn vault_create(password: &str) -> Result<String> {
    if password.len() < 8 {
        return Err(anyhow!("Password too short (min 8 chars)"));
    }
    if vault_status() != VaultStatus::Missing {
        return Err(anyhow!("Vault already exists (delete first)"));
    }
    let signing = SigningKey::generate(&mut OsRng);
    let secret_bytes = signing.to_bytes();
    let public: VerifyingKey = signing.verifying_key();
    let public_hex = hex::encode(public.as_bytes());
    persist_vault(password, &secret_bytes, &public_hex)?;
    if let Ok(mut guard) = UNLOCKED_VAULT.lock() {
        *guard = Some(UnlockedVault {
            secret: secret_bytes,
            public_hex: public_hex.clone(),
        });
    }
    Ok(public_hex)
}

fn vault_unlock(password: &str) -> Result<String> {
    let path = vault_path().ok_or_else(|| anyhow!("No config dir"))?;
    let data = std::fs::read(&path).context("read vault file")?;
    let stored: StoredVault = serde_json::from_slice(&data).context("parse vault")?;
    let salt = general_purpose::STANDARD
        .decode(&stored.salt)
        .context("salt b64")?;
    let nonce = general_purpose::STANDARD
        .decode(&stored.nonce)
        .context("nonce b64")?;
    let ciphertext = general_purpose::STANDARD
        .decode(&stored.ciphertext)
        .context("ct b64")?;
    let key = derive_key(password, &salt)?;
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&key));
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .context("decrypt failed")?;
    let secret: [u8; 32] = plaintext
        .try_into()
        .map_err(|_| anyhow!("bad key length"))?;
    let signing = SigningKey::from_bytes(&secret);
    let public_hex = hex::encode(signing.verifying_key().as_bytes());
    if let Ok(mut guard) = UNLOCKED_VAULT.lock() {
        *guard = Some(UnlockedVault { secret, public_hex: public_hex.clone() });
    }
    Ok(public_hex)
}

fn vault_lock() {
    if let Ok(mut guard) = UNLOCKED_VAULT.lock() {
        *guard = None;
    }
}

fn vault_delete() -> Result<()> {
    vault_lock();
    if let Some(path) = vault_path() {
        if path.exists() {
            std::fs::remove_file(path).context("delete vault file")?;
        }
    }
    Ok(())
}

fn persist_vault(password: &str, secret: &[u8; 32], public_hex: &str) -> Result<()> {
    let salt = SaltString::generate(&mut OsRng);
    let salt_bytes = salt.as_salt().as_str().as_bytes();
    let key = derive_key(password, salt_bytes)?;
    let cipher = ChaCha20Poly1305::new(Key::from_slice(&key));
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), secret.as_ref())
        .context("encrypt")?;
    let stored = StoredVault {
        salt: general_purpose::STANDARD.encode(salt_bytes),
        nonce: general_purpose::STANDARD.encode(nonce),
        ciphertext: general_purpose::STANDARD.encode(ciphertext),
        public_hex: public_hex.to_string(),
    };
    if let Some(path) = vault_path() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let data = serde_json::to_vec_pretty(&stored)?;
        std::fs::write(path, data)?;
    }
    Ok(())
}

fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; 32]> {
    let mut out = [0u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| anyhow!("argon2: {e}"))?;
    Ok(out)
}
