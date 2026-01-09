# L51 - Bet history and session stats (from scratch)

Focus files:
- `mobile/src/screens/HistoryScreen.tsx`
- `mobile/src/services/storage.ts`
- `mobile/src/hooks/useBetHistory.ts`

Goal: explain how the mobile app tracks bet history locally, calculates session statistics, and displays them with date filtering. For every excerpt, you will see **why it matters** and a **plain description of what the code does**.

---

## Concepts from scratch (expanded)

### 1) Client-side bet history
The mobile app stores bet history entirely on the device using MMKV encrypted storage. This means:
- No network round trips to view past bets.
- History persists across app restarts.
- User privacy is preserved (betting data stays local).

### 2) Session statistics vs history
History is the raw list of individual bets. Session statistics are aggregated metrics:
- Total bets placed, total wagered, total payout.
- Win/loss/push counts.
- Biggest win and biggest loss.

Both are stored separately but kept in sync.

### 3) Date filtering without a database
The app uses in-memory filtering on the stored JSON array. Date ranges (Today, 7 Days, 30 Days, All) are computed from wall-clock time and applied to the timestamp field of each bet entry.

### 4) Reactive UI updates
The HistoryScreen uses `useMemo` to recompute filtered bets and stats whenever the date filter or data changes. This keeps the UI responsive without manual cache management.

### 5) Pull-to-refresh pattern
Users can pull down to refresh data. Because data is local, the "refresh" re-reads from storage and forces React to re-render. This is mostly for UX consistency with other screens.

---

## Limits & management callouts (important)

1) **MAX_BET_HISTORY_ENTRIES = 500**
- Older entries are pruned when the history exceeds this limit.
- This prevents unbounded storage growth and performance degradation.
- Consider raising this if users need longer history, but test rendering performance with large lists.

2) **Date filter ranges**
- "Today" = current day, midnight to 23:59:59.
- "7 Days" = last 7 full days (168 hours).
- "30 Days" = last 30 full days (720 hours).
- "All" = epoch 0 to now.
These are client-computed and may drift if the device clock is wrong.

3) **Session stats update timing**
- Stats update immediately when a new bet is recorded via `addBetToHistory`.
- Stats are recalculated on-the-fly in the UI when filtering by date.
- Filtered stats are ephemeral (not persisted), only the all-time stats are stored.

4) **Storage encryption**
- Bet history is stored in MMKV with an encryption key in SecureStore.
- On web, it falls back to unencrypted localStorage.
- On Expo Go (no TurboModules), it falls back to AsyncStorage.
This means bet history privacy depends on the platform and build mode.

5) **No cloud sync**
- History is device-local only. If a user switches devices or reinstalls, they lose history.
- If you later add cloud sync, you must handle merge conflicts (e.g., same bet recorded on two devices).

---

## Bet history data model (deep dive)

### BetHistoryEntry schema
```ts
export interface BetHistoryEntry {
  id: string;             // unique ID: `${timestamp}-${random}`
  gameId: string;         // e.g., "blackjack", "craps"
  gameName: string;       // display name: "Blackjack", "Craps"
  bet: number;            // wager amount (chips)
  payout: number;         // payout amount (chips)
  won: boolean;           // true if payout > bet
  timestamp: number;      // Unix ms when bet was placed
  outcome?: string;       // optional result text: "Blackjack!", "7 Out"
}
```

Why this shape:
- `id` is generated at insertion time to guarantee uniqueness.
- `gameId` and `gameName` are both stored to avoid lookups during rendering.
- `bet` and `payout` are stored separately so we can compute net result on demand.
- `won` is a convenience flag derived from `payout > bet`.
- `timestamp` is used for sorting and date filtering.
- `outcome` is optional descriptive text for UX.

### SessionStats schema
```ts
export interface SessionStats {
  totalBets: number;
  totalWagered: number;
  totalPayout: number;
  wins: number;
  losses: number;
  pushes: number;
  biggestWin: number;
  biggestLoss: number;
  lastUpdated: number;
}
```

Why this shape:
- Aggregated metrics avoid recalculating on every render.
- `biggestWin` and `biggestLoss` track extremes for gamification UX.
- `lastUpdated` is a timestamp for debugging and future sync features.

---

## Storage layer: how bets are persisted

