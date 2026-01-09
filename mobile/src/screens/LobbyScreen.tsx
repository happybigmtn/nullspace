/**
 * Lobby Screen - Jony Ive Redesigned
 * Game selection with balance display and minimal navigation
 *
 * DS-041: Parallax scroll effect for game cards
 * - Cards translate at 0.5x scroll speed for depth illusion
 * - Header compresses smoothly on scroll up
 * - Balance display shrinks elegantly during scroll
 *
 * DS-042: Magnetic snap scrolling for game cards
 * - Cards snap to row boundaries with spring physics
 * - Momentum from flick preserved (fast flick = skip rows)
 * - Haptic feedback on snap
 * - Uses SPRING_LIQUID.liquidSettle for natural feel
 */
import { View, Text, StyleSheet, Pressable, ListRenderItem, useWindowDimensions, Linking, Share, RefreshControl } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import Animated, {
  FadeIn,
  FadeInUp,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  withSpring,
  withSequence,
  interpolate,
  Extrapolation,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, GAME_COLORS } from '../constants/theme';
import { SPRING_LIQUID } from '@nullspace/design-tokens';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { haptics } from '../services/haptics';
import { initializeNotifications, hasPlayedFirstGame, markFirstGamePlayed } from '../services';
import { useGameStore } from '../stores/gameStore';
import { useEntitlements, useGatewaySession } from '../hooks';
import { stripTrailingSlash } from '../utils/url';
import { GameIcon, ProfileIcon, HistoryIcon } from '../components/ui';
import type { LobbyScreenProps } from '../navigation/types';
import type { GameId } from '../types';

interface GameInfo {
  id: GameId;
  name: string;
  description: string;
  color: string;
}

/**
 * DS-041 + DS-043: Parallax Game Card with Staggered Entrance
 * - Cards enter with choreographed fade + translateY
 * - Each card translates at 0.5x scroll speed for depth illusion
 * - Uses SPRING_LIQUID.liquidFloat for natural bounce
 *
 * Extracted as standalone component to comply with React hooks rules
 * (useAnimatedStyle cannot be called inside useCallback)
 */
interface ParallaxGameCardProps {
  game: GameInfo;
  index: number;
  scrollY: SharedValue<number>;
  prefersReducedMotion: boolean;
  numColumns: number;
  parallaxFactor: number;
  onSelect: (gameId: GameId) => void;
}

function ParallaxGameCard({
  game,
  index,
  scrollY,
  prefersReducedMotion,
  numColumns,
  parallaxFactor,
  onSelect,
}: ParallaxGameCardProps) {
  // Calculate parallax offset - cards further down move more
  const cardAnimatedStyle = useAnimatedStyle(() => {
    if (prefersReducedMotion) {
      return {};
    }
    // Only apply parallax when scrolling down (positive scroll)
    // Each row gets slightly different parallax based on index
    const rowIndex = Math.floor(index / numColumns);
    const translateY = interpolate(
      scrollY.value,
      [0, 300],
      [0, -rowIndex * 8 * parallaxFactor], // Subtle parallax: 4px per row
      Extrapolation.CLAMP
    );
    return {
      transform: [{ translateY }],
    };
  });

  /**
   * DS-043: Staggered entrance with spring physics
   * - Uses STAGGER.normal (50ms) between cards
   * - SPRING_LIQUID.liquidFloat for natural bounce
   * - Respects reduced motion
   */
  const enteringAnimation = prefersReducedMotion
    ? FadeIn.duration(0)
    : FadeInUp.delay(index * 50)
        .springify()
        .mass(SPRING_LIQUID.liquidFloat.mass)
        .stiffness(SPRING_LIQUID.liquidFloat.stiffness)
        .damping(SPRING_LIQUID.liquidFloat.damping);

  return (
    <Animated.View
      entering={enteringAnimation}
      style={[styles.gameCardWrapper, cardAnimatedStyle]}
    >
      <Pressable
        onPress={() => onSelect(game.id)}
        style={({ pressed }) => [
          styles.gameCard,
          pressed && styles.gameCardPressed,
        ]}
      >
        <View style={[styles.gameIconContainer, { backgroundColor: game.color + '20' }]}>
          <GameIcon gameId={game.id} color={game.color} size={24} />
        </View>
        <Text style={styles.gameName}>{game.name}</Text>
        <Text style={styles.gameDescription}>{game.description}</Text>
      </Pressable>
    </Animated.View>
  );
}

