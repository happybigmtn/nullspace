/**
 * TouchBetControls - Touch-optimized bet controls for mobile (AC-8.2, AC-PQ.2)
 *
 * Features:
 * - Minimum 44pt touch targets (Apple HIG / Material Design guideline)
 * - Bottom-aligned layout for one-hand thumb reachability
 * - Responsive scaling for various screen sizes
 * - Integration with ChipSelector and bet submission hooks
 * - Accessibility: proper roles, labels, and state announcements
 *
 * Touch Target Requirements (AC-PQ.2):
 * - Action buttons: MIN_TOUCH_TARGET = 44pt (actual: 48pt)
 * - Chip selectors: 56pt (exceeds minimum)
 * - FAB/primary CTA: 56pt (thumb-friendly)
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { ChipSelector } from './ChipSelector';
import { ChipPile } from './ChipPile';
import { haptics } from '../../services/haptics';
import { COLORS, SPACING, RADIUS, TYPOGRAPHY, ANIMATION } from '../../constants/theme';
import type { ChipValue } from '../../types';
import type { PlacedChip } from '../../hooks/useChipBetting';

/**
 * Touch target constants per platform guidelines
 * - Apple HIG: 44pt minimum
 * - Material Design: 48dp minimum
 * We use 48pt as the floor to satisfy both
 */
export const TOUCH_TARGETS = {
  /** Minimum touch target (Apple HIG / Material) */
  MIN: 44,
  /** Standard button touch target */
  BUTTON: 48,
  /** Chip selector touch target */
  CHIP: 56,
  /** Primary FAB touch target */
  FAB: 56,
  /** Spacing between touch targets to prevent accidental taps */
  GAP: 8,
} as const;

/**
 * Screen size breakpoints for responsive layout
 */
const SCREEN_BREAKPOINTS = {
  /** Small phones (iPhone SE, etc.) */
  SMALL: 320,
  /** Standard phones (iPhone 14, Pixel 6) */
  MEDIUM: 375,
  /** Large phones (iPhone 14 Pro Max, Pixel 6 Pro) */
  LARGE: 428,
} as const;

/**
 * One-hand reachability zones
 * Based on thumb reach studies (Steven Hoober, Luke Wroblewski)
 * Bottom 2/3 of screen is the "easy reach" zone
 */
const REACHABILITY = {
  /** Maximum height from bottom for easy thumb access */
  EASY_REACH_HEIGHT: 0.67,
  /** Bottom margin for safe area + gesture navigation */
  BOTTOM_INSET: Platform.OS === 'ios' ? 34 : 24,
} as const;

