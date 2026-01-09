# E14 - Hetzner infra + hardening checklist (textbook-style deep dive)

Focus file: `docs/hetzner-deployment-runbook.md`

Goal: explain the staging/testnet deployment checklist for Hetzner, why each step exists, and how it protects the system. This lesson is a full walkthrough of the runbook with emphasis on security boundaries, capacity planning, and operational sequencing.

---

## Learning objectives

After this lesson you should be able to:

1) Describe the private network model used for staging/testnet.
2) Explain why only LBs and the bastion have public IPs.
3) Understand the firewall rules and what each port is for.
4) Explain the host layout and why each role is sized the way it is.
5) Understand env distribution, systemd supervision, and validation steps.
6) Identify common deployment pitfalls and how the runbook avoids them.

---

## 1) Context: why Hetzner and why this runbook

The runbook targets Hetzner Cloud because it provides cost-effective servers for staging and testnet workloads. It is explicitly *not* production and emphasizes a 5k concurrent player target.

The key point is not Hetzner itself; it is the deployment pattern. The runbook encodes a secure and repeatable way to bring up a distributed stack. The same ideas apply to other cloud providers.

**Note on Infrastructure as Code (IaC):** While this lesson covers manual provisioning procedures, the project has migrated to Terraform-based infrastructure management. See **E26 - Terraform infrastructure** and the `terraform/` directory for the IaC approach. The manual procedures below remain useful for understanding the underlying architecture and for debugging, but new deployments should prefer the Terraform workflow.

---

## 2) Project and network setup

The runbook starts with project creation and network planning:

- Create a Hetzner project (`nullspace-staging` or `nullspace-testnet`).
- Create a private network `10.0.0.0/16` with a `10.0.1.0/24` subnet.
- Attach all servers to the private network.
- Only load balancers and the bastion get public IPs.

**Terraform alternative:** These network and project resources are now defined as code in `terraform/` (see E26). The Terraform modules provision the private network, firewall rules, and server instances declaratively, replacing manual Hetzner console operations.

### 2.1 Why a private network is non-negotiable

Private networks reduce attack surface. Most services (validators, databases, simulator) do not need public exposure. If they are public, they are attack targets.

By enforcing that only LBs and the bastion are public, the system ensures:

- Public endpoints are limited and controllable.
- Internal traffic stays private.
- Access can be audited at a single entry point.

### 2.2 Why the bastion model matters

The bastion is the only SSH entry point. This is a standard security pattern:

- You lock down SSH to trusted IPs.
- You monitor a single entry point.
- You reduce lateral movement risk.

In other words, the bastion acts as the airlock for administrative access.

### 2.3 Future segmentation within the private network

The runbook uses a /16 private network with a /24 subnet. That gives you room to grow. In practice, you can allocate separate /24s for different tiers:

- One subnet for validators.

- One subnet for databases.

- One subnet for public-facing services.

This type of segmentation makes it easier to apply firewall rules and isolate blast radius. You do not need it at 5k scale, but it becomes valuable as the system grows.

### 2.4 Public IP minimization as a policy

Treat public IPs as a scarce security resource. Every public IP is a potential attack surface. The runbook enforces a policy: only LBs and bastion have public IPs. If a service needs exposure, expose it through an LB or reverse proxy rather than giving it a direct public IP.

This policy is the simplest form of zero trust: only the edge is public, everything else is private.

---

## 3) Firewall rules: public vs private ingress

The runbook provides explicit firewall rules. This is the most important hardening step.

**Terraform codification:** Firewall rules are now defined in Terraform modules (`terraform/`), ensuring consistent enforcement across environments and enabling version-controlled security policy.

### 3.1 Public ingress

Only the following should be public:

- 22/tcp (SSH): restricted to office/home IPs.
- 80/443 (HTTP/HTTPS): website, auth, gateway via LBs.

Nothing else should be exposed. If you see additional public ports, your firewall is too loose.

