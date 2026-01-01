# Hetzner Deployment Runbook (Staging/Testnet)

This runbook covers provisioning staging/testnet infrastructure on Hetzner for
~20k concurrent players. Hetzner does not offer a NYC region; Ashburn (us-east)
is the closest available location. If NYC residency is mandatory, use a
provider with NYC availability.

## 1) Project + network
1) Create a Hetzner Cloud project: `nullspace-staging` or `nullspace-testnet`.
2) Create a private network: `10.0.0.0/16` with subnet `10.0.1.0/24`.
3) Attach every server to the private network; only load balancers and
   the bastion should have public IPs.

## 2) Firewall rules (baseline)
Allow only required ports and restrict by source IP where possible.

Public ingress (LBs/bastion):
- 22/tcp (SSH): from office/home IPs only.
- 80/443 (HTTP/HTTPS): website + auth + gateway (via LB).

Private network ingress (service-to-service):
- 8080/tcp: simulator/indexer HTTP + WS.
- 9010/tcp: gateway WS (behind LB).
- 4000/tcp: auth service.
- 9001-9004/tcp: validator P2P (between validators only).
- 9100-9104/tcp: metrics (Prometheus only).
- 5432/tcp: Postgres (simulator/indexer only).

## 3) Host layout (20k target)
Use the resource sizing in `docs/resource_sizing.md` as a baseline.

Suggested layout (Ashburn):
- `ns-gw-1..4` (Gateway): CPX31/CPX41 (4-8 vCPU, 8-16 GB).
- `ns-sim-1..4` (Simulator/Indexer): CPX51 (16 vCPU, 32 GB).
- `ns-node-1..3` (Validators): CPX31 (4 vCPU, 8 GB).
- `ns-exec-1` (Executor): CPX31 (active) + `ns-exec-2` (standby).
- `ns-auth-1..2` (Auth): CPX21 (2 vCPU, 4 GB).
- `ns-convex-1` (Convex): CPX41 (8 vCPU, 16 GB) + persistent volume.
- `ns-db-1` (Postgres): CPX51 (16 vCPU, 32 GB) + dedicated volume.
- `ns-obs-1` (Prometheus/Grafana/Loki): CPX31 (optional, recommended).

Notes:
- Scale gateways horizontally; each node has its own `MAX_TOTAL_SESSIONS`.
- Keep simulator/indexer nodes behind an LB for read/submit traffic.
- Validators should be on separate hosts to maintain quorum.

## 4) Base server setup
On each host:
1) Create a `nullspace` user and directories:
   - `/opt/nullspace` (repo checkout)
   - `/etc/nullspace` (env files)
   - `/var/lib/nullspace` (gateway nonces, logs)
2) Install dependencies: Node 20+, pnpm, Rust toolchain, and system tools.
3) Clone repo to `/opt/nullspace` and build binaries (`cargo build --release`).

## 5) Env files + config distribution
Use env templates from `configs/staging/` or `configs/production/`:
- `configs/staging/simulator.env.example`
- `configs/staging/gateway.env.example`
- `services/auth/.env.staging.example`
- `website/.env.staging.example`

Generate validator configs:
```bash
NODES=4 OUTPUT=configs/testnet INDEXER=http://<INDEXER_HOST>:8080 \
  ./scripts/bootstrap-testnet.sh
```

Distribute `nodeN.yaml` + `peers.yaml` to each validator host.

## 6) Load balancers
Create separate LBs for:
- Gateway WS (TCP 9010): L4 LB with TCP health checks.
- Simulator/indexer (HTTP 8080): L7 LB with `/healthz` checks.
- Auth (HTTP 4000) + Website (HTTP/HTTPS 80/443): L7 LB or Nginx.

Recommended settings:
- Enable PROXY protocol only if your services parse it.
- Increase idle timeout for WS to 5-10 minutes.
- Use Cloudflare in front of website/auth for TLS + WAF.

## 7) Systemd supervision
Copy unit files from `ops/systemd/` to `/etc/systemd/system/` and set
`EnvironmentFile` to your `/etc/nullspace/*.env` files. Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website
sudo systemctl start nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website
```

## 8) Postgres + backups
Follow `docs/postgres-ops-runbook.md` to configure explorer persistence,
connection pooling, and WAL backups.

## 9) Validation
Run the smoke steps in `docs/testnet-readiness-runbook.md` and the full
sequence in `docs/testnet-runbook.md` before opening the testnet.
