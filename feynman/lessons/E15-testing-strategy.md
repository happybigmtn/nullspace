# E15 - Testing strategy + harnesses (from scratch)

Focus files:
- `gateway/tests/integration/all-bet-types.test.ts` (gateway integration)
- `node/src/tests.rs` (node simulation)
- `packages/protocol/test/fuzz.test.ts` (protocol fuzzing)
- `tests/integration/cross-service.test.ts` (cross-service integration)

Goal: explain how our multi-layered testing strategy validates the entire stack from protocol encoding to distributed consensus and cross-service behavior. For every excerpt, you will see why it matters and a plain description of what the code does. This lesson reads like a textbook chapter: it introduces the testing philosophy, then walks through the test files with Feynman-style explanations.

---

## 0) Feynman summary (why this lesson matters)

Testing is how we turn a distributed system into a predictable product. The gateway integration tests simulate a real player connecting over WebSockets and placing bets. The node tests simulate multiple validators, a network, and a consensus engine, all inside a deterministic runtime. Together these tests answer two questions:

1) Does the user-facing protocol behave correctly end to end?
2) Does the validator stack converge on the same state under normal and stressful conditions?

If either answer is wrong, the game becomes unfair or unreliable. That is why these tests exist.

---

## 1) Testing philosophy: layers and responsibilities

Our stack needs five kinds of tests:

1) **Integration tests** for the gateway and client protocol. These use real WebSocket messages, real game flows, and a running gateway.
2) **Deterministic simulation tests** for the validator stack. These use simulated networks and deterministic time to test consensus and execution without flakiness.
3) **Security regression tests** for config redaction and secrets. These ensure debug logs do not leak private material.
4) **Property-based fuzzing tests** for protocol encoding/decoding. These use randomized inputs to discover edge cases that manual tests miss.
5) **Cross-service integration tests** that verify the full stack (auth, gateway, simulator) working together end-to-end.

The two focus files cover the first three categories. This lesson also introduces the newer testing approaches: protocol fuzzing and cross-service integration testing.

---

## 2) Gateway integration test: overview

File: `gateway/tests/integration/all-bet-types.test.ts`

This test is designed to be exhaustive. It connects to a live gateway, plays every bet type for every game, and asserts that none of those bets return an error.

It is not a unit test. It is a real protocol exercise:

- WebSocket connection is established.
- The client waits for a `session_ready` event.
- A bet message is sent.
- A response is parsed and validated.
- For multi-step games, a second message is sent (the "move").

If this test passes, it strongly suggests that the gateway routes messages correctly, the game engines accept the bets, and the response types match what the client expects.

---

## 3) The test harness and configuration knobs

At the top of the file we import helpers:

- `BET_TIMEOUT_MS`, `INTEGRATION_ENABLED`, `TEST_GAMES`, `TEST_TIMEOUT_MS`
- `createConnection`, `sendAndReceive`, `waitForReady`

These helpers live in `gateway/tests/helpers/ws.ts` (compiled to `.js` when running). The helper file defines environment-based configuration:

- `RUN_INTEGRATION=true` enables integration tests.
- `TEST_GATEWAY_PORT` controls where the test connects.
- `TEST_TIMEOUT_MS` and `TEST_RESPONSE_TIMEOUT_MS` control overall and per-message timeouts.
- `TEST_BET_TIMEOUT_MS` optionally wraps each bet with a timeout.
- `TEST_GAMES` can restrict which game categories to test.

This design is intentional. Integration tests are slow and require infrastructure, so they are opt-in. The timeouts are generous by default to avoid false failures in CI or remote environments. The gating via `RUN_INTEGRATION` prevents local devs from accidentally hanging their test runs.

---

## 4) The core helper: `testBet`

The heart of the test file is the `testBet` function. It accepts:

- `game`: a human-readable name for logs.
- `betType`: a label for the bet.
- `startMsg`: the first message to send.
- `moveMsg` (optional): the second message for multi-step games.

The structure looks like this, in plain English:

1) Open a WebSocket connection.
2) Wait for the gateway to say `session_ready`.
3) Send the start message and wait for a response.
4) If the start response is an error, return a failure result.
5) If there is no move message, interpret the start response as the final result.
6) If a move message exists, send it and parse the response.
7) Return a structured `TestResult` with status, response type, and payout.
8) Always close the socket and clear timeouts.

This is a small state machine. The test is designed to mirror how the client would behave: connect, wait for ready, then send bets.

### 4.1 Why `waitForReady` matters

`waitForReady` is not a cosmetic step. It does two things:

