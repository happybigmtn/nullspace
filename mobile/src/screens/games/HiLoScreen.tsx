/**
 * Hi-Lo Game Screen - Jony Ive Redesigned
 * Simple binary choice: Higher or Lower
 */
import { View, Text, StyleSheet } from 'react-native';
import { useState, useCallback, useEffect, useMemo } from 'react';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useChipBetting } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import type { ChipValue, TutorialStep, Suit, Rank } from '../../types';
import type { HiLoMessage } from '@nullspace/protocol/mobile';

interface HiLoState {
  currentCard: { suit: Suit; rank: Rank } | null;
  nextCard: { suit: Suit; rank: Rank } | null;
  phase: 'betting' | 'playing' | 'result';
  message: string;
  lastResult: 'win' | 'loss' | null;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Simple Choice',
    description: 'Predict whether the next card will be higher or lower than the current card.',
  },
  {
    title: 'Place Your Bet',
    description: 'Select a chip value and tap to add to your bet. Drag chips up to the betting area.',
  },
  {
    title: 'Make Your Call',
    description: 'Tap HIGHER or LOWER. Aces are low, Kings are high. Ties push your bet back.',
  },
];

export function HiLoScreen() {
  // Shared hooks for connection and betting
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<HiLoMessage>();
  const { bet, selectedChip, setSelectedChip, placeChip, clearBet, setBet, balance } = useChipBetting();

  const [state, setState] = useState<HiLoState>({
    currentCard: null,
    nextCard: null,
    phase: 'betting',
    message: 'Place your bet',
    lastResult: null,
  });
  const [showTutorial, setShowTutorial] = useState(false);

  // Wrap chip placement to check game phase
  const handleChipPlace = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;
    placeChip(value);
  }, [state.phase, placeChip]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'state_update') {
      setState((prev) => ({
        ...prev,
        currentCard: lastMessage.card ?? prev.currentCard,
      }));
    }

    if (lastMessage.type === 'game_result') {
      const won = lastMessage.won ?? false;
      if (won) {
        haptics.win();
      } else {
        haptics.loss();
      }
      setState((prev) => ({
        ...prev,
        phase: 'result',
        currentCard: lastMessage.card ?? prev.currentCard,
        nextCard: lastMessage.nextCard ?? null,
        lastResult: won ? 'win' : 'loss',
        message: lastMessage.message ?? (won ? 'You win!' : 'You lose'),
      }));
    }
  }, [lastMessage]);

  const handleBet = useCallback(async (choice: 'higher' | 'lower') => {
    if (bet === 0 || state.phase !== 'betting') return;

    await haptics.betConfirm();

    send({
      type: 'hilo_bet',
      amount: bet,
      choice,
    });

    setState((prev) => ({
      ...prev,
      phase: 'playing',
      message: choice === 'higher' ? 'Higher...' : 'Lower...',
    }));
  }, [bet, state.phase, send]);

  const handleNewGame = useCallback(() => {
    clearBet();
    setState((prev) => ({
      ...prev,
      phase: 'betting',
      nextCard: null,
      message: 'Place your bet',
      lastResult: null,
    }));
  }, [clearBet]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.UP]: () => state.phase === 'betting' && bet > 0 && !isDisconnected && handleBet('higher'),
    [KEY_ACTIONS.DOWN]: () => state.phase === 'betting' && bet > 0 && !isDisconnected && handleBet('lower'),
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'result') handleNewGame();
    },
    [KEY_ACTIONS.ESCAPE]: () => state.phase === 'betting' && clearBet(),
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && handleChipPlace(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && handleChipPlace(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && handleChipPlace(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && handleChipPlace(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && handleChipPlace(500 as ChipValue),
  }), [state.phase, bet, isDisconnected, handleBet, handleNewGame, clearBet, handleChipPlace]);

  useGameKeyboard(keyboardHandlers);

  return (
    <>
      <GameLayout
        title="Hi-Lo"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
      >
        {/* Game Area */}
        <View style={styles.gameArea}>
          {/* Cards Display */}
          <View style={styles.cardsContainer}>
            {state.currentCard && (
              <Animated.View entering={FadeIn.duration(300)}>
                <Card
                  suit={state.currentCard.suit}
                  rank={state.currentCard.rank}
                  faceUp={true}
                  size="large"
                />
              </Animated.View>
            )}
            {state.nextCard && (
              <Animated.View entering={SlideInUp.duration(300)}>
                <Card
                  suit={state.nextCard.suit}
                  rank={state.nextCard.rank}
                  faceUp={true}
                  size="large"
                />
              </Animated.View>
            )}
          </View>

          {/* Message */}
          <Text
            style={[
              styles.message,
              state.lastResult === 'win' && styles.messageWin,
              state.lastResult === 'loss' && styles.messageLoss,
            ]}
          >
            {state.message}
          </Text>

          {/* Bet Display */}
          {bet > 0 && (
            <View style={styles.betContainer}>
              <Text style={styles.betLabel}>Bet</Text>
              <Text style={styles.betAmount}>${bet}</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {state.phase === 'betting' && (
            <>
              <PrimaryButton
                label="HIGHER"
                onPress={() => handleBet('higher')}
                disabled={bet === 0 || isDisconnected}
                variant="primary"
                size="large"
              />
              <PrimaryButton
                label="LOWER"
                onPress={() => handleBet('lower')}
                disabled={bet === 0 || isDisconnected}
                variant="danger"
                size="large"
              />
            </>
          )}

          {state.phase === 'result' && (
            <PrimaryButton
              label="NEW GAME"
              onPress={handleNewGame}
              variant="primary"
              size="large"
            />
          )}
        </View>

        {/* Chip Selector */}
        {state.phase === 'betting' && (
          <View style={styles.chipArea}>
            {bet > 0 && (
              <PrimaryButton
                label="CLEAR"
                onPress={clearBet}
                variant="secondary"
              />
            )}
            <ChipSelector
              selectedValue={selectedChip}
              onSelect={setSelectedChip}
              onChipPlace={handleChipPlace}
            />
          </View>
        )}
      </GameLayout>

      {/* Tutorial */}
      <TutorialOverlay
        gameId="hilo"
        steps={TUTORIAL_STEPS}
        onComplete={() => setShowTutorial(false)}
        forceShow={showTutorial}
      />
    </>
  );
}

const styles = StyleSheet.create({
  gameArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  cardsContainer: {
    flexDirection: 'row',
    gap: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  messageWin: {
    color: COLORS.success,
  },
  messageLoss: {
    color: COLORS.error,
  },
  betContainer: {
    alignItems: 'center',
  },
  betLabel: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
  },
  betAmount: {
    color: COLORS.gold,
    ...TYPOGRAPHY.h2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  chipArea: {
    alignItems: 'center',
    paddingBottom: SPACING.lg,
  },
});
