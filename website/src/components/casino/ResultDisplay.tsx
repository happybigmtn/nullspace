/**
 * ResultDisplay - Animated game result reveal with morphing transitions
 *
 * DS-055: Game result morph animations
 *
 * Creates smooth transition from betting UI to result display:
 * 1. Overlay fades in with glassmorphism blur
 * 2. Outcome text scales and fades in
 * 3. Payout amount animates up (count-up effect)
 * 4. Color shifts based on win/loss
 * 5. Session delta reveals last
 *
 * Different choreography for win/loss/push outcomes.
 * Uses spring physics for natural settling motion.
 */
import React, { useEffect, useCallback } from 'react';
import { animated, useSpring, useTransition, config, to } from '@react-spring/web';
import { createPortal } from 'react-dom';
import { AnimatedNumber, CountUp } from '../ui/AnimatedNumber';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { SPRING_LIQUID_CONFIGS } from '../../utils/motion';

// Simple className joiner
const cn = (...args: (string | boolean | undefined | null)[]) =>
  args.filter(Boolean).join(' ');

// Instant config for reduced motion
const INSTANT_CONFIG = { duration: 0 };

/** Result outcome type */
export type ResultOutcome = 'win' | 'loss' | 'push' | 'blackjack' | 'jackpot' | 'war';

/** Celebration intensity level */
export type CelebrationIntensity = 'small' | 'medium' | 'big' | 'jackpot';

/** Payout breakdown item for complex wins */
export interface PayoutBreakdownItem {
  label: string;
  amount: number;
}

export interface ResultDisplayProps {
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
  /** Z-index for portal rendering */
  zIndex?: number;
}

/** Animation timing constants (ms) */
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

/** Outcome-specific colors - US-261: Monochrome palette */
const OUTCOME_COLORS: Record<ResultOutcome, { primary: string; glow: string; bg: string }> = {
  win: {
    primary: '#000000', // mono-0 (high contrast black for wins)
    glow: '#FFFFFF',    // white glow on dark, inverts on light mode
    bg: 'rgba(0, 0, 0, 0.08)',
  },
  blackjack: {
    primary: '#000000', // mono-0 (premium win)
    glow: '#FFFFFF',
    bg: 'rgba(0, 0, 0, 0.12)',
  },
  jackpot: {
    primary: '#000000', // mono-0 (jackpot)
    glow: '#FFFFFF',
    bg: 'rgba(0, 0, 0, 0.15)',
  },
  loss: {
    primary: '#525252', // mono-400 (muted for losses)
    glow: '#737373',
    bg: 'rgba(0, 0, 0, 0.04)',
  },
  push: {
    primary: '#737373', // mono-500 (neutral)
    glow: '#A3A3A3',
    bg: 'rgba(0, 0, 0, 0.06)',
  },
  war: {
    primary: '#404040', // mono-300 (escalation state)
    glow: '#525252',
    bg: 'rgba(0, 0, 0, 0.06)',
  },
};

/**
 * Animated reveal element with scale + fade + translateY
 */
function RevealElement({
  children,
  delay,
  isVisible,
  className,
}: {
  children: React.ReactNode;
  delay: number;
  isVisible: boolean;
  className?: string;
}) {
  const prefersReducedMotion = useReducedMotion();

  const spring = useSpring({
    opacity: isVisible ? 1 : 0,
    y: isVisible ? 0 : 20,
    scale: isVisible ? 1 : 0.9,
    delay: isVisible ? delay : 0,
    config: prefersReducedMotion
      ? INSTANT_CONFIG
      : SPRING_LIQUID_CONFIGS?.liquidFloat ?? config.gentle,
  });

  return (
    <animated.div
      className={className}
      style={{
        opacity: spring.opacity,
        transform: to(
          [spring.y, spring.scale],
          (y, scale) => `translateY(${y}px) scale(${scale})`
        ),
      }}
    >
      {children}
    </animated.div>
  );
}

/**
 * Pulsing glow effect for wins
 */
