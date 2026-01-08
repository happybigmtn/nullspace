/**
 * Video Poker Game Screen - Jony Ive Redesigned
 * 5 card draw with hold selection, pay table modal
 */
import { View, Text, StyleSheet, Pressable, Modal, InteractionManager } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton, BetConfirmationModal } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useChipBetting, useModalBackHandler, useBetSubmission, useBetConfirmation } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, SPRING } from '../../constants/theme';
import { decodeStateBytes, parseNumeric, parseVideoPokerState } from '../../utils';
import type { ChipValue, TutorialStep, PokerHand, Card as CardType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface VideoPokerState {
  cards: CardType[];
  held: boolean[];
  phase: 'betting' | 'initial' | 'final' | 'result' | 'error';
  message: string;
  hand: PokerHand | null;
  payout: number;
  parseError: string | null;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Get Dealt 5 Cards',
    description: 'Place your bet and get 5 cards. Look for pairs, straights, flushes, and more!',
  },
  {
    title: 'Hold or Discard',
    description: 'Tap cards you want to HOLD. Unheld cards are replaced on the draw.',
  },
  {
    title: 'Jacks or Better',
    description: 'Minimum winning hand is a pair of Jacks. Royal Flush pays 800:1!',
  },
];

const PAY_TABLE: Record<PokerHand, number> = {
  ROYAL_FLUSH: 800,
  STRAIGHT_FLUSH: 50,
  FOUR_OF_A_KIND: 25,
  FULL_HOUSE: 9,
  FLUSH: 6,
  STRAIGHT: 4,
  THREE_OF_A_KIND: 3,
  TWO_PAIR: 2,
  JACKS_OR_BETTER: 1,
  NOTHING: 0,
};

const HAND_NAMES: Record<PokerHand, string> = {
  ROYAL_FLUSH: 'Royal Flush',
  STRAIGHT_FLUSH: 'Straight Flush',
  FOUR_OF_A_KIND: 'Four of a Kind',
  FULL_HOUSE: 'Full House',
  FLUSH: 'Flush',
  STRAIGHT: 'Straight',
  THREE_OF_A_KIND: 'Three of a Kind',
  TWO_PAIR: 'Two Pair',
  JACKS_OR_BETTER: 'Jacks or Better',
  NOTHING: 'No Win',
};

