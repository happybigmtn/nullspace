/**
 * Game Header with balance, title, and help button
 */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { HelpButton } from '../ui/HelpButton';
import { WalletBadge } from '../ui/WalletBadge';
import { EventBadge } from './EventBadge';
import { AnimatedBalance } from '../celebration/AnimatedBalance';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../../constants/theme';
import type { CelebrationIntensity } from '../../hooks/useCelebration';

interface GameHeaderProps {
  title: string;
  balance: number;
  sessionDelta?: number;
  onHelp?: () => void;
  rightContent?: React.ReactNode;
  /** Celebration state for animated balance */
  isWinCelebrating?: boolean;
  celebrationIntensity?: CelebrationIntensity;
  winAmount?: number;
}

export function GameHeader({
  title,
  balance,
  sessionDelta = 0,
  onHelp,
  rightContent,
  isWinCelebrating = false,
  celebrationIntensity = 'small',
  winAmount = 0,
}: GameHeaderProps) {
  const navigation = useNavigation();
  const sessionLabel = sessionDelta === 0 ? '$0' : `${sessionDelta > 0 ? '+' : ''}$${Math.abs(sessionDelta).toLocaleString()}`;

  return (
    <View style={styles.header}>
      <View style={styles.leftSection}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>{'<'}</Text>
        </Pressable>
        <View style={styles.balanceContainer}>
          <Text style={styles.balanceLabel}>Balance</Text>
          <AnimatedBalance
            balance={balance}
            isWinActive={isWinCelebrating}
            intensity={celebrationIntensity}
            winAmount={winAmount}
          />
          <Text style={[styles.sessionDelta, sessionDelta > 0 ? styles.sessionPositive : sessionDelta < 0 ? styles.sessionNegative : styles.sessionNeutral]}>
            Session {sessionLabel}
          </Text>
        </View>
      </View>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.rightSection}>
        <EventBadge />
        <WalletBadge />
        {rightContent}
        {onHelp && <HelpButton onPress={onHelp} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    marginRight: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.sm,
  },
  backText: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
  },
  balanceContainer: {
    alignItems: 'flex-start',
  },
  balanceLabel: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    textTransform: 'uppercase',
  },
  sessionDelta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  sessionPositive: {
    color: COLORS.success,
  },
  sessionNegative: {
    color: COLORS.destructive,
  },
  sessionNeutral: {
    color: COLORS.textMuted,
  },
  title: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase',
    letterSpacing: 2,
    flex: 1,
    textAlign: 'center',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    flex: 1,
    justifyContent: 'flex-end',
  },
});
