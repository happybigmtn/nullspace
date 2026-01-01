/**
 * Lobby Screen - Jony Ive Redesigned
 * Game selection with balance display and minimal navigation
 */
import { View, Text, StyleSheet, FlatList, Pressable, ListRenderItem, useWindowDimensions } from 'react-native';
import { useCallback, useEffect } from 'react';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, GAME_COLORS } from '../constants/theme';
import { haptics } from '../services/haptics';
import { initializeNotifications } from '../services';
import { useGameStore } from '../stores/gameStore';
import { useGatewaySession } from '../hooks';
import type { LobbyScreenProps } from '../navigation/types';
import type { GameId } from '../types';

interface GameInfo {
  id: GameId;
  name: string;
  description: string;
  emoji: string;
  color: string;
}

const GAMES: GameInfo[] = [
  {
    id: 'hi_lo',
    name: 'Hi-Lo',
    description: 'Higher or Lower',
    emoji: '🎲',
    color: GAME_COLORS.hi_lo,
  },
  {
    id: 'blackjack',
    name: 'Blackjack',
    description: 'Beat the dealer',
    emoji: '🃏',
    color: GAME_COLORS.blackjack,
  },
  {
    id: 'roulette',
    name: 'Roulette',
    description: 'Spin the wheel',
    emoji: '🎡',
    color: GAME_COLORS.roulette,
  },
  {
    id: 'craps',
    name: 'Craps',
    description: 'Roll the dice',
    emoji: '🎯',
    color: GAME_COLORS.craps,
  },
  {
    id: 'baccarat',
    name: 'Baccarat',
    description: 'Player or Banker',
    emoji: '👑',
    color: GAME_COLORS.baccarat,
  },
  {
    id: 'casino_war',
    name: 'Casino War',
    description: 'High card wins',
    emoji: '⚔️',
    color: GAME_COLORS.casino_war,
  },
  {
    id: 'video_poker',
    name: 'Video Poker',
    description: 'Jacks or Better',
    emoji: '🎰',
    color: GAME_COLORS.video_poker,
  },
  {
    id: 'sic_bo',
    name: 'Sic Bo',
    description: 'Dice totals',
    emoji: '🀄',
    color: GAME_COLORS.sic_bo,
  },
  {
    id: 'three_card_poker',
    name: '3 Card Poker',
    description: 'Ante & Pair Plus',
    emoji: '🎴',
    color: GAME_COLORS.three_card_poker,
  },
  {
    id: 'ultimate_texas_holdem',
    name: 'Ultimate Holdem',
    description: 'Bet the streets',
    emoji: '🤠',
    color: GAME_COLORS.ultimate_texas_holdem,
  },
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
  const faucetDisabled = faucetStatus === 'pending';
  const balanceLabel = balanceReady ? `$${balance.toLocaleString()}` : '...';
  const shortKey = publicKey ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}` : 'Not connected';
  const networkLabel = connectionState === 'connected' ? 'Testnet Online' : connectionState === 'connecting' ? 'Connecting' : 'Offline';

  useEffect(() => {
    void initializeNotifications();
  }, []);

  const handleGameSelect = useCallback((gameId: GameId) => {
    haptics.selectionChange();
    navigation.navigate('Game', { gameId });
  }, [navigation]);

  const handleClaimBonus = useCallback(() => {
    if (faucetDisabled) return;
    requestFaucet();
  }, [faucetDisabled, requestFaucet]);

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
          <Text style={styles.gameEmoji}>{game.emoji}</Text>
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
          <Text style={styles.profileIcon}>👤</Text>
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
  profileIcon: {
    fontSize: 20,
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
  gameEmoji: {
    fontSize: 24,
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