function GlowPulse({
  color,
  intensity,
  isActive,
}: {
  color: string;
  intensity: CelebrationIntensity;
  isActive: boolean;
}) {
  const prefersReducedMotion = useReducedMotion();

  const pulseIntensity =
    intensity === 'jackpot' ? 0.8 : intensity === 'big' ? 0.6 : 0.4;

  const spring = useSpring({
    glowOpacity: isActive && !prefersReducedMotion ? pulseIntensity : 0,
    glowSize: isActive && !prefersReducedMotion ? 30 : 10,
    config: { duration: TIMING.glowPulse / 2 },
    loop: isActive && !prefersReducedMotion,
  });

  if (!isActive || prefersReducedMotion) return null;

  return (
    <animated.div
      className="absolute inset-0 rounded-2xl pointer-events-none"
      style={{
        boxShadow: to(
          [spring.glowOpacity, spring.glowSize],
          (o, size) => `0 0 ${size}px ${color}${Math.round(o * 255).toString(16).padStart(2, '0')}`
        ),
      }}
    />
  );
}

/**
 * ResultDisplay component - orchestrates the staged result reveal
 */
export function ResultDisplay({
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
  zIndex = 9999,
}: ResultDisplayProps) {
  const prefersReducedMotion = useReducedMotion();
  const colors = OUTCOME_COLORS[outcome];
  const isWin = outcome === 'win' || outcome === 'blackjack' || outcome === 'jackpot';
  const isLoss = outcome === 'loss';

  // Overlay fade animation
  const overlaySpring = useSpring({
    opacity: isVisible ? 1 : 0,
    blur: isVisible ? 8 : 0,
    config: prefersReducedMotion ? INSTANT_CONFIG : { tension: 200, friction: 20 },
  });

  // Card scale animation
  const cardSpring = useSpring({
    scale: isVisible ? 1 : 0.95,
    y: isVisible ? 0 : 20,
    delay: isVisible ? TIMING.overlayFade / 2 : 0,
    config: prefersReducedMotion
      ? INSTANT_CONFIG
      : SPRING_LIQUID_CONFIGS?.liquidSettle ?? config.gentle,
  });

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

  // Handle click to dismiss
  const handleDismiss = useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

  // Handle escape key
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, handleDismiss]);

  if (!isVisible) return null;

  const showBreakdown = breakdown && breakdown.length > 0;
  const showSessionDelta = sessionDelta !== undefined && sessionDelta !== 0;

  return createPortal(
    <animated.div
      className="fixed inset-0"
      style={{
        zIndex,
        opacity: overlaySpring.opacity,
        pointerEvents: isVisible ? 'auto' : 'none',
      }}
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-message"
    >
      {/* Backdrop with blur */}
      <animated.div
        className="absolute inset-0 bg-black/60"
        style={{
          backdropFilter: overlaySpring.blur.to((b) => `blur(${b}px)`),
          WebkitBackdropFilter: overlaySpring.blur.to((b) => `blur(${b}px)`),
        }}
      />

      {/* Color overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ backgroundColor: colors.bg }}
      />

      {/* Content */}
      <div className="flex items-center justify-center h-full p-4">
        <animated.div
          className="relative bg-titanium-900/95 rounded-2xl p-8 min-w-[300px] max-w-md border border-titanium-700/50 shadow-2xl"
          style={{
            transform: to(
              [cardSpring.scale, cardSpring.y],
              (s, y) => `scale(${s}) translateY(${y}px)`
            ),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Glow effect for wins */}
          <GlowPulse color={colors.glow} intensity={intensity} isActive={isWin} />

          {/* Outcome message */}
          <RevealElement delay={TIMING.outcomeDelay} isVisible={isVisible}>
            <h2
              id="result-message"
              className="text-3xl font-bold text-center mb-4"
              style={{ color: colors.primary }}
            >
              {message}
            </h2>
          </RevealElement>

          {/* Payout amount */}
          <RevealElement
            delay={TIMING.payoutDelay}
            isVisible={isVisible}
            className="text-center mb-4"
          >
            <p className="text-titanium-400 text-sm uppercase tracking-wider mb-1">
              {isLoss ? 'Lost' : isWin ? 'Won' : 'Returned'}
            </p>
            <div
              className={cn(
                'text-5xl font-bold tabular-nums',
                payout > 0 && 'text-mono-0 dark:text-mono-1000 font-black',
                payout < 0 && 'text-mono-400 dark:text-mono-500',
                payout === 0 && 'text-titanium-300'
              )}
            >
              {payout >= 0 ? '+' : ''}
              <CountUp
                to={Math.abs(payout)}
                delay={TIMING.payoutDelay}
                prefix="$"
                formatOptions={{ maximumFractionDigits: 0 }}
              />
            </div>
            {bet > 0 && payout > 0 && (
              <p className="text-titanium-500 text-sm mt-1">
                {((payout / bet) + 1).toFixed(1)}x return
              </p>
            )}
          </RevealElement>

          {/* Breakdown for complex wins */}
          {showBreakdown && (
            <div className="border-t border-titanium-700/50 pt-4 mt-4">
              {breakdown.map((item, index) => (
                <RevealElement
                  key={item.label}
                  delay={TIMING.payoutDelay + (index + 1) * TIMING.breakdownStagger}
                  isVisible={isVisible}
                  className="flex justify-between py-1"
                >
                  <span className="text-titanium-400">{item.label}</span>
                  <span
                    className={cn(
                      'font-medium tabular-nums',
                      item.amount >= 0 ? 'text-mono-0 dark:text-mono-1000 font-black' : 'text-mono-400 dark:text-mono-500'
                    )}
                  >
                    {item.amount >= 0 ? '+' : ''}${Math.abs(item.amount).toLocaleString()}
                  </span>
                </RevealElement>
              ))}
            </div>
          )}

          {/* Session delta */}
          {showSessionDelta && (
            <RevealElement
              delay={TIMING.deltaDelay}
              isVisible={isVisible}
              className="border-t border-titanium-700/30 pt-4 mt-4 text-center"
            >
              <p className="text-titanium-500 text-xs uppercase tracking-wider mb-1">
                Session
              </p>
              <p
                className={cn(
                  'text-xl font-semibold tabular-nums',
                  sessionDelta > 0 && 'text-mono-0 dark:text-mono-1000 font-black',
                  sessionDelta < 0 && 'text-mono-400 dark:text-mono-500',
                  sessionDelta === 0 && 'text-titanium-300'
                )}
              >
                {sessionDelta >= 0 ? '+' : ''}${Math.abs(sessionDelta).toLocaleString()}
              </p>
            </RevealElement>
          )}

          {/* Dismiss hint */}
          <RevealElement
            delay={TIMING.deltaDelay + 200}
            isVisible={isVisible}
            className="text-center mt-6"
          >
            <p className="text-titanium-500 text-xs">
              Click or press any key to continue
            </p>
          </RevealElement>
        </animated.div>
      </div>
    </animated.div>,
    document.body
  );
}