### 3.2 Private ingress

The private network handles service-to-service traffic:

- 8080/tcp: simulator/indexer HTTP + WS.
- 9010/tcp: gateway WebSocket (behind LB).
- 4000/tcp: auth service.
- 9020/tcp: ops service (optional).
- 9001-9004/tcp: validator P2P.
- 9100-9104/tcp: metrics endpoints.
- 5432/tcp: Postgres.

These ports map directly to service roles. If a service does not need a port, it should not have it. This is the principle of least privilege applied to networking.

### 3.3 Port ownership and blast radius

Each port is a capability. If a service can accept traffic on a port, that port becomes part of its attack surface. The runbook's explicit port list is a blast radius control: it ensures that only the service that needs a port can accept traffic on it.

For example, Postgres on 5432 should only accept connections from the simulator/indexer. If a gateway can reach Postgres, a gateway compromise becomes a database compromise. The runbook avoids this by keeping internal ports private and restricting access by source. This is a core security principle, not just a networking detail.

---

## 4) Host layout for a 5k target

The runbook recommends a baseline host layout:

- `ns-gw-1..2` (Gateway): CPX31.
- `ns-sim-1` (Simulator/Indexer): CPX41/CPX51.
- `ns-node-1..3` (Validators): CPX31.
- `ns-auth-1` (Auth): CPX21.
- `ns-convex-1` (Convex): CPX41 + volume.
- `ns-db-1` (Postgres): CPX41 + volume.
- `ns-obs-1` (Observability): CPX31 (optional).
- `ns-ops-1` (Ops/analytics): CPX21 (optional).

**Terraform server definitions:** Server instances, their types, and volumes are declared in `terraform/` modules. This allows you to adjust instance sizes and counts via Terraform variables, applying changes through `terraform plan` and `terraform apply` rather than manual console operations.

### 4.1 Why these roles are separated

Each role has different scaling needs:

- Gateways are connection-heavy and scale horizontally.
- Validators are compute-heavy and must maintain quorum.
- Simulator/indexer is read-heavy and benefits from memory.
- Databases require persistent volumes.

If you colocate all roles, you lose the ability to scale independently. This is why the runbook is explicit about host roles.

### 4.2 NAT-heavy mobile traffic

The runbook warns about NAT-heavy mobile traffic. Many users may share one IP, which can trigger per-IP rate limits. It suggests raising `MAX_CONNECTIONS_PER_IP` and `RATE_LIMIT_WS_CONNECTIONS_PER_IP` to avoid false throttling.

This is a real-world nuance that many runbooks miss. It is important because it directly affects user experience during load tests.

---

## 5) Base server setup

The runbook requires a standard directory layout:

- `/opt/nullspace` for repo and builds.
- `/etc/nullspace` for env files.
- `/var/lib/nullspace` for persistent runtime data.

It also requires core dependencies:

- Node 20+, pnpm.
- Rust toolchain (for source builds).
- Docker/Compose (for container builds).

The key point is consistency. Systemd units and scripts assume these paths. Deviations should be treated as exceptions, not the norm.

### 5.1 Service user creation

Production services should run as a dedicated user (for example, `nullspace`). This isolates permissions and prevents accidental writes to sensitive directories. When you create the user, you should also ensure that `/opt/nullspace` and `/var/lib/nullspace` are owned by that user.

If you forget this step, services may fail with permission errors that look like application bugs. The runbook assumes the service user exists, even though it does not call it out explicitly. In practice, it should be on the checklist.

### 5.2 Source builds vs container images

The runbook allows either source builds (Rust/Node toolchains installed) or container-based deployments (Docker + Compose). Both are valid, but they have different tradeoffs:

- Source builds give you direct control and fewer layers.

- Containers give you reproducibility and easier rollbacks.

In staging/testnet, source builds are often faster to iterate. In production-like environments, containers reduce drift. The runbook supports both because it is meant to be pragmatic.

