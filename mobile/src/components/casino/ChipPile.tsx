/**
 * ChipPile - Animated chip stack visualization for betting areas (US-122)
 *
 * Features:
 * - 3D rotation animation when chips fly to betting area
 * - Random rotation offsets (0-15°) per chip for natural pile look
 * - Stack height grows with pile, bottom chips compress
 * - Live cumulative bet counter with animated updates
 * - Color-coded chip trails during flight animation
 *
 * DS-044: Enhanced chip toss physics
 * - Parabolic arc trajectory (gravity simulation)
 * - 3D tumble effect (rotateX + rotateY during flight)
 * - Scatter landing near existing chips
 * - SPRING.chipSettle for natural bounce on land
 */
import React, { useEffect, useMemo, useCallback } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withDelay,
  Easing,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { COLORS, SPACING, TYPOGRAPHY, SPRING } from '../../constants/theme';
import type { ChipValue } from '../../types';

/**
 * Premium chip color palette (matches ChipSelector)
 */
const CHIP_COLORS: Record<ChipValue, {
  base: string;
  edge: string;
  highlight: string;
  trail: string;
}> = {
  1: {
    base: '#F5F5F5',
    edge: '#E8E8E8',
    highlight: '#FFFFFF',
    trail: 'rgba(245, 245, 245, 0.6)',
  },
  5: {
    base: '#EF4444',
    edge: '#DC2626',
    highlight: '#F87171',
    trail: 'rgba(239, 68, 68, 0.6)',
  },
  25: {
    base: '#22C55E',
    edge: '#16A34A',
    highlight: '#4ADE80',
    trail: 'rgba(34, 197, 94, 0.6)',
  },
  100: {
    base: '#1F1F1F',
    edge: '#333333',
    highlight: '#404040',
    trail: 'rgba(31, 31, 31, 0.6)',
  },
  500: {
    base: '#8B5CF6',
    edge: '#7C3AED',
    highlight: '#A78BFA',
    trail: 'rgba(139, 92, 246, 0.6)',
  },
  1000: {
    base: '#FFCC00',
    edge: '#D4A500',
    highlight: '#FFE066',
    trail: 'rgba(255, 204, 0, 0.6)',
  },
};

/** Chip stack visual offset */
const CHIP_THICKNESS = 4;
const CHIP_SIZE = 40;
const MAX_VISIBLE_CHIPS = 10;
const COMPRESSION_FACTOR = 0.7; // Bottom chips compress to 70% height

interface PlacedChip {
  /** Unique identifier for animation tracking */
  id: string;
  /** Chip value */
  value: ChipValue;
  /** Random rotation angle (-15 to 15 degrees) */
  rotation: number;
  /** Time of placement for animation sequencing */
  placedAt: number;
  /**
   * DS-044: Scatter offset for landing position
   * Chips land slightly offset from center for natural pile look
   */
  scatterX?: number;
  scatterY?: number;
}

interface StackedChipProps {
  chip: PlacedChip;
  index: number;
  totalChips: number;
  isNew: boolean;
  /** DS-054: Callback for liquid ripple trigger on landing */
  onLand?: (chipValue: ChipValue) => void;
}

/**
 * DS-044: Parabolic arc constants for chip toss physics
 * Simulates gravity pulling chip down during flight
 */
const ARC_HEIGHT = 40; // Peak height of parabolic arc (px)
const FLIGHT_DURATION = 280; // Total flight time (ms)
const TUMBLE_ROTATIONS = 1.5; // Number of 360° rotations during flight

/**
 * Single chip in the pile with flight and stacking animation
 *
 * DS-044: Enhanced with parabolic arc trajectory and 3D tumble
 */
