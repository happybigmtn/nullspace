# Production Configs

Use isolated keys and endpoints for production.

- `simulator.env.example`: systemd env file for the simulator.
- `node.env.example`: systemd env file pointing at your node YAML.
- `gateway.env.example`: systemd env file for the gateway (mobile/web).
- `ops.env.example`: systemd env file for the ops/analytics service.
- `live-table.env.example`: env file for the live-table service.
- Auth service env: `services/auth/.env.example`.
- Website build env: `website/.env.production.example`.

Notes:
- `node.env` should include `NODE_CONFIG` and either `NODE_PEERS` or `NODE_HOSTS`.
- Gateway should set `GATEWAY_ALLOWED_ORIGINS` and `GATEWAY_ORIGIN` in production.
- If enabling live-table, set `GATEWAY_LIVE_TABLE_CRAPS_URL` and `GATEWAY_LIVE_TABLE_ADMIN_KEY_FILE`.

Generate local configs with:
`cargo run --bin generate-keys -- --nodes 4 --output configs/local`
Then create the production node YAML by copying one of the generated configs
and replacing keys, ports, and URLs for production.
