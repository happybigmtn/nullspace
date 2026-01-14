# QA Bet Flow & 4‑Node Consensus Learnings (Jan 12, 2026)

## What we changed
- Regenerated network identity (seed `2026011202`), bringing a 4‑validator cluster online on 10.0.1.3/4/5/7 with fresh data dirs.
- Synced `node{0-3}.yaml` + `peers.yaml` across hosts; all nodes run `nullspace-node:local-consensus` with `ALLOW_PRIVATE_IPS=1`.
- Reset simulator (`nullspace-simulator:local-consensus`) to the new identity and wiped `/var/lib/nullspace/simulator`.
- Rebuilt website with the new identity and QA flags (legacy keys + passkeys enabled, VITE_QA_BETS=true) and redeployed to ns-gw-1.
- Restarted gateway after backend switch.

## What broke / how it manifested
- **404s on `/state/:digest` for ~2–3 minutes after genesis**: indexer hadn’t populated state roots yet. Symptoms: QA harness spammed requestfailed 404s before eventually going green.
- **`InvalidSignature` warnings in simulator logs**: old summary submissions (view ~165k) being rejected; they don’t stall consensus but add noise.
- **Node gossip warnings** (`serve send failed peer=...`): transient while peers catch up after restart; resolved once all four nodes were online.

## Fix tactics that worked
- Wipe data dirs on every node + simulator when changing identity; keep config + env files intact.
- Make peers symmetric: each node uses the other three as bootstrappers, all on consistent ports (9000) and metrics ports separated where needed.
- Load the exact container tag on every host (scp image tarballs, `docker load`, then systemd override to point at `nullspace-node:local-consensus`).
- Redeploy website with matching identity; otherwise the UI shows “Missing VITE_IDENTITY / vault locked” even when the chain is healthy.
- Give the indexer a short warm-up before declaring failure; QA eventually succeeds once `/state` stops returning 404.

## Runbook (condensed)
1) Stop services: `systemctl stop nullspace-node nullspace-simulator` (all validators + sim).  
2) Wipe state: `rm -rf /var/lib/nullspace/node*` and `/var/lib/nullspace/simulator`.  
3) Copy configs: `node{0-3}.yaml`, `peers.yaml` to `/etc/nullspace/`; ensure ports/IPs match hosts.  
4) Ensure images present: `docker load -i nullspace-node-local-consensus.tar.gz` (and sim).  
5) Start services: `systemctl start nullspace-node` (all four), then `nullspace-simulator`.  
6) Redeploy website with current VITE_IDENTITY; restart gateway.  
7) Wait for indexer to answer `/state/<digest>` with 200, then run `node website/scripts/qa-bet-suite.mjs` with `QA_BASE_URL=https://testnet.regenesis.dev` and `QA_API_BASE=https://api.testnet.regenesis.dev`.

## QA harness tips
- Chrom(ium) path defaults to `/usr/bin/chromium`; set `QA_HEADLESS=0` to watch runs.
- Artifacts land in `qa-artifacts/qa-bet-suite-<timestamp>.{log,json,png,zip}`; check logs first when runs flap.
- If you see endless 404s, give the chain 2–3 minutes; if still failing, verify indexer URL in node configs and simulator identity.

## Follow-ups to consider
- Add metadata (remote IP, digest) to simulator `InvalidSignature` logs to trace bad submitters.
- Health check for `/state/<genesis-digest>` before starting QA to avoid noisy first minutes.
- Small alert if any validator reports sustained `serve send failed peer=` beyond warm-up.
