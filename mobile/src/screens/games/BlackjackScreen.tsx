/**
 * Blackjack Game Screen - Jony Ive Redesigned
 * Hit/Stand always visible, Split/Double contextual
 */
import { View, Text, StyleSheet, InteractionManager, Pressable, Dimensions } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { DealtCard, DealtHiddenCard, ChipSelector, ChipPile } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton, BlackjackSkeleton, BetConfirmationModal } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useChipBetting, useBetSubmission, useBetConfirmation } from '../../hooks';
import {
  COLORS,
  SPACING,
  TYPOGRAPHY,
  RADIUS,
  GAME_LAYOUT_STYLES,
  MESSAGE_STYLES,
  BET_STYLES,
  ACTION_STYLES,
  HAND_STYLES,
} from '../../constants/theme';
import { decodeCardList, decodeStateBytes, parseBlackjackState } from '../../utils';
import type { ChipValue, TutorialStep, Card as CardType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface BlackjackState {
  playerCards: CardType[];
  dealerCards: CardType[];
  dealerHidden: boolean;
  playerTotal: number;
  dealerTotal: number;
  phase: 'betting' | 'player_turn' | 'dealer_turn' | 'result' | 'error';
  message: string;
  canDouble: boolean;
  canSplit: boolean;
  lastResult: 'win' | 'loss' | 'push' | 'blackjack' | null;
  parseError: string | null;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Beat the Dealer',
    description: 'Get closer to 21 than the dealer without going over. Face cards are 10, Aces are 1 or 11.',
  },
  {
    title: 'Your Turn',
    description: 'Hit to take another card. Stand to keep your hand. Double to double your bet and take one card.',
  },
  {
    title: 'Special Moves',
    description: 'Split appears when you have a pair. Blackjack (Ace + 10) pays 3:2!',
  },
];

