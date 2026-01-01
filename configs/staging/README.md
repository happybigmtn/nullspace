# Staging Configs

Use isolated keys and endpoints for staging.

- `simulator.env.example`: systemd env file for the simulator.
- `node.env.example`: systemd env file pointing at your node YAML.
- `gateway.env.example`: systemd env file for the gateway (mobile/web).
- Auth service env: `services/auth/.env.staging.example`.
- Website build env: `website/.env.staging.example`.

Generate local configs with:
`cargo run --bin generate-keys -- --nodes 4 --output configs/local`
Then create the staging node YAML by copying one of the generated configs
and replacing keys, ports, and URLs for staging.
