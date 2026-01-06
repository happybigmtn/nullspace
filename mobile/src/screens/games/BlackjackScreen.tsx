/**
 * Blackjack Game Screen - Jony Ive Redesigned
 * Hit/Stand always visible, Split/Double contextual
 */
import { View, Text, StyleSheet, InteractionManager, Pressable } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { SlideInRight } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useChipBetting } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, SPRING, RADIUS } from '../../constants/theme';
import { decodeCardList, decodeStateBytes, parseBlackjackState } from '../../utils';
import type { ChipValue, TutorialStep, Card as CardType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface BlackjackState {
  playerCards: CardType[];
  dealerCards: CardType[];
  dealerHidden: boolean;
  playerTotal: number;
  dealerTotal: number;
  phase: 'betting' | 'player_turn' | 'dealer_turn' | 'result';
  message: string;
  canDouble: boolean;
  canSplit: boolean;
  lastResult: 'win' | 'loss' | 'push' | 'blackjack' | null;
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
  // Shared hooks for connection and betting
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { bet, selectedChip, setSelectedChip, placeChip, clearBet, setBet, balance } = useChipBetting();

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
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [sideBet21Plus3, setSideBet21Plus3] = useState(0);

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
      const stateBytes = decodeStateBytes((lastMessage as { state?: unknown }).state);
      if (!stateBytes) return;

      InteractionManager.runAfterInteractions(() => {
        if (!isMounted.current) return;
        const parsed = parseBlackjackState(stateBytes);
        if (!parsed) return;

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
          message: parsed.phase === 'betting'
            ? 'Place your bet'
            : parsed.phase === 'player_turn'
              ? 'Your turn'
              : parsed.phase === 'dealer_turn'
                ? 'Dealer\'s turn'
                : 'Round complete',
        }));
      });
      return;
    }

    if (lastMessage.type === 'game_result') {
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
        haptics.win();
      } else if (push) {
        haptics.push();
      } else {
        haptics.loss();
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
      setState((prev) => ({
        ...prev,
        message: typeof lastMessage.message === 'string' ? lastMessage.message : 'Action failed',
      }));
    }
  }, [lastMessage]);

  const handleDeal = useCallback(async () => {
    if (bet === 0) return;
    await haptics.betConfirm();

    send({
      type: 'blackjack_deal',
      amount: bet,
      sideBet21Plus3,
    });

    setState((prev) => ({
      ...prev,
      phase: 'player_turn',
      message: 'Your turn',
    }));
  }, [bet, send, sideBet21Plus3]);

  const handleHit = useCallback(async () => {
    await haptics.buttonPress();
    send({ type: 'blackjack_hit' });
  }, [send]);

  const handleStand = useCallback(async () => {
    await haptics.buttonPress();
    send({ type: 'blackjack_stand' });
    setState((prev) => ({
      ...prev,
      phase: 'dealer_turn',
      message: 'Dealer\'s turn',
    }));
  }, [send]);

  const handleDouble = useCallback(async () => {
    await haptics.betConfirm();
    send({ type: 'blackjack_double' });
    setBet(bet * 2);
  }, [send, bet, setBet]);

  const handleSplit = useCallback(async () => {
    await haptics.betConfirm();
    send({ type: 'blackjack_split' });
  }, [send]);

  const handleToggle21Plus3 = useCallback(async () => {
    if (state.phase !== 'betting') return;
    const nextAmount = sideBet21Plus3 > 0 ? 0 : selectedChip;
    if (bet + nextAmount > balance) {
      haptics.error();
      setState((prev) => ({ ...prev, message: 'Insufficient balance' }));
      return;
    }
    await haptics.buttonPress();
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
  const cardEnter = SlideInRight.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);

  return (
    <>
      <GameLayout
        title="Blackjack"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
      >
        {/* Game Area */}
        <View style={styles.gameArea}>
          {/* Dealer's Hand */}
          <View style={styles.handContainer}>
            <Text style={styles.handLabel}>
              Dealer {state.phase === 'result' && `(${state.dealerTotal})`}
            </Text>
            <View style={styles.cards}>
              {state.dealerCards.map((card, i) => (
                <Animated.View
                  key={i}
                  entering={cardEnter.delay(i * 100)}
                  style={[styles.cardWrapper, { marginLeft: i > 0 ? -40 : 0 }]}
                >
                  <Card
                    suit={card.suit}
                    rank={card.rank}
                    faceUp={!(i === 1 && state.dealerHidden)}
                  />
                </Animated.View>
              ))}
            </View>
          </View>

          {/* Message */}
          <Text
            style={[
              styles.message,
              state.lastResult === 'win' && styles.messageWin,
              state.lastResult === 'blackjack' && styles.messageBlackjack,
              state.lastResult === 'loss' && styles.messageLoss,
              state.lastResult === 'push' && styles.messagePush,
            ]}
          >
            {state.message}
          </Text>

          {/* Player's Hand */}
          <View style={styles.handContainer}>
            <Text style={styles.handLabel}>
              You ({state.playerTotal})
            </Text>
            <View style={styles.cards}>
              {state.playerCards.map((card, i) => (
                <Animated.View
                  key={i}
                  entering={cardEnter.delay(i * 100)}
                  style={[styles.cardWrapper, { marginLeft: i > 0 ? -40 : 0 }]}
                >
                  <Card suit={card.suit} rank={card.rank} faceUp={true} />
                </Animated.View>
              ))}
            </View>
          </View>

          {/* Bet Display */}
          {bet > 0 && (
            <View style={styles.betContainer}>
              <Text style={styles.betLabel}>Bet</Text>
              <Text style={styles.betAmount}>${bet}</Text>
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
        <View style={styles.actions}>
          {state.phase === 'betting' && (
            <PrimaryButton
              label="DEAL"
              onPress={handleDeal}
              disabled={bet === 0 || isDisconnected}
              variant="primary"
              size="large"
            />
          )}

          {state.phase === 'player_turn' && (
            <>
              <PrimaryButton
                label="HIT"
                onPress={handleHit}
                disabled={isDisconnected}
                variant="primary"
              />
              <PrimaryButton
                label="STAND"
                onPress={handleStand}
                disabled={isDisconnected}
                variant="secondary"
              />
              {state.canDouble && (
                <PrimaryButton
                  label="DOUBLE"
                  onPress={handleDouble}
                  disabled={isDisconnected}
                  variant="secondary"
                />
              )}
              {state.canSplit && (
                <PrimaryButton
                  label="SPLIT"
                  onPress={handleSplit}
                  disabled={isDisconnected}
                  variant="secondary"
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

      {/* Tutorial */}
      <TutorialOverlay
        gameId="blackjack"
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
    justifyContent: 'space-around',
    paddingHorizontal: SPACING.md,
  },
  handContainer: {
    alignItems: 'center',
  },
  handLabel: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
    marginBottom: SPACING.sm,
  },
  cards: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
  },
  messageWin: {
    color: COLORS.success,
  },
  messageBlackjack: {
    color: COLORS.gold,
  },
  messageLoss: {
    color: COLORS.error,
  },
  messagePush: {
    color: COLORS.warning,
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
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
});