---

## 6) Env files and configuration distribution

The runbook lists env templates under `configs/staging/` and `configs/production/`. These templates define the expected variables for each service.

Key production-required envs include:

- `GATEWAY_ORIGIN` and `GATEWAY_ALLOWED_ORIGINS`.
- `GATEWAY_DATA_DIR` for persistent nonce storage.
- `GATEWAY_ALLOW_NO_ORIGIN=1` for native mobile clients.
- `METRICS_AUTH_TOKEN` for metrics endpoints.
- `OPS_ADMIN_TOKEN` and `OPS_REQUIRE_ADMIN_TOKEN=1` for ops security.

### 6.1 Why these envs matter

These envs are security boundaries. If `GATEWAY_ALLOWED_ORIGINS` is missing, cross-origin abuse becomes possible. If `METRICS_AUTH_TOKEN` is missing, you expose internal metrics.

In production, env files are effectively policy files. Treat them as critical infrastructure.

### 6.2 Secret management discipline

Env files often include secrets: admin tokens, metrics tokens, and API keys. These should be handled like passwords:

- Keep them out of git.
- Restrict file permissions (root-owned, not world-readable).
- Rotate them periodically.

The runbook does not prescribe a secret manager, but the discipline still applies. If you ever check env files into a repo or leave them readable by non-service users, you have already failed the security model.

### 6.3 Global table admin keys

The runbook notes that global table admin keys should be file-based and that env keys are blocked in production unless explicitly allowed. This is a subtle but important hardening step. Environment variables can leak via process listings or logs; file-based secrets can be permissioned more tightly.

If you enable the global table coordinator, treat the admin key as highly sensitive. It can be used to control timing or outcomes, so it must be locked down.

---

## 7) Validator bootstrapping and peer config

The runbook includes a bootstrap script:

```bash
NODES=4 OUTPUT=configs/testnet INDEXER=http://<INDEXER_HOST>:8080   ./scripts/bootstrap-testnet.sh
```

This generates:

- `nodeN.yaml` per validator.
- `peers.yaml` containing peer list.

The runbook emphasizes that `peers.yaml` entries must be sorted and unique. The node refuses to start otherwise. This strictness prevents subtle consensus mismatches.

---

## 8) Load balancers

The runbook recommends separate LBs:

- Gateway WS (TCP 9010).
- Simulator/indexer (HTTP 8080).
- Auth + Website (HTTP/HTTPS 80/443).

### 8.1 Why separate LBs

WebSockets require long-lived connections and different timeout settings. Mixing them with short-lived HTTP traffic in one LB can cause performance issues. Separate LBs allow you to tune timeouts and health checks independently.

The runbook also suggests:

- Enabling PROXY protocol only if services parse it.
- Increasing idle timeouts for WebSockets.
- Aligning LB body size limits with service limits.

These are operational details that prevent subtle failures under load.

### 8.2 Health checks and failure detection

Each LB should use a health check endpoint (`/healthz` where available). Health checks prevent traffic from being routed to unhealthy instances. This is especially important during rolling deployments: new instances should not receive traffic until they are ready.

For WebSocket LBs, health checks are often HTTP-based even if the LB is L4. That means your services should expose a simple HTTP health endpoint. The runbook aligns with this pattern in multiple services.

### 8.3 TLS termination and edge security

The runbook recommends Cloudflare in front of website/auth for TLS and WAF. This is an important operational security layer. TLS termination at the edge allows you to manage certificates centrally, while WAF provides an additional defense against common web attacks.

The key is to keep the chain-facing services on private networks while using the edge only for user-facing traffic. This preserves the security boundary.

---

## 9) Systemd supervision

Systemd units from `ops/systemd/` are copied to `/etc/systemd/system/` and configured with env files in `/etc/nullspace`.

The standard sequence is:

