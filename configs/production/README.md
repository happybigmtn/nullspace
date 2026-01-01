# Production Configs

Use isolated keys and endpoints for production.

- `simulator.env.example`: systemd env file for the simulator.
- `node.env.example`: systemd env file pointing at your node YAML.
- `gateway.env.example`: systemd env file for the gateway (mobile/web).
- Auth service env: `services/auth/.env.production.example`.
- Website build env: `website/.env.production.example`.

Generate local configs with:
`cargo run --bin generate-keys -- --nodes 4 --output configs/local`
Then create the production node YAML by copying one of the generated configs
and replacing keys, ports, and URLs for production.
