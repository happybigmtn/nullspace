/**
 * Casino-themed skeleton loaders for game screens (US-115)
 *
 * Premium skeleton components that match the shapes of cards, chips, and table elements.
 * Used during InteractionManager.runAfterInteractions to provide visual feedback.
 *
 * Features:
 * - Card skeleton with rounded corners matching Card.tsx dimensions
 * - Chip skeleton matching ChipSelector dimensions
 * - Table area skeleton for betting zones
 * - Composite skeletons for common game layouts (BlackjackSkeleton, etc.)
 * - Progressive reveal animation when content loads
 * - Game-specific colors via GAME_COLORS
 */
import React from 'react';
import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { COLORS, RADIUS, SPACING, GAME_COLORS } from '../../constants/theme';

/* ─────────────────────────────────────────────────────────────────────────────
 * Core Shimmer Animation Hook
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * Custom hook for skeleton shimmer animation
 * Returns animated style for the traveling highlight effect
 */
function useSkeletonShimmer(duration: number = 1500) {
  const shimmerOffset = useSharedValue(-1);

  React.useEffect(() => {
    shimmerOffset.value = withRepeat(
      withTiming(2, { duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      false
    );
  }, [shimmerOffset, duration]);

  const shimmerStyle = useAnimatedStyle(() => {
    const translateXPercent = interpolate(
      shimmerOffset.value,
      [-1, 2],
      [-100, 200],
      Extrapolation.CLAMP
    );

    return {
      transform: [{ translateX: `${translateXPercent}%` as unknown as number }],
    };
  });

  return shimmerStyle;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Shimmer Highlight Component
 * ───────────────────────────────────────────────────────────────────────────── */

interface ShimmerHighlightProps {
  duration?: number;
}

function ShimmerHighlight({ duration = 1500 }: ShimmerHighlightProps) {
  const shimmerStyle = useSkeletonShimmer(duration);

  return (
    <Animated.View
      style={[styles.shimmerHighlight, shimmerStyle]}
      pointerEvents="none"
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Card Skeleton
 * ───────────────────────────────────────────────────────────────────────────── */

interface CardSkeletonProps {
  /** Card size matching Card.tsx */
  size?: 'small' | 'normal' | 'large';
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Skeleton for playing cards
 * Matches the dimensions and border radius from Card.tsx
 */
export function CardSkeleton({ size = 'normal', style }: CardSkeletonProps) {
  const dimensions = CARD_SIZES[size];

  return (
    <View
      style={[
        styles.cardSkeleton,
        { width: dimensions.width, height: dimensions.height },
        style,
      ]}
    >
      <ShimmerHighlight />
    </View>
  );
}

const CARD_SIZES = {
  small: { width: 56, height: 84 },
  normal: { width: 80, height: 120 },
  large: { width: 100, height: 150 },
} as const;

/* ─────────────────────────────────────────────────────────────────────────────
 * Chip Skeleton
 * ───────────────────────────────────────────────────────────────────────────── */

interface ChipSkeletonProps {
  /** Chip size (diameter) */
  size?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Skeleton for casino chips
 * Circular shape matching ChipSelector chip dimensions
 */
export function ChipSkeleton({ size = 48, style }: ChipSkeletonProps) {
  return (
    <View
      style={[
        styles.chipSkeleton,
        { width: size, height: size, borderRadius: size / 2 },
        style,
      ]}
    >
      <ShimmerHighlight duration={1200} />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Table Area Skeleton
 * ───────────────────────────────────────────────────────────────────────────── */

interface TableAreaSkeletonProps {
  /** Width of the table area */
  width?: number | `${number}%`;
  /** Height of the table area */
  height?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Skeleton for table betting areas
 * Rounded rectangle representing felt surfaces
 */
export function TableAreaSkeleton({
  width = '100%',
  height = 80,
  style,
}: TableAreaSkeletonProps) {
  return (
    <View style={[styles.tableAreaSkeleton, { width, height }, style]}>
      <ShimmerHighlight duration={1800} />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Hand Skeleton (row of cards)
 * ───────────────────────────────────────────────────────────────────────────── */

interface HandSkeletonProps {
  /** Number of cards in the hand */
  cardCount?: number;
  /** Card size */
  cardSize?: 'small' | 'normal' | 'large';
  /** Overlap between cards (negative margin) */
  overlap?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Skeleton for a hand of cards (overlapping card row)
 * Used for dealer/player hands in card games
 */
export function HandSkeleton({
  cardCount = 2,
  cardSize = 'normal',
  overlap = 40,
  style,
}: HandSkeletonProps) {
  return (
    <View style={[styles.handSkeleton, style]}>
      {Array.from({ length: cardCount }, (_, i) => (
        <CardSkeleton
          key={i}
          size={cardSize}
          style={{ marginLeft: i > 0 ? -overlap : 0 }}
        />
      ))}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Chip Row Skeleton
 * ───────────────────────────────────────────────────────────────────────────── */

interface ChipRowSkeletonProps {
  /** Number of chips */
  chipCount?: number;
  /** Chip size */
  chipSize?: number;
  /** Gap between chips */
  gap?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Skeleton for a row of chips (chip selector)
 */
export function ChipRowSkeleton({
  chipCount = 5,
  chipSize = 48,
  gap = SPACING.sm,
  style,
}: ChipRowSkeletonProps) {
  return (
    <View style={[styles.chipRowSkeleton, { gap }, style]}>
      {Array.from({ length: chipCount }, (_, i) => (
        <ChipSkeleton key={i} size={chipSize} />
      ))}
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Text Line Skeleton
 * ───────────────────────────────────────────────────────────────────────────── */

interface TextSkeletonProps {
  /** Width of the text line */
  width?: number | `${number}%`;
  /** Height of the text line */
  height?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Skeleton for text labels (hand labels, messages, bet amounts)
 */
export function TextSkeleton({
  width = 80,
  height = 16,
  style,
}: TextSkeletonProps) {
  return (
    <View style={[styles.textSkeleton, { width, height }, style]}>
      <ShimmerHighlight />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Button Skeleton
 * ───────────────────────────────────────────────────────────────────────────── */

interface ButtonSkeletonProps {
  /** Button width */
  width?: number;
  /** Button height */
  height?: number;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Skeleton for action buttons
 */
export function ButtonSkeleton({
  width = 120,
  height = 48,
  style,
}: ButtonSkeletonProps) {
  return (
    <View style={[styles.buttonSkeleton, { width, height }, style]}>
      <ShimmerHighlight duration={1400} />
    </View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Game-Specific Composite Skeletons
 * ───────────────────────────────────────────────────────────────────────────── */

interface GameSkeletonProps {
  /** Game-specific accent color (from GAME_COLORS) */
  accentColor?: string;
  /** Additional styles */
  style?: StyleProp<ViewStyle>;
}

/**
 * Blackjack/Card game skeleton
 * Shows dealer hand, player hand, bet area, and action buttons
 */
export function BlackjackSkeleton({ style }: GameSkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.gameSkeletonContainer, style]}
    >
      {/* Dealer area */}
      <View style={styles.handArea}>
        <TextSkeleton width={60} height={12} style={styles.labelSkeleton} />
        <HandSkeleton cardCount={2} />
      </View>

      {/* Message area */}
      <TextSkeleton width={150} height={24} style={styles.messageSkeleton} />

      {/* Player area */}
      <View style={styles.handArea}>
        <TextSkeleton width={80} height={12} style={styles.labelSkeleton} />
        <HandSkeleton cardCount={2} />
      </View>

      {/* Bet display */}
      <View style={styles.betArea}>
        <TextSkeleton width={30} height={12} />
        <TextSkeleton width={60} height={24} />
      </View>

      {/* Action buttons */}
      <View style={styles.actionsArea}>
        <ButtonSkeleton width={140} height={52} />
      </View>

      {/* Chip selector */}
      <ChipRowSkeleton />
    </Animated.View>
  );
}

/**
 * HiLo/Simple card game skeleton
 * Shows single card in center with action buttons
 */
export function HiLoSkeleton({ style }: GameSkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.gameSkeletonContainer, styles.centeredSkeleton, style]}
    >
      {/* Central card */}
      <CardSkeleton size="large" />

      {/* Message */}
      <TextSkeleton width={120} height={24} style={styles.messageSkeleton} />

      {/* Actions */}
      <View style={styles.actionsRow}>
        <ButtonSkeleton width={100} height={48} />
        <ButtonSkeleton width={100} height={48} />
      </View>

      {/* Chips */}
      <ChipRowSkeleton />
    </Animated.View>
  );
}

/**
 * Roulette skeleton
 * Shows wheel representation, bet grid, and chips
 */
export function RouletteSkeleton({ style }: GameSkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.gameSkeletonContainer, style]}
    >
      {/* Wheel area */}
      <View style={styles.wheelArea}>
        <ChipSkeleton size={120} />
      </View>

      {/* Bet grid */}
      <TableAreaSkeleton height={200} />

      {/* Chips */}
      <ChipRowSkeleton />
    </Animated.View>
  );
}

/**
 * Video Poker skeleton
 * Shows 5 cards in a row with action buttons
 */
export function VideoPokerSkeleton({ style }: GameSkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.gameSkeletonContainer, styles.centeredSkeleton, style]}
    >
      {/* 5 cards */}
      <View style={styles.pokerHandRow}>
        {Array.from({ length: 5 }, (_, i) => (
          <CardSkeleton key={i} size="small" />
        ))}
      </View>

      {/* Message */}
      <TextSkeleton width={180} height={24} style={styles.messageSkeleton} />

      {/* Action */}
      <ButtonSkeleton width={140} height={52} />

      {/* Chips */}
      <ChipRowSkeleton />
    </Animated.View>
  );
}

/**
 * Craps/Dice game skeleton
 * Shows dice area, bet grid, and chips
 */
export function CrapsSkeleton({ style }: GameSkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.gameSkeletonContainer, style]}
    >
      {/* Dice area */}
      <View style={styles.diceArea}>
        <View style={styles.diceSkeleton}>
          <ShimmerHighlight />
        </View>
        <View style={styles.diceSkeleton}>
          <ShimmerHighlight />
        </View>
      </View>

      {/* Bet table */}
      <TableAreaSkeleton height={180} />

      {/* Action */}
      <View style={styles.actionsArea}>
        <ButtonSkeleton width={140} height={52} />
      </View>

      {/* Chips */}
      <ChipRowSkeleton />
    </Animated.View>
  );
}

/**
 * Sic Bo skeleton
 * Shows dice and bet grid
 */
export function SicBoSkeleton({ style }: GameSkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.gameSkeletonContainer, style]}
    >
      {/* Three dice */}
      <View style={styles.diceArea}>
        <View style={styles.diceSkeleton}>
          <ShimmerHighlight />
        </View>
        <View style={styles.diceSkeleton}>
          <ShimmerHighlight />
        </View>
        <View style={styles.diceSkeleton}>
          <ShimmerHighlight />
        </View>
      </View>

      {/* Bet table */}
      <TableAreaSkeleton height={200} />

      {/* Chips */}
      <ChipRowSkeleton />
    </Animated.View>
  );
}

/**
 * Baccarat skeleton
 * Shows player/banker hands with tie area
 */
export function BaccaratSkeleton({ style }: GameSkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.gameSkeletonContainer, style]}
    >
      {/* Player hand */}
      <View style={styles.handArea}>
        <TextSkeleton width={60} height={12} style={styles.labelSkeleton} />
        <HandSkeleton cardCount={2} />
      </View>

      {/* Message */}
      <TextSkeleton width={120} height={24} style={styles.messageSkeleton} />

      {/* Banker hand */}
      <View style={styles.handArea}>
        <TextSkeleton width={60} height={12} style={styles.labelSkeleton} />
        <HandSkeleton cardCount={2} />
      </View>

      {/* Bet areas */}
      <View style={styles.baccaratBetAreas}>
        <TableAreaSkeleton width={100} height={60} />
        <TableAreaSkeleton width={80} height={60} />
        <TableAreaSkeleton width={100} height={60} />
      </View>

      {/* Chips */}
      <ChipRowSkeleton />
    </Animated.View>
  );
}

/**
 * Generic game skeleton for games without a specific layout
 */
export function GenericGameSkeleton({ style }: GameSkeletonProps) {
  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={[styles.gameSkeletonContainer, styles.centeredSkeleton, style]}
    >
      {/* Central area */}
      <TableAreaSkeleton width="80%" height={150} />

      {/* Message */}
      <TextSkeleton width={150} height={24} style={styles.messageSkeleton} />

      {/* Action */}
      <ButtonSkeleton width={140} height={52} />

      {/* Chips */}
      <ChipRowSkeleton />
    </Animated.View>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Skeleton Loader Wrapper
 * ───────────────────────────────────────────────────────────────────────────── */

type GameType =
  | 'blackjack'
  | 'hi_lo'
  | 'roulette'
  | 'video_poker'
  | 'craps'
  | 'sic_bo'
  | 'baccarat'
  | 'casino_war'
  | 'three_card_poker'
  | 'ultimate_texas_holdem';

interface GameSkeletonLoaderProps {
  /** Game type to determine which skeleton to show */
  gameType: GameType;
  /** Whether skeleton is visible */
  isLoading: boolean;
  /** Game-specific accent color (optional, defaults to GAME_COLORS) */
  accentColor?: string;
  /** Children to render when not loading */
  children: React.ReactNode;
}

/**
 * Skeleton loader wrapper that shows appropriate skeleton based on game type
 *
 * @example
 * <GameSkeletonLoader gameType="blackjack" isLoading={!isReady}>
 *   <BlackjackGameContent />
 * </GameSkeletonLoader>
 */
export function GameSkeletonLoader({
  gameType,
  isLoading,
  accentColor,
  children,
}: GameSkeletonLoaderProps) {
  const color = accentColor ?? GAME_COLORS[gameType] ?? COLORS.primary;

  if (!isLoading) {
    return (
      <Animated.View
        entering={FadeIn.duration(300)}
        style={styles.contentWrapper}
      >
        {children}
      </Animated.View>
    );
  }

  const SkeletonComponent = getSkeletonForGame(gameType);
  return <SkeletonComponent accentColor={color} />;
}

function getSkeletonForGame(gameType: GameType) {
  switch (gameType) {
    case 'blackjack':
    case 'casino_war':
    case 'three_card_poker':
    case 'ultimate_texas_holdem':
      return BlackjackSkeleton;
    case 'hi_lo':
      return HiLoSkeleton;
    case 'roulette':
      return RouletteSkeleton;
    case 'video_poker':
      return VideoPokerSkeleton;
    case 'craps':
      return CrapsSkeleton;
    case 'sic_bo':
      return SicBoSkeleton;
    case 'baccarat':
      return BaccaratSkeleton;
    default:
      return GenericGameSkeleton;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Styles
 * ───────────────────────────────────────────────────────────────────────────── */

const SKELETON_BG = COLORS.border;
const SKELETON_SHIMMER = 'rgba(255, 255, 255, 0.3)';

const styles = StyleSheet.create({
  // Shimmer highlight
  shimmerHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: '50%',
    backgroundColor: SKELETON_SHIMMER,
    transform: [{ skewX: '-20deg' }],
  },

  // Card skeleton
  cardSkeleton: {
    backgroundColor: SKELETON_BG,
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },

  // Chip skeleton
  chipSkeleton: {
    backgroundColor: SKELETON_BG,
    overflow: 'hidden',
  },

  // Table area skeleton
  tableAreaSkeleton: {
    backgroundColor: SKELETON_BG,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },

  // Hand skeleton (row of cards)
  handSkeleton: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  // Chip row skeleton
  chipRowSkeleton: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
  },

  // Text skeleton
  textSkeleton: {
    backgroundColor: SKELETON_BG,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },

  // Button skeleton
  buttonSkeleton: {
    backgroundColor: SKELETON_BG,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },

  // Game skeleton container
  gameSkeletonContainer: {
    flex: 1,
    justifyContent: 'space-around',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.lg,
  },

  centeredSkeleton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xl,
  },

  // Hand area (label + cards)
  handArea: {
    alignItems: 'center',
  },

  labelSkeleton: {
    marginBottom: SPACING.sm,
  },

  messageSkeleton: {
    alignSelf: 'center',
    marginVertical: SPACING.md,
  },

  betArea: {
    alignItems: 'center',
    gap: SPACING.xs,
  },

  actionsArea: {
    alignItems: 'center',
    marginVertical: SPACING.md,
  },

  actionsRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },

  // Roulette wheel area
  wheelArea: {
    alignItems: 'center',
    marginVertical: SPACING.lg,
  },

  // Video poker hand row
  pokerHandRow: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },

  // Dice area
  diceArea: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    marginVertical: SPACING.lg,
  },

  diceSkeleton: {
    width: 48,
    height: 48,
    backgroundColor: SKELETON_BG,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },

  // Baccarat bet areas
  baccaratBetAreas: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginVertical: SPACING.md,
  },

  // Content wrapper for fade-in
  contentWrapper: {
    flex: 1,
  },
});