- It waits for `session_ready`, which indicates the gateway established the session and is ready to accept messages.
- It polls balance and registration state to ensure the account is usable for bets.

If we skip this step, the first bet might be rejected for missing session state. That would produce false failures.

### 4.2 Error handling and `TestResult`

The function returns a `TestResult` object with fields:

- `game`, `betType` for logging.
- `status` as `success` or `failed`.
- `response` if a response type is available.
- `payout` when present.
- `error` if an error occurred.

This allows `runAllTests` to produce a clean summary of failures without crashing the entire run.

### 4.3 Timeout control

The function wraps the run in a `Promise.race` if `BET_TIMEOUT_MS` is configured. This is a protective guard: if a bet hangs, the test fails fast and moves on.

Note the default: `BET_TIMEOUT_MS` can be zero, meaning no per-bet timeout. This is useful for local debugging when you want a slow bet to complete rather than be aborted.

### 4.4 Cleanup logic

The `finally` block is important. It clears any timeout and closes the WebSocket. Without this, you would leak sockets and timers, making the test unreliable and possibly exhausting file descriptors.

---

## 5) The bet catalog: exhaustive coverage by game

The file defines arrays for each game category. This is the "data layer" of the test: each entry describes one bet and its required message format.

### 5.1 Craps bet types

`CRAPS_BETS` contains a long list, including:

- Core bets: Pass Line, Don't Pass, Come, Don't Come, Field.
- Place bets ("Yes") with targets 4,5,6,8,9,10.
- Lay bets ("No") with targets.
- Hop bets for specific totals on the next roll.
- Hardway bets for specific doubles.
- Fire bet (side bet).
- ATS (All-Tall-Small) bets.
- Additional side bets like Muggsy, Diff Doubles, Ride Line, Replay, Hot Roller.

Each bet entry includes a numeric `betType` and a `target`. The tests do not verify payout correctness; they verify that the gateway accepts the bet and returns a non-error response. This is a pragmatic choice: payout correctness is covered by lower-level game logic tests; this file focuses on protocol viability and coverage.

### 5.2 Baccarat bet types

`BACCARAT_BETS` covers the common betting categories:

- Player, Banker, Tie.
- Side bets like Player Pair, Banker Pair, Lucky 6, Dragon bets, Panda 8, Perfect Pair.

Each test sends a `baccarat_deal` message with a list of bets. The response is expected to be a deal result with optional payout.

### 5.3 Roulette bet types

`ROULETTE_BETS` includes both inside and outside bets. The list illustrates the protocol shape:

- Inside bets: Straight, Split, Street, Corner, Six Line.
- Outside bets: Red, Black, Odd, Even, Low/High, Dozens, Columns.

Each entry has a `type` (bet kind) and a `value` (often the table position or subgroup). The test uses these to construct a `roulette_spin` message.

### 5.4 Sic Bo bet types

`SICBO_BETS` includes:

- Small and Big totals.
- Odd and Even.
- Specific triple, any triple.
- Specific double.
- Total bets.
- Single number bets.
- Domino (two dice) bets.
- Hop3 and Hop4 combinations.

Several of these use bit-packed numbers. For example, Domino uses `(2 << 4) | 5` to encode dice values. This is a compact representation used by the protocol. The test ensures the gateway accepts these encoded forms.

### 5.5 Three Card Poker bonus bets

`THREE_CARD_BETS` tests combinations of:

- Ante.
- Pair Plus.
- Six Card.
- Progressive.

These bets are represented as a struct of amounts. The test sends a `threecardpoker_deal` followed by a `threecardpoker_play` message. This models the actual game flow: you must deal before you can play.

### 5.6 Ultimate Holdem bonus bets

`ULTIMATE_HOLDEM_BETS` uses a similar pattern:

- Ante and blind are always present.
- Optional trips, six card, and progressive bonuses.

The test sends `ultimateholdem_deal` and then `ultimateholdem_check`, which simulates checking through to the river.

### 5.7 Blackjack bonus bets

`BLACKJACK_BETS` covers the standard bet and the optional 21+3 side bet.

### 5.8 Other games

`OTHER_GAMES` includes single-step games:

- HiLo (deal only).
- Video Poker (deal only).
- Casino War with and without the tie bet.

These are instant games where the deal response includes the result. That is why these entries do not include a `moveMsg`.

---

## 6) Per-game runners

For each game category, there is a `runXTests` function. The pattern is consistent:

1) Print a section header.
2) Create a results array.
3) For each bet, call `testBet` with the appropriate start message (and optional move).
4) Print a per-bet success or failure line.
5) Return the results.

Examples:

