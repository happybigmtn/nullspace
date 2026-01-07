/**
 * Splash Screen - Jony Ive Redesigned
 * Minimal branding with biometric authentication prompt
 *
 * Premium features (US-113):
 * - Skeleton shimmer loader instead of plain dots
 */
import { View, Text, StyleSheet } from 'react-native';
import { useEffect, useCallback } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { SkeletonShimmer } from '../components/ui/MicroInteractions';
import { authenticateWithBiometrics, initializeAuth } from '../services/auth';
import { getPublicKey } from '../services/crypto';
import { initializeStorage } from '../services';
import { useAuth } from '../context';
import type { SplashScreenProps } from '../navigation/types';

export function SplashScreen({ navigation }: SplashScreenProps) {
  const { authenticate } = useAuth();

  const initializeApp = useCallback(async () => {
    try {
      // Initialize storage first
      await initializeStorage();

      // Initialize crypto keypair in background (only public key is accessible)
      await getPublicKey();

      // Check if biometrics available and authenticate
      const authResult = await initializeAuth();

      if (authResult.available) {
        const authenticated = await authenticateWithBiometrics();
        if (authenticated) {
          authenticate(); // Mark session as authenticated
          navigation.replace('Lobby');
        } else {
          // Stay on splash, user can retry
          navigation.replace('Auth');
        }
      } else {
        // No biometrics, go to auth screen
        navigation.replace('Auth');
      }
    } catch (error) {
      console.error('Initialization error:', error);
      navigation.replace('Auth');
    }
  }, [authenticate, navigation]);

  useEffect(() => {
    initializeApp();
  }, [initializeApp]);

  return (
    <View style={styles.container}>
      <Animated.View
        entering={FadeIn.duration(800)}
        style={styles.content}
      >
        {/* Logo/Brand */}
        <View style={styles.logoContainer}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>N</Text>
          </View>
          <Text style={styles.brandName}>NULLSPACE</Text>
          <Text style={styles.tagline}>Provably Fair Casino</Text>
        </View>

        {/* Premium skeleton shimmer loader */}
        <View style={styles.loadingContainer}>
          <SkeletonShimmer width={8} height={8} variant="circle" />
          <SkeletonShimmer width={8} height={8} variant="circle" />
          <SkeletonShimmer width={8} height={8} variant="circle" />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: SPACING.xl * 2,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  logoText: {
    color: COLORS.background,
    fontSize: 40,
    fontWeight: 'bold',
  },
  brandName: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.displayLarge,
    letterSpacing: 4,
  },
  tagline: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.body,
    marginTop: SPACING.xs,
  },
  loadingContainer: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
});
