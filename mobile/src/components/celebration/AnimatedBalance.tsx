/**
 * AnimatedBalance - Balance display with slot-machine roller effect and shimmer
 *
 * Features:
 * - Slot-machine digit roller animation on value change
 * - Gold shimmer wave across text on win
 * - Scale pop when balance updates
 * - Win/loss delta badge that fades after 2s
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { COLORS, TYPOGRAPHY, SPACING, SPRING } from '../../constants/theme';
import type { CelebrationIntensity } from '../../hooks/useCelebration';

interface AnimatedBalanceProps {
  /** Current balance value */
  balance: number;
  /** Is a celebration active */
  isWinActive?: boolean;
  /** Celebration intensity for scaling effects */
  intensity?: CelebrationIntensity;
  /** Win amount for delta badge */
  winAmount?: number;
}

/** Format number as currency string */
function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

/** Split currency string into individual characters */
function splitDigits(formatted: string): string[] {
  return formatted.split('');
}

/**
 * Single animated digit with roller effect
 */
function RollerDigit({ char, isAnimating, delay }: { char: string; isAnimating: boolean; delay: number }) {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (isAnimating) {
      // Roller effect: slide up from below
      translateY.value = 20;
      opacity.value = 0;
      translateY.value = withDelay(
        delay,
        withSpring(0, { ...SPRING.button, damping: 15 })
      );
      opacity.value = withDelay(
        delay,
        withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) })
      );
    }
  }, [char, isAnimating, delay, translateY, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  // Non-digit characters don't animate
  const isDigit = /\d/.test(char);
  if (!isDigit) {
    return <Text style={styles.digit}>{char}</Text>;
  }

  return (
    <Animated.Text style={[styles.digit, animatedStyle]}>
      {char}
    </Animated.Text>
  );
}

/**
 * Shimmer overlay that sweeps across the balance
 */
function ShimmerOverlay({ isActive }: { isActive: boolean }) {
  const translateX = useSharedValue(-100);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (isActive) {
      translateX.value = -100;
      opacity.value = withSequence(
        withTiming(0.7, { duration: 100 }),
        withTiming(0.7, { duration: 600 }),
        withTiming(0, { duration: 200 })
      );
      translateX.value = withTiming(200, {
        duration: 800,
        easing: Easing.inOut(Easing.quad),
      });
    }
  }, [isActive, translateX, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: `${translateX.value}%` }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View style={[styles.shimmerOverlay, animatedStyle]} pointerEvents="none">
      <View style={styles.shimmerGradient} />
    </Animated.View>
  );
}

/**
 * Win delta badge that shows +amount and fades
 */
function DeltaBadge({ amount, isVisible }: { amount: number; isVisible: boolean }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(10);
  const scale = useSharedValue(0.8);

  useEffect(() => {
    if (isVisible && amount > 0) {
      // Pop in
      opacity.value = withSequence(
        withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }),
        withDelay(1500, withTiming(0, { duration: 500, easing: Easing.in(Easing.quad) }))
      );
      translateY.value = withSpring(0, SPRING.button);
      scale.value = withSequence(
        withSpring(1.1, { ...SPRING.button, damping: 10 }),
        withSpring(1, SPRING.button)
      );
    } else {
      opacity.value = withTiming(0, { duration: 150 });
    }
  }, [isVisible, amount, opacity, translateY, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
  }));

  if (amount <= 0) return null;

  return (
    <Animated.View style={[styles.deltaBadge, animatedStyle]}>
      <Text style={styles.deltaText}>+${amount.toLocaleString()}</Text>
    </Animated.View>
  );
}

/**
 * Main animated balance component
 */
export function AnimatedBalance({
  balance,
  isWinActive = false,
  intensity = 'small',
  winAmount = 0,
}: AnimatedBalanceProps) {
  const [displayBalance, setDisplayBalance] = useState(balance);
  const [isRolling, setIsRolling] = useState(false);
  const prevBalanceRef = useRef(balance);
  const containerScale = useSharedValue(1);

  // Detect balance changes and trigger animation
  useEffect(() => {
    const prevBalance = prevBalanceRef.current;
    if (balance !== prevBalance) {
      const isIncrease = balance > prevBalance;

      if (isIncrease && isWinActive) {
        // Scale pop based on intensity
        const scaleAmount =
          intensity === 'jackpot' ? 1.15 : intensity === 'big' ? 1.12 : intensity === 'medium' ? 1.08 : 1.05;

        containerScale.value = withSequence(
          withSpring(scaleAmount, { ...SPRING.success, damping: 8 }),
          withSpring(1, SPRING.success)
        );
      }

      // Trigger roller animation
      setIsRolling(true);
      setDisplayBalance(balance);

      // Reset rolling state after animation
      const timer = setTimeout(() => {
        setIsRolling(false);
      }, 600);

      prevBalanceRef.current = balance;
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [balance, isWinActive, intensity, containerScale]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: containerScale.value }],
  }));

  const digits = splitDigits(formatCurrency(displayBalance));

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.container, containerStyle]}>
        <View style={styles.digitsRow}>
          {digits.map((char, index) => (
            <RollerDigit
              key={`${index}-${char}`}
              char={char}
              isAnimating={isRolling}
              delay={index * 30} // Stagger effect
            />
          ))}
        </View>
        <ShimmerOverlay isActive={isWinActive} />
      </Animated.View>
      <DeltaBadge amount={winAmount} isVisible={isWinActive} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'flex-start',
    position: 'relative',
  },
  container: {
    overflow: 'hidden',
    position: 'relative',
  },
  digitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  digit: {
    color: COLORS.primary,
    ...TYPOGRAPHY.h2,
    fontVariant: ['tabular-nums'],
  },
  shimmerOverlay: {
    ...StyleSheet.absoluteFillObject,
    width: '50%',
  },
  shimmerGradient: {
    flex: 1,
    backgroundColor: 'transparent',
    // Simulated gradient with gold glow
    shadowColor: COLORS.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 20,
    elevation: 0,
  },
  deltaBadge: {
    position: 'absolute',
    right: -8,
    top: -8,
    backgroundColor: COLORS.success,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderRadius: 8,
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 4,
  },
  deltaText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