### 1) Storage keys
```ts
export const STORAGE_KEYS = {
  BET_HISTORY: 'history.bets',
  SESSION_STATS: 'history.session_stats',
} as const;
```

Why this matters:
- Storage keys are namespaced to avoid collisions with other app data.
- The `history.*` prefix groups related data.

What this code does:
- Defines constants for the two storage keys used by bet history.

---

### 2) Reading bet history
```ts
export function getBetHistory(): BetHistoryEntry[] {
  return getObject<BetHistoryEntry[]>(STORAGE_KEYS.BET_HISTORY, []);
}
```

Why this matters:
- Provides a type-safe accessor for the raw bet list.

What this code does:
- Reads JSON from storage, parses it as an array of BetHistoryEntry.
- Returns empty array `[]` if no history exists yet.

---

### 3) Adding a bet to history
```ts
export function addBetToHistory(entry: Omit<BetHistoryEntry, 'id'>): void {
  const history = getBetHistory();
  const newEntry: BetHistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };

  // Prepend new entry, keep most recent MAX_BET_HISTORY_ENTRIES
  const updated = [newEntry, ...history].slice(0, MAX_BET_HISTORY_ENTRIES);
  setObject(STORAGE_KEYS.BET_HISTORY, updated);

  // Update session stats
  updateSessionStats(newEntry);
}
```

Why this matters:
- This is the single write path for bet history. All bets flow through here.

What this code does:
- Generates a unique ID from timestamp and random string.
- Prepends the new entry to the front of the list (most recent first).
- Trims the array to MAX_BET_HISTORY_ENTRIES to prevent unbounded growth.
- Writes the updated array to storage.
- Calls `updateSessionStats` to increment aggregates.

Tradeoff:
- Prepending means newest bets are at index 0, making the default sort chronological.
- Slicing at 500 means very old bets are silently dropped. This is acceptable for a session stats feature.

---

### 4) Updating session stats
```ts
function updateSessionStats(entry: BetHistoryEntry): void {
  const stats = getSessionStats();
  const netResult = entry.payout - entry.bet;

  stats.totalBets += 1;
  stats.totalWagered += entry.bet;
  stats.totalPayout += entry.payout;
  stats.lastUpdated = Date.now();

  if (entry.payout > entry.bet) {
    stats.wins += 1;
    if (netResult > stats.biggestWin) {
      stats.biggestWin = netResult;
    }
  } else if (entry.payout < entry.bet) {
    stats.losses += 1;
    const loss = entry.bet - entry.payout;
    if (loss > stats.biggestLoss) {
      stats.biggestLoss = loss;
    }
  } else {
    stats.pushes += 1;
  }

  setObject(STORAGE_KEYS.SESSION_STATS, stats);
}
```

Why this matters:
- Keeps session stats incrementally updated instead of recalculating from scratch.

What this code does:
- Reads current stats from storage.
- Increments counters for total bets, wagered, payout.
- Classifies the bet as win/loss/push based on net result.
- Updates biggest win/loss if this bet is a new extreme.
- Writes updated stats back to storage.

Performance note:
- This is O(1) per bet. Recalculating from the full history would be O(n).

---

### 5) Date range filtering
```ts
export function getBetHistoryByDateRange(
  startDate: Date,
  endDate: Date
): BetHistoryEntry[] {
  const history = getBetHistory();
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  return history.filter(
    (entry) => entry.timestamp >= startMs && entry.timestamp <= endMs
  );
}
```

Why this matters:
- Enables the date filter UI (Today, 7 Days, 30 Days).

What this code does:
- Loads full history from storage.
- Filters entries where timestamp falls within the range [startMs, endMs].
- Returns a new array (does not mutate storage).

Tradeoff:
- This is O(n) on the full history. With 500 max entries, this is fast enough.
- If history grows larger, consider indexing or storing pre-aggregated buckets.

---

## Hook layer: useBetHistory

### Recording bets from game flow
```ts
export function useBetHistory() {
  const recordBet = useCallback((params: RecordBetParams) => {
    const { gameId, bet, payout, won, outcome } = params;

    // Don't record bets with 0 amount (shouldn't happen, but guard)
    if (bet <= 0) return;

    addBetToHistory({
      gameId,
      gameName: getGameName(gameId as never),
      bet,
      payout,
      won,
      timestamp: Date.now(),
      outcome,
    });
  }, []);

  return { recordBet };
}
```