type LeagueEntry = {
  publicKey: string;
  points: number;
};

type ReferralSummary = {
  code: string | null;
  referrals: number;
  qualified: number;
};

const GAMES: GameInfo[] = [
  { id: 'hi_lo', name: 'Hi-Lo', description: 'Higher or Lower', color: GAME_COLORS.hi_lo },
  { id: 'blackjack', name: 'Blackjack', description: 'Beat the dealer', color: GAME_COLORS.blackjack },
  { id: 'roulette', name: 'Roulette', description: 'Spin the wheel', color: GAME_COLORS.roulette },
  { id: 'craps', name: 'Craps', description: 'Roll the dice', color: GAME_COLORS.craps },
  { id: 'baccarat', name: 'Baccarat', description: 'Player or Banker', color: GAME_COLORS.baccarat },
  { id: 'casino_war', name: 'Casino War', description: 'High card wins', color: GAME_COLORS.casino_war },
  { id: 'video_poker', name: 'Video Poker', description: 'Jacks or Better', color: GAME_COLORS.video_poker },
  { id: 'sic_bo', name: 'Sic Bo', description: 'Dice totals', color: GAME_COLORS.sic_bo },
  { id: 'three_card_poker', name: '3 Card Poker', description: 'Ante & Pair Plus', color: GAME_COLORS.three_card_poker },
  { id: 'ultimate_texas_holdem', name: 'Ultimate Holdem', description: 'Bet the streets', color: GAME_COLORS.ultimate_texas_holdem },
];

