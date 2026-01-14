# Nullspace Terminal CLI

Clean slash-command interface for live gameplay over the real gateway (no stubs).

## Build

```bash
cargo build -p terminal-cli
```

## Run

```bash
cargo run -p terminal-cli -- --gateway wss://api.testnet.regenesis.dev
```

Flags:

- `--gateway` (default `wss://api.testnet.regenesis.dev`) — WebSocket gateway URL.
- `--faucet-amount` — optional faucet claim amount sent on startup.
- `--verbose` — also print raw JSON messages from the gateway.

## Command palette

Commands are grouped with tab-completion and predictive hints:

- Session: `/help`, `/status`, `/balance`, `/faucet [amt]`, `/reconnect`, `/quit`
- Blackjack: `/bj deal <amt> [side]`, `/hit`, `/stand`, `/double`, `/split`
- Roulette: `/roulette <red|black|odd|even|high|low|number N> <amt>`
- Craps: `/craps <PASS|DONT_PASS|FIELD|YES|NO> <amt> [target]`
- Sic Bo: `/sicbo <SMALL|BIG|ODD|EVEN|SINGLE N> <amt>`
- Baccarat: `/baccarat <PLAYER|BANKER|TIE> <amt>`
- Hi-Lo: `/hilo <amt> <higher|lower|same>`, `/hilo_cashout`
- Casino War: `/war deal <amt> [tie]`, `/war go`, `/war surrender`
- Video Poker: `/vp deal <amt>`, `/vp hold <binaryMask>`
- Vault (local, optional): `/vault status`, `/vault create <password>`, `/vault unlock <password>`, `/vault lock`, `/vault delete`

All actions go directly to the live gateway; errors surface in the log stream.