/**
 * Hook for managing result display state in game components
 *
 * @example
 * ```tsx
 * const result = useResultDisplay();
 *
 * // Show result when game ends
 * useEffect(() => {
 *   if (gameState.phase === 'result') {
 *     result.show({
 *       outcome: gameState.didWin ? 'win' : 'loss',
 *       message: gameState.didWin ? 'You Win!' : 'Dealer Wins',
 *       payout: gameState.payout,
 *       bet: gameState.bet,
 *     });
 *   }
 * }, [gameState.phase]);
 *
 * // Render
 * <ResultDisplay {...result.props} onDismiss={result.hide} />
 * ```
 */
export interface UseResultDisplayOptions {
  onShow?: () => void;
  onHide?: () => void;
}

export function useResultDisplay(options?: UseResultDisplayOptions) {
  const [state, setState] = React.useState<{
    isVisible: boolean;
    outcome: ResultOutcome;
    message: string;
    payout: number;
    bet: number;
    breakdown?: PayoutBreakdownItem[];
    sessionDelta?: number;
    intensity?: CelebrationIntensity;
  }>({
    isVisible: false,
    outcome: 'win',
    message: '',
    payout: 0,
    bet: 0,
  });

  const show = useCallback(
    (params: Omit<typeof state, 'isVisible'>) => {
      setState({ ...params, isVisible: true });
      options?.onShow?.();
    },
    [options]
  );

  const hide = useCallback(() => {
    setState((s) => ({ ...s, isVisible: false }));
    options?.onHide?.();
  }, [options]);

  return {
    show,
    hide,
    props: state,
  };
}

export default ResultDisplay;
