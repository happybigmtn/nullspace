# Staging Configs

Use isolated keys and endpoints for staging.

- `simulator.env.example`: systemd env file for the simulator.
- `node.env.example`: systemd env file pointing at your node YAML.
- `gateway.env.example`: systemd env file for the gateway (mobile/web).
- `ops.env.example`: systemd env file for the ops/analytics service.
- Auth service env: `services/auth/.env.example`.
- Website build env: `website/.env.staging.example`.

Notes:
- `node.env` should include `NODE_CONFIG` and either `NODE_PEERS` or `NODE_HOSTS`.
- If validators are consolidated on a single host, prefer loopback aliases in `peers.yaml` (127.0.0.1-127.0.0.4) and start nodes with `ALLOW_PRIVATE_IPS=1`.
- Gateway should set `GATEWAY_ALLOWED_ORIGINS` and `GATEWAY_ORIGIN` in staging.
- For the global craps table, set `GATEWAY_LIVE_TABLE_CRAPS=1` and `GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE`.
- To report global player counts, set `GATEWAY_INSTANCE_ID` and (optionally) `GATEWAY_LIVE_TABLE_PRESENCE_TOKEN`.
- On staging, apply simulator persistence via a systemd drop-in (avoid editing `.env` files), e.g. `Environment=SIMULATOR_ARGS=--summary-persistence-path=/var/lib/nullspace/simulator/summary.sqlite ...`.
- `ns-sim-1` should not run validators; disable `nullspace-node*.service` there to avoid forked indexer data.
- Staging validators should use a very large `prune_interval` to keep history available for new/repairing nodes.

Generate local configs with:
`cargo run --bin generate-keys -- --nodes 4 --output configs/local`
Then create the staging node YAML by copying one of the generated configs
and replacing keys, ports, and URLs for staging.
