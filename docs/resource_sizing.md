# Resource Sizing Guidance

This guidance targets simulator/indexer throughput and WS fanout. Validate with
load tests before production.

## 5k Concurrent Players (Baseline)
- Simulator/indexer: 1x 8-16 vCPU, 16-32 GB RAM.
- Validators: 3x 4 vCPU, 8 GB RAM.
- Executor: 1x 4 vCPU, 8 GB RAM (standby recommended).
- Auth service: 1-2x 2 vCPU, 4 GB RAM.
- Convex backend: 1x 8 vCPU, 16 GB RAM + SSD volume.
- Postgres (explorer/shared): 1x 8 vCPU, 16 GB RAM.

## 20k Concurrent Players
- Simulator/indexer: 4x 16 vCPU, 32 GB RAM (shard read paths).
- WS gateways: 2-4x 4-8 vCPU, 8-16 GB RAM.
- Validators: 3x 4-8 vCPU, 8-16 GB RAM.
- Executor: 2x 4-8 vCPU, 8-16 GB RAM (active/standby).
- Auth service: 2-3x 2-4 vCPU, 4-8 GB RAM.
- Convex backend: 1x 16 vCPU, 32 GB RAM + external DB.
- Postgres: 1x 16 vCPU, 32-64 GB RAM + SSD + WAL backups.
- Redis/NATS: 1-2x 2-4 vCPU, 4-8 GB RAM.

## 50k Concurrent Players
- Simulator/indexer: 8-12x 32 vCPU, 64 GB RAM (multi-shard + fanout).
- WS gateways: 4-8x 8 vCPU, 16 GB RAM.
- Validators: 4-5x 8 vCPU, 16 GB RAM.
- Executor: 2-3x 8 vCPU, 16 GB RAM.
- Auth service: 4-6x 4 vCPU, 8 GB RAM.
- Convex backend: 1x 32 vCPU, 64 GB RAM + external DB.
- Postgres: 2x 32 vCPU, 128 GB RAM (primary + read replicas).
- Metrics/logs: dedicated cluster (Prometheus + Grafana + Loki/ELK).

## Notes
- CPU-heavy paths: proof generation, update indexing, and WS fanout.
- Memory-heavy paths: explorer state retention, WS queues, and caches.
- Target hardware assumes SSD/NVMe storage and low-latency network.