export function LobbyScreen({ navigation }: LobbyScreenProps) {
  const { width } = useWindowDimensions();
  const {
    balance,
    balanceReady,
    publicKey,
    faucetStatus,
    faucetMessage,
  } = useGameStore();
  const { requestFaucet, connectionState } = useGatewaySession();
  const { entitlements, loading: entitlementsLoading } = useEntitlements();
  const [leagueEntries, setLeagueEntries] = useState<LeagueEntry[]>([]);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [referralSummary, setReferralSummary] = useState<ReferralSummary | null>(null);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);

  // US-137: Pull-to-refresh state
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const refreshFadeValue = useSharedValue(0);

  // DS-041: Parallax scroll state
  const scrollY = useSharedValue(0);
  const prefersReducedMotion = useReducedMotion();

  // DS-042: Snap scrolling state
  const lastSnapIndex = useSharedValue(0);
  const isSnapping = useSharedValue(false);

  // Header collapse threshold - how far to scroll before header fully compresses
  const HEADER_COLLAPSE_THRESHOLD = 100;
  // Parallax factor - cards move at this ratio of scroll speed (0.5 = half speed)
  const PARALLAX_FACTOR = 0.5;

  /**
   * DS-042: Snap configuration
   * Card row height = card height (~120px) + vertical spacing (~8px)
   * This creates natural snap points at each row boundary
   */
  const CARD_ROW_HEIGHT = 128; // Approximate height of game card + margin
  const SNAP_VELOCITY_THRESHOLD = 500; // px/s - fast flick to skip rows
  const MAX_SKIP_ROWS = 3; // Maximum rows to skip on fast flick

  /**
   * DS-042: Trigger haptic feedback on snap (runs on JS thread)
   */
  const triggerSnapHaptic = useCallback(() => {
    if (prefersReducedMotion) return;
    haptics.selectionChange().catch(() => {});
  }, [prefersReducedMotion]);

  /**
   * DS-041 + DS-042: Animated scroll handler for parallax and snap effects
   * Runs on UI thread for 60fps performance
   *
   * Tracks scroll position for parallax and momentum end for snapping
   */
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
    onMomentumEnd: (event) => {
      // DS-042: Calculate snap point based on momentum
      const offset = event.contentOffset.y;
      const velocity = event.velocity?.y ?? 0;

      // Calculate current row index
      let targetRow = Math.round(offset / CARD_ROW_HEIGHT);

      // Apply momentum - fast flicks skip more rows
      if (Math.abs(velocity) > SNAP_VELOCITY_THRESHOLD) {
        const skipCount = Math.min(
          Math.floor(Math.abs(velocity) / SNAP_VELOCITY_THRESHOLD),
          MAX_SKIP_ROWS
        );
        const direction = velocity > 0 ? 1 : -1;
        targetRow += direction * skipCount;
      }

      // Clamp to valid range (5 rows for 10 games in 2 columns)
      const maxRows = Math.ceil(GAMES.length / numColumns);
      targetRow = Math.max(0, Math.min(maxRows - 1, targetRow));

      // Trigger haptic if snapped to different row
      if (targetRow !== lastSnapIndex.value) {
        lastSnapIndex.value = targetRow;
        runOnJS(triggerSnapHaptic)();
      }
    },
  });

  /**
   * DS-041: Header animated style
   * - Scales down as user scrolls (1 -> 0.85)
   * - Translates up to compress
   * - Opacity fades for greeting text
   */
  const headerAnimatedStyle = useAnimatedStyle(() => {
    if (prefersReducedMotion) {
      return {};
    }
    const scale = interpolate(
      scrollY.value,
      [0, HEADER_COLLAPSE_THRESHOLD],
      [1, 0.85],
      Extrapolation.CLAMP
    );
    const translateY = interpolate(
      scrollY.value,
      [0, HEADER_COLLAPSE_THRESHOLD],
      [0, -20],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale }, { translateY }],
    };
  });

  /**
   * DS-041: Balance text animated style
   * Shrinks elegantly as user scrolls
   */
  const balanceAnimatedStyle = useAnimatedStyle(() => {
    if (prefersReducedMotion) {
      return {};
    }
    const scale = interpolate(
      scrollY.value,
      [0, HEADER_COLLAPSE_THRESHOLD],
      [1, 0.8],
      Extrapolation.CLAMP
    );
    return {
      transform: [{ scale }],
      transformOrigin: 'left center',
    };
  });

  /**
   * DS-041: Greeting text animated style
   * Fades out as user scrolls
   */
  const greetingAnimatedStyle = useAnimatedStyle(() => {
    if (prefersReducedMotion) {
      return {};
    }
    const opacity = interpolate(
      scrollY.value,
      [0, HEADER_COLLAPSE_THRESHOLD / 2],
      [1, 0],
      Extrapolation.CLAMP
    );
    return { opacity };
  });

  const faucetDisabled = faucetStatus === 'pending';
  const balanceLabel = balanceReady ? `$${balance.toLocaleString()}` : '...';
  const shortKey = publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}` : 'Not connected';
  const networkLabel = connectionState === 'connected' ? 'Testnet Online' : connectionState === 'connecting' ? 'Connecting' : 'Offline';
  const activeEntitlement = entitlements.find((ent) => ['active', 'trialing'].includes(ent.status));
  const tierLabel = activeEntitlement ? activeEntitlement.tier.toUpperCase() : 'Free';
  const billingUrl = process.env.EXPO_PUBLIC_BILLING_URL ?? process.env.EXPO_PUBLIC_WEBSITE_URL ?? '';
  const opsBase = process.env.EXPO_PUBLIC_OPS_URL ?? process.env.EXPO_PUBLIC_ANALYTICS_URL ?? '';
  const inviteBase = process.env.EXPO_PUBLIC_WEBSITE_URL ?? '';

  useEffect(() => {
    void initializeNotifications(publicKey);
  }, [publicKey]);

  useEffect(() => {
    if (!opsBase) return;
    const controller = new AbortController();
    setLeagueError(null);

    const getWeekKey = (date: Date) => {
      const day = (date.getUTCDay() + 6) % 7;
      const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      thursday.setUTCDate(date.getUTCDate() - day + 3);
      const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
    };

    const opsRoot = stripTrailingSlash(opsBase);
    const fetchLeaderboard = async () => {
      try {
        const weekKey = getWeekKey(new Date());
        const response = await fetch(
          opsRoot + '/league/leaderboard?week=' + encodeURIComponent(weekKey),
          {
          signal: controller.signal,
          }
        );
        if (!response.ok) throw new Error(`Leaderboard failed (${response.status})`);
        const data = await response.json();
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        setLeagueEntries(entries.slice(0, 3));
      } catch (err) {
        const error = err instanceof Error ? err : null;
        if (error?.name === 'AbortError') return;
        setLeagueEntries([]);
        setLeagueError(error ? error.message : 'League unavailable');
      }
    };

    void fetchLeaderboard();
    return () => controller.abort();
  }, [opsBase]);

  useEffect(() => {
    if (!opsBase) return;
    if (!publicKey) return;
    const controller = new AbortController();
    setReferralLoading(true);
    setReferralError(null);

    const opsRoot = stripTrailingSlash(opsBase);
    const fetchReferral = async () => {
      try {
        const codeRes = await fetch(opsRoot + '/referrals/code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKey }),
          signal: controller.signal,
        });
        if (!codeRes.ok) throw new Error(`Referral code failed (${codeRes.status})`);
        const codeData = await codeRes.json();
        const summaryRes = await fetch(
          opsRoot + '/referrals/summary?publicKey=' + encodeURIComponent(publicKey),
          { signal: controller.signal }
        );
        if (!summaryRes.ok) throw new Error(`Referral summary failed (${summaryRes.status})`);
        const summaryData = await summaryRes.json();
        setReferralSummary({
          code: codeData?.code ?? summaryData?.code ?? null,
          referrals: Number(summaryData?.referrals ?? 0),
          qualified: Number(summaryData?.qualified ?? 0),
        });
      } catch (err) {
        const error = err instanceof Error ? err : null;
        if (error?.name === 'AbortError') return;
        setReferralSummary(null);
        setReferralError(error ? error.message : 'Referral unavailable');
      } finally {
        setReferralLoading(false);
      }
    };

    void fetchReferral();
    return () => controller.abort();
  }, [opsBase, publicKey]);

  const handleGameSelect = useCallback((gameId: GameId) => {
    // First game ever - celebratory haptic feedback
    if (!hasPlayedFirstGame()) {
      markFirstGamePlayed();
      haptics.jackpot().catch(() => {});
    } else {
      haptics.selectionChange().catch(() => {});
    }
    navigation.navigate('Game', { gameId });
  }, [navigation]);

  /**
   * US-137: Pull-to-refresh handler with haptic feedback
   * Refreshes league data, referral summary, and triggers content fade-in
   */
  const handleRefresh = useCallback(async () => {
    // Haptic feedback at refresh start
    haptics.selectionChange().catch(() => {});
    setRefreshing(true);

    // Prepare fade-in animation
    refreshFadeValue.value = 0;

    try {
      // Re-fetch league data
      if (opsBase) {
        const leagueUrl = `${stripTrailingSlash(opsBase)}/api/ops/league`;
        const leagueResp = await fetch(leagueUrl);
        if (leagueResp.ok) {
          const data = await leagueResp.json();
          setLeagueEntries(data.entries ?? []);
          setLeagueError(null);
        }

        // Re-fetch referral data
        if (publicKey) {
          const referralUrl = `${stripTrailingSlash(opsBase)}/api/ops/referrals/${publicKey}`;
          const referralResp = await fetch(referralUrl);
          if (referralResp.ok) {
            const data = await referralResp.json();
            setReferralSummary(data);
            setReferralError(null);
          }
        }
      }

      // Update timestamp
      setLastRefreshed(new Date());

      // Trigger content fade-in animation
      refreshFadeValue.value = withSequence(
        withSpring(0.5, { damping: 15 }),
        withSpring(1, { damping: 15 })
      );

      // Success haptic
      haptics.win().catch(() => {});
    } catch {
      // Silently fail - network issues shouldn't block UI
      haptics.error().catch(() => {});
    } finally {
      setRefreshing(false);
    }
  }, [opsBase, publicKey, refreshFadeValue]);

  const handleClaimBonus = useCallback(() => {
    if (faucetDisabled) return;
    requestFaucet();
  }, [faucetDisabled, requestFaucet]);

  const handleManageMembership = useCallback(() => {
    if (!billingUrl) return;
    void Linking.openURL(billingUrl);
  }, [billingUrl]);

  const handleShareInvite = useCallback(async () => {
    if (!referralSummary?.code) return;
    const base = inviteBase ? stripTrailingSlash(inviteBase) : '';
    const url = base ? `${base}/?ref=${referralSummary.code}` : referralSummary.code;
    try {
      await Share.share({
        message: base ? `Join me on Nullspace: ${url}` : `My referral code: ${url}`,
      });
    } catch {
      if (base) {
        void Linking.openURL(url);
      }
    }
  }, [inviteBase, referralSummary]);

  const numColumns = width >= 900 ? 4 : width >= 700 ? 3 : 2;

  const renderGameCard: ListRenderItem<GameInfo> = useCallback(({ item: game, index }) => (
    <ParallaxGameCard
      game={game}
      index={index}
      scrollY={scrollY}
      prefersReducedMotion={prefersReducedMotion}
      numColumns={numColumns}
      parallaxFactor={PARALLAX_FACTOR}
      onSelect={handleGameSelect}
    />
  ), [scrollY, prefersReducedMotion, numColumns, handleGameSelect]);

  const ListHeader = useCallback(() => (
    <Text style={styles.sectionTitle}>Games</Text>
  ), []);

  /** Format last refresh timestamp */
  const formatLastRefreshed = useCallback((date: Date | null): string => {
    if (!date) return '';
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return 'Updated just now';
    if (diff < 3600) return `Updated ${Math.floor(diff / 60)}m ago`;
    return `Updated ${Math.floor(diff / 3600)}h ago`;
  }, []);

  const ListFooter = useCallback(() => (
    <View style={styles.footer}>
      <Text style={styles.footerText}>Provably Fair • On-Chain</Text>
      {lastRefreshed && (
        <Animated.View entering={FadeInDown.delay(200)}>
          <Text style={styles.lastRefreshedText}>
            {formatLastRefreshed(lastRefreshed)}
          </Text>
        </Animated.View>
      )}
    </View>
  ), [lastRefreshed, formatLastRefreshed]);

  return (
    <View style={styles.container}>
      {/* Header - DS-041: Compresses on scroll */}
      <Animated.View entering={FadeIn} style={[styles.header, headerAnimatedStyle]}>
        <View>
          <Animated.Text style={[styles.greeting, greetingAnimatedStyle]}>Good evening</Animated.Text>
          <Animated.Text style={[styles.balance, balanceAnimatedStyle]}>{balanceLabel}</Animated.Text>
          <Animated.View style={[styles.headerMetaRow, greetingAnimatedStyle]}>
            <Text style={styles.headerMetaText}>{networkLabel}</Text>
            <Text style={styles.headerMetaDivider}>•</Text>
            <Text style={styles.headerMetaText}>{shortKey}</Text>
          </Animated.View>
        </View>
        <View style={styles.headerButtons}>
          <Pressable style={styles.headerButton} onPress={() => navigation.navigate('History')}>
            <HistoryIcon color={COLORS.textPrimary} size={20} />
          </Pressable>
          <Pressable style={styles.headerButton} onPress={() => navigation.navigate('Vault')}>
            <ProfileIcon color={COLORS.textPrimary} size={20} />
          </Pressable>
        </View>
      </Animated.View>

      <View style={styles.rewardsCard}>
        <View style={styles.rewardsHeader}>
          <View>
            <Text style={styles.rewardsLabel}>Testnet faucet</Text>
            <Text style={styles.rewardsValue}>+1,000 chips</Text>
            <Text style={styles.rewardsSub}>
              {faucetStatus === 'success'
                ? 'Faucet claimed'
                : faucetStatus === 'pending'
                  ? 'Requesting chips...'
                  : faucetMessage ?? 'Ready to claim'}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={handleClaimBonus}
          disabled={faucetDisabled}
          style={({ pressed }) => [
            styles.rewardsButton,
            faucetDisabled && styles.rewardsButtonDisabled,
            pressed && !faucetDisabled && styles.rewardsButtonPressed,
          ]}
        >
          <Text style={[styles.rewardsButtonText, faucetDisabled && styles.rewardsButtonTextDisabled]}>
            {faucetStatus === 'pending' ? 'Claiming...' : 'Claim now'}
          </Text>
        </Pressable>
        <View style={styles.clubRow}>
          <Text style={styles.clubText}>Need more chips? Faucet is rate-limited by testnet rules.</Text>
        </View>
      </View>

      <View style={styles.membershipCard}>
        <View>
          <Text style={styles.rewardsLabel}>Membership</Text>
          <Text style={styles.rewardsValue}>{entitlementsLoading ? 'Checking...' : tierLabel}</Text>
          <Text style={styles.rewardsSub}>
            {activeEntitlement ? 'Freeroll boosted' : 'Unlock daily freeroll boosts'}
          </Text>
        </View>
        {billingUrl ? (
          <Pressable style={styles.membershipButton} onPress={handleManageMembership}>
            <Text style={styles.membershipButtonText}>{activeEntitlement ? 'Manage' : 'Join'}</Text>
          </Pressable>
        ) : null}
      </View>

      {opsBase ? (
        <View style={styles.leagueCard}>
          <View style={styles.leagueHeader}>
            <Text style={styles.rewardsLabel}>Weekly league</Text>
            <Text style={styles.rewardsSub}>Top players this week</Text>
          </View>
          {leagueEntries.length > 0 ? (
            leagueEntries.map((entry, index) => {
              const masked = `${entry.publicKey.slice(0, 6)}...${entry.publicKey.slice(-4)}`;
              const isYou = publicKey && entry.publicKey.toLowerCase() === publicKey.toLowerCase();
              return (
                <View key={entry.publicKey} style={styles.leagueRow}>
                  <Text style={[styles.leagueRank, isYou && styles.leagueHighlight]}>#{index + 1}</Text>
                  <Text style={[styles.leagueKey, isYou && styles.leagueHighlight]}>
                    {masked}{isYou ? ' (you)' : ''}
                  </Text>
                  <Text style={styles.leaguePoints}>{Math.floor(entry.points).toLocaleString()}</Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.leagueEmpty}>{leagueError ?? 'No league data yet.'}</Text>
          )}
        </View>
      ) : null}

      {opsBase && publicKey ? (
        <View style={styles.referralCard}>
          <View style={styles.leagueHeader}>
            <Text style={styles.rewardsLabel}>Invite friends</Text>
            <Text style={styles.rewardsSub}>Share your referral code</Text>
          </View>
          {referralLoading ? (
            <Text style={styles.leagueEmpty}>Loading referral…</Text>
          ) : referralSummary ? (
            <>
              <Text style={styles.referralCode}>{referralSummary.code ?? '—'}</Text>
              <Text style={styles.referralStats}>
                Referrals: {referralSummary.referrals} · Qualified: {referralSummary.qualified}
              </Text>
              {referralSummary.code ? (
                <Pressable style={styles.referralButton} onPress={handleShareInvite}>
                  <Text style={styles.referralButtonText}>Share invite</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text style={styles.leagueEmpty}>{referralError ?? 'Referral unavailable.'}</Text>
          )}
        </View>
      ) : null}

      {/* Games Grid - DS-041 + DS-042: Animated FlatList with parallax and snap scroll */}
      <Animated.FlatList
        key={`games-${numColumns}`}
        data={GAMES}
        numColumns={numColumns}
        keyExtractor={(item) => item.id}
        renderItem={renderGameCard}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.gamesContainer}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        onScroll={scrollHandler}
        scrollEventThrottle={16} // 60fps scroll tracking
        // DS-042: Magnetic snap scrolling configuration
        snapToInterval={CARD_ROW_HEIGHT} // Snap to row boundaries
        snapToAlignment="start" // Align row to top
        decelerationRate={0.992} // iOS-like deceleration for natural momentum
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
            progressBackgroundColor={COLORS.surface}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  greeting: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.body,
  },
  balance: {
    color: COLORS.primary,
    ...TYPOGRAPHY.displayLarge,
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginTop: SPACING.xs,
  },
  headerMetaText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  headerMetaDivider: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  headerButtons: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  rewardsCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  membershipCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
  },
  membershipButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
  },
  membershipButtonText: {
    ...TYPOGRAPHY.label,
    color: '#FFFFFF',
  },
  leagueCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  leagueHeader: {
    marginBottom: SPACING.sm,
  },
  leagueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  leagueRank: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    width: 32,
  },
  leagueKey: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    flex: 1,
  },
  leaguePoints: {
    ...TYPOGRAPHY.label,
    color: COLORS.textPrimary,
  },
  leagueEmpty: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  leagueHighlight: {
    color: COLORS.primary,
  },
  referralCard: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.lg,
    padding: SPACING.md,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  referralCode: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  referralStats: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginBottom: SPACING.sm,
  },
  referralButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  referralButtonText: {
    ...TYPOGRAPHY.label,
    color: '#FFFFFF',
  },
  rewardsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  rewardsLabel: {
    ...TYPOGRAPHY.label,
    color: COLORS.textMuted,
  },
  rewardsValue: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  rewardsSub: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  rewardsButton: {
    marginTop: SPACING.xs,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    backgroundColor: COLORS.success,
    alignItems: 'center',
  },
  rewardsButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  rewardsButtonDisabled: {
    backgroundColor: COLORS.border,
  },
  rewardsButtonText: {
    ...TYPOGRAPHY.label,
    color: '#FFFFFF',
  },
  rewardsButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  clubRow: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  clubText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    flex: 1,
  },
  gamesContainer: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.md,
    marginLeft: SPACING.xs,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  gameCardWrapper: {
    width: '48%',
  },
  gameCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.xs,
  },
  gameCardPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  gameIconContainer: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  gameName: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.h3,
    marginBottom: 2,
  },
  gameDescription: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
  },
  footer: {
    marginTop: SPACING.xl,
    alignItems: 'center',
  },
  footerText: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
  },
  lastRefreshedText: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xs,
    opacity: 0.7,
  },
});