Why this matters:
- Provides a React hook that game screens can call when a round completes.

What this code does:
- Wraps `addBetToHistory` in a `useCallback` for React optimization.
- Rejects bets with zero or negative amounts (defensive guard).
- Enriches the entry with the current timestamp and display name.

Integration point:
- Game screens listen for `game_result` messages and call `recordBet` with the outcome.

---

## UI layer: HistoryScreen component

### 1) Date filter computation
```ts
type DateFilter = 'today' | 'week' | 'month' | 'all';

function getDateRangeForFilter(filter: DateFilter): { start: Date; end: Date } {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (filter) {
    case 'today': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      return { start, end };
    }
    case 'week': {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case 'month': {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case 'all':
    default:
      return { start: new Date(0), end };
  }
}
```

Why this matters:
- Provides the date ranges for the filter buttons.

What this code does:
- Computes midnight-to-midnight bounds for "today".
- Computes 7 and 30 day lookback windows from now.
- Returns epoch 0 for "all" to include everything.

Edge case:
- DST transitions can cause off-by-one-hour errors. This code uses local time, so it will match user expectations but may be inconsistent across timezones.

---

### 2) Reactive filtering with useMemo
```ts
const { history, stats } = useMemo(() => {
  const allHistory = getBetHistory();
  const sessionStats = getSessionStats();

  if (filter === 'all') {
    return { history: allHistory, stats: sessionStats };
  }

  const { start, end } = getDateRangeForFilter(filter);
  const filtered = getBetHistoryByDateRange(start, end);

  // Calculate stats for filtered period
  const filteredStats: SessionStats = filtered.reduce(
    (acc, entry) => {
      acc.totalBets += 1;
      acc.totalWagered += entry.bet;
      acc.totalPayout += entry.payout;

      const netResult = entry.payout - entry.bet;
      if (entry.payout > entry.bet) {
        acc.wins += 1;
        if (netResult > acc.biggestWin) acc.biggestWin = netResult;
      } else if (entry.payout < entry.bet) {
        acc.losses += 1;
        const loss = entry.bet - entry.payout;
        if (loss > acc.biggestLoss) acc.biggestLoss = loss;
      } else {
        acc.pushes += 1;
      }
      return acc;
    },
    {
      totalBets: 0,
      totalWagered: 0,
      totalPayout: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      biggestWin: 0,
      biggestLoss: 0,
      lastUpdated: Date.now(),
    }
  );

  return { history: filtered, stats: filteredStats };
}, [filter, refreshKey]);
```

Why this matters:
- Recomputes filtered history and stats whenever the filter or refresh trigger changes.
- Keeps the UI reactive without manual cache invalidation.

What this code does:
- If filter is "all", returns full history and stored session stats.
- Otherwise, filters history by date range and recalculates stats from scratch.
- Uses `reduce` to aggregate the filtered subset.
- Returns both the filtered history and ephemeral stats.

Performance:
- This runs on every render when deps change. With 500 max entries, the reduce is fast.
- `refreshKey` is used to force a re-read from storage on pull-to-refresh.

---

### 3) Statistics card rendering
```tsx
<Animated.View entering={FadeIn} style={styles.statsCard}>
  <View style={styles.statsRow}>
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>Total Bets</Text>
      <Text style={styles.statValue}>{stats.totalBets}</Text>
    </View>
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>Win Rate</Text>
      <Text style={styles.statValue}>{winRate}%</Text>
    </View>
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>Net P/L</Text>
      <Text
        style={[
          styles.statValue,
          netProfit > 0 && styles.statValuePositive,
          netProfit < 0 && styles.statValueNegative,
        ]}
      >
        {netProfit >= 0 ? '+' : ''}{formatAmount(netProfit)}
      </Text>
    </View>
  </View>
  {/* Additional rows for wagered, wins, losses, pushes, biggest win/loss */}
</Animated.View>
```

Why this matters:
- Displays aggregated stats at the top of the screen.

What this code does:
- Renders total bets, win rate percentage, and net profit/loss.
- Applies color styling: green for profit, red for loss.
- Shows secondary stats (wagered, wins, losses, pushes) in a second row.
- Conditionally shows biggest win/loss if they are non-zero.

