# Staging Infrastructure (testnet.regenesis.dev)

SSH access:

`ssh -i ~/.ssh/id_ed25519_hetzner root@<server-ip>`

Servers:

| Server   | IP             | Private IP | Role                         |
| -------- | -------------- | ---------- | ---------------------------- |
| ns-sim-1 | 5.161.67.36     | 10.0.1.2   | Indexer/Simulator            |
| ns-gw-1  | 178.156.212.135 | 10.0.1.6   | Gateway + Website            |
| ns-auth-1| 5.161.209.39    | 10.0.1.7   | Auth Service                 |
| ns-db-1  | 5.161.124.82    | 10.0.1.1   | Validators (4x consolidated) |

Services & URLs:

- Website: https://testnet.regenesis.dev (ns-gw-1:8080)
- Gateway: https://api.testnet.regenesis.dev (ns-gw-1:9010)
- Indexer: https://indexer.testnet.regenesis.dev (ns-sim-1:8080)
- Auth: https://auth.testnet.regenesis.dev (ns-auth-1:4000)
- Convex: https://convex.testnet.regenesis.dev (ns-db-1:3210)

Hetzner CLI (firewall/server management):

```bash
hcloud firewall list
hcloud server list
hcloud firewall add-rule <firewall> --direction in --protocol tcp --port <port> --source-ips <cidr>
```

Private network: servers communicate via `10.0.1.0/24` (nullspace-private). Gateway uses private IPs to reach backends.

Config locations: `/etc/nullspace/*.env` on each server. Docker containers use `--env-file`.

Network identity (staging):

```
85a5cfe0aef544f32090e7740eda6c4714c8dc7ee861a6ecf9bf2a6d148611fb0e51d185356686a9af2ea4fafaec78dd051e683f366f7d81e7bb2da0877ed6001f769ba014b4c81dfc00ad776da9dffdf5dd39c1bc7eddfcf7d64139d6252867
```

Current infrastructure notes (Jan 2026):

- Active servers: `ns-sim-1` cpx41 (simulator), `ns-db-1` cpx41 (validators), `ns-gw-1` cpx31 (gateway/website), `ns-auth-1` cpx21 (auth).
- `ns-sim-1` should run only the simulator/indexer. Disable `nullspace-node*.service` on `ns-sim-1` to avoid forked indexer data.
- 4 validators consolidated on ns-db-1 for BFT consensus (n >= 3f+1, f = 1).
- Validators use per-node YAML config files (`configs/staging/node{0-3}.yaml`) with individual keys, not shared env files.
- Validators run with host networking; ports 9001-9004 are bound directly.
- Validators share a single host; `configs/staging/peers.yaml` should use the public IP (`5.161.124.82`) with ports 9001-9004 unless `ALLOW_PRIVATE_IPS=1` is set. If you want loopback/private peers, enable `ALLOW_PRIVATE_IPS=1` and switch the peers file to `127.0.0.1-127.0.0.4`.
- Threshold: 3/4 signatures required for consensus.
