/**
 * ResultReveal - Staged result reveal with theatrical choreography
 *
 * Replaces instant text result display with a staged reveal:
 * 1. Semi-transparent overlay fades in
 * 2. Outcome text animates in (scale + fade)
 * 3. Payout amount staggers in (delay)
 * 4. Session delta reveals last (delay)
 *
 * Different choreography for win/loss/push outcomes.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSequence,
  withSpring,
  Easing,
  interpolate,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { TYPOGRAPHY, SPACING, RADIUS, GLASS } from '../../constants/theme';
import { MONO } from '@nullspace/design-tokens';
import { haptics } from '../../services/haptics';
import type { CelebrationIntensity } from '../../hooks/useCelebration';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

/** Result outcome type */
export type ResultOutcome = 'win' | 'loss' | 'push' | 'blackjack' | 'war';

/** Payout breakdown item for complex wins */
export interface PayoutBreakdownItem {
  label: string;
  amount: number;
}

export interface ResultRevealProps {
  /** Whether result is being shown */
  isVisible: boolean;
  /** Result outcome type */
  outcome: ResultOutcome;
  /** Main message text (e.g., "Blackjack!", "You Win!", "Dealer Wins") */
  message: string;
  /** Net payout amount (profit, not including original bet) */
  payout: number;
  /** Original bet amount */
  bet: number;
  /** Optional breakdown for complex wins (sidebets, etc.) */
  breakdown?: PayoutBreakdownItem[];
  /** Session net change (cumulative for this session) */
  sessionDelta?: number;
  /** Callback when result is dismissed */
  onDismiss?: () => void;
  /** Auto-dismiss after duration (ms). Default: 3000 for wins, 2000 for loss/push */
  autoDismissMs?: number;
  /** Celebration intensity for win animations */
  intensity?: CelebrationIntensity;
}

/** Animation timing constants */
const TIMING = {
  overlayFade: 250,
  outcomeDelay: 100,
  outcomeIn: 400,
  payoutDelay: 500,
  payoutIn: 350,
  deltaDelay: 800,
  deltaIn: 300,
  breakdownStagger: 100,
  glowPulse: 1200,
  dismissDelay: 200,
} as const;

/**
 * Outcome-specific colors - Monochrome redesign (US-262)
 *
 * All outcomes use white glow with varying intensity/opacity.
 * State differentiation via contrast and typography weight.
 */
const OUTCOME_COLORS: Record<ResultOutcome, { primary: string; glow: string; bg: string }> = {
  win: {
    primary: MONO[1000],                    // White text - high contrast
    glow: MONO[1000],                       // White glow
    bg: 'rgba(255, 255, 255, 0.08)',        // Subtle white overlay
  },
  blackjack: {
    primary: MONO[1000],                    // White text - maximum emphasis
    glow: MONO[1000],                       // Intense white glow
    bg: 'rgba(255, 255, 255, 0.12)',        // Stronger overlay for special wins
  },
  loss: {
    primary: MONO[500],                     // Muted gray - de-emphasized
    glow: MONO[500],                        // Subtle glow
    bg: 'rgba(0, 0, 0, 0.15)',              // Darker overlay
  },
  push: {
    primary: MONO[700],                     // Light gray - neutral
    glow: MONO[700],                        // Subtle glow
    bg: 'rgba(255, 255, 255, 0.05)',        // Minimal overlay
  },
  war: {
    primary: MONO[700],                     // Light gray
    glow: MONO[700],
    bg: 'rgba(255, 255, 255, 0.05)',
  },
};

/**
 * Individual animated reveal element with scale + fade
 */
function RevealElement({
  children,
  delay,
  duration = 350,
  style,
}: {
  children: React.ReactNode;
  delay: number;
  duration?: number;
  style?: object;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withSpring(1, {
        damping: 15,
        stiffness: 150,
        mass: 0.8,
      })
    );
  }, [delay, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0, 1]),
    transform: [
      { scale: interpolate(progress.value, [0, 0.5, 1], [0.8, 1.05, 1]) },
      { translateY: interpolate(progress.value, [0, 1], [20, 0]) },
    ],
  }));

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

/**
 * Pulsing glow effect for wins
 */