- `runBaccaratTests` uses `baccarat_deal` with `bets: [{ type, amount }]`.
- `runCrapsTests` uses `craps_bet` with `betType`, `target`, and `amount`.
- `runRouletteTests` uses `roulette_spin` with a list of bets.
- `runSicBoTests` uses `sicbo_roll` with a list of bets.
- `runThreeCardPokerTests` uses `threecardpoker_deal` then `threecardpoker_play`.
- `runUltimateHoldemTests` uses `ultimateholdem_deal` then `ultimateholdem_check`.
- `runBlackjackTests` uses `blackjack_deal`.
- `runOtherGamesTests` uses prebuilt messages.

The important design choice here is uniformity: each function uses the same `testBet` helper, so the logic for connection setup, timeout, and error handling is centralized.

---

## 7) Test orchestration: `runAllTests`

`runAllTests` is the coordinator. It prints a banner, then decides which categories to run:

- It builds an `include` function that checks `TEST_GAMES`.
- If `TEST_GAMES` is empty, all categories run.
- If `TEST_GAMES` contains entries, only those categories run.

This allows a developer to run a fast subset of tests, such as only `craps` or only `roulette`.

After running all enabled categories, `runAllTests` prints a summary:

- number of passed bets,
- number of failed bets,
- a list of failures with game name and error message.

This summary is crucial in CI where you want a quick view of what failed without scanning hundreds of lines.

---

## 8) Vitest wrapper and timeouts

The bottom of the file uses:

```
describe.skipIf(!INTEGRATION_ENABLED)(...)
```

This is the opt-in gate. If `RUN_INTEGRATION` is not true, the entire suite is skipped.

The single test case calls `runAllTests`, then asserts that the list of failed tests is empty. It passes `TEST_TIMEOUT_MS` to the test, which defaults to 20 minutes. That is deliberate. Integration tests can be slow in CI, especially when the gateway is cold or under load.

---

## 9) What this integration test *does not* do

It is important to understand the limitations:

- It does not check payout correctness or fairness. It only ensures the gateway accepts the bet and returns a response.
- It does not validate internal settlement logic. That is the domain of the execution and game engine tests.
- It requires a live gateway. If the gateway is misconfigured or offline, the test fails for environmental reasons.

The test is therefore best seen as a protocol sanity check, not a full correctness proof.

---

## 10) Node simulation tests: overview

File: `node/src/tests.rs`

This file is the opposite of the integration test. It avoids real networking and runs everything inside a deterministic runtime. The goals are:

- prove consensus determinism,
- simulate adverse network conditions,
- verify backfill and recovery,
- ensure secrets are not leaked in logs.

The file defines constants, helper functions, and multiple tests. It uses Commonware's simulated network and deterministic runtime to eliminate non-determinism.

---

## 11) Constants and context setup

The file begins with imports and a long list of constants. These constants matter because the deterministic runtime stores all state in memory.

Examples:

- `FREEZER_TABLE_INITIAL_SIZE` is set to 1MB to keep memory bounded.
- `BUFFER_POOL_PAGE_SIZE`, `BUFFER_POOL_CAPACITY` tune the storage buffer pool.
- `PRUNABLE_ITEMS_PER_SECTION`, `IMMUTABLE_ITEMS_PER_SECTION`, `MMR_ITEMS_PER_BLOB` define internal storage batching.
- `REPLAY_BUFFER` and `WRITE_BUFFER` define memory used for replay and write batching.

These are not random numbers. They are scaled down versions of production configs to keep tests fast and memory-safe while still exercising the code paths.

The file also defines short polling intervals: `ONLINE_POLL_INTERVAL_MS` and `ONLINE_MAX_POLL_TICKS`. These allow tests to detect convergence quickly without waiting for real timeouts.

---

## 12) Security regression test: config redaction

The first test, `config_redacted_debug_does_not_leak_secrets`, is a security regression test. It constructs a `Config` object with fake secret values:

- `private_key` = "deadbeef"
- `share` = "cafebabe"
- `polynomial` = "0123456789abcdef"

Then it renders `config.redacted_debug()` and asserts:

- none of the secret strings appear,
- the output contains "<redacted>".

This test enforces a critical rule: debug logs must never reveal private keys or secret shares. That matters for production because logs often flow to third-party systems.

---

## 13) Helper: `register_validators`

The function `register_validators` is the first major helper. It interacts with the simulated network oracle to register each validator.

For each validator:

1) It obtains a `control` handle from the oracle.
2) It registers eight channels, each with the same quota.
3) It stores the senders and receivers in a map keyed by validator public key.

The channels correspond to different message types in the engine:

