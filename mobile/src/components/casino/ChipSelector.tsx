/**
 * Chip selector with drag-and-drop and tap gestures
 *
 * Premium design features (US-110):
 * - Concentric ring detail suggesting grooved chip edges
 * - Radial gradient dome effect on chip surface
 * - Metallic sheen animation on gold ($1000) chip
 * - Micro-bounce settling animation when chip lands
 * - Subtle rotation randomness for visual variety
 */
import React, { useCallback, useMemo } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  withRepeat,
  Easing,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { COLORS, SPACING, TYPOGRAPHY, SPRING } from '../../constants/theme';
import { CHIP_VALUES } from '../../constants/theme';
import { GLOW, SHADOW_COLORED } from '@nullspace/design-tokens';
import type { ChipValue } from '../../types';

/**
 * Premium chip color palette
 * Each chip has: base color, edge detail, highlight, and text colors
 */
const CHIP_COLORS = {
  1: {
    base: '#F5F5F5',
    edge: '#E8E8E8',
    edgeDark: '#D0D0D0',
    highlight: '#FFFFFF',
    text: '#333333',
    border: '#CCCCCC',
    label: 'white',
  },
  5: {
    base: '#EF4444',
    edge: '#DC2626',
    edgeDark: '#B91C1C',
    highlight: '#F87171',
    text: '#FFFFFF',
    border: '#DC2626',
    label: 'red',
  },
  25: {
    base: '#22C55E',
    edge: '#16A34A',
    edgeDark: '#15803D',
    highlight: '#4ADE80',
    text: '#FFFFFF',
    border: '#16A34A',
    label: 'green',
  },
  100: {
    base: '#1F1F1F',
    edge: '#333333',
    edgeDark: '#0F0F0F',
    highlight: '#404040',
    text: '#FFFFFF',
    border: '#333333',
    label: 'black',
  },
  500: {
    base: '#8B5CF6',
    edge: '#7C3AED',
    edgeDark: '#6D28D9',
    highlight: '#A78BFA',
    text: '#FFFFFF',
    border: '#7C3AED',
    label: 'purple',
  },
  1000: {
    base: '#FFCC00',
    edge: '#D4A500',
    edgeDark: '#B38B00',
    highlight: '#FFE066',
    text: '#1F1F1F',
    border: '#D4A500',
    label: 'gold',
    isGold: true,
  },
} as const;

type ChipColorKey = keyof typeof CHIP_COLORS;

/**
 * Concentric edge rings - creates grooved chip edge effect
 * Uses semi-transparent overlays at different radii
 */
const ChipEdgeRings = React.memo(function ChipEdgeRings({
  edgeColor,
  edgeDarkColor,
}: {
  edgeColor: string;
  edgeDarkColor: string;
}) {
  return (
    <>
      {/* Outer edge ring - darker groove */}
      <View
        style={[
          styles.edgeRing,
          styles.edgeRingOuter,
          { borderColor: edgeDarkColor },
        ]}
        pointerEvents="none"
      />
      {/* Middle edge ring - lighter groove */}
      <View
        style={[
          styles.edgeRing,
          styles.edgeRingMiddle,
          { borderColor: edgeColor },
        ]}
        pointerEvents="none"
      />
      {/* Inner edge ring - subtle inner detail */}
      <View
        style={[
          styles.edgeRing,
          styles.edgeRingInner,
          { borderColor: edgeColor },
        ]}
        pointerEvents="none"
      />
    </>
  );
});

/**
 * Radial gradient dome effect - simulates curved chip surface
 * Creates highlight at top-left and shadow at bottom-right
 */
const ChipDomeEffect = React.memo(function ChipDomeEffect({
  highlightColor,
}: {
  highlightColor: string;
}) {
  return (
    <>
      {/* Top-left highlight - dome light catch */}
      <View
        style={[
          styles.domeHighlight,
          { backgroundColor: highlightColor },
        ]}
        pointerEvents="none"
      />
      {/* Bottom-right shadow - dome curvature */}
      <View style={styles.domeShadow} pointerEvents="none" />
    </>
  );
});