export function BlackjackScreen() {
  // Shared hooks for connection, betting, and submission debouncing
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { bet, selectedChip, setSelectedChip, placeChip, clearBet, setBet, balance, placedChips } = useChipBetting();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);

  const [state, setState] = useState<BlackjackState>({
    playerCards: [],
    dealerCards: [],
    dealerHidden: true,
    playerTotal: 0,
    dealerTotal: 0,
    phase: 'betting',
    message: 'Place your bet',
    canDouble: false,
    canSplit: false,
    lastResult: null,
    parseError: null,
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [sideBet21Plus3, setSideBet21Plus3] = useState(0);
  // US-115: Track loading state during InteractionManager parsing
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

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'game_started' || lastMessage.type === 'game_move') {
      clearSubmission(); // Clear bet submission state on server response
      const stateBytes = decodeStateBytes((lastMessage as { state?: unknown }).state);
      if (!stateBytes) {
        if (__DEV__) {
          console.error('[Blackjack] Failed to decode state bytes from message');
        }
        setState((prev) => ({
          ...prev,
          phase: 'error',
          message: 'Failed to load game state. Please try again.',
          parseError: 'decode_failed',
        }));
        return;
      }

      // US-115: Show skeleton during state parsing
      setIsParsingState(true);

      InteractionManager.runAfterInteractions(() => {
        if (!isMounted.current) return;
        const parsed = parseBlackjackState(stateBytes);
        if (!parsed) {
          if (__DEV__) {
            console.error('[Blackjack] Failed to parse state blob');
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

        setState((prev) => ({
          ...prev,
          playerCards: parsed.playerCards,
          dealerCards: parsed.dealerCards,
          playerTotal: parsed.playerTotal,
          dealerTotal: parsed.dealerTotal,
          canDouble: parsed.canDouble,
          canSplit: parsed.canSplit,
          dealerHidden: parsed.dealerHidden,
          phase: parsed.phase,
          lastResult: parsed.phase === 'result' ? prev.lastResult : null,
          parseError: null,
          message: parsed.phase === 'betting'
            ? 'Place your bet'
            : parsed.phase === 'player_turn'
              ? 'Your turn'
              : parsed.phase === 'dealer_turn'
                ? 'Dealer\'s turn'
                : 'Round complete',
        }));
        setIsParsingState(false);
      });
      return;
    }

    if (lastMessage.type === 'game_result') {
      clearSubmission(); // Clear bet submission state on result
      const payload = lastMessage as Record<string, unknown>;
      const dealerInfo = payload.dealer as { cards?: number[]; value?: number } | undefined;
      const hands = Array.isArray(payload.hands)
        ? (payload.hands as { cards?: number[]; value?: number }[])
        : [];
      const mainHand = hands[0];

      const playerCards = mainHand?.cards ? decodeCardList(mainHand.cards) : null;
      const dealerCards = dealerInfo?.cards ? decodeCardList(dealerInfo.cards) : null;

      const won = (payload.won as boolean | undefined) ?? false;
      const push = (payload.push as boolean | undefined) ?? false;

      if (won) {
        haptics.win().catch(() => {});
      } else if (push) {
        haptics.push().catch(() => {});
      } else {
        haptics.loss().catch(() => {});
      }

      setState((prev) => ({
        ...prev,
        phase: 'result',
        dealerHidden: false,
        playerCards: playerCards ?? prev.playerCards,
        dealerCards: dealerCards ?? prev.dealerCards,
        playerTotal: typeof mainHand?.value === 'number' ? mainHand.value : prev.playerTotal,
        dealerTotal: typeof dealerInfo?.value === 'number' ? dealerInfo.value : prev.dealerTotal,
        canDouble: false,
        canSplit: false,
        lastResult: won ? 'win' : push ? 'push' : 'loss',
        message: typeof payload.message === 'string'
          ? payload.message
          : won
            ? 'You win!'
            : push
              ? 'Push'
              : 'Dealer wins',
      }));
      return;
    }

    if (lastMessage.type === 'error') {
      clearSubmission(); // Clear bet submission state on error
      setState((prev) => ({
        ...prev,
        // Revert to betting phase so user can try again
        phase: 'betting',
        message: typeof lastMessage.message === 'string' ? lastMessage.message : 'Action failed',
      }));
    }
  }, [lastMessage, clearSubmission]);

  // US-118: Execute the actual bet submission
  const executeDeal = useCallback(() => {
    if (bet === 0 || isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    // US-090: Pass total bet amount for atomic validation to prevent race conditions
    const totalBet = bet + sideBet21Plus3;
    const success = submitBet(
      {
        type: 'blackjack_deal',
        amount: bet,
        sideBet21Plus3,
      },
      { amount: totalBet }
    );

    if (success) {
      setState((prev) => ({
        ...prev,
        phase: 'player_turn',
        message: 'Your turn',
      }));
    }
  }, [bet, submitBet, sideBet21Plus3, isSubmitting]);

  // US-118: Bet confirmation modal integration
  const { showConfirmation, confirmationProps, requestConfirmation } = useBetConfirmation({
    gameType: 'blackjack',
    onConfirm: executeDeal,
    countdownSeconds: 5,
    autoConfirm: false,
  });

  // US-118: Handle deal with confirmation modal
  const handleDeal = useCallback(() => {
    if (bet === 0 || isSubmitting) return;

    const totalBet = bet + sideBet21Plus3;
    const sideBets = sideBet21Plus3 > 0
      ? [{ name: '21+3 Side Bet', amount: sideBet21Plus3 }]
      : undefined;

    requestConfirmation({
      amount: totalBet,
      sideBets,
    });
  }, [bet, sideBet21Plus3, isSubmitting, requestConfirmation]);

  const handleHit = useCallback(() => {
    haptics.buttonPress().catch(() => {});
    send({ type: 'blackjack_hit' });
  }, [send]);

  const handleStand = useCallback(() => {
    haptics.buttonPress().catch(() => {});
    send({ type: 'blackjack_stand' });
    setState((prev) => ({
      ...prev,
      phase: 'dealer_turn',
      message: 'Dealer\'s turn',
    }));
  }, [send]);

  const handleDouble = useCallback(() => {
    haptics.betConfirm().catch(() => {});
    send({ type: 'blackjack_double' });
    setBet(bet * 2);
  }, [send, bet, setBet]);

  const handleSplit = useCallback(() => {
    haptics.betConfirm().catch(() => {});
    send({ type: 'blackjack_split' });
  }, [send]);

  const handleToggle21Plus3 = useCallback(() => {
    if (state.phase !== 'betting') return;
    const nextAmount = sideBet21Plus3 > 0 ? 0 : selectedChip;
    if (bet + nextAmount > balance) {
      haptics.error().catch(() => {});
      setState((prev) => ({ ...prev, message: 'Insufficient balance' }));
      return;
    }
    haptics.buttonPress().catch(() => {});
    setSideBet21Plus3(nextAmount);
  }, [state.phase, sideBet21Plus3, selectedChip, bet, balance]);

  const handleNewGame = useCallback(() => {
    clearBet();
    setSideBet21Plus3(0);
    setState({
      playerCards: [],
      dealerCards: [],
      dealerHidden: true,
      playerTotal: 0,
      dealerTotal: 0,
      phase: 'betting',
      message: 'Place your bet',
      canDouble: false,
      canSplit: false,
      lastResult: null,
      parseError: null,
    });
  }, [clearBet]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.H]: () => state.phase === 'player_turn' && !isDisconnected && handleHit(),
    [KEY_ACTIONS.S]: () => state.phase === 'player_turn' && !isDisconnected && handleStand(),
    [KEY_ACTIONS.D]: () => state.phase === 'player_turn' && state.canDouble && !isDisconnected && handleDouble(),
    [KEY_ACTIONS.P]: () => state.phase === 'player_turn' && state.canSplit && !isDisconnected && handleSplit(),
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && bet > 0 && !isDisconnected) handleDeal();
      else if (state.phase === 'result') handleNewGame();
    },
    [KEY_ACTIONS.ESCAPE]: () => clearBet(),
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && handleChipPlace(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && handleChipPlace(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && handleChipPlace(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && handleChipPlace(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && handleChipPlace(500 as ChipValue),
  }), [state.phase, bet, state.canDouble, state.canSplit, isDisconnected, handleHit, handleStand, handleDouble, handleSplit, handleDeal, handleNewGame, clearBet, handleChipPlace]);

  useGameKeyboard(keyboardHandlers);

  // Get screen dimensions for dealer position (top-center)
  const { width: screenWidth } = Dimensions.get('window');
  const dealerPosition = useMemo(() => ({
    x: screenWidth / 2,
    y: -80, // Above visible game area
  }), [screenWidth]);

  return (
    <>
      <GameLayout
        title="Blackjack"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
        gameId="blackjack"
      >
        {/* US-115: Show skeleton during state parsing */}
        {isParsingState ? (
          <BlackjackSkeleton />
        ) : (
        <>
        {/* Game Area */}
        <View style={GAME_LAYOUT_STYLES.gameArea}>
          {/* Dealer's Hand */}
          <View style={GAME_LAYOUT_STYLES.handContainer} testID="dealer-hand">
            <Text style={HAND_STYLES.handLabel} testID="dealer-hand-label">
              Dealer {state.phase === 'result' && `(${state.dealerTotal})`}
            </Text>
            <View style={GAME_LAYOUT_STYLES.cards}>
              {state.dealerCards.map((card, i) => {
                const isFaceDown = i === 1 && state.dealerHidden;
                return isFaceDown ? (
                  <View
                    key={i}
                    style={[GAME_LAYOUT_STYLES.cardWrapper, { marginLeft: i > 0 ? -40 : 0 }]}
                  >
                    <DealtHiddenCard
                      dealIndex={i}
                      dealerPosition={dealerPosition}
                    />
                  </View>
                ) : (
                  <View
                    key={i}
                    style={[GAME_LAYOUT_STYLES.cardWrapper, { marginLeft: i > 0 ? -40 : 0 }]}
                  >
                    <DealtCard
                      suit={card.suit}
                      rank={card.rank}
                      faceUp={true}
                      dealIndex={i}
                      dealerPosition={dealerPosition}
                    />
                  </View>
                );
              })}
            </View>
          </View>

          {/* Message */}
          <Text
            testID="game-message"
            style={[
              MESSAGE_STYLES.message,
              state.lastResult === 'win' && MESSAGE_STYLES.messageWin,
              state.lastResult === 'blackjack' && MESSAGE_STYLES.messageBlackjack,
              state.lastResult === 'loss' && MESSAGE_STYLES.messageLoss,
              state.lastResult === 'push' && MESSAGE_STYLES.messagePush,
              state.phase === 'error' && MESSAGE_STYLES.messageError,
            ]}
          >
            {state.message}
          </Text>

          {/* Game Result indicator for E2E testing */}
          {state.phase === 'result' && (
            <Text testID={`game-result-${state.lastResult || 'unknown'}`} style={{ display: 'none' }}>
              {state.lastResult}
            </Text>
          )}

          {/* Player's Hand */}
          <View style={GAME_LAYOUT_STYLES.handContainer} testID="player-hand">
            <Text style={HAND_STYLES.handLabel} testID="player-hand-label">
              You ({state.playerTotal})
            </Text>
            <View style={GAME_LAYOUT_STYLES.cards}>
              {state.playerCards.map((card, i) => (
                <View
                  key={i}
                  style={[GAME_LAYOUT_STYLES.cardWrapper, { marginLeft: i > 0 ? -40 : 0 }]}
                >
                  <DealtCard
                    suit={card.suit}
                    rank={card.rank}
                    faceUp={true}
                    dealIndex={i}
                    dealerPosition={dealerPosition}
                  />
                </View>
              ))}
            </View>
          </View>

          {/* Bet Display - ChipPile visualization (US-122) */}
          {state.phase === 'betting' && (
            <ChipPile
              chips={placedChips}
              totalBet={bet}
              showCounter={true}
              testID="blackjack-chip-pile"
            />
          )}
          {state.phase !== 'betting' && bet > 0 && (
            <View style={BET_STYLES.betContainer}>
              <Text style={BET_STYLES.betLabel}>Bet</Text>
              <Text style={BET_STYLES.betAmount}>${bet}</Text>
            </View>
          )}

          {state.phase === 'betting' && (
            <Pressable
              onPress={handleToggle21Plus3}
              style={[
                styles.sideBetToggle,
                sideBet21Plus3 > 0 && styles.sideBetToggleActive,
              ]}
            >
              <Text style={styles.sideBetLabel}>21+3</Text>
              <Text style={styles.sideBetAmount}>
                {sideBet21Plus3 > 0 ? `$${sideBet21Plus3}` : 'OFF'}
              </Text>
            </Pressable>
          )}
        </View>

        {/* Actions */}
        <View style={ACTION_STYLES.actions}>
          {state.phase === 'betting' && (
            <PrimaryButton
              label="DEAL"
              onPress={handleDeal}
              disabled={bet === 0 || isDisconnected || isSubmitting}
              variant="primary"
              size="large"
              testID="deal-button"
            />
          )}

          {state.phase === 'player_turn' && (
            <>
              <PrimaryButton
                label="HIT"
                onPress={handleHit}
                disabled={isDisconnected}
                variant="primary"
                testID="action-hit"
              />
              <PrimaryButton
                label="STAND"
                onPress={handleStand}
                disabled={isDisconnected}
                variant="secondary"
                testID="action-stand"
              />
              {state.canDouble && (
                <PrimaryButton
                  label="DOUBLE"
                  onPress={handleDouble}
                  disabled={isDisconnected}
                  variant="secondary"
                  testID="action-double"
                />
              )}
              {state.canSplit && (
                <PrimaryButton
                  label="SPLIT"
                  onPress={handleSplit}
                  disabled={isDisconnected}
                  variant="secondary"
                  testID="action-split"
                />
              )}
            </>
          )}

          {state.phase === 'result' && (
            <PrimaryButton
              label="NEW GAME"
              onPress={handleNewGame}
              variant="primary"
              size="large"
              testID="new-game-button"
            />
          )}

          {state.phase === 'error' && (
            <PrimaryButton
              label="TRY AGAIN"
              onPress={handleNewGame}
              variant="primary"
              size="large"
              testID="try-again-button"
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
        </>
        )}
      </GameLayout>

      {/* Tutorial */}
      <TutorialOverlay
        gameId="blackjack"
        steps={TUTORIAL_STEPS}
        onComplete={() => setShowTutorial(false)}
        forceShow={showTutorial}
      />

      {/* US-118: Bet Confirmation Modal */}
      <BetConfirmationModal
        {...confirmationProps}
        testID="bet-confirmation-modal"
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Game-specific styles only - shared styles come from theme primitives
  sideBetToggle: {
    alignSelf: 'center',
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  sideBetToggleActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '20',
  },
  sideBetLabel: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
  },
  sideBetAmount: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.caption,
  },
});
