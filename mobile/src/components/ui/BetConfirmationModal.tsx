/**
 * Bet Confirmation Modal - US-118
 *
 * A premium modal that shows bet summary before submission with:
 * - Countdown progress indicator (casino-style timer)
 * - Bet summary with game type and total amount
 * - Potential payout calculation based on game odds
 * - Visual danger zone when bet approaches balance limit
 * - Cancel/Confirm buttons with countdown auto-submit option
 */
import { useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle, TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  runOnJS,
  Easing,
  interpolate,
  interpolateColor,
  Extrapolation,
} from 'react-native-reanimated';
import { GlassModal } from './GlassModal';
import { PrimaryButton } from './PrimaryButton';
import { haptics } from '../../services/haptics';
import { useThemedColors } from '../../hooks/useThemedColors';
import { useTheme } from '../../context/ThemeContext';
import {
  SPACING,
  RADIUS,
  TYPOGRAPHY,
  FONT_DISPLAY,
} from '../../constants/theme';

/** Game type for determining payout display */
export type GameType =
  | 'blackjack'
  | 'roulette'
  | 'baccarat'
  | 'craps'
  | 'hi_lo'
  | 'video_poker'
  | 'casino_war'
  | 'three_card'
  | 'ultimate_holdem'
  | 'sic_bo';

/** Bet details for display */
export interface BetDetails {
  /** Total bet amount in chips */
  amount: number;
  /** Game being played */
  gameType: GameType;
  /** Side bets breakdown (optional) */
  sideBets?: { name: string; amount: number }[];
  /** Custom payout description (e.g., "Banker pays 0.95:1") */
  payoutDescription?: string;
}

interface BetConfirmationModalProps {
  /** Whether modal is visible */
  visible: boolean;
  /** Called when user confirms bet */
  onConfirm: () => void;
  /** Called when user cancels */
  onCancel: () => void;
  /** Bet details to display */
  bet: BetDetails;
  /** Current balance for danger zone calculation */
  balance: number;
  /** Countdown duration in seconds (default: 5) */
  countdownSeconds?: number;
  /** Whether to auto-confirm when countdown completes (default: false) */
  autoConfirm?: boolean;
  /** Test ID for testing */
  testID?: string;
}

/** Common game odds for payout estimation */
const GAME_ODDS: Record<GameType, { minPayout: number; maxPayout: string }> = {
  blackjack: { minPayout: 1, maxPayout: '3:2 (Blackjack)' },
  roulette: { minPayout: 1, maxPayout: '35:1 (Straight)' },
  baccarat: { minPayout: 0.95, maxPayout: '8:1 (Tie)' },
  craps: { minPayout: 1, maxPayout: '30:1 (2/12)' },
  hi_lo: { minPayout: 1.5, maxPayout: 'Streak multiplier' },
  video_poker: { minPayout: 1, maxPayout: '800:1 (Royal)' },
  casino_war: { minPayout: 1, maxPayout: '10:1 (Tie bet)' },
  three_card: { minPayout: 1, maxPayout: '40:1 (Pair Plus)' },
  ultimate_holdem: { minPayout: 1, maxPayout: '500:1 (Royal)' },
  sic_bo: { minPayout: 1, maxPayout: '180:1 (Triple)' },
};

/** Game display names */
const GAME_NAMES: Record<GameType, string> = {
  blackjack: 'Blackjack',
  roulette: 'Roulette',
  baccarat: 'Baccarat',
  craps: 'Craps',
  hi_lo: 'Hi-Lo',
  video_poker: 'Video Poker',
  casino_war: 'Casino War',
  three_card: 'Three Card Poker',
  ultimate_holdem: 'Ultimate Texas Hold\'em',
  sic_bo: 'Sic Bo',
};

/** Danger zone threshold - show warning when bet > this % of balance */
const DANGER_THRESHOLD = 0.8; // 80%

/**
 * Format chip amount with commas
 */
function formatAmount(amount: number): string {
  return amount.toLocaleString();
}

/**
 * BetConfirmationModal - Casino-style bet confirmation with countdown
 */