/**
 * Metallic sheen animation for gold chip
 * Creates a diagonal light sweep effect
 */
const MetallicSheen = React.memo(function MetallicSheen({
  isGold,
  sheenOffset,
}: {
  isGold: boolean;
  sheenOffset: SharedValue<number>;
}) {
  const animatedSheenStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sheenOffset.value }],
    opacity: isGold ? 0.4 : 0,
  }));

  if (!isGold) return null;

  return (
    <Animated.View
      style={[styles.metallicSheen, animatedSheenStyle]}
      pointerEvents="none"
    />
  );
});

interface ChipProps {
  value: ChipValue;
  selected: boolean;
  disabled?: boolean;
  randomRotation: number;
  testID?: string;
  onSelect: (value: ChipValue) => void;
  onDrop: (value: ChipValue, position: { x: number; y: number }) => void;
}

const Chip = React.memo(function Chip({
  value,
  selected,
  disabled = false,
  randomRotation,
  testID,
  onSelect,
  onDrop,
}: ChipProps) {
  const offset = useSharedValue({ x: 0, y: 0 });
  const scale = useSharedValue(1);
  const rotation = useSharedValue(randomRotation);
  const isDragging = useSharedValue(false);
  const startPosition = useSharedValue({ x: 0, y: 0 });

  // Metallic sheen animation for gold chip
  const sheenOffset = useSharedValue(-60);
  const colors = CHIP_COLORS[value as ChipColorKey] ?? CHIP_COLORS[1];
  const isGold = 'isGold' in colors && colors.isGold;

  // Start sheen animation for gold chip
  React.useEffect(() => {
    if (isGold) {
      sheenOffset.value = withRepeat(
        withSequence(
          withTiming(-60, { duration: 0 }),
          withTiming(60, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
          withTiming(60, { duration: 3000 }) // Pause before repeat
        ),
        -1, // Infinite repeat
        false
      );
    }
  }, [isGold, sheenOffset]);

  const triggerHaptic = () => haptics.chipPlace().catch(() => {});
  const triggerDropHaptic = () => haptics.betConfirm().catch(() => {});

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onBegin(() => {
      'worklet';
      isDragging.value = true;
      scale.value = withSpring(1.2, SPRING.chipStack);
      // Straighten chip during drag
      rotation.value = withSpring(0, SPRING.chipStack);
      startPosition.value = { x: offset.value.x, y: offset.value.y };
      runOnJS(triggerHaptic)();
    })
    .onUpdate((e) => {
      'worklet';
      offset.value = {
        x: startPosition.value.x + e.translationX,
        y: startPosition.value.y + e.translationY,
      };
    })
    .onEnd((e) => {
      'worklet';
      isDragging.value = false;

      // Check if dropped in betting area (above starting position)
      if (offset.value.y < -100) {
        runOnJS(onDrop)(value, {
          x: e.absoluteX,
          y: e.absoluteY,
        });
        runOnJS(triggerDropHaptic)();
      }

      // Micro-bounce settling animation
      scale.value = withSequence(
        withSpring(1.05, SPRING.chipSettle),
        withSpring(1, SPRING.chipSettle)
      );

      // Return rotation to random angle
      rotation.value = withSpring(randomRotation, SPRING.chipSettle);

      // Spring back to origin
      offset.value = {
        x: withSpring(0, SPRING.chipToss),
        y: withSpring(0, SPRING.chipToss),
      };
    });

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .onEnd(() => {
      'worklet';
      // Micro-bounce on tap selection
      scale.value = withSequence(
        withSpring(1.1, SPRING.chipSettle),
        withSpring(1, SPRING.chipSettle)
      );
      runOnJS(onSelect)(value);
      runOnJS(triggerHaptic)();
    });

  const composedGesture = Gesture.Exclusive(pan, tap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offset.value.x },
      { translateY: offset.value.y },
      { scale: scale.value },
      { rotate: `${rotation.value}deg` },
    ],
    zIndex: isDragging.value ? 100 : 0,
    opacity: disabled ? 0.4 : 1,
  }));

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        testID={testID}
        style={[
          styles.chip,
          {
            backgroundColor: colors.base,
            borderColor: colors.border,
          },
          selected && styles.chipSelected,
          animatedStyle,
        ]}
        accessible={true}
        accessibilityRole="button"
        accessibilityLabel={`$${value} ${colors.label} chip`}
        accessibilityState={{ selected, disabled }}
        accessibilityHint="Tap to select, drag to place bet"
      >
        {/* Edge grooves - concentric rings */}
        <ChipEdgeRings
          edgeColor={colors.edge}
          edgeDarkColor={colors.edgeDark}
        />

        {/* Dome effect - radial highlight/shadow */}
        <ChipDomeEffect highlightColor={colors.highlight} />

        {/* Metallic sheen (gold chip only) */}
        <MetallicSheen isGold={isGold} sheenOffset={sheenOffset} />

        {/* Chip value text */}
        <Text style={[styles.chipText, { color: colors.text }]}>
          ${value}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
});

