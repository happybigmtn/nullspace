# Management Action Items (from Feynman walkthrough callouts)

This document consolidates every **Limits & management callout** from the Feynman walkthroughs into concrete action items. Each action item lists the impacted lessons so coverage is explicit. Items are grouped by theme so we can implement and track them systematically.

Status legend:
- **[ ] Pending** = not yet implemented in code/docs
- **[x] Implemented** = implemented in this repo (code or runbook change)
- **[~] Needs decision** = requires product/ops decision outside code

---

## A) Access control, origins, and secrets

1. **[x] Enforce origin allowlists across all public HTTP/WS surfaces**
   - Apply to: L01, L12, L13, L47, L28, L32, S01, S05, E14
   - Action: require explicit allowlists in production for gateway, simulator (HTTP + WS), auth, ops; support `ALLOW_NO_ORIGIN` for native clients.

2. **[x] Require metrics auth in production**
   - Apply to: E03, E14, S07
   - Action: ensure validators, simulator, auth reject `/metrics` unless `METRICS_AUTH_TOKEN` set; include in env examples.

3. **[x] Lock down admin keys to file/secret sources in production**
   - Apply to: E14, L39, L44
   - Action: keep env keys disabled by default; document file-based key paths and permissions.

4. **[x] Protect service tokens (Convex, ops) and plan rotations**
   - Apply to: L38
   - Action: document 90-day rotation cadence + incident rotation steps and ensure service tokens are required for sensitive endpoints.

5. **[x] Never log private keys**
   - Apply to: S03, S04, L49
   - Action: validate logging/redaction and document "no key logging" rule.

---

## B) Limits, rate limiting, and payload size

6. **[x] Align casino name/payload limits across clients and gateway**
   - Apply to: L03, L15, L24
   - Action: add shared constants and enforce max name/payload sizes before submission.

7. **[x] Add submission size cap on the gateway client side**
   - Apply to: L04
   - Action: reject oversized submissions before POSTing to simulator; align with simulator body limit.

8. **[x] Tune gateway session caps + rate limits for NAT-heavy traffic**
   - Apply to: L01, L02, L13, E02, E16
   - Action: document 5k testnet caps and NAT guidance in runbooks/limits.

9. **[x] Tune simulator rate limits for testnet traffic**
   - Apply to: L47, E16
   - Action: document 5k testnet rate limits and adjustment guidance.

10. **[x] Ensure WS timeouts and buffers are configured intentionally**
    - Apply to: L12
    - Action: document defaults and enforce in config if needed.

11. **[x] Keep upstream proxy/body limits aligned**
    - Apply to: E16, L47
    - Action: document that LB/proxy limits must match simulator `http_body_limit_bytes`.

47. **[x] Gateway submit/health/account timeouts are configurable**
    - Apply to: L05, L17
    - Action: expose env overrides for submit/health/account timeouts.

12. **[x] Mempool and queue sizes must be bounded and budgeted**
   - Apply to: S02, E16
   - Action: document memory budget targets for 5k and confirm on staging load tests.

---

## C) Consensus-critical constants and economics

13. **[x] Centralize view-time conversion to avoid drift**
    - Apply to: L11, L45
    - Action: use a single `MS_PER_VIEW` constant so time-based rules update consistently.

14. **[x] Document consensus-critical limits + upgrade process**
    - Apply to: E16, L11, E06, L45
    - Action: document that casino/protocol caps are consensus-critical and require coordinated upgrades.

15. **[x] Super mode fee is fixed**
    - Apply to: E06
    - Action: document as consensus-critical economic policy.

---

## D) Storage, retention, and persistence

16. **[x] Explorer retention settings must be explicit**
    - Apply to: E05, L48
    - Action: document `--explorer-max-blocks` and retention targets; add env example values.

17. **[x] Ops data must be on persistent disk**
    - Apply to: E11
    - Action: document `OPS_DATA_DIR` requirements in runbook.

18. **[x] Auth challenges and Stripe events need retention policies**
    - Apply to: L33, L37
    - Action: document retention envs and ensure prune jobs are scheduled.

19. **[x] Convex admin nonce table growth**
    - Apply to: L40
    - Action: document acceptable growth and add optional cleanup policy if needed.

---

## E) Auth and identity flows

20. **[x] Auth challenge TTL must be short but usable**
    - Apply to: L28, L32, S05
    - Action: set `AUTH_CHALLENGE_TTL_MS` in env examples and document tradeoffs.

21. **[x] Challenge store should avoid unbounded growth**
    - Apply to: L33
    - Action: ensure prune job exists and retention configured.

22. **[x] Entitlements queries must be bounded**
    - Apply to: L38
    - Action: add query limit (pagination or max cap) and update auth server calls.

23. **[x] Nonce store resilience**
    - Apply to: L39
    - Action: document fallback behavior and recommend always-on Convex nonce store.

---

## F) Payments and Stripe

24. **[x] Webhook verification and idempotency enforced**
    - Apply to: S06
    - Action: confirm signature verification + idempotent storage are documented.

25. **[x] Stripe webhook rate limits must be tuned**
   - Apply to: L35
   - Action: document 5k starting values for rate limit envs + memory caps.

26. **[x] Stripe event retention**
    - Apply to: L37
    - Action: set `STRIPE_EVENT_RETENTION_MS` and prune schedule.

27. **[x] Stripe API version maintenance**
    - Apply to: L36
    - Action: document upgrade process for API version changes.

