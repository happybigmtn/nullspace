/**
 * Root navigation structure with parallax depth transitions
 *
 * Uses JS-based @react-navigation/stack instead of native-stack
 * to enable custom CardStyleInterpolators for premium parallax effects.
 *
 * Transition behavior:
 * - Splash → Auth: Fade with depth (subtle, no gesture)
 * - Auth → Lobby: Fade with depth (subtle, no gesture)
 * - Lobby → Game: Horizontal parallax (outgoing scales down, incoming slides + scales up)
 * - Lobby → Vault: Horizontal parallax
 */
import {
  NavigationContainer,
  LinkingOptions,
  getStateFromPath,
} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import * as Linking from 'expo-linking';

import { SplashScreen } from '../screens/SplashScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { LobbyScreen } from '../screens/LobbyScreen';
import { VaultScreen } from '../screens/VaultScreen';
import { GameScreen } from '../screens/GameScreen';
import { RootStackParamList } from './types';
import { COLORS } from '../constants/theme';
import { useAuth } from '../context';
import { ParallaxTransitionPresets } from './parallaxTransitions';

const linkingConfig = {
  screens: {
    Lobby: 'lobby',
    Vault: 'vault',
    Game: 'game/:gameId',
  },
};

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();

  // Custom linking that redirects unauthenticated deep links to Auth
  const linking: LinkingOptions<RootStackParamList> = {
    prefixes: [Linking.createURL('/'), 'nullspace://', 'https://nullspace.casino'],
    config: linkingConfig,
    getStateFromPath: (path, options) => {
      // Get the default state from the path
      const state = getStateFromPath(path, options);

      // If not authenticated, redirect protected routes to Auth
      if (!isAuthenticated && state?.routes) {
        const protectedRoutes = ['Lobby', 'Game'];
        const hasProtectedRoute = state.routes.some((route) =>
          protectedRoutes.includes(route.name)
        );

        if (hasProtectedRoute) {
          // Redirect to Auth screen instead
          return {
            routes: [{ name: 'Auth' }],
          };
        }
      }

      return state;
    },
  };

  // Show nothing while checking auth state (SplashScreen handles this)
  if (isLoading) {
    return null;
  }

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        initialRouteName={isAuthenticated ? 'Lobby' : 'Splash'}
        screenOptions={{
          headerShown: false,
          cardStyle: {
            backgroundColor: COLORS.background,
          },
          // Default to parallax horizontal slide
          ...ParallaxTransitionPresets.slideWithParallax,
        }}
      >
        {/* Auth flow screens use subtle fade with depth */}
        <Stack.Screen
          name="Splash"
          component={SplashScreen}
          options={ParallaxTransitionPresets.fadeWithDepth}
        />
        <Stack.Screen
          name="Auth"
          component={AuthScreen}
          options={ParallaxTransitionPresets.fadeWithDepth}
        />
        {/* Onboarding for first-time users - uses fade with depth like auth flow */}
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          options={ParallaxTransitionPresets.fadeWithDepth}
        />
        {/* Lobby is the hub - uses default parallax for push transitions */}
        <Stack.Screen name="Lobby" component={LobbyScreen} />
        {/* Settings/utility screens use horizontal parallax */}
        <Stack.Screen name="Vault" component={VaultScreen} />
        {/* Game screen uses parallax but disables gesture during gameplay */}
        <Stack.Screen
          name="Game"
          component={GameScreen}
          options={{
            ...ParallaxTransitionPresets.slideWithParallax,
            gestureEnabled: false, // Prevent swipe-back during game
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