```bash
sudo systemctl daemon-reload
sudo systemctl enable nullspace-simulator nullspace-node nullspace-auth   nullspace-gateway nullspace-website nullspace-ops
sudo systemctl start nullspace-simulator nullspace-node nullspace-auth   nullspace-gateway nullspace-website nullspace-ops
```

This ensures services start on boot and restart on failure. It is the canonical supervisor for staging/testnet.

### 9.1 File descriptor limits and gateway scale

The gateway unit sets `LimitNOFILE=100000`. This is critical for WebSocket scale. Without it, the gateway will hit the Linux default and stop accepting new connections.

This is a classic example of a production-only failure: everything looks fine at low traffic, then collapses under load. The runbook's systemd templates bake in the fix.

### 9.2 Journald and log visibility

Systemd routes logs to journald. That means `journalctl -u <service>` becomes your immediate debugging tool. If you run multiple hosts, you should still centralize logs, but journald is the first place to look when something fails.

This is another operational benefit of systemd: logs and process supervision are in one place.

---

## 10) Postgres and backups

The runbook references `docs/postgres-ops-runbook.md` for configuration, connection pooling, and WAL backups. This is crucial for explorer persistence. Even though the chain is the source of truth, re-indexing from genesis is expensive. Postgres provides a durable read model.

If you lose Postgres, you can rebuild, but it is slow. That is why backups are required even in staging environments.

### 10.1 WAL and recovery time objectives

WAL (write-ahead log) backups allow you to restore Postgres to a specific point in time. Without WAL, you can only restore to the last full backup. The runbook's emphasis on WAL is about minimizing recovery time and data loss.

Even in testnet, slow restores can block development and testing. Backups are not just a production concern; they are a productivity concern.

---

## 11) Validation and preflight checks

Before opening the network, the runbook requires validation:

- Smoke steps in `docs/testnet-readiness-runbook.md`.
- Full sequence in `docs/testnet-runbook.md`.
- Preflight config check:

```bash
node scripts/preflight-management.mjs   gateway /etc/nullspace/gateway.env   simulator /etc/nullspace/simulator.env   node /etc/nullspace/node.env   auth /etc/nullspace/auth.env   ops /etc/nullspace/ops.env
```

This script validates env config before services run. It catches misconfigurations early, which is the number one cause of deployment failure.

### 11.1 Readiness as a culture

The runbook distinguishes smoke steps from full readiness steps. That is a cultural pattern: quick checks for fast feedback, deep checks before exposure. If you skip readiness, you trade short-term speed for long-term instability.

In practice, you should automate readiness checks and make them part of your deployment pipeline. Manual checklists are too easy to skip under time pressure. The runbook gives you the steps; your job is to make them routine.

---

## 12) Scaling beyond 5k

The runbook points to `docs/resource_sizing.md` for 20k+ guidance. The scaling strategy is role-based:

- Add gateways for more concurrent connections.
- Add simulator replicas for read-heavy load.
- Keep validators on separate hosts to preserve quorum.

The key is to scale the bottleneck role, not everything. This is why role separation matters.

### 12.1 Load testing discipline

Scaling decisions should be data-driven. Before you add more gateways or increase instance sizes, run load tests to identify actual bottlenecks. This prevents overprovisioning and keeps costs predictable.

The runbook references readiness runbooks for validation. In practice, you should add stress tests that simulate real user behavior (WebSocket connections, bet submissions, and global table updates). The goal is not just to make the system survive; it is to ensure it behaves correctly under load.

### 12.2 Observability at scale

Once you scale beyond a few thousand users, metrics and dashboards become essential. The optional `ns-obs-1` host (Prometheus/Grafana/Loki) is not just \"nice to have\"; it is how you diagnose saturation and latency.

At scale, the absence of observability is itself a failure. You cannot fix what you cannot see.

---

## 13) Common pitfalls and how the runbook avoids them

### 13.1 Public exposure creep