export function VideoPokerScreen() {
  // Shared hooks for connection, betting, and submission debouncing
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { bet, selectedChip, setSelectedChip, placeChip, clearBet, balance } = useChipBetting();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);

  const [state, setState] = useState<VideoPokerState>({
    cards: [],
    held: [false, false, false, false, false],
    phase: 'betting',
    message: 'Place your bet',
    hand: null,
    payout: 0,
    parseError: null,
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [showPayTable, setShowPayTable] = useState(false);

  useModalBackHandler(showPayTable, () => setShowPayTable(false));

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

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'game_started' || lastMessage.type === 'game_move') {
      clearSubmission(); // Clear bet submission state on server response
      const stateBytes = decodeStateBytes((lastMessage as { state?: unknown }).state);
      if (!stateBytes) {
        if (__DEV__) {
          console.error('[VideoPoker] Failed to decode state bytes from message');
        }
        setState((prev) => ({
          ...prev,
          phase: 'error',
          message: 'Failed to load game state. Please try again.',
          parseError: 'decode_failed',
        }));
        return;
      }
      InteractionManager.runAfterInteractions(() => {
        if (!isMounted.current) return;
        const parsed = parseVideoPokerState(stateBytes);
        if (!parsed) {
          if (__DEV__) {
            console.error('[VideoPoker] Failed to parse state blob');
          }
          setState((prev) => ({
            ...prev,
            phase: 'error',
            message: 'Failed to parse game data. Please try again.',
            parseError: 'parse_failed',
          }));
          return;
        }
        setState((prev) => ({
          ...prev,
          cards: parsed.cards,
          phase: parsed.stage === 'draw' ? 'initial' : 'betting',
          message: parsed.stage === 'draw' ? 'Tap cards to HOLD, then DRAW' : 'Place your bet',
          parseError: null,
        }));
      });
      return;
    }

    if (lastMessage.type === 'game_result') {
      clearSubmission(); // Clear bet submission state on result
      const payload = lastMessage as Record<string, unknown>;
      const payout = parseNumeric(payload.payout ?? payload.totalReturn) ?? 0;
      const hand = typeof payload.hand === 'string' ? payload.hand as PokerHand : null;
      if (payout > 0) {
        if (hand === 'ROYAL_FLUSH') {
          haptics.jackpot().catch(() => {});
        } else {
          haptics.win().catch(() => {});
        }
      } else {
        haptics.loss().catch(() => {});
      }

      setState((prev) => ({
        ...prev,
        phase: 'result',
        hand,
        payout,
        message: typeof payload.message === 'string'
          ? payload.message
          : payout > 0 && hand
            ? HAND_NAMES[hand]
            : 'No winning hand',
      }));
    }
  }, [lastMessage, clearSubmission]);

  /**
   * Execute the deal after confirmation (US-155)
   */
  const executeDeal = useCallback(() => {
    if (bet === 0 || isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    // US-090: Pass bet amount for atomic validation
    submitBet(
      {
        type: 'video_poker_deal',
        amount: bet,
      },
      { amount: bet }
    );
  }, [bet, submitBet, isSubmitting]);

  // US-155: Bet confirmation modal integration
  const { showConfirmation, confirmationProps, requestConfirmation } = useBetConfirmation({
    gameType: 'video_poker',
    onConfirm: executeDeal,
    countdownSeconds: 5,
  });

  /**
   * Handle deal button - triggers confirmation modal (US-155)
   */
  const handleDeal = useCallback(() => {
    if (bet === 0 || isSubmitting) return;

    // US-155: Show confirmation modal
    requestConfirmation({
      amount: bet,
    });
  }, [bet, isSubmitting, requestConfirmation]);

  const handleToggleHold = useCallback((index: number) => {
    if (state.phase !== 'initial') return;
    haptics.selectionChange().catch(() => {});

    setState((prev) => {
      const newHeld = [...prev.held];
      newHeld[index] = !newHeld[index];
      return { ...prev, held: newHeld };
    });
  }, [state.phase]);

  const handleDraw = useCallback(() => {
    if (isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    const success = submitBet({
      type: 'video_poker_draw',
      held: state.held,
    });

    if (success) {
      setState((prev) => ({
        ...prev,
        phase: 'final',
        message: 'Drawing...',
      }));
    }
  }, [state.held, submitBet, isSubmitting]);

  const handleNewGame = useCallback(() => {
    clearBet();
    setState({
      cards: [],
      held: [false, false, false, false, false],
      phase: 'betting',
      message: 'Place your bet',
      hand: null,
      payout: 0,
      parseError: null,
    });
  }, [clearBet]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && bet > 0 && !isDisconnected) handleDeal();
      else if (state.phase === 'initial' && !isDisconnected) handleDraw();
      else if (state.phase === 'result') handleNewGame();
    },
    [KEY_ACTIONS.ESCAPE]: () => clearBet(),
    [KEY_ACTIONS.ONE]: () => {
      if (state.phase === 'betting') handleChipPlace(1 as ChipValue);
      else if (state.phase === 'initial') handleToggleHold(0);
    },
    [KEY_ACTIONS.TWO]: () => {
      if (state.phase === 'betting') handleChipPlace(5 as ChipValue);
      else if (state.phase === 'initial') handleToggleHold(1);
    },
    [KEY_ACTIONS.THREE]: () => {
      if (state.phase === 'betting') handleChipPlace(25 as ChipValue);
      else if (state.phase === 'initial') handleToggleHold(2);
    },
    [KEY_ACTIONS.FOUR]: () => {
      if (state.phase === 'betting') handleChipPlace(100 as ChipValue);
      else if (state.phase === 'initial') handleToggleHold(3);
    },
    [KEY_ACTIONS.FIVE]: () => {
      if (state.phase === 'betting') handleChipPlace(500 as ChipValue);
      else if (state.phase === 'initial') handleToggleHold(4);
    },
  }), [state.phase, bet, isDisconnected, handleDeal, handleDraw, handleNewGame, clearBet, handleChipPlace, handleToggleHold]);

  useGameKeyboard(keyboardHandlers);

  const cardEnterFade = FadeIn.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);

  return (
    <>
      <GameLayout
        title="Video Poker"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
        headerRightContent={
          <Pressable
            onPress={() => setShowPayTable(true)}
            style={styles.payTableButton}
          >
            <Text style={styles.payTableText}>Pay Table</Text>
          </Pressable>
        }
        gameId="videoPoker"
      >
        {/* Game Area */}
      <View style={styles.gameArea}>
        {/* Cards Display */}
        <View style={styles.cardsContainer}>
          {state.cards.length > 0 ? (
            state.cards.map((card, i) => (
              <Pressable
                key={i}
                onPress={() => handleToggleHold(i)}
                disabled={state.phase !== 'initial'}
              >
                <Animated.View
                  entering={cardEnterFade.delay(i * 100)}
                  style={[
                    styles.cardWrapper,
                    state.held[i] && styles.cardHeld,
                  ]}
                >
                  <Card suit={card.suit} rank={card.rank} faceUp={true} />
                  {state.held[i] && (
                    <View style={styles.holdBadge}>
                      <Text style={styles.holdText}>HOLD</Text>
                    </View>
                  )}
                </Animated.View>
              </Pressable>
            ))
          ) : (
            Array.from({ length: 5 }).map((_, i) => (
              <View key={i} style={styles.cardPlaceholder} />
            ))
          )}
        </View>

        {/* Message / Hand */}
        <Text
          style={[
            styles.message,
            state.payout > 0 && styles.messageWin,
            state.phase === 'error' && styles.messageError,
          ]}
        >
          {state.message}
        </Text>

        {/* Payout */}
        {state.payout > 0 && (
          <Text style={styles.payout}>+${state.payout}</Text>
        )}

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
          <PrimaryButton
            label="DEAL"
            onPress={handleDeal}
            disabled={bet === 0 || isDisconnected || isSubmitting}
            variant="primary"
            size="large"
          />
        )}

        {state.phase === 'initial' && (
          <PrimaryButton
            label="DRAW"
            onPress={handleDraw}
            disabled={isDisconnected || isSubmitting}
            variant="primary"
            size="large"
          />
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
        <ChipSelector
          selectedValue={selectedChip}
          onSelect={setSelectedChip}
          onChipPlace={handleChipPlace}
        />
      )}
      </GameLayout>

      {/* Pay Table Modal */}
      <Modal visible={showPayTable} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.payTableModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pay Table</Text>
              <Pressable onPress={() => setShowPayTable(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>

            {(Object.entries(PAY_TABLE) as [PokerHand, number][])
              .filter(([, pay]) => pay > 0)
              .map(([hand, pay]) => (
                <View key={hand} style={styles.payRow}>
                  <Text style={styles.handName}>{HAND_NAMES[hand]}</Text>
                  <Text style={styles.payAmount}>{pay}:1</Text>
                </View>
              ))}
          </View>
        </View>
      </Modal>

      {/* Tutorial */}
      <TutorialOverlay
        gameId="video_poker"
        steps={TUTORIAL_STEPS}
        onComplete={() => setShowTutorial(false)}
        forceShow={showTutorial}
      />

      {/* US-155: Bet Confirmation Modal */}
      <BetConfirmationModal
        {...confirmationProps}
        testID="bet-confirmation-modal"
      />
    </>
  );
}