- pending,
- recovered,
- resolver,
- broadcast,
- backfill,
- seeder,
- aggregator,
- aggregation.

The exact semantics of these channels are part of the engine, but the pattern is clear: each validator has a set of pipelines for different network flows. By registering all of them up front, the tests can wire each validator into the network.

The `Quota::per_second(NZU32!(10_000))` ensures that the simulated network does not artificially throttle traffic in tests.

---

## 14) Helper: `link_validators`

`link_validators` connects validators inside the simulated network. It accepts:

- a list of validators,
- a `Link` that defines latency, jitter, and success rate,
- an optional `restrict_to` function that can limit which connections are created.

The function iterates over all pairs `(v1, v2)`:

- It skips self-links.
- It applies the `restrict_to` filter if provided.
- It calls `oracle.add_link(v1, v2, link)` to establish the connection.

This allows tests to simulate full connectivity, partial partitions, or asymmetric networks simply by changing the `restrict_to` predicate.

---

## 15) The core simulation: `all_online`

`all_online` is the primary test harness. It spins up `n` validators, connects them, runs the engine, and waits until enough progress is observed.

### 15.1 Deterministic runtime

The function uses `commonware_runtime::deterministic::Runner` with a seed. This is crucial: it means every run with the same seed will produce the same execution order and random outcomes.

This property underpins the tests that compare state across runs. If the deterministic runtime works, two runs with the same seed should produce identical end states.

### 15.2 Simulated network

The function constructs a simulated network:

- `Network::new` returns a network handle and an oracle.
- The network is started inside the deterministic runtime.

The simulated network enforces the `Link` characteristics (latency, jitter, success rate). This allows the tests to reproduce good or bad network conditions deterministically.

### 15.3 Validators and keys

For each of `n` validators:

- A deterministic `PrivateKey` is derived from a seed.
- The public key is collected into a list.
- The list is sorted to ensure deterministic ordering.

Sorting is a subtle but important detail: it eliminates nondeterministic iteration order that could change the behavior across runs.

### 15.4 Distributed key generation (DKG)

The function calls `dkg::deal_anonymous::<MinSig>` to generate a threshold sharing and shares for each validator. This provides a shared identity (the threshold public key) and per-validator shares.

In plain terms: the validators jointly create a shared signing key without any single validator owning the full secret. This is a standard BFT technique for threshold signatures.

### 15.5 Mock indexer

A `Mock` indexer is created with the shared identity. The indexer collects summaries and seeds. It acts as the external "observer" in tests, allowing the simulation to check if validators are producing and sharing the expected outputs.

### 15.6 Engine configuration

For each validator, the test builds an `engine::Config` with three major sections:

1) **Identity config**: signer, sharing, share, participants.
2) **Storage config**: all the buffer sizes, freezer sizes, and table parameters.
3) **Consensus and application config**: timeouts, quotas, mempool limits, and execution concurrency.

This is a near-complete representation of the node configuration in production, scaled down for tests.

The presence of many constants here is a reminder: testing is not just about logic, it is about realistic configuration. If the configuration is unrealistic, the tests may not catch production failures.

### 15.7 Starting the engine

Each engine is created with `Engine::new` and started with the registered network channels:

- pending,
- recovered,
- resolver,
- broadcast,
- backfill,
- seeder,
- aggregator,
- aggregation.

This is the moment the simulation becomes active. Each validator starts listening, producing, and participating in consensus.

### 15.8 Polling metrics for convergence

After starting the engines, `all_online` enters a polling loop:

- It calls `context.encode()` to fetch metrics.
- It parses metrics lines, ignoring comments.
- It checks that `peers_blocked` metrics are zero.
- It counts `certificates_processed` metrics for validators.
- It checks the `indexer` for seeds and summaries.

This is a clever convergence detection mechanism. Rather than waiting for a specific block height, it uses metrics and indexer signals to infer that consensus activity is happening and that data is flowing.

If too many polling ticks pass, the test logs a warning and exits. This prevents infinite hangs in CI.

### 15.9 Returning the state

At the end, the function returns `context.auditor().state()`. This is the deterministic runtime's snapshot of system state. It is used by tests to verify determinism: the same inputs should yield the same state.

---

## 16) Tests that use `all_online`

Three tests call `all_online` with different network characteristics:

- `test_good_links`: low latency, low jitter, perfect success rate. It compares the state across two runs with the same seed.
- `test_bad_links`: high latency, high jitter, 75 percent success. Still expects deterministic state across runs.
- `test_1k`: moderate latency and jitter, and a 98 percent success rate. It runs with a large `required` value to stress the system.

