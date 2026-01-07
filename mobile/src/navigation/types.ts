/**
 * Navigation type definitions
 */
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { GameId } from '../types';
import { GAME_DISPLAY_NAMES } from '@nullspace/constants/games';

// Root stack param list
export type RootStackParamList = {
  Splash: undefined;
  Auth: undefined;
  Onboarding: undefined;
  Lobby: undefined;
  Vault: undefined;
  Game: {
    gameId: GameId;
  };
};

// Screen props types
export type SplashScreenProps = NativeStackScreenProps<RootStackParamList, 'Splash'>;
export type AuthScreenProps = NativeStackScreenProps<RootStackParamList, 'Auth'>;
export type OnboardingScreenProps = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;
export type LobbyScreenProps = NativeStackScreenProps<RootStackParamList, 'Lobby'>;
export type VaultScreenProps = NativeStackScreenProps<RootStackParamList, 'Vault'>;
export type GameScreenProps = NativeStackScreenProps<RootStackParamList, 'Game'>;

// Game screen names - re-export from constants
export const GAME_SCREENS = GAME_DISPLAY_NAMES;