UX detail:
- Win rate is calculated as `(wins / totalBets) * 100` and rounded.
- Net profit is `totalPayout - totalWagered`.

---

### 4) Date filter buttons
```tsx
<View style={styles.filterRow}>
  {DATE_FILTERS.map((f) => (
    <Pressable
      key={f.key}
      onPress={() => handleFilterChange(f.key)}
      style={[
        styles.filterButton,
        filter === f.key && styles.filterButtonActive,
      ]}
    >
      <Text
        style={[
          styles.filterButtonText,
          filter === f.key && styles.filterButtonTextActive,
        ]}
      >
        {f.label}
      </Text>
    </Pressable>
  ))}
</View>
```

Why this matters:
- Provides the date filter UI (Today, 7 Days, 30 Days, All).

What this code does:
- Maps over the filter options and renders a button for each.
- Applies active styles to the currently selected filter.
- Calls `handleFilterChange` on press, which triggers haptic feedback and updates state.

Haptic feedback:
- `haptics.selectionChange()` provides tactile feedback on filter change.

---

### 5) Bet entry list rendering
```tsx
const renderBetEntry: ListRenderItem<BetHistoryEntry> = useCallback(
  ({ item, index }) => {
    const netResult = item.payout - item.bet;
    const isWin = netResult > 0;
    const isPush = netResult === 0;
    const gameColor = GAME_COLORS[item.gameId as GameId] ?? COLORS.primary;

    return (
      <Animated.View
        entering={FadeInUp.delay(index * 30).springify()}
        layout={LinearTransition}
        style={styles.betEntry}
      >
        <View style={[styles.betIconContainer, { backgroundColor: gameColor + '20' }]}>
          <GameIcon gameId={item.gameId as GameId} color={gameColor} size={20} />
        </View>
        <View style={styles.betDetails}>
          <Text style={styles.betGameName}>{item.gameName}</Text>
          <Text style={styles.betTimestamp}>{formatTimestamp(item.timestamp)}</Text>
          {item.outcome ? (
            <Text style={styles.betOutcome}>{item.outcome}</Text>
          ) : null}
        </View>
        <View style={styles.betAmounts}>
          <Text style={styles.betWager}>-{formatAmount(item.bet)}</Text>
          <Text
            style={[
              styles.betResult,
              isWin && styles.betResultWin,
              isPush && styles.betResultPush,
              !isWin && !isPush && styles.betResultLoss,
            ]}
          >
            {isWin ? '+' : ''}{formatAmount(netResult)}
          </Text>
        </View>
      </Animated.View>
    );
  },
  []
);
```

Why this matters:
- Renders each individual bet as a list item.

What this code does:
- Computes net result (payout - bet) to determine win/loss/push.
- Uses game-specific color from `GAME_COLORS` constant.
- Shows game icon, name, timestamp, and optional outcome text.
- Shows wager amount as negative (e.g., "-$100") and result as signed (e.g., "+$50" or "-$50").
- Applies color styling: green for wins, red for losses, yellow for pushes.

Animation:
- Each entry fades in with a staggered delay based on index.
- `LinearTransition` animates layout changes (e.g., when filtering).

---

### 6) Pull-to-refresh implementation
```tsx
const handleRefresh = useCallback(async () => {
  haptics.selectionChange();
  setRefreshing(true);
  // Force re-read from storage
  setRefreshKey((k) => k + 1);
  // Brief delay for UX
  await new Promise((resolve) => setTimeout(resolve, 300));
  setRefreshing(false);
  haptics.win();
}, []);
```

Why this matters:
- Provides standard mobile UX for refreshing data.

What this code does:
- Increments `refreshKey` which triggers the `useMemo` to re-run.
- Adds a 300ms delay for visual feedback (spinner stays visible briefly).
- Plays success haptic after refresh.

Note:
- This is mostly cosmetic since data is local. But it provides a consistent UX with other screens that fetch from network.

---

## Data flow from chain events to UI

### 1) Game completes on chain
- Simulator or validator executes the game and emits a `game_result` event.
- Event includes outcome, payout, and final balances.

### 2) Gateway forwards result to client
- Gateway WebSocket pushes `game_result` message to the connected client.

### 3) Game screen receives result
- Game screen (e.g., BlackjackScreen) listens for WebSocket messages.
- Parses the result and extracts bet amount, payout, outcome text.