const StackedChip = React.memo(function StackedChip({
  chip,
  index,
  totalChips,
  isNew,
  onLand,
}: StackedChipProps) {
  const colors = CHIP_COLORS[chip.value];

  // DS-044: Scatter offset for natural pile landing
  const scatterX = chip.scatterX ?? 0;
  const scatterY = chip.scatterY ?? 0;

  // Animation values
  const translateY = useSharedValue(isNew ? -100 : scatterY);
  const translateX = useSharedValue(isNew ? 30 : scatterX);
  const scale = useSharedValue(isNew ? 0.5 : 1);
  // DS-044: Enhanced 3D tumble - both X and Y rotation during flight
  const rotateX = useSharedValue(isNew ? 45 : 0); // Forward/back tilt
  const rotateY = useSharedValue(isNew ? 0 : 0);  // Side-to-side tumble
  const rotateZ = useSharedValue(chip.rotation);  // Flat spin
  const opacity = useSharedValue(isNew ? 0 : 1);
  const trailOpacity = useSharedValue(isNew ? 1 : 0);
  // DS-044: Arc height for parabolic trajectory
  const arcOffset = useSharedValue(isNew ? 0 : 0);

  // Calculate compression based on position in stack
  // Bottom chips compress more, top chips stay full size
  const compressionRatio = useMemo((): number => {
    if (totalChips <= 3) return 1;
    const positionFromBottom = index;
    const maxCompression = Math.min(totalChips - 1, 5);
    if (positionFromBottom >= maxCompression) return 1;
    return COMPRESSION_FACTOR + (1 - COMPRESSION_FACTOR) * (positionFromBottom / maxCompression);
  }, [index, totalChips]);

  // Calculate stack offset - chips pile up with compression
  const stackOffset = useMemo(() => {
    let offset = 0;
    for (let i = 0; i < index; i++) {
      const iCompressionRatio = totalChips <= 3 ? 1 :
        i >= Math.min(totalChips - 1, 5) ? 1 :
        COMPRESSION_FACTOR + (1 - COMPRESSION_FACTOR) * (i / Math.min(totalChips - 1, 5));
      offset += CHIP_THICKNESS * iCompressionRatio;
    }
    return offset;
  }, [index, totalChips]);

  const triggerLandingHaptic = useCallback(() => {
    haptics.chipPlace();
    // DS-054: Trigger liquid ripple effect on chip landing
    if (onLand) {
      onLand(chip.value);
    }
  }, [onLand, chip.value]);

  /**
   * DS-044: Enhanced chip toss animation
   * - Parabolic arc trajectory (rise then fall)
   * - 3D tumble effect (rotateX + rotateY)
   * - Scatter landing near existing chips
   * - Spring physics settle on land
   */
  useEffect(() => {
    if (!isNew) return;

    // DS-044: Parabolic arc - chip rises to peak then falls
    // Uses sin curve to simulate arc: 0 -> ARC_HEIGHT -> 0
    arcOffset.value = withSequence(
      withTiming(-ARC_HEIGHT, {
        duration: FLIGHT_DURATION * 0.4, // Rise phase
        easing: Easing.out(Easing.ease),
      }),
      withTiming(0, {
        duration: FLIGHT_DURATION * 0.6, // Fall phase (gravity acceleration)
        easing: Easing.in(Easing.quad),
      })
    );

    // Horizontal translation with scatter offset landing
    translateX.value = withSequence(
      withTiming(15, { duration: FLIGHT_DURATION * 0.5 }),
      withSpring(scatterX, SPRING.chipSettle)
    );

    // Vertical translation (main trajectory)
    translateY.value = withSequence(
      withTiming(-60, { duration: FLIGHT_DURATION * 0.4, easing: Easing.out(Easing.ease) }),
      withSpring(scatterY, SPRING.chipToss)
    );

    // Scale: grow during flight, bounce on land
    scale.value = withSequence(
      withTiming(1.1, { duration: FLIGHT_DURATION * 0.5 }),
      withSpring(1, SPRING.chipSettle)
    );

    // DS-044: 3D tumble - forward/back rotation (rotateX)
    rotateX.value = withSequence(
      withTiming(TUMBLE_ROTATIONS * 180, { duration: FLIGHT_DURATION, easing: Easing.out(Easing.ease) }),
      withSpring(0, { ...SPRING.chipSettle, damping: 15 })
    );

    // DS-044: 3D tumble - side-to-side rotation (rotateY)
    // Random direction based on chip rotation sign
    const tumbleDirection = chip.rotation >= 0 ? 1 : -1;
    rotateY.value = withSequence(
      withTiming(tumbleDirection * TUMBLE_ROTATIONS * 120, { duration: FLIGHT_DURATION, easing: Easing.out(Easing.ease) }),
      withSpring(0, { ...SPRING.chipSettle, damping: 18 })
    );

    // Fade in quickly
    opacity.value = withTiming(1, { duration: 100 });

    // Fade out trail during flight
    trailOpacity.value = withSequence(
      withDelay(50, withTiming(0.8, { duration: 100 })),
      withTiming(0, { duration: 200 })
    );

    // Trigger haptic on landing
    const timeoutId = setTimeout(() => {
      runOnJS(triggerLandingHaptic)();
    }, FLIGHT_DURATION);

    return () => clearTimeout(timeoutId);
  }, [isNew, translateY, translateX, scale, rotateX, rotateY, arcOffset, opacity, trailOpacity, triggerLandingHaptic, scatterX, scatterY, chip.rotation]);

  /**
   * DS-044: Animated style with parabolic arc and 3D tumble
   * - arcOffset adds vertical displacement for parabolic trajectory
   * - rotateX + rotateY create 3D tumble effect
   */
  const animatedChipStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      // DS-044: Arc offset adds parabolic "bump" to trajectory
      { translateY: translateY.value - stackOffset + arcOffset.value },
      { scale: scale.value * compressionRatio },
      { perspective: 500 },
      { rotateX: `${rotateX.value}deg` },
      { rotateY: `${rotateY.value}deg` }, // DS-044: Side tumble
      { rotateZ: `${rotateZ.value}deg` },
    ],
    opacity: opacity.value,
    zIndex: index + 1,
  }));

  const animatedTrailStyle = useAnimatedStyle(() => ({
    opacity: trailOpacity.value,
    transform: [
      { translateX: interpolate(translateX.value, [0, 30], [0, 15], Extrapolation.CLAMP) },
      { translateY: interpolate(translateY.value, [-100, 0], [-50, -stackOffset], Extrapolation.CLAMP) - stackOffset },
    ],
  }));

  return (
    <>
      {/* Color-coded trail during flight */}
      <Animated.View
        style={[
          styles.chipTrail,
          { backgroundColor: colors.trail },
          animatedTrailStyle,
        ]}
        pointerEvents="none"
      />

      {/* Chip */}
      <Animated.View
        style={[
          styles.stackedChip,
          {
            backgroundColor: colors.base,
            borderColor: colors.edge,
          },
          animatedChipStyle,
        ]}
      >
        {/* Dome highlight */}
        <View
          style={[styles.chipHighlight, { backgroundColor: colors.highlight }]}
          pointerEvents="none"
        />
        {/* Shadow for depth */}
        <View style={styles.chipShadow} pointerEvents="none" />
        {/* Value text */}
        <Text style={[
          styles.chipValue,
          { color: chip.value === 100 || chip.value === 1000 ? '#FFFFFF' : '#333333' },
        ]}>
          {chip.value >= 1000 ? '1K' : chip.value}
        </Text>
      </Animated.View>
    </>
  );
});

