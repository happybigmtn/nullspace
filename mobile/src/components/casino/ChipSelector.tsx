/**
 * Chip selector with drag-and-drop and tap gestures
 */
import React, { useCallback } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { haptics } from '../../services/haptics';
import { COLORS, SPACING, TYPOGRAPHY, SPRING } from '../../constants/theme';
import { CHIP_VALUES } from '../../constants/theme';
import type { ChipValue } from '../../types';

interface ChipProps {
  value: ChipValue;
  selected: boolean;
  disabled?: boolean;
  onSelect: (value: ChipValue) => void;
  onDrop: (value: ChipValue, position: { x: number; y: number }) => void;
}

const Chip = React.memo(function Chip({ value, selected, disabled = false, onSelect, onDrop }: ChipProps) {
  const offset = useSharedValue({ x: 0, y: 0 });
  const scale = useSharedValue(1);
  const isDragging = useSharedValue(false);
  const startPosition = useSharedValue({ x: 0, y: 0 });

  const triggerHaptic = () => haptics.chipPlace();
  const triggerDropHaptic = () => haptics.betConfirm();

  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onBegin(() => {
      'worklet';
      isDragging.value = true;
      scale.value = withSpring(1.2, SPRING.chipStack);
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
      scale.value = withSpring(1, SPRING.chipStack);

      // Check if dropped in betting area (above starting position)
      if (offset.value.y < -100) {
        runOnJS(onDrop)(value, {
          x: e.absoluteX,
          y: e.absoluteY,
        });
        runOnJS(triggerDropHaptic)();
      }

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
      runOnJS(onSelect)(value);
      runOnJS(triggerHaptic)();
    });

  const composedGesture = Gesture.Exclusive(pan, tap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offset.value.x },
      { translateY: offset.value.y },
      { scale: scale.value },
    ],
    zIndex: isDragging.value ? 100 : 0,
    opacity: disabled ? 0.4 : 1,
  }));

  // Chip color based on value
  const chipColor = getChipColor(value);

  return (
    <GestureDetector gesture={composedGesture}>
      <Animated.View
        style={[
          styles.chip,
          { backgroundColor: chipColor.bg, borderColor: chipColor.border },
          selected && styles.chipSelected,
          animatedStyle,
        ]}
      >
        <Text style={[styles.chipText, { color: chipColor.text }]}>
          ${value}
        </Text>
      </Animated.View>
    </GestureDetector>
  );
});

function getChipColor(value: ChipValue) {
  switch (value) {
    case 1:
      return { bg: '#FFFFFF', border: '#CCCCCC', text: '#333333' };
    case 5:
      return { bg: '#EF4444', border: '#DC2626', text: '#FFFFFF' };
    case 25:
      return { bg: '#22C55E', border: '#16A34A', text: '#FFFFFF' };
    case 100:
      return { bg: '#1F1F1F', border: '#333333', text: '#FFFFFF' };
    case 500:
      return { bg: '#8B5CF6', border: '#7C3AED', text: '#FFFFFF' };
    case 1000:
      return { bg: COLORS.gold, border: '#D4A500', text: '#1F1F1F' };
    default:
      return { bg: '#4A4A4A', border: '#666666', text: '#FFFFFF' };
  }
}

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
  const handleDrop = useCallback((value: ChipValue, _position: { x: number; y: number }) => {
    onChipPlace(value);
  }, [onChipPlace]);

  return (
    <View style={styles.container}>
      {CHIP_VALUES.map((value) => (
        <Chip
          key={value}
          value={value}
          selected={selectedValue === value}
          disabled={disabled}
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  chipSelected: {
    borderColor: COLORS.primary,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.5,
  },
  chipText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textPrimary,
    fontWeight: '700',
    fontSize: 11,
  },
});
