# E14 - Hetzner infra + hardening checklist (from scratch)

Focus file: `docs/hetzner-deployment-runbook.md`

Goal: explain the staging/testnet deployment checklist for Hetzner. For every excerpt, you will see **why it matters** and a **plain description of what the text means**.

---

## Concepts from scratch (expanded)

### 1) Private network first
Most services must never be exposed publicly. Use a private network for service-to-service traffic.

### 2) Role-based sizing
Each service has a recommended instance type based on its workload.

### 3) Environment and secrets
Configuration is distributed via env files under `/etc/nullspace`.

---

## Limits & management callouts (important)

1) **Gateway origins must be locked down**
- `GATEWAY_ALLOWED_ORIGINS` is required in production.
- Missing this risks cross-origin abuse.

2) **Metrics auth tokens are required**
- `METRICS_AUTH_TOKEN` must be set for simulator, validators, and auth.

3) **Live-table admin keys should be file-based**
- Env keys are blocked in production unless explicitly allowed.

---

## Walkthrough with key excerpts

### 1) Private network and firewall rules
```rust
Create a private network: `10.0.0.0/16` with subnet `10.0.1.0/24`.
Attach every server to the private network; only load balancers and
   the bastion should have public IPs.

Public ingress (LBs/bastion):
- 22/tcp (SSH): from office/home IPs only.
- 80/443 (HTTP/HTTPS): website + auth + gateway (via LB).
```

Why this matters:
- This defines the core security boundary for testnet.

What this means:
- Internal ports should never be exposed to the public internet.

---

### 2) Production-required envs
```rust
Production-required envs (set in your env files):
- `GATEWAY_ORIGIN` (public gateway origin, e.g. `https://gateway.example.com`)
- `GATEWAY_DATA_DIR` (persistent gateway nonce directory)
- `GATEWAY_ALLOWED_ORIGINS` (origin allowlist for gateway WebSocket)
- `GATEWAY_ALLOW_NO_ORIGIN=1` (if supporting native mobile clients)
- `METRICS_AUTH_TOKEN` (simulator + validators + auth metrics auth)
- `OPS_ADMIN_TOKEN` (ops admin endpoints) and `OPS_REQUIRE_ADMIN_TOKEN=1`
```

Why this matters:
- These envs are essential for security and correctness.

What this means:
- Missing them will cause the stack to misbehave or be insecure.

---

### 3) Systemd supervision
```rust
Copy unit files from `ops/systemd/` to `/etc/systemd/system/` and set
`EnvironmentFile` to your `/etc/nullspace/*.env` files. Then:

sudo systemctl enable nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website nullspace-ops
sudo systemctl start nullspace-simulator nullspace-node nullspace-auth \
  nullspace-gateway nullspace-website nullspace-ops
```

Why this matters:
- Systemd is the recommended supervisor for staging/testnet.

What this means:
- Services should start on boot and restart on failure.

---

## Key takeaways
- The runbook prioritizes private networking and strict firewalling.
- Required env variables enforce security boundaries.
- Systemd is the standard supervision method.

## Next lesson
E15 - Testing strategy + harnesses: `feynman/lessons/E15-testing-strategy.md`