interface AnimatedCounterProps {
  value: number;
}

/**
 * Animated counter with slot-machine style digit rolling
 */
const AnimatedCounter = React.memo(function AnimatedCounter({ value }: AnimatedCounterProps) {
  const displayScale = useSharedValue(1);
  const displayColor = useSharedValue(0);

  useEffect(() => {
    // Pop animation on value change
    displayScale.value = withSequence(
      withSpring(1.15, SPRING.chipSettle),
      withSpring(1, SPRING.chipSettle)
    );
    // Brief gold flash
    displayColor.value = withSequence(
      withTiming(1, { duration: 100 }),
      withDelay(200, withTiming(0, { duration: 300 }))
    );
  }, [value, displayScale, displayColor]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: displayScale.value }],
  }));

  return (
    <Animated.View style={[styles.counterContainer, animatedStyle]}>
      <Text style={styles.counterLabel}>Total</Text>
      <Text style={styles.counterValue}>${value}</Text>
    </Animated.View>
  );
});

export interface ChipPileProps {
  /** Array of placed chips */
  chips: PlacedChip[];
  /** Total bet amount */
  totalBet: number;
  /** Show the counter overlay */
  showCounter?: boolean;
  /** Test ID for testing */
  testID?: string;
  /**
   * DS-054: Callback fired when a chip lands
   * Used to trigger liquid ripple effects
   * @param chipValue - The value of the chip that landed
   */
  onChipLand?: (chipValue: ChipValue) => void;
}

