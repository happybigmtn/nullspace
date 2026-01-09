/**
 * History Screen (US-165)
 * Shows bet history and session statistics with date filtering.
 *
 * Features:
 * - Recent bets list with outcome, amount, game
 * - Session statistics (win/loss ratio, total wagered)
 * - Date filtering (Today, Week, Month, All)
 * - Pull to refresh
 */
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ListRenderItem,
} from 'react-native';
import { useCallback, useMemo, useState } from 'react';
import Animated, { FadeIn, FadeInUp, LinearTransition } from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, GAME_COLORS } from '../constants/theme';
import { GameIcon } from '../components/ui';
import { haptics } from '../services/haptics';
import {
  getBetHistory,
  getSessionStats,
  getBetHistoryByDateRange,
  type BetHistoryEntry,
  type SessionStats,
} from '../services/storage';
import type { HistoryScreenProps } from '../navigation/types';
import type { GameId } from '../types';

type DateFilter = 'today' | 'week' | 'month' | 'all';

const DATE_FILTERS: { key: DateFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: '7 Days' },
  { key: 'month', label: '30 Days' },
  { key: 'all', label: 'All' },
];

/**
 * Get date range for filter
 */
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

/**
 * Format timestamp to readable date/time
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Format currency amount
 */
function formatAmount(amount: number): string {
  return `$${amount.toLocaleString()}`;
}

/**
 * Calculate win rate percentage
 */
function calculateWinRate(wins: number, totalBets: number): number {
  if (totalBets === 0) return 0;
  return Math.round((wins / totalBets) * 100);
}

export function HistoryScreen({ navigation }: HistoryScreenProps) {
  const [filter, setFilter] = useState<DateFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Load data based on filter
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, refreshKey]);

  const netProfit = stats.totalPayout - stats.totalWagered;
  const winRate = calculateWinRate(stats.wins, stats.totalBets);

  const handleFilterChange = useCallback((newFilter: DateFilter) => {
    haptics.selectionChange().catch(() => {});
    setFilter(newFilter);
  }, []);

  const handleRefresh = useCallback(async () => {
    haptics.selectionChange().catch(() => {});
    setRefreshing(true);
    // Force re-read from storage
    setRefreshKey((k) => k + 1);
    // Brief delay for UX
    await new Promise((resolve) => setTimeout(resolve, 300));
    setRefreshing(false);
    haptics.win().catch(() => {});
  }, []);

  const handleBack = useCallback(() => {
    haptics.buttonPress().catch(() => {});
    navigation.goBack();
  }, [navigation]);

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

  const ListHeader = useCallback(
    () => (
      <View style={styles.headerContainer}>
        {/* Stats Card */}
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

          <View style={styles.statsDivider} />

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Wagered</Text>
              <Text style={styles.statValueSmall}>{formatAmount(stats.totalWagered)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Wins</Text>
              <Text style={[styles.statValueSmall, styles.statValuePositive]}>
                {stats.wins}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Losses</Text>
              <Text style={[styles.statValueSmall, styles.statValueNegative]}>
                {stats.losses}
              </Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Pushes</Text>
              <Text style={styles.statValueSmall}>{stats.pushes}</Text>
            </View>
          </View>

          {(stats.biggestWin > 0 || stats.biggestLoss > 0) && (
            <>
              <View style={styles.statsDivider} />
              <View style={styles.statsRow}>
                {stats.biggestWin > 0 && (
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Biggest Win</Text>
                    <Text style={[styles.statValueSmall, styles.statValuePositive]}>
                      +{formatAmount(stats.biggestWin)}
                    </Text>
                  </View>
                )}
                {stats.biggestLoss > 0 && (
                  <View style={styles.statItem}>
                    <Text style={styles.statLabel}>Biggest Loss</Text>
                    <Text style={[styles.statValueSmall, styles.statValueNegative]}>
                      -{formatAmount(stats.biggestLoss)}
                    </Text>
                  </View>
                )}
              </View>
            </>
          )}
        </Animated.View>

        {/* Date Filter */}
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

        <Text style={styles.sectionTitle}>Recent Bets</Text>
      </View>
    ),
    [stats, winRate, netProfit, filter, handleFilterChange]
  );

  const ListEmpty = useCallback(
    () => (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No bets recorded yet.</Text>
        <Text style={styles.emptySubtext}>Play some games to see your history here!</Text>
      </View>
    ),
    []
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </Pressable>
        <Text style={styles.title}>History</Text>
        <View style={styles.headerSpacer} />
      </View>

      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        renderItem={renderBetEntry}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingTop: 60,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
  },
  backButton: {
    minWidth: 60,
    paddingVertical: SPACING.xs,
  },
  backButtonText: {
    ...TYPOGRAPHY.label,
    color: COLORS.primary,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
  },
  headerSpacer: {
    minWidth: 60,
  },
  headerContainer: {
    paddingHorizontal: SPACING.md,
  },
  statsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  statValue: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
  },
  statValueSmall: {
    ...TYPOGRAPHY.label,
    color: COLORS.textPrimary,
  },
  statValuePositive: {
    color: COLORS.success,
  },
  statValueNegative: {
    color: COLORS.error,
  },
  statsDivider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.sm,
  },
  filterRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.md,
  },
  filterButton: {
    flex: 1,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  filterButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterButtonText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  filterButtonTextActive: {
    color: '#FFFFFF',
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  listContent: {
    paddingBottom: SPACING.xl,
  },
  betEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  betIconContainer: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  betDetails: {
    flex: 1,
  },
  betGameName: {
    ...TYPOGRAPHY.label,
    color: COLORS.textPrimary,
  },
  betTimestamp: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  betOutcome: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  betAmounts: {
    alignItems: 'flex-end',
  },
  betWager: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  betResult: {
    ...TYPOGRAPHY.label,
    color: COLORS.textPrimary,
  },
  betResultWin: {
    color: COLORS.success,
  },
  betResultLoss: {
    color: COLORS.error,
  },
  betResultPush: {
    color: COLORS.warning,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: SPACING.xl * 2,
    paddingHorizontal: SPACING.lg,
  },
  emptyText: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  emptySubtext: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