These tests are not about performance; they are about determinism and resilience. Even under bad links, the consensus should converge on the same state if the network eventually delivers messages.

---

## 17) Backfill test

`test_backfill` exercises a crucial distributed systems feature: catching up a late validator.

The test uses `n = 5` validators. It proceeds in phases:

1) **Start 4 validators**, leaving one out.
2) **Wait until the online validators have processed enough certificates** (the "initial" container requirement).
3) **Bring the late validator online** but with restricted connectivity (only connected to a subset).
4) **Wait until all validators, including the late one, reach the final container requirement**.

This verifies that backfill works: a validator that missed earlier consensus rounds can fetch and process historical data and still converge to the same state.

The test uses `link_validators` with a `restrict_to` predicate to simulate partial connectivity. This is realistic: in a real network, a node might only connect to a few peers at first.

The backfill test also reuses the metric-based polling strategy, checking `certificates_processed` per validator prefix. This ensures the late validator is truly catching up, not just connecting.

---

## 18) Unclean shutdown test

`test_unclean_shutdown` validates recovery from abrupt restarts.

Key ideas:

- The deterministic runtime supports checkpoints.
- The test simulates random shutdowns and restarts.
- It ensures the system can recover and eventually converge.

### 18.1 Shared identity and indexer

The test derives a threshold sharing once and clones it for each run. The `Mock` indexer is created outside the restart loop, because it stores seeds beyond the pruning boundary. This is a subtle but important detail: if the indexer were reset each run, it would lose context and invalidate the test.

### 18.2 Restart loop

The test runs in a loop. Each iteration:

- Constructs a deterministic runtime (either from a checkpoint or a timed run).
- Starts a network and validators.
- Links validators with good network conditions.
- Runs until either a random shutdown point or completion.

After two restarts, the test lets the run finish and asserts that multiple runs occurred. This proves that the system can recover from unclean shutdowns without corrupting state.

---

## 19) Execution test: 1000 transactions

`test_execution` is the most detailed simulation test. It verifies that the execution pipeline processes transactions consistently and that all validators see the same events at the same heights.

The flow:

1) Build a deterministic runtime and simulated network.
2) Create a validator set and link them.
3) Generate a DKG sharing and mock indexer.
4) Configure and start engines for each validator.
5) Submit 1000 transactions (casino registrations).
6) Wait until all transactions are processed.
7) Verify that all validators produce identical event summaries.

### 19.1 Transaction submission and rebroadcast

The test generates 1000 transactions and submits them via the mock indexer. It keeps a `remaining` map of pending transactions. If no events appear for a while, it rebroadcasts the remaining transactions. This mirrors real-world gossip behavior and ensures that transient drops do not stall the test.

### 19.2 Event processing and consensus checks

The test drains the `summaries` from the indexer and inspects events. It looks for `CasinoPlayerRegistered` events and removes those transactions from the `remaining` map.

It also records each summary by height in a `seen` map. For each height, it counts how many validators produced the same summary. It only advances once all validators agree on the summary for that height. This is the core determinism check: all validators must produce identical outputs at each height.

### 19.3 Final state

Once all transactions are processed and all heights are consistent, the test returns the auditor state. This allows higher-level tests to compare runs with different network conditions.

---

## 20) Execution tests under different links

Three tests exercise `test_execution`:

- `test_execution_basic`: simple run with low latency, low jitter.
- `test_execution_good_links`: repeated runs with the same link and different seeds; asserts deterministic equality across runs.
- `test_execution_bad_links`: same as above but with high latency and packet loss.

The key idea is that even with bad links, deterministic inputs should yield deterministic state. If they do not, there is a bug in consensus or execution ordering.

---

## 21) Why these tests are strong

These tests are powerful because they simulate real distributed behavior without requiring a real network:

- You get repeatability due to deterministic runtime seeds.
- You can control network conditions precisely.
- You can test failure scenarios (late nodes, restarts) deterministically.
- You can verify cross-validator state equality.

This is the gold standard for distributed systems testing. It is much stronger than a single-node unit test and much cheaper than full-scale distributed integration tests.

---

## 22) Operational guidance

When running these tests, keep the following in mind:

- Gateway integration tests require a live gateway and `RUN_INTEGRATION=true`.
- Node simulation tests run entirely in-memory and should be deterministic; if they become flaky, that is a red flag.
- If you change consensus timeouts or storage parameters, update tests accordingly; many constants are tuned for deterministic runtime constraints.
- Long timeouts are intentional; shortening them may introduce false negatives in CI.

---

## 23) Protocol fuzzing: property-based testing with fast-check