function GlowPulse({ color, intensity }: { color: string; intensity: CelebrationIntensity }) {
  const pulse = useSharedValue(0);

  useEffect(() => {
    const pulseIntensity = intensity === 'jackpot' ? 0.8 : intensity === 'big' ? 0.6 : 0.4;
    pulse.value = withSequence(
      withTiming(pulseIntensity, { duration: TIMING.glowPulse / 2 }),
      withTiming(0.2, { duration: TIMING.glowPulse / 2 })
    );
    // Loop the pulse
    const interval = setInterval(() => {
      pulse.value = withSequence(
        withTiming(pulseIntensity, { duration: TIMING.glowPulse / 2 }),
        withTiming(0.2, { duration: TIMING.glowPulse / 2 })
      );
    }, TIMING.glowPulse);
    return () => clearInterval(interval);
  }, [intensity, pulse]);

  const glowStyle = useAnimatedStyle(() => ({
    shadowColor: color,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: pulse.value,
    shadowRadius: interpolate(pulse.value, [0.2, 0.8], [10, 30]),
    elevation: 10,
  }));

  return <Animated.View style={[StyleSheet.absoluteFill, glowStyle]} />;
}

/**
 * Animated counter for payout amount
 */
function AnimatedPayout({ amount, color, delay }: { amount: number; color: string; delay: number }) {
  const displayValue = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 200 }));
    displayValue.value = withDelay(
      delay,
      withTiming(amount, {
        duration: 600,
        easing: Easing.out(Easing.cubic),
      })
    );
  }, [amount, delay, displayValue, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: interpolate(opacity.value, [0, 1], [0.9, 1]) }],
  }));

  // For the text, we use a workaround since Animated.Text doesn't support text interpolation
  // We'll animate the container and show the final value
  return (
    <Animated.View style={animatedStyle}>
      <Text
        style={[
          styles.payoutAmount,
          { color },
          amount > 0 && styles.payoutPositive,
          amount < 0 && styles.payoutNegative,
        ]}
      >
        {amount >= 0 ? '+' : ''}${Math.abs(amount).toLocaleString()}
      </Text>
    </Animated.View>
  );
}

/**
 * ResultReveal component - orchestrates the staged result reveal
 */
