/**
 * Game Screen Container - Jony Ive Redesigned
 * Wraps individual game screens with consistent navigation
 */
import { View, StyleSheet, Pressable, Text } from 'react-native';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { haptics } from '../services/haptics';
import type { GameScreenProps } from '../navigation/types';
import { GameErrorBoundary } from '../components/game';

// Import all game screens
import { HiLoScreen } from './games/HiLoScreen';
import { BlackjackScreen } from './games/BlackjackScreen';
import { RouletteScreen } from './games/RouletteScreen';
import { CrapsScreen } from './games/CrapsScreen';
import { CasinoWarScreen } from './games/CasinoWarScreen';
import { VideoPokerScreen } from './games/VideoPokerScreen';
import { BaccaratScreen } from './games/BaccaratScreen';
import { SicBoScreen } from './games/SicBoScreen';
import { ThreeCardPokerScreen } from './games/ThreeCardPokerScreen';
import { UltimateTXHoldemScreen } from './games/UltimateTXHoldemScreen';

const GAME_COMPONENTS = {
  hi_lo: HiLoScreen,
  blackjack: BlackjackScreen,
  roulette: RouletteScreen,
  craps: CrapsScreen,
  casino_war: CasinoWarScreen,
  video_poker: VideoPokerScreen,
  baccarat: BaccaratScreen,
  sic_bo: SicBoScreen,
  three_card_poker: ThreeCardPokerScreen,
  ultimate_texas_holdem: UltimateTXHoldemScreen,
} as const;

export function GameScreen({ navigation, route }: GameScreenProps) {
  const { gameId } = route.params;
  const GameComponent = GAME_COMPONENTS[gameId];

  const handleBack = () => {
    haptics.buttonPress().catch(() => {});
    navigation.goBack();
  };

  if (!GameComponent) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Game not found</Text>
          <Pressable onPress={handleBack} style={styles.backButton}>
            <Text style={styles.backButtonText}>← Back to Lobby</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Back Button - Fixed position */}
      <Pressable
        onPress={handleBack}
        style={styles.backButtonFixed}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.backArrow}>←</Text>
      </Pressable>

      {/* Game Component */}
      <GameErrorBoundary>
        <GameComponent />
      </GameErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  backButtonFixed: {
    position: 'absolute',
    top: 50,
    left: SPACING.md,
    zIndex: 100,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backArrow: {
    color: COLORS.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h2,
    marginBottom: SPACING.md,
  },
  backButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  backButtonText: {
    color: COLORS.primary,
    ...TYPOGRAPHY.body,
  },
});