File: `packages/protocol/test/fuzz.test.ts`

Fuzzing is a powerful technique for discovering edge cases that manual tests miss. Instead of writing specific test cases, you define properties that should always hold true and let the fuzzer generate thousands of randomized inputs.

Our protocol fuzzing tests use fast-check, a property-based testing library that generates random test data intelligently. The tests cover four key areas:

1. **Roundtrip encoding**: If you encode data and then decode it, you should get the original value back.
2. **Mutation testing**: Flip random bits in valid messages and ensure the decoder handles corruption gracefully.
3. **Random binary input**: Feed completely random bytes to decoders and ensure they never crash.
4. **Boundary conditions**: Test edge values for all numeric fields (zero, max values, etc).

### 23.1 Why fuzzing matters for protocols

Protocol bugs are often hiding in edge cases you didn't think to test:

- What happens when a card suit byte is 255 instead of 0-3?
- What if the message length field says 100 bytes but only 50 remain?
- Can bet amounts overflow when they reach MAX_SAFE_INTEGER?
- Does bit-flipping in an encoded bet create an exploitable state?

Manual testing can't cover the combinatorial explosion of possibilities. Fuzzing finds these cases automatically by generating thousands of test inputs.

### 23.2 Roundtrip property tests

The most fundamental property is roundtrip encoding. For example, version headers:

```typescript
fc.property(
  fc.uint8Array({ minLength: 1, maxLength: 1000 }),
  (payload) => {
    const versioned = withVersionHeader(payload);
    const { version, payload: stripped } = stripVersionHeader(versioned);

    expect(version).toBe(CURRENT_PROTOCOL_VERSION);
    expect(stripped).toEqual(payload);
  }
)
```

This test generates 10,000 random byte arrays, wraps each with a version header, strips it back off, and verifies the payload is unchanged. If any input breaks this invariant, the test fails and fast-check provides a minimal failing example.

### 23.3 Encoding stability tests

Encoding functions should never crash regardless of input. The fuzzer tests all atomic batch encoders:

- Roulette bets: random bet types, numbers (0-36), and amounts up to u64::MAX
- Craps bets: random bet types, targets, and amounts
- Baccarat, Sic Bo: similar coverage for their bet structures

Example for roulette:

```typescript
fc.property(
  fc.integer({ min: 0, max: 255 }),  // betType
  fc.integer({ min: 0, max: 36 }),    // number
  fc.bigInt({ min: 1n, max: BigInt(Number.MAX_SAFE_INTEGER) }),
  (betType, number, amount) => {
    const encoded = encodeRouletteBet(betType, number, amount);
    expect(encoded.length).toBe(12);
    expect(encoded[0]).toBe(CURRENT_PROTOCOL_VERSION);
  }
)
```

The test verifies that encoding always produces the expected byte length and includes the version header, even with extreme values.

### 23.4 Decoder robustness: crash testing

The most critical tests verify that decoders never crash on invalid input. Every decoder must either return valid data or throw a known error type (ProtocolError or UnsupportedProtocolVersionError). It must never throw an unhandled exception or cause a panic.

```typescript
fc.property(
  fc.uint8Array({ minLength: 0, maxLength: 500 }),
  (data) => {
    try {
      decodeGameResult(data);
    } catch (e) {
      expect(e).toBeInstanceOf(ProtocolError);
    }
  }
)
```

This feeds completely random bytes to `decodeGameResult`. The test passes if the decoder either succeeds or throws only ProtocolError. Any other exception type indicates a bug.

### 23.5 Mutation testing: bit flips

Mutation tests verify graceful handling of corrupted messages. The fuzzer generates valid data, flips a random bit, and checks the result:

```typescript
fc.property(
  fc.integer({ min: 0, max: 3 }),   // valid suit
  fc.integer({ min: 0, max: 12 }),  // valid rank
  fc.integer({ min: 0, max: 23 }),  // bit position
  (suit, rank, bitPos) => {
    const data = new Uint8Array([suit, rank, 1]);
    const byteIdx = Math.floor(bitPos / 8);
    const bitIdx = bitPos % 8;
    data[byteIdx] ^= (1 << bitIdx);  // flip bit

    try {
      const card = decodeCard(data, 0);
      // If it decodes, verify structure is valid
      expect(card).toHaveProperty('suit');
    } catch (e) {
      // Should only throw ProtocolError
      expect(e).toBeInstanceOf(ProtocolError);
    }
  }
)
```

This simulates network corruption or malicious tampering. The decoder must handle every possible bit flip without crashing.

### 23.6 Boundary value testing

The fuzzer explicitly tests boundary conditions for numeric fields:

