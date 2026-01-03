# E13 - Systemd + service orchestration (from scratch)

Focus files: `ops/systemd/README.md`, `ops/systemd/nullspace-gateway.service`

Goal: explain how systemd units supervise services in production. For every excerpt, you will see **why it matters** and a **plain description of what the text means**.

---

## Concepts from scratch (expanded)

### 1) Systemd units
Systemd runs services at boot, restarts them on failure, and handles logging. Each service has a unit file.

### 2) Environment files
Environment variables are stored in `/etc/nullspace/*.env` and loaded by systemd for each service.

### 3) Service supervision
Restart policies and file descriptor limits are configured per service.

---

## Limits & management callouts (important)

1) **File descriptor limit is explicit**
- Gateway service sets `LimitNOFILE=100000`.
- This is critical for high WebSocket concurrency.

2) **Environment file paths are hard-coded defaults**
- If you deploy to a different layout, you must update unit files.

---

## Walkthrough with key excerpts

### 1) Systemd usage guidance
```rust
Copy them to `/etc/systemd/system/` and adjust the `EnvironmentFile` entries and paths
...
- Create `/etc/nullspace/` env files per service (examples in `configs/`).
- Add `/etc/nullspace/live-table.env` if running the live-table service.
- Add `/etc/nullspace/node.env` if running validator nodes.
```

Why this matters:
- Consistent env file locations reduce deployment mistakes.

What this means:
- You should centralize environment configuration under `/etc/nullspace/`.
- Each service reads its own env file.

---

### 2) Gateway unit file
```rust
[Service]
Type=simple
User=nullspace
Group=nullspace
WorkingDirectory=/opt/nullspace/gateway
EnvironmentFile=/etc/nullspace/gateway.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/nullspace/gateway/dist/index.js
Restart=on-failure
RestartSec=5
LimitNOFILE=100000
```

Why this matters:
- This defines how the gateway is started and supervised.

What this code does:
- Runs the gateway as the `nullspace` user.
- Loads env vars from `/etc/nullspace/gateway.env`.
- Restarts on failure with a 5-second delay.
- Sets a high file descriptor limit for WebSocket connections.

---

## Key takeaways
- Systemd is the production supervisor for all services.
- Env files are centralized and must be kept in sync with unit files.
- File descriptor limits are critical for gateway scale.

## Next lesson
E14 - Hetzner infra + hardening checklist: `feynman/lessons/E14-hetzner-runbook.md`