---

## G) Client behavior and UX safeguards

28. **[x] Web/mobile reconnect backoff**
   - Apply to: E09
   - Action: document exponential backoff defaults and tuning guidance.

29. **[x] Lazy-loaded routes must be monitored**
    - Apply to: E10
    - Action: ensure error monitoring includes all routes.

30. **[x] UI assumptions about initial balance**
    - Apply to: L14
    - Action: ensure UI reflects on-chain initial chips or refreshes from backend.

---

## H) Live-table operations

31. **[x] Live-table timing and retry settings must be explicit**
    - Apply to: L42, L43, L44
    - Action: document `LIVE_TABLE_*` envs and align between gateway + service.

32. **[x] Live-table bot configuration must be explicit**
    - Apply to: L43
    - Action: document defaults and require opt-in in production.

33. **[x] Gateway should not silently accept oversized bets**
    - Apply to: L41, L46
    - Action: ensure limits are enforced in execution or gateway validates against config.

---

## I) Ops, CI, and testing

34. **[x] CI image pipeline cost awareness**
    - Apply to: E12
    - Action: document trigger policy, caching strategy, and required website build args/secrets.

35. **[x] Environment file paths and systemd layout**
    - Apply to: E13
    - Action: document paths and ensure unit files match deployment layout (including file descriptor limits).

36. **[x] Integration test prerequisites**
    - Apply to: E15
    - Action: document required gateway for integration tests and expected timeouts.

37. **[x] Private network + firewall enforcement**
    - Apply to: E02
    - Action: ensure internal services are private-only and firewall rules match runbook.

38. **[x] Scaling guidance for gateway/simulator**
    - Apply to: E01, E02
    - Action: document when to add gateway replicas and simulator/indexer replicas behind an LB.

39. **[x] Gameplay timing defaults must be tuned with telemetry**
   - Apply to: E01, L11, L45, L43
   - Action: document where timing constants live, keep defaults for 5k, and adjust after load tests.

---

## J) Reliability + policy decisions

40. **[x] RPO/RTO drill plan**
   - Apply to: E05
   - Action: set quarterly restore drills + annual failover rehearsal for RPO/RTO targets.

41. **[x] Economic policy limits review**
   - Apply to: L11, L13, L27, L28, L39
   - Action: document 5k testnet defaults for faucet, tournaments, and freeroll limits.

42. **[x] Health check latency guidelines**
    - Apply to: S07
    - Action: document that health endpoints must remain fast and avoid slow downstream calls.

43. **[x] OTLP tracing configuration**
   - Apply to: E11
   - Action: document OTLP endpoint + sampling defaults for testnet.

44. **[x] Web feature-flag/config validation**
   - Apply to: E10
   - Action: add website preflight checks for required VITE_* flags.

45. **[x] Explorer persistence backpressure policy**
   - Apply to: L48
   - Action: choose `block` for testnet/prod and document defaults.

46. **[x] Vault password/KDF policy + passkey fallback guidance**
   - Apply to: L50
   - Action: enforce min length 10, PBKDF2 310k iterations, and document passkey fallback portability.

---

## Callout coverage index

This index maps each lesson callout to its action item(s).

- E01: Item 38 (scale non-goals), Item 39 (timing defaults)
- E02: Item 37 (private network/firewall), Item 38 (scaling), Item 8 (gateway caps)
- E03: Item 2 (metrics auth), Item 12 (channel rate limits)
- E04: Item 14 (proof bounds), Item 12 (batch size tuning)
- E05: Item 16, Item 17, Item 40
- E06: Item 15
- E07: Item 14 (consensus RNG requirements)
- E08: Item 14 (schema drift prevention)
- E09: Item 28
- E10: Item 29, Item 44
- E11: Item 17, Item 1 (CORS allowlist), Item 43
- E12: Item 34
- E13: Item 35
- E14: Item 1, Item 2, Item 3
- E15: Item 36
- E16: Item 6, Item 8, Item 9, Item 11, Item 12, Item 14
- L01: Item 8, Item 1
- L02: Item 8, Item 30
- L03: Item 6
- L04: Item 7
- L05: Item 8, Item 47
- L11: Item 13, Item 14, Item 41
- L12: Item 1, Item 10
- L13: Item 8, Item 1, Item 41
- L14: Item 30
- L15: Item 6
- L16: Item 14
- L17: Item 8, Item 47
- L18: Item 6
- L24: Item 6
- L25: Item 35 (data dir perms documented elsewhere)
- L26: Item 28 (polling/backoff expectations)
- L27: Item 31 (schedule timing), Item 41
- L28: Item 20, Item 2, Item 41
- L29: Item 23
- L32: Item 20, Item 1
- L33: Item 18, Item 21
- L34: Item 23
- L35: Item 25
- L36: Item 27
- L37: Item 18, Item 26
- L38: Item 22, Item 4
- L39: Item 3, Item 23, Item 41
- L40: Item 19
- L41: Item 33
- L42: Item 31
- L43: Item 31, Item 32
- L44: Item 31, Item 3
- L45: Item 13, Item 14
- L46: Item 33
- L47: Item 1, Item 9, Item 11
- L48: Item 16, Item 45
- L49: Item 5
- L50: Item 46, Item 5
- S01: Item 1
- S02: Item 12
- S03: Item 5
- S04: Item 5
- S05: Item 1, Item 20
- S06: Item 24
- S07: Item 2, Item 36, Item 42