### 4) Hook records bet to storage
- Game screen calls `recordBet` from `useBetHistory` hook.
- Hook calls `addBetToHistory` which writes to MMKV storage.
- Session stats are updated atomically.

### 5) HistoryScreen displays updated data
- If HistoryScreen is mounted, the next refresh (manual or automatic) will re-read from storage.
- If not mounted, the updated data will appear next time the user navigates to the screen.

This flow is **entirely client-side** after the game result arrives. There is no server-side bet history API.

---

## Persistence and caching strategy

### 1) Storage layer: MMKV with encryption
- On native builds (iOS/Android), MMKV provides fast, encrypted key-value storage.
- Encryption key is stored in SecureStore (iOS Keychain / Android Keystore).
- Data persists across app restarts.

### 2) Fallback: AsyncStorage on Expo Go
- Expo Go does not support TurboModules, so MMKV is unavailable.
- The storage module falls back to AsyncStorage (slower, unencrypted).
- This is only for development. Production builds use MMKV.

### 3) Fallback: localStorage on web
- Web builds use browser localStorage (synchronous, unencrypted).
- Same API surface via the `WebStorage` adapter.

### 4) No cloud sync
- All data is device-local. Reinstalling the app or switching devices loses history.
- If you add cloud sync, you must:
  - Deduplicate entries by `id`.
  - Handle merge conflicts (same bet recorded on two devices).
  - Respect user privacy (betting history is sensitive).

### 5) Cache invalidation
- There is no cache invalidation. Data is read on demand from storage.
- `refreshKey` is used to force a re-read, but this is just a state trigger.

### 6) Storage size management
- Pruning to 500 entries prevents unbounded growth.
- At 500 bets, storage size is roughly 50-100 KB (depends on outcome strings).
- This is negligible on modern devices.

---

## Testing bet history (acceptance criteria)

From commit 8a02111, the acceptance criteria were:
1. HistoryScreen shows bet list with outcome, amount, game.
2. Session stats display win/loss ratio and total wagered.
3. Date filtering (Today, 7 Days, 30 Days, All).
4. Navigation from LobbyScreen header via HistoryIcon.

All storage tests pass:
- `getBetHistory` returns empty array initially.
- `addBetToHistory` prepends entries and prunes at 500.
- `getSessionStats` returns zero stats initially.
- `updateSessionStats` increments counters correctly.
- `getBetHistoryByDateRange` filters by timestamp.

UI tests would verify:
- Rendering the stats card with correct values.
- Filter buttons toggle correctly.
- Bet entries render with correct colors (win/loss/push).
- Pull-to-refresh updates the list.

---

## Future enhancements (not implemented)

### 1) Export history to CSV
- Allow users to download their bet history for personal records.
- This is useful for responsible gambling tracking.

### 2) Cloud sync via Convex
- Store bet history in the Convex database.
- Sync across devices and persist after reinstalls.
- Requires user authentication and conflict resolution.

### 3) Advanced filtering
- Filter by game type (e.g., only Blackjack bets).
- Filter by outcome (only wins or only losses).
- Search by date range picker.

### 4) Graphs and charts
- Win/loss over time (line chart).
- Win rate by game (bar chart).
- Net profit trend (area chart).

### 5) Responsible gambling limits
- Track daily/weekly loss limits.
- Alert user if they exceed self-imposed limits.
- Link to help resources.

### 6) Bet replay
- Tap a bet entry to see detailed game state at that point.
- Requires storing full game state, not just outcome.

---

## Security and privacy considerations

### 1) Data sensitivity
- Bet history reveals gambling behavior, which is sensitive personal data.
- Encryption at rest (MMKV + SecureStore) protects against device theft.
- No encryption on web (localStorage is plaintext).

### 2) No server-side tracking
- The server does not log individual bets to a history database.
- This preserves user privacy but means support cannot recover lost history.

### 3) Local-only data
- If a user loses their device or uninstalls, history is gone.
- This is acceptable for a privacy-first design, but may frustrate users.

### 4) Regulatory compliance
- Some jurisdictions require gambling operators to provide bet history for a minimum period.
- If this app is used in a regulated market, you may need to add server-side history with audit logs.

### 5) Accidental exposure
- If the user shares their device or screenshots, bet history could be exposed.
- Consider adding a PIN lock or biometric gate for the HistoryScreen.