interface TouchBetControlsProps {
  /** Current bet amount */
  bet: number;
  /** Currently selected chip value */
  selectedChip: ChipValue;
  /** Available balance */
  balance: number;
  /** Placed chips for pile visualization */
  placedChips: PlacedChip[];
  /** Whether betting is disabled (not in betting phase) */
  disabled?: boolean;
  /** Whether a bet submission is in progress */
  isSubmitting?: boolean;
  /** Handler for chip selection */
  onSelectChip: (value: ChipValue) => void;
  /** Handler for chip placement (adds to bet) */
  onPlaceChip: (value: ChipValue) => void;
  /** Handler for clearing bet */
  onClearBet: () => void;
  /** Handler for confirming/submitting bet */
  onConfirmBet: () => void;
  /** Optional label for confirm button (default: "DEAL") */
  confirmLabel?: string;
  /** Test ID prefix for E2E testing */
  testID?: string;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * TouchBetControls - Bottom-aligned betting interface for one-hand use
 */
export function TouchBetControls({
  bet,
  selectedChip,
  balance,
  placedChips,
  disabled = false,
  isSubmitting = false,
  onSelectChip,
  onPlaceChip,
  onClearBet,
  onConfirmBet,
  confirmLabel = 'DEAL',
  testID = 'touch-bet-controls',
}: TouchBetControlsProps) {
  const screenWidth = Dimensions.get('window').width;
  const isSmallScreen = screenWidth < SCREEN_BREAKPOINTS.MEDIUM;

  // Confirm button press animation
  const confirmScale = useSharedValue(1);
  const clearScale = useSharedValue(1);

  const handleConfirmPressIn = useCallback(() => {
    confirmScale.value = withSpring(0.95, ANIMATION.spring);
  }, [confirmScale]);

  const handleConfirmPressOut = useCallback(() => {
    confirmScale.value = withSpring(1, ANIMATION.spring);
  }, [confirmScale]);

  const handleClearPressIn = useCallback(() => {
    clearScale.value = withSpring(0.95, ANIMATION.spring);
  }, [clearScale]);

  const handleClearPressOut = useCallback(() => {
    clearScale.value = withSpring(1, ANIMATION.spring);
  }, [clearScale]);

  const handleConfirmPress = useCallback(() => {
    if (disabled || isSubmitting || bet === 0) return;
    haptics.betConfirm().catch(() => {});
    onConfirmBet();
  }, [disabled, isSubmitting, bet, onConfirmBet]);

  const handleClearPress = useCallback(() => {
    if (disabled || bet === 0) return;
    haptics.buttonPress().catch(() => {});
    onClearBet();
  }, [disabled, bet, onClearBet]);

  const handleChipPlace = useCallback((value: ChipValue) => {
    if (disabled) return;
    onPlaceChip(value);
  }, [disabled, onPlaceChip]);

  const confirmAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: confirmScale.value }],
  }));

  const clearAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: clearScale.value }],
  }));

  const isConfirmDisabled = disabled || isSubmitting || bet === 0;
  const isClearDisabled = disabled || bet === 0;

  // Accessibility announcement for bet amount
  const betAccessibilityLabel = useMemo(() => {
    if (bet === 0) return 'No bet placed';
    return `Current bet: $${bet}. Balance: $${balance}`;
  }, [bet, balance]);

  return (
    <View
      style={[styles.container, isSmallScreen && styles.containerSmall]}
      testID={testID}
      accessibilityRole="group"
      accessibilityLabel="Betting controls"
    >
      {/* Bet display with chip pile */}
      <View
        style={styles.betDisplayContainer}
        accessibilityLabel={betAccessibilityLabel}
        accessibilityRole="text"
      >
        <ChipPile
          chips={placedChips}
          totalBet={bet}
          showCounter={true}
          testID={`${testID}-chip-pile`}
        />
      </View>

      {/* Chip selector - already has 56pt targets */}
      <View style={styles.chipSelectorContainer}>
        <ChipSelector
          selectedValue={selectedChip}
          disabled={disabled}
          onSelect={onSelectChip}
          onChipPlace={handleChipPlace}
        />
      </View>

      {/* Action buttons - bottom-aligned for one-hand reach */}
      <View style={styles.actionsContainer}>
        {/* Clear button - secondary action, left side */}
        <AnimatedPressable
          testID={`${testID}-clear-button`}
          style={[
            styles.actionButton,
            styles.clearButton,
            isClearDisabled && styles.actionButtonDisabled,
            clearAnimatedStyle,
          ]}
          onPress={handleClearPress}
          onPressIn={handleClearPressIn}
          onPressOut={handleClearPressOut}
          disabled={isClearDisabled}
          accessibilityRole="button"
          accessibilityLabel="Clear bet"
          accessibilityState={{ disabled: isClearDisabled }}
          accessibilityHint="Removes all chips from current bet"
        >
          <Text
            style={[
              styles.actionButtonText,
              styles.clearButtonText,
              isClearDisabled && styles.actionButtonTextDisabled,
            ]}
          >
            CLEAR
          </Text>
        </AnimatedPressable>

        {/* Confirm/Deal button - primary action, right side for right-hand thumb */}
        <AnimatedPressable
          testID={`${testID}-confirm-button`}
          style={[
            styles.actionButton,
            styles.confirmButton,
            isConfirmDisabled && styles.confirmButtonDisabled,
            confirmAnimatedStyle,
          ]}
          onPress={handleConfirmPress}
          onPressIn={handleConfirmPressIn}
          onPressOut={handleConfirmPressOut}
          disabled={isConfirmDisabled}
          accessibilityRole="button"
          accessibilityLabel={`${confirmLabel} for $${bet}`}
          accessibilityState={{ disabled: isConfirmDisabled }}
          accessibilityHint={isSubmitting ? 'Submitting bet' : 'Confirms and submits your bet'}
        >
          <Text
            style={[
              styles.actionButtonText,
              styles.confirmButtonText,
              isConfirmDisabled && styles.confirmButtonTextDisabled,
            ]}
          >
            {isSubmitting ? 'SUBMITTING...' : confirmLabel}
          </Text>
        </AnimatedPressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: SPACING.md,
    paddingBottom: REACHABILITY.BOTTOM_INSET,
    gap: SPACING.sm,
  },
  containerSmall: {
    paddingHorizontal: SPACING.sm,
    gap: SPACING.xs,
  },
  betDisplayContainer: {
    alignItems: 'center',
    minHeight: 80,
    justifyContent: 'center',
  },
  chipSelectorContainer: {
    alignItems: 'center',
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TOUCH_TARGETS.GAP,
    paddingTop: SPACING.sm,
  },
  actionButton: {
    // Minimum 48pt touch target (satisfies both 44pt Apple HIG and 48dp Material)
    minHeight: TOUCH_TARGETS.BUTTON,
    minWidth: 120,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: RADIUS.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    ...TYPOGRAPHY.label,
    fontWeight: '700',
    letterSpacing: 1,
  },
  actionButtonTextDisabled: {
    color: COLORS.textDisabled,
  },
  clearButton: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    flex: 1,
  },
  clearButtonText: {
    color: COLORS.textSecondary,
  },
  confirmButton: {
    backgroundColor: COLORS.textPrimary,
    flex: 1.5,
    // Larger touch target for primary action
    minHeight: TOUCH_TARGETS.FAB,
  },
  confirmButtonDisabled: {
    backgroundColor: COLORS.textDisabled,
  },
  confirmButtonText: {
    color: COLORS.surface,
  },
  confirmButtonTextDisabled: {
    color: COLORS.textMuted,
  },
});
