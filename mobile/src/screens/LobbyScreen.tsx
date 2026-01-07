/**
 * Lobby Screen - Jony Ive Redesigned
 * Game selection with balance display and minimal navigation
 */
import { View, Text, StyleSheet, FlatList, Pressable, ListRenderItem, useWindowDimensions, Linking, Share } from 'react-native';
import { useCallback, useEffect, useState } from 'react';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, GAME_COLORS } from '../constants/theme';
import { haptics } from '../services/haptics';
import { initializeNotifications, hasPlayedFirstGame, markFirstGamePlayed } from '../services';
import { useGameStore } from '../stores/gameStore';
import { useEntitlements, useGatewaySession } from '../hooks';
import { stripTrailingSlash } from '../utils/url';
import { GameIcon, ProfileIcon } from '../components/ui';
import type { LobbyScreenProps } from '../navigation/types';
import type { GameId } from '../types';

interface GameInfo {
  id: GameId;
  name: string;
  description: string;
  color: string;
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
      haptics.jackpot();
    } else {
      haptics.selectionChange();
    }
    navigation.navigate('Game', { gameId });
  }, [navigation]);

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
    <Animated.View
      entering={FadeInUp.delay(index * 50)}
      style={styles.gameCardWrapper}
    >
      <Pressable
        onPress={() => handleGameSelect(game.id)}
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
  ), [handleGameSelect]);

  const ListHeader = useCallback(() => (
    <Text style={styles.sectionTitle}>Games</Text>
  ), []);

  const ListFooter = useCallback(() => (
    <View style={styles.footer}>
      <Text style={styles.footerText}>Provably Fair • On-Chain</Text>
    </View>
  ), []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <Animated.View entering={FadeIn} style={styles.header}>
        <View>
          <Text style={styles.greeting}>Good evening</Text>
          <Text style={styles.balance}>{balanceLabel}</Text>
          <View style={styles.headerMetaRow}>
            <Text style={styles.headerMetaText}>{networkLabel}</Text>
            <Text style={styles.headerMetaDivider}>•</Text>
            <Text style={styles.headerMetaText}>{shortKey}</Text>
          </View>
        </View>
        <Pressable style={styles.profileButton} onPress={() => navigation.navigate('Vault')}>
          <ProfileIcon color={COLORS.textPrimary} size={20} />
        </Pressable>
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

      {/* Games Grid */}
      <FlatList
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
  profileButton: {
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
});
