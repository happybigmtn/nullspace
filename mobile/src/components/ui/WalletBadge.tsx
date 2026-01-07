import { View, Text, StyleSheet } from 'react-native';
import { useGameStore } from '../../stores/gameStore';
import { getNetworkLabel } from '../../utils';
import { COLORS, RADIUS, SPACING, TYPOGRAPHY } from '../../constants/theme';

// Minimum length where ellipsis truncation makes sense (6 prefix + 3 ellipsis + 4 suffix = 13 visible chars)
// For keys shorter than this, just show the full key
const MIN_LENGTH_FOR_TRUNCATION = 11;

export function WalletBadge() {
  const publicKey = useGameStore((state) => state.publicKey);
  if (!publicKey) {
    return null;
  }

  // For short keys, show full key to avoid duplicate characters in display
  // (e.g., "1234" would become "1234...1234" with naive slicing)
  const shortKey = publicKey.length >= MIN_LENGTH_FOR_TRUNCATION
    ? `${publicKey.slice(0, 6)}...${publicKey.slice(-4)}`
    : publicKey;
  const network = getNetworkLabel();

  return (
    <View style={styles.badge}>
      <Text style={styles.network}>{network}</Text>
      <Text style={styles.key}>{shortKey}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  network: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  key: {
    ...TYPOGRAPHY.label,
    color: COLORS.textPrimary,
  },
});