export function BetConfirmationModal({
  visible,
  onConfirm,
  onCancel,
  bet,
  balance,
  countdownSeconds = 5,
  autoConfirm = false,
  testID,
}: BetConfirmationModalProps) {
  const colors = useThemedColors();
  const { isDark } = useTheme();

  // Animation values
  const countdownProgress = useSharedValue(0);
  const pulseScale = useSharedValue(1);
  const dangerPulse = useSharedValue(0);
  const confirmPressed = useRef(false);

  // Calculate danger zone
  const isDangerZone = balance > 0 && bet.amount / balance >= DANGER_THRESHOLD;
  const balanceAfterBet = balance - bet.amount;

  // Get game info
  const gameOdds = GAME_ODDS[bet.gameType];
  const gameName = GAME_NAMES[bet.gameType];

  // Calculate potential payout range
  const minPayout = Math.floor(bet.amount * gameOdds.minPayout);

  // Reset animations when modal opens
  useEffect(() => {
    if (visible) {
      confirmPressed.current = false;
      countdownProgress.value = 0;

      // Start countdown animation
      countdownProgress.value = withTiming(1, {
        duration: countdownSeconds * 1000,
        easing: Easing.linear,
      }, (finished) => {
        if (finished && autoConfirm && !confirmPressed.current) {
          runOnJS(handleAutoConfirm)();
        }
      });

      // Start pulse animation for countdown ring
      const startPulse = () => {
        pulseScale.value = withSequence(
          withTiming(1.02, { duration: 500 }),
          withTiming(1, { duration: 500 })
        );
      };
      startPulse();
      const pulseInterval = setInterval(startPulse, 1000);

      // Danger zone pulse if applicable
      if (isDangerZone) {
        const startDangerPulse = () => {
          dangerPulse.value = withSequence(
            withTiming(1, { duration: 300 }),
            withTiming(0, { duration: 300 })
          );
        };
        startDangerPulse();
        const dangerInterval = setInterval(startDangerPulse, 600);
        return () => {
          clearInterval(pulseInterval);
          clearInterval(dangerInterval);
        };
      }

      return () => clearInterval(pulseInterval);
    }
    return undefined;
  }, [visible, countdownSeconds, autoConfirm, isDangerZone]);

  const handleAutoConfirm = useCallback(() => {
    if (!confirmPressed.current) {
      confirmPressed.current = true;
      haptics.betConfirm().catch(() => {});
      onConfirm();
    }
  }, [onConfirm]);

  const handleConfirm = useCallback(() => {
    confirmPressed.current = true;
    haptics.betConfirm().catch(() => {});
    onConfirm();
  }, [onConfirm]);

  const handleCancel = useCallback(() => {
    confirmPressed.current = true;
    haptics.selectionChange().catch(() => {});
    onCancel();
  }, [onCancel]);

  // Countdown progress bar animation
  const countdownBarStyle = useAnimatedStyle((): ViewStyle => {
    const width = interpolate(
      countdownProgress.value,
      [0, 1],
      [100, 0],
      Extrapolation.CLAMP
    );
    return {
      width: `${width}%` as unknown as number, // RN accepts string percentages
    };
  });

  // Pulse animation for countdown container
  const containerPulseStyle = useAnimatedStyle((): ViewStyle => ({
    transform: [{ scale: pulseScale.value }],
  }));

  // Danger zone pulse style
  const dangerStyle = useAnimatedStyle((): ViewStyle => {
    if (!isDangerZone) return {};

    const backgroundColor = interpolateColor(
      dangerPulse.value,
      [0, 1],
      ['rgba(239, 68, 68, 0.1)', 'rgba(239, 68, 68, 0.25)']
    );

    return { backgroundColor };
  });

  return (
    <GlassModal
      visible={visible}
      onClose={handleCancel}
      position="center"
      closeOnBackdrop={false}
      testID={testID}
    >
      <View style={viewStyles.container}>
        {/* Header */}
        <Text style={[textStyles.title, { color: colors.textPrimary }]}>
          Confirm Bet
        </Text>

        {/* Countdown Ring / Amount Display */}
        <Animated.View style={[viewStyles.countdownContainer, containerPulseStyle]}>
          <View style={[viewStyles.countdownRing, { borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
            {/* Progress bar inside ring */}
            <Animated.View
              style={[
                viewStyles.countdownProgressBar,
                { backgroundColor: isDangerZone ? colors.error : colors.primary },
                countdownBarStyle,
              ]}
            />
          </View>
          {/* Amount in center */}
          <View style={viewStyles.countdownCenter}>
            <Text style={[textStyles.currencySymbol, { color: colors.textSecondary }]}>
              $
            </Text>
            <Text style={[textStyles.amountText, { color: colors.textPrimary }]}>
              {formatAmount(bet.amount)}
            </Text>
          </View>
        </Animated.View>

        {/* Game Type Badge */}
        <View style={[viewStyles.gameBadge, { backgroundColor: colors.surface }]}>
          <Text style={[textStyles.gameBadgeText, { color: colors.textSecondary }]}>
            {gameName}
          </Text>
        </View>

        {/* Side Bets Breakdown */}
        {bet.sideBets && bet.sideBets.length > 0 && (
          <View style={viewStyles.sideBetsContainer}>
            {bet.sideBets.map((sideBet, index) => (
              <View key={index} style={viewStyles.sideBetRow}>
                <Text style={[textStyles.sideBetName, { color: colors.textSecondary }]}>
                  {sideBet.name}
                </Text>
                <Text style={[textStyles.sideBetAmount, { color: colors.textPrimary }]}>
                  ${formatAmount(sideBet.amount)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Payout Info */}
        <View style={[viewStyles.payoutContainer, { borderColor: colors.border }]}>
          <View style={viewStyles.payoutRow}>
            <Text style={[textStyles.payoutLabel, { color: colors.textSecondary }]}>
              Min Win
            </Text>
            <Text style={[textStyles.payoutValue, { color: colors.success }]}>
              +${formatAmount(minPayout)}
            </Text>
          </View>
          <View style={viewStyles.payoutRow}>
            <Text style={[textStyles.payoutLabel, { color: colors.textSecondary }]}>
              Max Payout
            </Text>
            <Text style={[textStyles.payoutValue, { color: colors.gold }]}>
              {bet.payoutDescription || gameOdds.maxPayout}
            </Text>
          </View>
        </View>

        {/* Danger Zone Warning */}
        {isDangerZone && (
          <Animated.View style={[viewStyles.dangerWarning, dangerStyle]}>
            <Text style={textStyles.dangerIcon}>⚠️</Text>
            <View style={viewStyles.dangerTextContainer}>
              <Text style={[textStyles.dangerTitle, { color: colors.error }]}>
                High Stake Bet
              </Text>
              <Text style={[textStyles.dangerSubtitle, { color: colors.textSecondary }]}>
                Balance after: ${formatAmount(balanceAfterBet)}
              </Text>
            </View>
          </Animated.View>
        )}

        {/* Action Buttons */}
        <View style={viewStyles.buttonContainer}>
          <Pressable
            onPress={handleCancel}
            style={[viewStyles.cancelButton, { borderColor: colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Cancel bet"
          >
            <Text style={[textStyles.cancelText, { color: colors.textSecondary }]}>
              Cancel
            </Text>
          </Pressable>
          <View style={viewStyles.confirmButtonWrapper}>
            <PrimaryButton
              label={autoConfirm ? 'Confirm Now' : 'Place Bet'}
              onPress={handleConfirm}
              variant={isDangerZone ? 'danger' : 'primary'}
              size="large"
            />
          </View>
        </View>

        {/* Auto-confirm hint */}
        {autoConfirm && (
          <Text style={[textStyles.autoConfirmHint, { color: colors.textSecondary }]}>
            Auto-confirming in {countdownSeconds}s
          </Text>
        )}
      </View>
    </GlassModal>
  );
}

// View styles
const viewStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  countdownContainer: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  countdownRing: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 4,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  countdownProgressBar: {
    height: '100%',
    borderRadius: 65,
  },
  countdownCenter: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  gameBadge: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.full,
    marginBottom: SPACING.md,
  },
  sideBetsContainer: {
    width: '100%',
    marginBottom: SPACING.md,
  },
  sideBetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  payoutContainer: {
    width: '100%',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.md,
  },
  payoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  dangerWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
  },
  dangerTextContainer: {
    flex: 1,
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: SPACING.md,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonWrapper: {
    flex: 2,
  },
});

// Text styles - manually typed to avoid ViewStyle | TextStyle union issues
const textStyles: Record<string, TextStyle> = {
  title: {
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.lg,
  },
  currencySymbol: {
    ...TYPOGRAPHY.h3,
    marginTop: 4,
    marginRight: 2,
  },
  amountText: {
    fontSize: 36,
    fontWeight: '700',
    fontFamily: FONT_DISPLAY.bold,
    fontVariant: ['tabular-nums'],
  },
  gameBadgeText: {
    ...TYPOGRAPHY.label,
    fontSize: 11,
  },
  sideBetName: {
    ...TYPOGRAPHY.bodySmall,
  },
  sideBetAmount: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600',
  },
  payoutLabel: {
    ...TYPOGRAPHY.bodySmall,
  },
  payoutValue: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '600',
    fontFamily: FONT_DISPLAY.semibold,
  },
  dangerIcon: {
    fontSize: 24,
    marginRight: SPACING.sm,
  },
  dangerTitle: {
    ...TYPOGRAPHY.bodySmall,
    fontWeight: '700',
  },
  dangerSubtitle: {
    ...TYPOGRAPHY.caption,
    marginTop: 2,
  },
  cancelText: {
    ...TYPOGRAPHY.label,
    letterSpacing: 1,
  },
  autoConfirmHint: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.md,
  },
};

export default BetConfirmationModal;