Accidentally exposing internal ports is easy. The runbook's strict firewall rules are designed to prevent this.

### 13.2 Missing env file values

Many production failures come from missing env values. The runbook explicitly lists required envs and provides templates.

### 13.3 Weak origin policies

If `GATEWAY_ALLOWED_ORIGINS` is not set, any website can connect to the gateway. The runbook calls this out as a hard requirement.

### 13.4 Metrics exposure

Metrics endpoints can leak internal state. The runbook requires `METRICS_AUTH_TOKEN` to protect them.

### 13.5 Global table coordination pitfalls

With the global table, the gateway coordinates round timing and fans out updates from the chain. That means gateway health directly affects the global-table UX: if gateways are overloaded or down, clients lose the shared table experience even if the chain is healthy.

The mitigation is operational: scale gateways for fan-out, monitor update latency, and treat the admin key + updates stream as production-critical dependencies. If those inputs stall, rounds stall.

### 13.6 Gateway nonce persistence

The gateway uses a persistent data directory for nonce tracking (`GATEWAY_DATA_DIR`). If this directory is not on a persistent disk, gateway restarts can invalidate session state or allow replay attempts. The runbook calls this out because it is easy to overlook.

This is another example of a subtle configuration requirement that becomes critical under load and restarts.

### 13.7 Origin allowlists and CORS hygiene

`GATEWAY_ALLOWED_ORIGINS` is not just a web concern. It is a security boundary. If you allow all origins, any website can connect to your gateway and proxy user actions. That is effectively a cross-site request forgery vector for WebSocket-based systems.

The runbook insists on explicit origin allowlists in production. If you support native clients, you can allow no-origin requests (`GATEWAY_ALLOW_NO_ORIGIN=1`) but that should be a conscious choice, not a default. In other words: origin policies are part of your threat model.

### 13.8 WebSocket idle timeouts

WebSocket connections are long-lived and sensitive to idle timeouts. Load balancers and proxies often default to short idle timeouts (for example, 60 seconds). If you do not increase those timeouts, clients will see frequent disconnects even when the system is healthy.

The runbook recommends increasing idle timeouts to 5-10 minutes. That is not arbitrary: it balances resource usage with user experience. Longer timeouts reduce reconnect churn, which reduces load on gateways. If you ignore this, you can end up in a reconnect storm where users repeatedly reconnect and overload the gateway.

This is another example of an operational setting that directly affects product experience.

One more habit to build: treat the runbook as a living document. When a deployment fails or you discover a new safety check, update the checklist immediately. That is how institutional memory forms and how you prevent the same outage from repeating next week.

---

## 14) Feynman recap

The Hetzner runbook is a security checklist disguised as a deployment guide. It says: build a private network, expose only the front door, run each role on the right size machine, and validate everything before you open the doors. If you follow that, you get a safe and repeatable testnet. The details matter because every skipped step becomes a future outage. Treat it like an operations playbook, not a suggestion.

Repeatability is the real product.

**Migration to Infrastructure as Code:** The project has evolved from manual provisioning to Terraform-based IaC. While the principles and architecture described here remain foundational, new deployments use `terraform/` modules to provision infrastructure declaratively. See **E26 - Terraform infrastructure** for the IaC workflow. The manual procedures documented here are still valuable for:

- Understanding the underlying architecture and security boundaries
- Debugging infrastructure issues when Terraform state diverges
- One-off testing and development scenarios
- Learning the "why" behind infrastructure decisions before automating them

---

## 15) Exercises

1) Why are validators kept on private IPs only?
2) What happens if the gateway and simulator share the same public LB?
3) Which env variables are mandatory for production security?
4) Why is `peers.yaml` sorting enforced by the node?
5) How would you scale from 5k to 20k players without changing the architecture?

---

## Next lesson

E15 - Testing strategy + harnesses: `feynman/lessons/E15-testing-strategy.md`
