/**
 * Help button component for accessing game tutorials
 *
 * Premium features (US-113):
 * - Subtle float animation when idle to draw attention
 */
import { useState } from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { haptics } from '../../services/haptics';
import { COLORS, RADIUS } from '../../constants/theme';
import { FloatAnimation } from './MicroInteractions';

interface HelpButtonProps {
  onPress: () => void;
  /** Enable subtle float animation when idle (default: true) */
  float?: boolean;
}

export function HelpButton({ onPress, float = true }: HelpButtonProps) {
  const [isPressed, setIsPressed] = useState(false);

  const handlePress = () => {
    // Fire-and-forget haptic (non-blocking)
    haptics.buttonPress().catch(() => {});
    onPress();
  };

  return (
    <FloatAnimation isActive={float && !isPressed} distance={3} duration={2500}>
      <Pressable
        onPress={handlePress}
        onPressIn={() => setIsPressed(true)}
        onPressOut={() => setIsPressed(false)}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Help"
        accessibilityHint="Opens game tutorial"
      >
        <Text style={styles.text}>?</Text>
      </Pressable>
    </FloatAnimation>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    backgroundColor: COLORS.surface,
  },
  text: {
    color: COLORS.primary,
    fontSize: 16,
    fontWeight: '700',
  },
});