- SessionID: 0, 1, MAX_SAFE_INTEGER, i64::MAX, u64::MAX
- Payout amounts: same boundaries
- Card counts: 0, 1, 10, 21 (blackjack edge case)
- Message lengths: 0, 1, 127, 255 (max for u8 length prefix)

These are the values most likely to trigger integer overflow, underflow, or off-by-one errors.

### 23.7 CI integration and iteration control

The fuzz tests run with 10,000 iterations locally and 1,000 in CI (to keep build times reasonable). You can override with `FUZZ_ITERATIONS=1000000` for extended fuzzing:

```bash
FUZZ_ITERATIONS=1000000 pnpm test fuzz.test.ts
```

For extended runs (>100,000 iterations), the fuzzer includes a stress test that runs all decoders on the same random input and verifies zero crashes.

### 23.8 Why this approach is strong

Property-based fuzzing complements manual tests:

- Manual tests cover known scenarios and expected behavior
- Fuzzing finds unknown edge cases and unexpected failures
- Together they provide much higher confidence than either alone

If a fuzzer finds a bug, you add a regression test for that specific case. Over time, the combination of fuzzing and regression tests covers a much larger input space than manual testing alone.

---

## 24) Cross-service integration tests

Files: `tests/integration/cross-service.test.ts`, `tests/integration/helpers/services.ts`

Cross-service tests verify the full stack working together: authentication service, gateway, and blockchain simulator. Unlike the per-service integration tests, these tests exercise the complete user journey across service boundaries.

### 24.1 What cross-service tests validate

These tests answer questions like:

- Can a new user authenticate, connect to the gateway, and place a bet end-to-end?
- Do balance updates from the simulator propagate correctly through the gateway?
- Does session state remain isolated between concurrent clients?
- How does the system handle invalid messages or malformed requests across services?
- Can multiple clients play games simultaneously without interfering with each other?

These are system-level properties that can't be validated by testing services in isolation.

### 24.2 Service orchestration and health checks

Before running tests, the framework verifies all services are healthy:

```typescript
const DEFAULT_SERVICES = [
  { name: 'convex', healthUrl: 'http://localhost:3210', timeout: 30000 },
  { name: 'auth', healthUrl: 'http://localhost:4000', timeout: 30000 },
  { name: 'simulator', healthUrl: 'http://localhost:8080', timeout: 60000 },
  { name: 'gateway', healthUrl: 'http://localhost:9010', timeout: 30000 },
];

await waitForAllServices();
```

The framework polls each service's health endpoint until it responds or times out. This prevents flaky failures from services not being ready.

### 24.3 Full user journey test

The most important test validates the complete flow:

1. **Connect to gateway** over WebSocket
2. **Wait for `session_ready` message** (gateway confirms session established)
3. **Register user** (simulator creates account and allocates initial balance)
4. **Query balance** (verify registration and balance propagated)
5. **Place bet** (send blackjack_deal message)
6. **Receive result** (verify game engine processed bet and returned outcome)
7. **Check balance updated** (verify settlement reflected in balance)

This exercises:
- WebSocket connection handling
- Session management
- User registration flow
- Balance tracking across services
- Game engine execution
- State synchronization

### 24.4 Concurrent client isolation

A critical property for a multi-tenant system is that clients don't interfere with each other:

```typescript
it('should isolate game state between clients', async () => {
  const client1 = new CrossServiceClient();
  const client2 = new CrossServiceClient();

  // Start game on client1
  await client1.sendAndReceive({ type: 'blackjack_deal', amount: 100 });

  // Client2 should not have an active game
  const response = await client2.sendAndReceive({ type: 'blackjack_stand' });
  expect(response.code).toBe('NO_ACTIVE_GAME');
});
```

This verifies that session state is properly isolated. If the gateway mixed up sessions, client2 might see or interfere with client1's game.

### 24.5 Error handling across service boundaries

Cross-service tests verify error propagation:

- Invalid message types return `INVALID_MESSAGE` errors
- Bets exceeding balance return `INSUFFICIENT_BALANCE` from the simulator
- Moves without an active game return `NO_ACTIVE_GAME` from the game engine
- Malformed JSON is handled gracefully without crashing connections

These tests ensure error handling is consistent across the full stack, not just in individual services.

### 24.6 Load testing with concurrent connections

The tests verify the system handles multiple simultaneous clients:

```typescript
it('should handle multiple simultaneous clients', async () => {
  const clients = Array.from({ length: 5 }, () => new CrossServiceClient());

  await Promise.all(clients.map(c => c.connect()));
  const sessions = await Promise.all(clients.map(c => c.waitForMessage('session_ready')));

  // Verify all sessions are unique
  const sessionIds = sessions.map(s => s.sessionId);
  expect(new Set(sessionIds).size).toBe(clients.length);
});
```

