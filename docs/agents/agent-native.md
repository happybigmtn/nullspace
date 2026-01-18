# Agent-Native Development

- Follow the Every.to "Agent-Native Software" guide: enforce parity (anything in the UI must be doable via tools/CLI), granularity (atomic tools over monolith flows), composability (features = prompts + tools), emergent capability (open-ended prompts reveal missing tools), and improvement-over-time (prompts/configs can ship without code).
- Default to agent-first delivery: single non-interactive entrypoints, deterministic seeds/fixtures, idempotent scripts, and zero manual checkpoints.
- Prefer machine-readable outputs (JSON/YAML) and structured logs to stdout + CI artifacts; never rely on local shell state.
- Make configuration explicit and flaggable: env/CLI switches with safe local defaults; secrets live in env files or secret stores, never personal shells.
- Bake in self-healing: pre-flight health checks, bounded retries where safe, graceful teardown/cleanup, and port reclamation to avoid stuck runs.
- Every new feature ships with an executable "golden path" (update `scripts/agent-up.sh`/`agent-loop.sh`/tests) plus fixtures/golden vectors to keep validation green by default.
- Document failure modes and recovery steps inline (README/AGENTS) so agents can autonomously choose next priorities.
