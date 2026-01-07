import { View, Text, StyleSheet, Animated } from 'react-native';
import { useRef, useEffect } from 'react';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../../constants/theme';
import { VAULT_PASSWORD_MIN_LENGTH } from '../../services/vault';

type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong';

interface PasswordStrengthIndicatorProps {
  password: string;
}

/**
 * Calculates password entropy in bits.
 * Entropy = log2(charset^length) = length * log2(charset)
 */
function calculateEntropy(password: string): number {
  if (!password) return 0;

  let charsetSize = 0;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);

  if (hasLower) charsetSize += 26;
  if (hasUpper) charsetSize += 26;
  if (hasDigit) charsetSize += 10;
  if (hasSpecial) charsetSize += 32;

  if (charsetSize === 0) return 0;

  return Math.round(password.length * Math.log2(charsetSize));
}

function getStrengthLevel(password: string): StrengthLevel {
  const entropy = calculateEntropy(password);
  const meetsMinLength = password.length >= VAULT_PASSWORD_MIN_LENGTH;

  if (!meetsMinLength || entropy < 40) return 'weak';
  if (entropy < 50) return 'fair';
  if (entropy < 60) return 'good';
  return 'strong';
}

function getStrengthConfig(level: StrengthLevel): {
  color: string;
  label: string;
  barCount: number;
} {
  switch (level) {
    case 'weak':
      return { color: COLORS.error, label: 'Weak', barCount: 1 };
    case 'fair':
      return { color: COLORS.warning, label: 'Fair', barCount: 2 };
    case 'good':
      return { color: COLORS.primary, label: 'Good', barCount: 3 };
    case 'strong':
      return { color: COLORS.success, label: 'Strong', barCount: 4 };
  }
}

export function PasswordStrengthIndicator({ password }: PasswordStrengthIndicatorProps) {
  const animValue = useRef(new Animated.Value(0)).current;
  const entropy = calculateEntropy(password);
  const level = getStrengthLevel(password);
  const config = getStrengthConfig(level);
  const meetsMinLength = password.length >= VAULT_PASSWORD_MIN_LENGTH;

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [animValue, level]);

  if (!password) return null;

  return (
    <View style={styles.container}>
      <View style={styles.barsContainer}>
        {[1, 2, 3, 4].map((bar) => (
          <View
            key={bar}
            style={[
              styles.bar,
              { backgroundColor: bar <= config.barCount ? config.color : COLORS.border },
            ]}
          />
        ))}
      </View>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
        <Text style={styles.entropy}>{entropy} bits</Text>
      </View>
      {!meetsMinLength && (
        <Text style={styles.warning}>
          {VAULT_PASSWORD_MIN_LENGTH - password.length} more characters needed
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  barsContainer: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  bar: {
    flex: 1,
    height: 4,
    borderRadius: RADIUS.sm,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: SPACING.xs,
  },
  label: {
    ...TYPOGRAPHY.caption,
    fontWeight: '600',
  },
  entropy: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  warning: {
    ...TYPOGRAPHY.caption,
    color: COLORS.warning,
    marginTop: SPACING.xs,
  },
});