const styles = StyleSheet.create({
  payTableButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
  },
  payTableText: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.bodySmall,
  },
  gameArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.sm,
  },
  cardsContainer: {
    flexDirection: 'row',
    gap: SPACING.xs,
    marginBottom: SPACING.lg,
  },
  cardWrapper: {
    alignItems: 'center',
  },
  cardHeld: {
    transform: [{ translateY: -10 }],
  },
  holdBadge: {
    position: 'absolute',
    bottom: -8,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  holdText: {
    color: COLORS.background,
    fontSize: 10,
    fontWeight: 'bold',
  },
  cardPlaceholder: {
    width: 60,
    height: 90,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  messageWin: {
    color: COLORS.success,
  },
  messageError: {
    color: COLORS.error,
  },
  payout: {
    color: COLORS.gold,
    ...TYPOGRAPHY.displayMedium,
    textAlign: 'center',
    marginBottom: SPACING.md,
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
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  payTableModal: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    width: '100%',
    maxWidth: 320,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  modalTitle: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.h2,
  },
  modalClose: {
    color: COLORS.textSecondary,
    fontSize: 24,
    padding: SPACING.xs,
  },
  payRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  handName: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.body,
  },
  payAmount: {
    color: COLORS.gold,
    ...TYPOGRAPHY.label,
  },
});