This is a lightweight load test: if the system can handle 5 clients in parallel, it likely handles connection concurrency correctly. More extensive load tests would use tools like k6 or Locust, but this smoke test catches basic concurrency bugs.

### 24.7 Docker Compose orchestration

The test helpers include utilities for starting the full stack with Docker Compose:

```typescript
await startDockerStack('tests/integration/docker-compose.cross-service.yml');
// ... run tests ...
await stopDockerStack();
```

This allows tests to run in CI without requiring a manually-started stack. The Docker Compose file defines all service dependencies, networking, and initialization order.

### 24.8 Opt-in execution

Like the gateway integration tests, cross-service tests are opt-in:

```bash
RUN_CROSS_SERVICE=true pnpm test:cross-service
```

This prevents them from running in quick local test loops (they're slow and require infrastructure) but ensures they run in CI on every PR.

### 24.9 Why cross-service tests matter

Individual service tests can't catch:

- Race conditions in cross-service communication
- State synchronization bugs between gateway and simulator
- Session handling edge cases that span service boundaries
- Network-level issues in production-like deployments

Cross-service tests validate the system as players experience it. They're the last line of defense before production.

---

## 25) CI workflow integration

The testing strategy is only effective if all tests run automatically on every change. The CI workflows ensure:

1. **Unit tests** run on every commit (fast feedback)
2. **Integration tests** run on PRs affecting each service
3. **Cross-service tests** run on PRs affecting multiple services or the integration boundary
4. **Fuzzing tests** run with reduced iterations in CI (1000) and extended locally (10000+)

### 25.1 Test selection and triggers

Different test suites have different trigger conditions:

- **Unit tests**: Always run (fast, no infrastructure needed)
- **Gateway integration**: Run when `gateway/**` or `packages/protocol/**` changes
- **Cross-service**: Run when multiple services change or on `main` branch

This optimizes CI time by only running expensive tests when relevant code changes.

### 25.2 Timeout configuration

Each test suite has appropriate timeouts:

- Unit tests: 2 minutes (should be fast)
- Integration tests: 20 minutes (allow for slow startup and message processing)
- Cross-service: 30 minutes (full stack startup takes time)

These are deliberately generous to avoid false failures in CI environments with variable performance.

### 25.3 Artifact retention

Failed tests upload artifacts for debugging:

- Integration tests: logs from failed test runs (7 days)
- Fuzzing: minimal failing examples when found (30 days)

Artifact retention balances debuggability with storage costs.

### 25.4 Test reporting and PR comments

Workflows post comments on PRs with:

- Test summaries (passed/failed/skipped counts)
- Links to detailed logs and artifacts
- Instructions for reproducing failures locally
- Guidance on updating fixtures if needed

This keeps the feedback loop tight: developers see results in the PR without leaving GitHub.

### 25.5 Continuous monitoring

Beyond PR checks, some tests run on a schedule:

- Extended fuzzing (1M iterations) runs nightly on `main`
- Cross-service soak tests run weekly to catch gradual degradation
- Dependency update PRs trigger all test suites

This catches issues that only appear over time or in rare combinations.

---

## 26) Feynman recap

The testing strategy has five complementary layers:

1. **Gateway integration tests** provide exhaustive protocol coverage: every bet type, every game, via real WebSocket messages.

2. **Node simulation tests** use deterministic runtime and simulated networks to prove consensus and execution converge correctly even under bad links, late nodes, or unclean restarts.

3. **Protocol fuzzing** with fast-check generates thousands of randomized inputs to find edge cases in encoding/decoding that manual tests miss. It verifies decoders never crash, encoders handle extreme values, and bit-flipped messages are handled gracefully.

4. **Cross-service integration tests** exercise the complete user journey across authentication, gateway, and simulator boundaries. They verify session isolation, error propagation, and concurrent client handling at the system level.

5. **CI workflow integration** ensures all tests run automatically on relevant changes with appropriate timeouts, artifact retention, and PR feedback.

Together these layers provide defense in depth:

- Unit tests catch logic bugs
- Integration tests catch protocol and API issues
- Fuzzing catches edge cases and crashes
- Cross-service tests catch system-level bugs
- Simulation tests catch consensus and distributed systems issues

If you can explain these tests to someone new, you understand how the system is supposed to behave under both normal and adversarial conditions. More importantly, you understand why each testing layer matters and what classes of bugs it prevents.