/**
 * ChipPile renders a visual stack of placed chips with animations
 */
export const ChipPile = React.memo(function ChipPile({
  chips,
  totalBet,
  showCounter = true,
  testID,
  onChipLand,
}: ChipPileProps) {
  const safeChips = chips ?? [];

  // Only show most recent chips to prevent visual clutter
  const visibleChips = useMemo(() => {
    if (safeChips.length <= MAX_VISIBLE_CHIPS) return safeChips;
    return safeChips.slice(-MAX_VISIBLE_CHIPS);
  }, [safeChips]);

  // Track which chips are "new" for animation purposes
  const newChipIds = useMemo(() => {
    const now = Date.now();
    return new Set(
      safeChips
        .filter((c) => now - c.placedAt < 500)
        .map((c) => c.id)
    );
  }, [safeChips]);

  if (safeChips.length === 0) {
    return (
      <View style={styles.emptyContainer} testID={testID}>
        <View style={styles.emptyIndicator}>
          <Text style={styles.emptyText}>Drop chips here</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.pileArea}>
        {visibleChips.map((chip, index) => (
          <StackedChip
            key={chip.id}
            chip={chip}
            index={index}
            totalChips={visibleChips.length}
            isNew={newChipIds.has(chip.id)}
            onLand={onChipLand}
          />
        ))}
      </View>

      {showCounter && <AnimatedCounter value={totalBet} />}
    </View>
  );
});

/**
 * DS-044: Scatter range for natural pile landing
 * Chips land slightly offset from center, creating organic pile appearance
 */
const SCATTER_RANGE = 6; // Max pixels from center

/**
 * Helper to create a placed chip with random rotation and scatter offset
 *
 * DS-044: Now includes scatterX and scatterY for natural pile landing
 */
export function createPlacedChip(value: ChipValue, existingChipCount = 0): PlacedChip {
  // DS-044: Calculate scatter based on pile size
  // More chips = wider scatter to simulate natural stacking
  const scatterMultiplier = Math.min(existingChipCount / 5, 1); // Cap at 1x
  const baseScatter = SCATTER_RANGE * scatterMultiplier;

  return {
    id: `chip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    value,
    rotation: Math.random() * 30 - 15, // -15 to 15 degrees
    placedAt: Date.now(),
    // DS-044: Scatter offset - chips land near but not exactly on center
    scatterX: (Math.random() * 2 - 1) * baseScatter,
    scatterY: (Math.random() * 2 - 1) * (baseScatter * 0.5), // Less vertical scatter
  };
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
    minWidth: 80,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
    minWidth: 80,
  },
  emptyIndicator: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: COLORS.textMuted,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5,
  },
  emptyText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 9,
    textAlign: 'center',
  },
  pileArea: {
    width: CHIP_SIZE + 20,
    height: CHIP_SIZE + 60, // Room for stacking
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  stackedChip: {
    position: 'absolute',
    bottom: 0,
    width: CHIP_SIZE,
    height: CHIP_SIZE,
    borderRadius: CHIP_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    // Shadow for 3D effect
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  chipHighlight: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    opacity: 0.4,
  },
  chipShadow: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  chipValue: {
    fontSize: 10,
    fontWeight: '700',
    zIndex: 10,
  },
  chipTrail: {
    position: 'absolute',
    bottom: 0,
    width: 30,
    height: 8,
    borderRadius: 4,
  },
  counterContainer: {
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  counterLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    fontSize: 10,
  },
  counterValue: {
    ...TYPOGRAPHY.body,
    color: '#FFCC00',
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});

export type { PlacedChip };
