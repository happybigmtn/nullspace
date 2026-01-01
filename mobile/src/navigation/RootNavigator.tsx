/**
 * Root navigation structure
 */
import {
  NavigationContainer,
  LinkingOptions,
  getStateFromPath,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';

import { SplashScreen } from '../screens/SplashScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { LobbyScreen } from '../screens/LobbyScreen';
import { VaultScreen } from '../screens/VaultScreen';
import { GameScreen } from '../screens/GameScreen';
import { RootStackParamList } from './types';
import { COLORS } from '../constants/theme';
import { useAuth } from '../context';

const linkingConfig = {
  screens: {
    Lobby: 'lobby',
    Vault: 'vault',
    Game: 'game/:gameId',
  },
};

const Stack = createNativeStackNavigator<RootStackParamList>();

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
          animation: 'fade',
          contentStyle: {
            backgroundColor: COLORS.background,
          },
        }}
      >
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="Auth" component={AuthScreen} />
        <Stack.Screen name="Lobby" component={LobbyScreen} />
        <Stack.Screen name="Vault" component={VaultScreen} />
        <Stack.Screen
          name="Game"
          component={GameScreen}
          options={{
            gestureEnabled: false, // Prevent swipe-back during game
            animation: 'slide_from_right',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