---

## Edge cases and error handling

### 1) Zero or negative bet amounts
- `useBetHistory` rejects bets with `bet <= 0`.
- This guards against malformed game results.

### 2) Missing game name
- `getGameName` may return a fallback if `gameId` is unknown.
- This prevents crashes from new game types.

### 3) Timestamp drift
- Date filters use device clock, which may be wrong.
- Consider adding server time sync for accurate filtering.

### 4) Storage full
- MMKV and localStorage can run out of space.
- If storage write fails, the bet is silently lost.
- Consider adding error logging or fallback alerts.

### 5) Corrupt storage
- If JSON is corrupted, `getObject` returns the default value.
- This silently resets history, which may confuse users.
- Consider adding checksum validation.

### 6) Duplicate entries
- If a game result message is delivered twice, the bet could be recorded twice.
- The `id` field includes timestamp and random string, so duplicates are unlikely but possible.
- Consider deduplicating by transaction hash or game session ID.

---

## Performance considerations

### 1) List rendering
- FlatList is used for efficient rendering of large lists.
- With 500 entries, rendering is instant on modern devices.
- If history grows larger, consider virtualization or pagination.

### 2) Storage read speed
- MMKV is fast (microseconds).
- AsyncStorage and localStorage are slower (milliseconds).
- Reading 500 entries is still fast enough for a snappy UI.

### 3) Stats recalculation
- Filtering by date recalculates stats from scratch using `reduce`.
- This is O(n) on the filtered subset, not the full history.
- With 500 max entries, this is imperceptible.

### 4) Animation performance
- `FadeInUp.delay(index * 30)` staggers animations by 30ms per item.
- With 50 visible items, this adds 1.5 seconds of stagger.
- Consider reducing delay or disabling for large lists.

### 5) Memory usage
- The full history array is kept in memory while the screen is mounted.
- With 500 entries, this is roughly 100 KB of JS heap.
- React Native handles this fine on modern devices.

---

## Walkthrough with code excerpts

### 1) Adding a bet from game flow
```ts
// In BlackjackScreen (example)
const { recordBet } = useBetHistory();

// When game result arrives:
recordBet({
  gameId: 'blackjack',
  bet: 100,
  payout: 200,
  won: true,
  outcome: 'Blackjack!'
});
```

Why this matters:
- This is the entry point for recording bets from any game.

What this code does:
- Calls the `recordBet` function from the hook.
- Passes game ID, bet amount, payout, win flag, and outcome text.
- Hook writes to storage and updates stats.

---

### 2) Win rate calculation
```ts
function calculateWinRate(wins: number, totalBets: number): number {
  if (totalBets === 0) return 0;
  return Math.round((wins / totalBets) * 100);
}

const winRate = calculateWinRate(stats.wins, stats.totalBets);
```

Why this matters:
- Provides a single-number summary of player performance.

What this code does:
- Divides wins by total bets and multiplies by 100 to get percentage.
- Rounds to nearest integer.
- Returns 0 if no bets have been placed (avoids divide-by-zero).

---

### 3) Timestamp formatting
```ts
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
```

Why this matters:
- Makes timestamps human-readable in the list.

What this code does:
- If the bet is from today, shows time only (e.g., "3:45 PM").
- If from a previous day, shows date only (e.g., "Jan 7").
- Uses locale-aware formatting for internationalization.

UX detail:
- This keeps the timestamp column compact and easy to scan.

---

### 4) Empty state
```tsx
const ListEmpty = useCallback(
  () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>No bets recorded yet.</Text>
      <Text style={styles.emptySubtext}>Play some games to see your history here!</Text>
    </View>
  ),
  []
);
```

Why this matters:
- Provides guidance when the list is empty.

What this code does:
- Renders a centered message encouraging the user to play games.
- Uses friendly, non-technical language.

---

## Key takeaways
- Bet history is stored locally on-device using encrypted MMKV storage.
- Session stats are incrementally updated to avoid expensive recalculations.
- Date filtering is client-side, using wall-clock time and in-memory filtering.
- The UI is reactive via `useMemo` and re-renders when filter or data changes.
- No cloud sync means history is device-local and lost on reinstall.

## Next lesson
L52 - Responsible gambling tools (future): `feynman/lessons/L52-responsible-gambling.md`