export function ResultReveal({
  isVisible,
  outcome,
  message,
  payout,
  bet,
  breakdown,
  sessionDelta,
  onDismiss,
  autoDismissMs,
  intensity = 'small',
}: ResultRevealProps) {
  const colors = OUTCOME_COLORS[outcome];
  const isWin = outcome === 'win' || outcome === 'blackjack';
  const isLoss = outcome === 'loss';

  // Auto-dismiss timer
  useEffect(() => {
    if (!isVisible || !onDismiss) return;

    const defaultDuration = isWin ? 3000 : 2000;
    const duration = autoDismissMs ?? defaultDuration;

    const timer = setTimeout(() => {
      onDismiss();
    }, duration);

    return () => clearTimeout(timer);
  }, [isVisible, isWin, autoDismissMs, onDismiss]);

  // Haptic feedback on reveal
  useEffect(() => {
    if (isVisible) {
      if (isWin) {
        // Win haptic handled by celebration system
      } else if (isLoss) {
        haptics.error().catch(() => {});
      } else {
        // Use push haptic for neutral outcomes (push/war)
        haptics.push().catch(() => {});
      }
    }
  }, [isVisible, isWin, isLoss]);

  if (!isVisible) return null;

  const showBreakdown = breakdown && breakdown.length > 0;
  const showSessionDelta = sessionDelta !== undefined && sessionDelta !== 0;

  return (
    <Animated.View
      style={styles.container}
      entering={FadeIn.duration(TIMING.overlayFade)}
      exiting={FadeOut.duration(TIMING.dismissDelay)}
    >
      {/* Backdrop blur */}
      <BlurView
        intensity={GLASS.blur.medium}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />

      {/* Semi-transparent overlay with outcome color */}
      <Animated.View style={[styles.colorOverlay, { backgroundColor: colors.bg }]} />

      {/* Dismissible tap area */}
      <Pressable style={styles.dismissArea} onPress={onDismiss}>
        {/* Content card */}
        <View style={styles.card}>
          {/* Glow effect for wins */}
          {isWin && <GlowPulse color={colors.glow} intensity={intensity} />}

          {/* Outcome message */}
          <RevealElement delay={TIMING.outcomeDelay}>
            <Text style={[styles.outcomeText, { color: colors.primary }]}>{message}</Text>
          </RevealElement>

          {/* Payout amount */}
          <RevealElement delay={TIMING.payoutDelay} style={styles.payoutContainer}>
            <Text style={styles.payoutLabel}>{isLoss ? 'Lost' : isWin ? 'Won' : 'Returned'}</Text>
            <AnimatedPayout amount={payout} color={colors.primary} delay={TIMING.payoutDelay + 100} />
            {bet > 0 && payout !== 0 && (
              <Text style={styles.payoutMultiplier}>
                {isWin ? `${((payout / bet) + 1).toFixed(1)}x return` : ''}
              </Text>
            )}
          </RevealElement>

          {/* Breakdown for complex wins */}
          {showBreakdown && (
            <View style={styles.breakdownContainer}>
              {breakdown.map((item, index) => (
                <RevealElement
                  key={item.label}
                  delay={TIMING.payoutDelay + (index + 1) * TIMING.breakdownStagger}
                  style={styles.breakdownRow}
                >
                  <Text style={styles.breakdownLabel}>{item.label}</Text>
                  <Text style={[styles.breakdownAmount, { color: item.amount >= 0 ? MONO[1000] : MONO[500] }]}>
                    {item.amount >= 0 ? '+' : ''}${Math.abs(item.amount).toLocaleString()}
                  </Text>
                </RevealElement>
              ))}
            </View>
          )}

          {/* Session delta */}
          {showSessionDelta && (
            <RevealElement delay={TIMING.deltaDelay} style={styles.sessionDeltaContainer}>
              <Text style={styles.sessionLabel}>Session</Text>
              <Text
                style={[
                  styles.sessionDelta,
                  sessionDelta > 0 && styles.sessionPositive,
                  sessionDelta < 0 && styles.sessionNegative,
                ]}
              >
                {sessionDelta >= 0 ? '+' : ''}${Math.abs(sessionDelta).toLocaleString()}
              </Text>
            </RevealElement>
          )}

          {/* Tap to dismiss hint */}
          <RevealElement delay={TIMING.deltaDelay + 200}>
            <Text style={styles.dismissHint}>Tap to continue</Text>
          </RevealElement>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Hook for managing result reveal state in game screens
 */
export interface ResultRevealState {
  isVisible: boolean;
  outcome: ResultOutcome;
  message: string;
  payout: number;
  bet: number;
  breakdown?: PayoutBreakdownItem[];
  sessionDelta?: number;
  intensity?: CelebrationIntensity;
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  colorOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  dismissArea: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  card: {
    backgroundColor: 'rgba(28, 28, 30, 0.95)',
    borderRadius: RADIUS.xl,
    padding: SPACING.xl,
    minWidth: SCREEN_WIDTH * 0.75,
    maxWidth: SCREEN_WIDTH * 0.9,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  outcomeText: {
    ...TYPOGRAPHY.displayMedium,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  payoutContainer: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  payoutLabel: {
    ...TYPOGRAPHY.label,
    color: MONO[500],
    marginBottom: SPACING.xs,
  },
  payoutAmount: {
    fontSize: 48,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  payoutPositive: {
    // Color set dynamically
  },
  payoutNegative: {
    // Color set dynamically
  },
  payoutMultiplier: {
    ...TYPOGRAPHY.bodySmall,
    color: MONO[500],
    marginTop: SPACING.xs,
  },
  breakdownContainer: {
    width: '100%',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    paddingTop: SPACING.md,
    marginTop: SPACING.sm,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
  },
  breakdownLabel: {
    ...TYPOGRAPHY.body,
    color: MONO[600],
  },
  breakdownAmount: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  sessionDeltaContainer: {
    alignItems: 'center',
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.05)',
    width: '100%',
  },
  sessionLabel: {
    ...TYPOGRAPHY.caption,
    color: MONO[500],
    marginBottom: SPACING.xs,
  },
  sessionDelta: {
    ...TYPOGRAPHY.h3,
    color: MONO[600],
    fontVariant: ['tabular-nums'],
  },
  sessionPositive: {
    color: MONO[1000],                      // White - positive emphasis
    fontWeight: '700',
  },
  sessionNegative: {
    color: MONO[400],                       // Muted - de-emphasized
    fontWeight: '400',
  },
  dismissHint: {
    ...TYPOGRAPHY.caption,
    color: MONO[500],
    marginTop: SPACING.lg,
  },
});

export default ResultReveal;
