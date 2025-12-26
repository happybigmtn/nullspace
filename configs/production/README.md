# Production Configs

Use isolated keys and endpoints for production.

- `simulator.env.example`: systemd env file for the simulator.
- `node.env.example`: systemd env file pointing at your node YAML.
- Auth service env: `services/auth/.env.production.example`.
- Website build env: `website/.env.production.example`.

Create the node YAML by copying a local config (for example,
`configs/local/node0.yaml`) and replacing keys, ports, and URLs for production.
