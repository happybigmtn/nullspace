# L26 - Freeroll UI scheduler (from scratch)

Focus file: `website/src/hooks/terminalGame/useFreerollScheduler.ts`

Goal: explain how the UI keeps freeroll tournaments in sync with chain state and automatically starts/ends tournaments when needed. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) UI needs a scheduler
Freeroll tournaments are time‑based. The UI must:
- know the next tournament time,
- detect the active tournament,
- update player stats and leaderboard,
- trigger auto‑start/end when needed.

### 2) WebSocket vs polling
The UI prefers WebSocket updates. If the socket is idle or hidden, it falls back to periodic HTTP polling.

### 3) Registration vs active phases
Freerolls have a registration window and an active window. The UI uses this to show appropriate state and to trigger auto‑start/end.

---

## Limits & management callouts (important)

1) **Polling intervals**
- `NETWORK_POLL_FAST_MS = 2000`
- `NETWORK_POLL_IDLE_MS = 8000`
- `NETWORK_POLL_HIDDEN_MS = 30000`
These trade responsiveness for bandwidth.

2) **WS idle thresholds**
- `WS_IDLE_FAST_MS = 4000`
- `WS_IDLE_SLOW_MS = 15000`
- `WS_IDLE_HIDDEN_MS = 60000`
Used to decide when to fall back to polling.

3) **Leaderboard polling**
- `LEADERBOARD_POLL_MIN_MS = 15000`
Avoids hammering the leaderboard endpoint.

---

## Walkthrough with code excerpts

### 1) Schedule tick and next tournament timing
```ts
useEffect(() => {
  const interval = setInterval(() => {
    const now = Date.now();
    if (playMode !== 'FREEROLL') {
      setTournamentTime(0);
      setFreerollActiveTournamentId(null);
      setFreerollActiveTimeLeft(0);
      setFreerollNextTournamentId(null);
      setFreerollNextStartIn(0);
      setFreerollIsJoinedNext(false);
    } else {
      const scheduleNow = getFreerollSchedule(now);
      const nextTid = scheduleNow.isRegistration ? scheduleNow.tournamentId : scheduleNow.tournamentId + 1;
      const nextStartMs = nextTid * FREEROLL_CYCLE_MS + FREEROLL_REGISTRATION_MS;
      setFreerollNextTournamentId(nextTid);
      setFreerollNextStartIn(Math.max(0, Math.ceil((nextStartMs - now) / 1000)));

      if (manualTournamentEndTime !== null && phase === 'ACTIVE') {
        const remaining = Math.max(0, manualTournamentEndTime - now);
        setTournamentTime(Math.ceil(remaining / 1000));
      }
    }
    // ...
  }, 1000);

  return () => clearInterval(interval);
}, [/* deps */]);
```

Why this matters:
- The UI must always know when the next freeroll starts and how long the current one lasts.

What this code does:
- Runs once per second.
- If not in freeroll mode, clears tournament UI state.
- If in freeroll mode, computes next tournament ID and time‑to‑start.
- Updates countdown timers when the tournament is active.

---

### 2) WS idle detection and fallback polling
```ts
const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
const updatesStatus = clientRef.current?.getUpdatesStatus?.();
const sessionStatus = clientRef.current?.getSessionStatus?.();
const lastEventAt = Math.max(updatesStatus?.lastEventAt ?? 0, sessionStatus?.lastEventAt ?? 0);
const wsConnected = Boolean(updatesStatus?.connected || sessionStatus?.connected);
const idleThreshold = isHidden
  ? WS_IDLE_HIDDEN_MS
  : (awaitingChainResponseRef.current || isPendingRef.current ? WS_IDLE_FAST_MS : WS_IDLE_SLOW_MS);
const wsIdle = !lastEventAt || now - lastEventAt > idleThreshold;
if (wsConnected && !wsIdle) {
  return;
}

const pollInterval = isHidden
  ? NETWORK_POLL_HIDDEN_MS
  : (awaitingChainResponseRef.current || isPendingRef.current ? NETWORK_POLL_FAST_MS : NETWORK_POLL_IDLE_MS);
if (now - lastNetworkPollRef.current < pollInterval) {
  return;
}
lastNetworkPollRef.current = now;
```

Why this matters:
- WebSockets can go silent or the tab can be hidden. Polling ensures the UI stays correct.

What this code does:
- Detects whether the app is hidden and whether WS has been idle too long.
- If WS is healthy, it skips polling to save bandwidth.
- If WS is idle, it polls at a rate determined by activity level.

---

### 3) Update player stats and balances
```ts
if (playerState) {
  setIsRegistered(true);
  hasRegisteredRef.current = true;

  setTournamentsPlayedToday(Number(playerState.tournamentsPlayedToday ?? 0));
  const chainLimit = Number(playerState.tournamentDailyLimit ?? 0);
  setTournamentDailyLimit(chainLimit > 0 ? chainLimit : FREEROLL_DAILY_LIMIT_FREE);

  const timeSinceLastUpdate = Date.now() - lastBalanceUpdateRef.current;
  shouldUpdateBalance = timeSinceLastUpdate > balanceUpdateCooldownMs;

  playerActiveTid = playerState.activeTournament != null ? Number(playerState.activeTournament) : null;
  setPlayerActiveTournamentId(playerActiveTid);
}
```

Why this matters:
- This keeps the UI accurate even if WebSocket updates are missed.

What this code does:
- Uses the latest player state to update registration status, daily limits, and active tournament.
- Throttles balance refresh to avoid UI jitter and excessive polling.

---

### 4) Auto‑start and auto‑end tournaments
```ts
if (!scheduleNow.isRegistration && now < scheduleNow.endTimeMs && !freerollStartInFlightRef.current) {
  try {
    const t = await client.getCasinoTournament(scheduleNow.tournamentId);
    if (t && t.phase === 'Registration' && Array.isArray(t.players) && t.players.length > 0) {
      freerollStartInFlightRef.current = true;
      setIsTournamentStarting(true);
      try {
        const result = await client.nonceManager.submitCasinoStartTournament(
          scheduleNow.tournamentId,
          scheduleNow.startTimeMs,
          scheduleNow.endTimeMs
        );
        if (result?.txHash) setLastTxSig(result.txHash);
      } finally {
        setIsTournamentStarting(false);
        freerollStartInFlightRef.current = false;
      }
    }
  } catch (e) {
    setIsTournamentStarting(false);
    freerollStartInFlightRef.current = false;
  }
}

if (activeTournament && now >= activeTournament.endTimeMs && !freerollEndInFlightRef.current) {
  freerollEndInFlightRef.current = true;
  try {
    const result = await client.nonceManager.submitCasinoEndTournament(activeTournament.id);
    if (result?.txHash) setLastTxSig(result.txHash);
  } finally {
    freerollEndInFlightRef.current = false;
  }
}
```

Why this matters:
- Freerolls need automation. If no one manually starts or ends them, they stall.

What this code does:
- Detects when a tournament should start, and submits an on‑chain start transaction.
- Detects when an active tournament has ended and submits the end transaction.
- Uses in‑flight refs to avoid double submissions.

---

## Key takeaways
- The freeroll scheduler keeps the UI aligned with chain time and state.
- It falls back to polling when WebSockets are idle.
- It can auto‑start and auto‑end tournaments when conditions are met.

## Next lesson
L27 - Tournament scheduler: `feynman/lessons/L27-tournament-scheduler.md`
