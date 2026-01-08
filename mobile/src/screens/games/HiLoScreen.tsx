/**
 * Hi-Lo Game Screen - Jony Ive Redesigned
 * Simple binary choice: Higher or Lower
 */
import { View, Text, InteractionManager } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton, HiLoSkeleton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useChipBetting, useBetSubmission } from '../../hooks';
import {
  SPRING,
  GAME_LAYOUT_STYLES,
  MESSAGE_STYLES,
  BET_STYLES,
  ACTION_STYLES,
  CHIP_AREA_STYLES,
} from '../../constants/theme';
import { decodeCardId, decodeStateBytes, parseHiLoState } from '../../utils';
import type { ChipValue, TutorialStep, Suit, Rank } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface HiLoState {
  currentCard: { suit: Suit; rank: Rank } | null;
  nextCard: { suit: Suit; rank: Rank } | null;
  phase: 'betting' | 'playing' | 'result' | 'error';
  message: string;
  lastResult: 'win' | 'loss' | null;
  parseError: string | null;
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
  // Shared hooks for connection, betting, and submission debouncing
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { bet, selectedChip, setSelectedChip, placeChip, clearBet, balance } = useChipBetting();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);

  const [state, setState] = useState<HiLoState>({
    currentCard: null,
    nextCard: null,
    phase: 'betting',
    message: 'Place your bet',
    lastResult: null,
    parseError: null,
  });
  const [showTutorial, setShowTutorial] = useState(false);
  // US-156: Track loading state during InteractionManager parsing
  const [isParsingState, setIsParsingState] = useState(false);

  // Track mounted state to prevent setState after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Wrap chip placement to check game phase
  const handleChipPlace = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;
    placeChip(value);
  }, [state.phase, placeChip]);

  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'game_started' || lastMessage.type === 'game_move') {
      clearSubmission(); // Clear bet submission state on server response
      const stateBytes = decodeStateBytes((lastMessage as { state?: unknown }).state);
      if (!stateBytes) {
        if (__DEV__) {
          console.error('[HiLo] Failed to decode state bytes from message');
        }
        setState((prev) => ({
          ...prev,
          phase: 'error',
          message: 'Failed to load game state. Please try again.',
          parseError: 'decode_failed',
        }));
        return;
      }

      // US-156: Show skeleton during state parsing
      setIsParsingState(true);
      InteractionManager.runAfterInteractions(() => {
        if (!isMounted.current) return;
        const parsed = parseHiLoState(stateBytes);
        if (!parsed?.currentCard) {
          if (__DEV__) {
            console.error('[HiLo] Failed to parse state blob');
          }
          setIsParsingState(false);
          setState((prev) => ({
            ...prev,
            phase: 'error',
            message: 'Failed to parse game data. Please try again.',
            parseError: 'parse_failed',
          }));
          return;
        }
        setIsParsingState(false);
        setState((prev) => ({
          ...prev,
          currentCard: parsed.currentCard,
          phase: 'playing',
          message: 'Make your call',
          parseError: null,
        }));
      });
      return;
    }

    if (lastMessage.type === 'game_result') {
      clearSubmission(); // Clear bet submission state on result
      const payload = lastMessage as Record<string, unknown>;
      const won = (payload.won as boolean | undefined) ?? false;
      const prevCardId = payload.previousCard ?? payload.card;
      const nextCardId = payload.newCard ?? payload.nextCard;
      const prevCard = typeof prevCardId === 'number' ? decodeCardId(prevCardId) : null;
      const nextCard = typeof nextCardId === 'number' ? decodeCardId(nextCardId) : null;

      if (won) {
        haptics.win().catch(() => {});
      } else {
        haptics.loss().catch(() => {});
      }
      setState((prev) => ({
        ...prev,
        phase: 'result',
        currentCard: prevCard ?? prev.currentCard,
        nextCard: nextCard ?? prev.nextCard,
        lastResult: won ? 'win' : 'loss',
        message: typeof payload.message === 'string' ? payload.message : won ? 'You win!' : 'You lose',
      }));
    }
  }, [lastMessage, clearSubmission]);

  const handleBet = useCallback((choice: 'higher' | 'lower') => {
    if (bet === 0 || state.phase !== 'betting' || isSubmitting) return;

    haptics.betConfirm().catch(() => {});

    // US-090: Pass bet amount for atomic validation
    const success = submitBet(
      {
        type: 'hilo_bet',
        amount: bet,
        choice,
      },
      { amount: bet }
    );

    if (success) {
      setState((prev) => ({
        ...prev,
        phase: 'playing',
        message: choice === 'higher' ? 'Higher...' : 'Lower...',
      }));
    }
  }, [bet, state.phase, submitBet, isSubmitting]);

  const handleNewGame = useCallback(() => {
    clearBet();
    setState((prev) => ({
      ...prev,
      phase: 'betting',
      nextCard: null,
      message: 'Place your bet',
      lastResult: null,
      parseError: null,
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

  const cardEnterFade = FadeIn.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);

  const cardEnterUp = SlideInUp.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);

  return (
    <>
      <GameLayout
        title="Hi-Lo"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
        gameId="hiLo"
      >
        {/* US-156: Show skeleton during state parsing */}
        {isParsingState ? (
          <HiLoSkeleton />
        ) : (
        <>
        {/* Game Area */}
        <View style={GAME_LAYOUT_STYLES.gameAreaCentered}>
          {/* Cards Display */}
          <View style={GAME_LAYOUT_STYLES.cardsWithGap}>
            {state.currentCard && (
              <Animated.View entering={cardEnterFade}>
                <Card
                  suit={state.currentCard.suit}
                  rank={state.currentCard.rank}
                  faceUp={true}
                  size="large"
                />
              </Animated.View>
            )}
            {state.nextCard && (
              <Animated.View entering={cardEnterUp}>
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
              MESSAGE_STYLES.message,
              state.lastResult === 'win' && MESSAGE_STYLES.messageWin,
              state.lastResult === 'loss' && MESSAGE_STYLES.messageLoss,
              state.phase === 'error' && MESSAGE_STYLES.messageError,
            ]}
          >
            {state.message}
          </Text>

          {/* Bet Display */}
          {bet > 0 && (
            <View style={BET_STYLES.betContainer}>
              <Text style={BET_STYLES.betLabel}>Bet</Text>
              <Text style={BET_STYLES.betAmount}>${bet}</Text>
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={ACTION_STYLES.actions}>
          {state.phase === 'betting' && (
            <>
              <PrimaryButton
                label="HIGHER"
                onPress={() => handleBet('higher')}
                disabled={bet === 0 || isDisconnected || isSubmitting}
                variant="primary"
                size="large"
              />
              <PrimaryButton
                label="LOWER"
                onPress={() => handleBet('lower')}
                disabled={bet === 0 || isDisconnected || isSubmitting}
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

          {state.phase === 'error' && (
            <PrimaryButton
              label="TRY AGAIN"
              onPress={handleNewGame}
              variant="primary"
              size="large"
            />
          )}
        </View>

        {/* Chip Selector */}
        {state.phase === 'betting' && (
          <View style={CHIP_AREA_STYLES.chipArea}>
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
        </>
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

// All styles now come from shared theme primitives:
// GAME_LAYOUT_STYLES, MESSAGE_STYLES, BET_STYLES, ACTION_STYLES, CHIP_AREA_STYLES