interface ChipSelectorProps {
  selectedValue: ChipValue;
  disabled?: boolean;
  onSelect: (value: ChipValue) => void;
  onChipPlace: (value: ChipValue) => void;
}

export const ChipSelector = React.memo(function ChipSelector({
  selectedValue,
  disabled = false,
  onSelect,
  onChipPlace,
}: ChipSelectorProps) {
  const handleDrop = useCallback(
    (value: ChipValue, _position: { x: number; y: number }) => {
      onChipPlace(value);
    },
    [onChipPlace]
  );

  // Generate stable random rotations for each chip (subtle stack randomness)
  // Range: -8 to +8 degrees for natural look
  const chipRotations = useMemo(
    () =>
      CHIP_VALUES.map((value) => {
        // Use chip value as seed for consistent randomness
        const seed = value * 17 + 3;
        return ((seed % 17) - 8);
      }),
    []
  );

  return (
    <View
      style={styles.container}
      testID="chip-selector"
      accessibilityRole="radiogroup"
      accessibilityLabel="Chip selector"
    >
      {CHIP_VALUES.map((value, index) => (
        <Chip
          key={value}
          value={value}
          selected={selectedValue === value}
          disabled={disabled}
          randomRotation={chipRotations[index] ?? 0}
          testID={`chip-${value}`}
          onSelect={onSelect}
          onDrop={handleDrop}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    gap: SPACING.xs,
  },
  chip: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // Multi-layer shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
  },
  chipSelected: {
    borderColor: GLOW.indigo.color,
    shadowColor: GLOW.indigo.color,
    shadowOpacity: GLOW.indigo.opacity + 0.2, // Slightly stronger for visibility
    shadowRadius: GLOW.indigo.blur / 2, // Scale for RN (CSS blur is spread)
  },
  chipText: {
    ...TYPOGRAPHY.caption,
    fontWeight: '700',
    fontSize: 11,
    zIndex: 10,
    // Text shadow for readability on dome effect
    textShadowColor: 'rgba(0, 0, 0, 0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 1,
  },

  // Edge ring styles - concentric grooves
  edgeRing: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'solid',
  },
  edgeRingOuter: {
    width: 52,
    height: 52,
    top: 2,
    left: 2,
    opacity: 0.5,
  },
  edgeRingMiddle: {
    width: 44,
    height: 44,
    top: 6,
    left: 6,
    opacity: 0.4,
  },
  edgeRingInner: {
    width: 36,
    height: 36,
    top: 10,
    left: 10,
    opacity: 0.3,
  },

  // Dome effect styles - radial gradient simulation
  domeHighlight: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    opacity: 0.3,
  },
  domeShadow: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },

  // Metallic sheen for gold chip
  metallicSheen: {
    position: 'absolute',
    top: -10,
    width: 16,
    height: 80,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    transform: [{ rotate: '25deg' }],
    borderRadius: 8,
  },
});
