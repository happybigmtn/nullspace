/**
 * Auth Screen - Jony Ive Redesigned
 * Biometric authentication with fallback
 */
import { View, Text, StyleSheet } from 'react-native';
import { useState, useCallback } from 'react';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import { PrimaryButton } from '../components/ui';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../constants/theme';
import { authenticateWithBiometrics, getBiometricType } from '../services/auth';
import { haptics } from '../services/haptics';
import { isOnboardingCompleted } from '../services';
import { useAuth } from '../context';
import type { AuthScreenProps } from '../navigation/types';

export function AuthScreen({ navigation }: AuthScreenProps) {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const biometricType = getBiometricType();
  const { authenticate } = useAuth();

  const handleAuthenticate = useCallback(async () => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const success = await authenticateWithBiometrics();

      if (success) {
        haptics.win().catch(() => {});
        authenticate(); // Mark session as authenticated
        // First-time users see onboarding, returning users go to lobby
        const nextScreen = isOnboardingCompleted() ? 'Lobby' : 'Onboarding';
        navigation.replace(nextScreen);
      } else {
        haptics.loss().catch(() => {});
        setError('Authentication failed. Please try again.');
      }
    } catch {
      haptics.loss().catch(() => {});
      setError('An error occurred. Please try again.');
    } finally {
      setIsAuthenticating(false);
    }
  }, [navigation, authenticate]);

  const handleSkip = useCallback(() => {
    // Allow skipping in development/demo mode
    haptics.buttonPress().catch(() => {});
    authenticate(); // Mark session as authenticated even in demo
    // First-time users see onboarding, returning users go to lobby
    const nextScreen = isOnboardingCompleted() ? 'Lobby' : 'Onboarding';
    navigation.replace(nextScreen);
  }, [navigation, authenticate]);

  const getBiometricLabel = () => {
    switch (biometricType) {
      case 'FACE_ID':
        return 'Authenticate with Face ID';
      case 'TOUCH_ID':
        return 'Authenticate with Touch ID';
      case 'FINGERPRINT':
        return 'Authenticate with Fingerprint';
      default:
        return 'Authenticate';
    }
  };

  const getBiometricIcon = () => {
    switch (biometricType) {
      case 'FACE_ID':
        return '👤';
      case 'TOUCH_ID':
      case 'FINGERPRINT':
        return '👆';
      default:
        return '🔐';
    }
  };

  return (
    <View style={styles.container}>
      <Animated.View entering={FadeIn.duration(600)} style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>N</Text>
          </View>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>
            Authenticate to access your wallet
          </Text>
        </View>

        {/* Biometric Icon */}
        <Animated.View
          entering={FadeInUp.delay(200)}
          style={styles.biometricContainer}
        >
          <View style={styles.biometricIcon}>
            <Text style={styles.biometricEmoji}>{getBiometricIcon()}</Text>
          </View>
        </Animated.View>

        {/* Error Message */}
        {error && (
          <Animated.View entering={FadeIn} style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
          </Animated.View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <PrimaryButton
            label={getBiometricLabel()}
            onPress={handleAuthenticate}
            disabled={isAuthenticating}
            variant="primary"
            size="large"
          />

          {__DEV__ && (
            <PrimaryButton
              label="Skip (Demo Mode)"
              onPress={handleSkip}
              variant="ghost"
            />
          )}
        </View>

        {/* Security Notice */}
        <Text style={styles.securityNote}>
          Your keys never leave this device.{'\n'}
          All transactions are signed locally.
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    paddingHorizontal: SPACING.lg,
  },
  content: {
    alignItems: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  logoText: {
    color: COLORS.background,
    fontSize: 28,
    fontWeight: 'bold',
  },
  title: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.displayMedium,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.body,
    textAlign: 'center',
  },
  biometricContainer: {
    marginVertical: SPACING.xl,
  },
  biometricIcon: {
    width: 100,
    height: 100,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  biometricEmoji: {
    fontSize: 48,
  },
  errorContainer: {
    backgroundColor: COLORS.error + '20',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    marginBottom: SPACING.md,
  },
  errorText: {
    color: COLORS.error,
    ...TYPOGRAPHY.bodySmall,
    textAlign: 'center',
  },
  actions: {
    width: '100%',
    gap: SPACING.md,
    marginBottom: SPACING.xl,
  },
  securityNote: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
    lineHeight: 18,
  },
});
