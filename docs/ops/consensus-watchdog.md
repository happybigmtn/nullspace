# Consensus Watchdog (Staging)

Purpose: prevent long-lived stalls by detecting consensus stagnation and
auto-restarting lagging validators.

## Signals
- `nullspace_engine_marshal_finalized_height` (finalized height)
- `nullspace_engine_consensus_voter_state_current_view` (current view)
- mempool backlog signals for additional alerting:
  - `nullspace_engine_application_pending_transactions_total`
  - `nullspace_engine_application_pending_transactions_dropped_nonce_total`

## How it works
`scripts/consensus-watchdog.sh` polls validator metrics on ports 9100–9103:
- If any node lags by `LAG_THRESHOLD` blocks, restart that node.
- If the max finalized height does not advance for `STALL_SECONDS`, restart laggards.
- If no clear laggard exists when stalled, restart all validators.

Defaults are conservative to avoid flapping; restarts are rate-limited by
`RESTART_COOLDOWN` (seconds).

## Optional recovery (manual)
If a validator remains stuck after restart:
1) Quarantine its data directory (do **not** delete):
   - `/var/lib/nullspace/node-0` → `/var/lib/nullspace/node-0.bak-<timestamp>`
2) Restart the container so it re-syncs from peers.

This is gated behind `WIPE_STALE=1` in the watchdog and should be used
only after operator approval.

## Install on staging
```
sudo install -m 0755 scripts/consensus-watchdog.sh /usr/local/bin/nullspace-consensus-watchdog.sh
sudo cp ops/systemd/nullspace-consensus-watchdog.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nullspace-consensus-watchdog.timer
```

## Tuning
Environment overrides (set in systemd unit or drop-in):
- `LAG_THRESHOLD` (default 100)
- `STALL_SECONDS` (default 120)
- `RESTART_COOLDOWN` (default 60)
- `WIPE_STALE` (default 0)
