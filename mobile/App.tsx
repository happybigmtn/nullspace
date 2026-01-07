/**
 * Nullspace Casino - Mobile App
 * React Native + Expo SDK 54+
 *
 * Jony Ive design principles:
 * - Radical simplicity in every interaction
 * - Progressive disclosure of complexity
 * - 60fps animations, native haptics
 * - On-chain provably fair gaming
 */
import './src/utils/cryptoPolyfill';
import * as Sentry from '@sentry/react-native';
import { initializeErrorReporter } from './src/services/errorReporter';
import { audio } from './src/services/audio';
import { registerRootComponent } from 'expo';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation/RootNavigator';
import { COLORS } from './src/constants/theme';
import { useAppState, useGatewaySession, useWebSocketReconnectOnForeground, useThemedColors } from './src/hooks';
import { AuthProvider, WebSocketProvider, ThemeProvider, useTheme, ToastProvider } from './src/context';

// Typography imports - synced with @nullspace/design-tokens
import {
  useFonts,
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

// Hold splash screen until fonts are loaded
SplashScreen.preventAutoHideAsync();

// Initialize Sentry for production error tracking
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN && !__DEV__) {
  Sentry.init({
    dsn: SENTRY_DSN,
    tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    environment: process.env.EXPO_PUBLIC_ENVIRONMENT ?? 'production',
  });
}

// Dev-only error reporter (sends to local HTTP server)
initializeErrorReporter();

function GatewaySessionBridge({ children }: { children: React.ReactNode }) {
  useGatewaySession();
  useWebSocketReconnectOnForeground();
  return children;
}

function ThemedContent() {
  const { isDark } = useTheme();
  const colors = useThemedColors();

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={[styles.container, { backgroundColor: colors.background }]}>
        <StatusBar
          barStyle={isDark ? 'light-content' : 'dark-content'}
          backgroundColor={colors.background}
        />
        <ToastProvider>
          <AuthProvider>
            <WebSocketProvider>
              <GatewaySessionBridge>
                <RootNavigator />
              </GatewaySessionBridge>
            </WebSocketProvider>
          </AuthProvider>
        </ToastProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function AppContent() {
  // Handle app lifecycle state persistence
  useAppState();

  return (
    <ThemeProvider>
      <ThemedContent />
    </ThemeProvider>
  );
}

function ErrorFallback({ resetError }: { resetError: () => void }) {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorText}>
            We've been notified and are working on a fix.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={resetError}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

function App() {
  const [appIsReady, setAppIsReady] = useState(false);

  // Load custom fonts from @expo-google-fonts packages
  // These match the typography defined in @nullspace/design-tokens
  const [fontsLoaded, fontError] = useFonts({
    // Display font (Outfit) - used for headlines and large text
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
    // Body font (Plus Jakarta Sans) - used for readable paragraphs and UI
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  useEffect(() => {
    async function prepare() {
      // Initialize audio service in parallel with font loading
      // Audio init is non-blocking - app continues even if it fails
      await audio.initialize().catch(() => {
        // Audio failures are non-critical, app continues
      });

      if (fontsLoaded || fontError) {
        setAppIsReady(true);
      }
    }

    prepare();
  }, [fontsLoaded, fontError]);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      // Hide splash screen once fonts are loaded and layout is ready
      await SplashScreen.hideAsync();
    }
  }, [appIsReady]);

  // Don't render until fonts are ready (splash screen stays visible)
  if (!appIsReady) {
    return null;
  }

  // In production, wrap with Sentry error boundary
  // In development, let errors bubble up naturally
  if (SENTRY_DSN && !__DEV__) {
    return (
      <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
        <Sentry.ErrorBoundary fallback={ErrorFallback} showDialog>
          <AppContent />
        </Sentry.ErrorBoundary>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AppContent />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorText: {
    color: '#999999',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

// Register the app component - required for Expo to mount on all platforms
registerRootComponent(App);
