/**
 * Three Card Poker Game Screen - Jony Ive Redesigned
 * Ante/Play with optional Pair Plus side bet
 */
import { View, Text, StyleSheet, Pressable, InteractionManager } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton, BetConfirmationModal } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useBetSubmission, useBetConfirmation } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, SPRING } from '../../constants/theme';
import { decodeCardList, decodeStateBytes, parseThreeCardState, parseNumeric } from '../../utils';
import { useGameStore } from '../../stores/gameStore';
import type { ChipValue, TutorialStep, ThreeCardPokerHand, Card as CardType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface ThreeCardPokerState {
  anteBet: number;
  pairPlusBet: number;
  sixCardBet: number;
  progressiveBet: number;
  playerCards: CardType[];
  dealerCards: CardType[];
  dealerRevealed: boolean;
  phase: 'betting' | 'dealt' | 'showdown' | 'result' | 'error';
  message: string;
  playerHand: ThreeCardPokerHand | null;
  dealerHand: ThreeCardPokerHand | null;
  dealerQualifies: boolean;
  anteResult: 'win' | 'loss' | 'push' | null;
  pairPlusResult: 'win' | 'loss' | null;
  payout: number;
  parseError: string | null;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Ante to Play',
    description: 'Place an Ante bet to receive 3 cards. Pair Plus is an optional side bet that pays on your hand alone.',
  },
  {
    title: 'Play or Fold',
    description: 'After seeing your cards, Play (match Ante) to continue, or Fold (lose Ante). Simple decision!',
  },
  {
    title: 'Dealer Qualifies',
    description: 'Dealer needs Queen-high or better to qualify. If not, Ante pays 1:1 and Play pushes.',
  },
];

const HAND_NAMES: Record<ThreeCardPokerHand, string> = {
  STRAIGHT_FLUSH: 'Straight Flush',
  THREE_OF_A_KIND: 'Three of a Kind',
  STRAIGHT: 'Straight',
  FLUSH: 'Flush',
  PAIR: 'Pair',
  HIGH_CARD: 'High Card',
};

export function ThreeCardPokerScreen() {
  // Shared hook for connection (ThreeCardPoker has multi-bet so keeps custom bet state)
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { balance } = useGameStore();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);

  const [state, setState] = useState<ThreeCardPokerState>({
    anteBet: 0,
    pairPlusBet: 0,
    sixCardBet: 0,
    progressiveBet: 0,
    playerCards: [],
    dealerCards: [],
    dealerRevealed: false,
    phase: 'betting',
    message: 'Place your Ante',
    playerHand: null,
    dealerHand: null,
    dealerQualifies: false,
    anteResult: null,
    pairPlusResult: null,
    payout: 0,
    parseError: null,
  });
  const [selectedChip, setSelectedChip] = useState<ChipValue>(25);
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeBetType, setActiveBetType] = useState<'ante' | 'pairplus' | 'sixcard' | 'progressive'>('ante');

  // Track mounted state to prevent setState after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'game_started' || lastMessage.type === 'game_move') {
      clearSubmission(); // Clear bet submission state on server response
      const stateBytes = decodeStateBytes((lastMessage as { state?: unknown }).state);
      if (!stateBytes) {
        if (__DEV__) {
          console.error('[ThreeCardPoker] Failed to decode state bytes from message');
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
        const parsed = parseThreeCardState(stateBytes);
        if (!parsed) {
          if (__DEV__) {
            console.error('[ThreeCardPoker] Failed to parse state blob');
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
          playerCards: parsed.playerCards.length > 0 ? parsed.playerCards : prev.playerCards,
          dealerCards: parsed.dealerCards.length > 0 ? parsed.dealerCards : prev.dealerCards,
          pairPlusBet: parsed.pairPlusBet > 0 ? parsed.pairPlusBet : prev.pairPlusBet,
          sixCardBet: parsed.sixCardBonusBet > 0 ? parsed.sixCardBonusBet : prev.sixCardBet,
          progressiveBet: parsed.progressiveBet > 0 ? parsed.progressiveBet : prev.progressiveBet,
          dealerRevealed: parsed.stage === 'awaiting' || parsed.stage === 'complete',
          parseError: null,
          phase: parsed.stage === 'decision'
            ? 'dealt'
            : parsed.stage === 'awaiting'
              ? 'showdown'
              : parsed.stage === 'complete'
                ? 'result'
                : 'betting',
          message: parsed.stage === 'decision'
            ? 'Play or Fold?'
            : parsed.stage === 'awaiting'
              ? 'Revealing dealer...'
              : parsed.stage === 'complete'
                ? 'Round complete'
                : 'Place your Ante',
        }));
      });
      return;
    }

    if (lastMessage.type === 'game_result') {
      clearSubmission(); // Clear bet submission state on result
      const payload = lastMessage as Record<string, unknown>;
      const payout = parseNumeric(payload.totalReturn ?? payload.payout) ?? 0;
      const player = payload.player as { cards?: number[]; rank?: ThreeCardPokerHand } | undefined;
      const dealer = payload.dealer as { cards?: number[]; rank?: ThreeCardPokerHand; qualifies?: boolean } | undefined;
      const anteReturn = parseNumeric(payload.anteReturn) ?? 0;
      const anteBet = parseNumeric(payload.anteBet) ?? state.anteBet;
      const pairPlusReturn = parseNumeric(payload.pairplusReturn) ?? 0;
      const pairPlusBet = parseNumeric(payload.pairplusBet) ?? state.pairPlusBet;

      if (payout > 0) {
        if (player?.rank === 'STRAIGHT_FLUSH') {
          haptics.jackpot().catch(() => {});
        } else {
          haptics.win().catch(() => {});
        }
      } else {
        haptics.loss().catch(() => {});
      }

      setState((prev) => ({
        ...prev,
        playerCards: player?.cards ? decodeCardList(player.cards) : prev.playerCards,
        dealerCards: dealer?.cards ? decodeCardList(dealer.cards) : prev.dealerCards,
        dealerRevealed: true,
        playerHand: player?.rank ?? prev.playerHand,
        dealerHand: dealer?.rank ?? prev.dealerHand,
        dealerQualifies: dealer?.qualifies ?? prev.dealerQualifies,
        phase: 'result',
        anteResult: anteReturn > anteBet ? 'win' : anteReturn === anteBet ? 'push' : 'loss',
        pairPlusResult: pairPlusBet > 0 ? (pairPlusReturn > pairPlusBet ? 'win' : 'loss') : null,
        payout,
        message: typeof payload.message === 'string' ? payload.message : payout > 0 ? 'You win!' : 'Dealer wins',
      }));
    }
  }, [lastMessage, state.anteBet, state.pairPlusBet, clearSubmission]);

  const handleChipPlace = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;

    // Calculate current total bet
    const currentTotalBet = state.anteBet + state.pairPlusBet + state.sixCardBet + state.progressiveBet;
    if (activeBetType === 'progressive') {
      const progressiveUnit = 1;
      if (currentTotalBet + (state.progressiveBet > 0 ? 0 : progressiveUnit) > balance) {
        haptics.error().catch(() => {});
        return;
      }
      haptics.chipPlace().catch(() => {});
      setState((prev) => ({
        ...prev,
        progressiveBet: prev.progressiveBet > 0 ? 0 : progressiveUnit,
      }));
      return;
    }
    if (currentTotalBet + value > balance) {
      haptics.error().catch(() => {});
      return;
    }

    haptics.chipPlace().catch(() => {});

    setState((prev) => ({
      ...prev,
      anteBet: activeBetType === 'ante' ? prev.anteBet + value : prev.anteBet,
      pairPlusBet: activeBetType === 'pairplus' ? prev.pairPlusBet + value : prev.pairPlusBet,
      sixCardBet: activeBetType === 'sixcard' ? prev.sixCardBet + value : prev.sixCardBet,
    }));
  }, [state.phase, activeBetType, state.anteBet, state.pairPlusBet, state.sixCardBet, state.progressiveBet, balance]);

  /**
   * Execute the deal after confirmation (US-155)
   */
  const executeDeal = useCallback(() => {
    if (state.anteBet === 0 || isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    // US-090: Calculate total bet for atomic validation
    const totalBetAmount = state.anteBet + state.pairPlusBet + state.sixCardBet + state.progressiveBet;
    const success = submitBet(
      {
        type: 'three_card_poker_deal',
        ante: state.anteBet,
        pairPlus: state.pairPlusBet,
        sixCard: state.sixCardBet,
        progressive: state.progressiveBet,
      },
      { amount: totalBetAmount }
    );

    if (success) {
      setState((prev) => ({
        ...prev,
        message: 'Dealing...',
      }));
    }
  }, [state.anteBet, state.pairPlusBet, state.sixCardBet, state.progressiveBet, submitBet, isSubmitting]);

  // US-155: Bet confirmation modal integration
  const { showConfirmation, confirmationProps, requestConfirmation } = useBetConfirmation({
    gameType: 'three_card',
    onConfirm: executeDeal,
    countdownSeconds: 5,
  });

  /**
   * Handle deal button - triggers confirmation modal (US-155)
   */
  const handleDeal = useCallback(() => {
    if (state.anteBet === 0 || isSubmitting) return;

    // US-155: Calculate total bet and show confirmation
    const totalBetAmount = state.anteBet + state.pairPlusBet + state.sixCardBet + state.progressiveBet;
    const sideBets: { name: string; amount: number }[] = [];
    if (state.pairPlusBet > 0) sideBets.push({ name: 'Pair Plus', amount: state.pairPlusBet });
    if (state.sixCardBet > 0) sideBets.push({ name: '6 Card Bonus', amount: state.sixCardBet });
    if (state.progressiveBet > 0) sideBets.push({ name: 'Progressive', amount: state.progressiveBet });

    requestConfirmation({
      amount: totalBetAmount,
      sideBets: sideBets.length > 0 ? sideBets : undefined,
    });
  }, [state.anteBet, state.pairPlusBet, state.sixCardBet, state.progressiveBet, isSubmitting, requestConfirmation]);

  const handlePlay = useCallback(() => {
    if (isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    const success = submitBet({
      type: 'three_card_poker_play',
    });

    if (success) {
      setState((prev) => ({
        ...prev,
        phase: 'showdown',
        message: 'Revealing dealer...',
      }));
    }
  }, [submitBet, isSubmitting]);

  const handleFold = useCallback(() => {
    if (isSubmitting) return;
    haptics.buttonPress().catch(() => {});

    submitBet({
      type: 'three_card_poker_fold',
    });

    setState((prev) => ({
      ...prev,
      phase: 'result',
      anteResult: 'loss',
      message: 'Folded',
    }));
  }, [submitBet, isSubmitting]);

  const handleNewGame = useCallback(() => {
    setState({
      anteBet: 0,
      pairPlusBet: 0,
      sixCardBet: 0,
      progressiveBet: 0,
      playerCards: [],
      dealerCards: [],
      dealerRevealed: false,
      phase: 'betting',
      message: 'Place your Ante',
      playerHand: null,
      dealerHand: null,
      dealerQualifies: false,
      anteResult: null,
      pairPlusResult: null,
      payout: 0,
      parseError: null,
    });
    setActiveBetType('ante');
  }, []);

  const handleClearBets = useCallback(() => {
    if (state.phase !== 'betting') return;
    setState((prev) => ({ ...prev, anteBet: 0, pairPlusBet: 0, sixCardBet: 0, progressiveBet: 0 }));
  }, [state.phase]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && state.anteBet > 0 && !isDisconnected) handleDeal();
      else if (state.phase === 'dealt' && !isDisconnected) handlePlay();
      else if (state.phase === 'result') handleNewGame();
    },
    [KEY_ACTIONS.ESCAPE]: () => {
      if (state.phase === 'betting') handleClearBets();
      else if (state.phase === 'dealt' && !isDisconnected) handleFold();
    },
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && handleChipPlace(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && handleChipPlace(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && handleChipPlace(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && handleChipPlace(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && handleChipPlace(500 as ChipValue),
  }), [state.phase, state.anteBet, isDisconnected, handleDeal, handlePlay, handleFold, handleNewGame, handleClearBets, handleChipPlace]);

  useGameKeyboard(keyboardHandlers);

  const cardEnterUp = SlideInUp.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);

  const cardEnterFade = FadeIn.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);

  return (
    <>
      <GameLayout
        title="Three Card Poker"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
        gameId="threeCard"
      >
        {/* Game Area */}
      <View style={styles.gameArea}>
        {/* Dealer Hand */}
        <View style={styles.handContainer}>
          <Text style={styles.handLabel}>DEALER</Text>
          <View style={styles.cards}>
            {state.dealerCards.length > 0 ? (
              state.dealerCards.map((card, i) => (
                <Animated.View
                  key={i}
                  entering={cardEnterUp.delay(i * 100 + 300)}
                  style={[styles.cardWrapper, { marginLeft: i > 0 ? -20 : 0 }]}
                >
                  <Card
                    suit={card.suit}
                    rank={card.rank}
                    faceUp={state.dealerRevealed}
                  />
                </Animated.View>
              ))
            ) : (
              <View style={styles.cardPlaceholder} />
            )}
          </View>
          {state.dealerHand && state.dealerRevealed && (
            <Text style={styles.handName}>
              {HAND_NAMES[state.dealerHand]}
              {!state.dealerQualifies && ' (No Qualify)'}
            </Text>
          )}
        </View>

        {/* Message */}
        <Text
          style={[
            styles.message,
            state.payout > 0 && styles.messageWin,
            state.anteResult === 'loss' && styles.messageLoss,
            state.phase === 'error' && styles.messageError,
          ]}
        >
          {state.message}
        </Text>

        {/* Payout */}
        {state.payout > 0 && (
          <Text style={styles.payout}>+${state.payout}</Text>
        )}

        {/* Player Hand */}
        <View style={styles.handContainer}>
          <Text style={styles.handLabel}>YOUR HAND</Text>
          <View style={styles.cards}>
            {state.playerCards.length > 0 ? (
              state.playerCards.map((card, i) => (
                <Animated.View
                  key={i}
                  entering={cardEnterFade.delay(i * 100)}
                  style={[styles.cardWrapper, { marginLeft: i > 0 ? -20 : 0 }]}
                >
                  <Card suit={card.suit} rank={card.rank} faceUp={true} />
                </Animated.View>
              ))
            ) : (
              <View style={styles.cardPlaceholder} />
            )}
          </View>
          {state.playerHand && (
            <Text style={styles.handName}>{HAND_NAMES[state.playerHand]}</Text>
          )}
        </View>
      </View>

      {/* Betting Spots */}
      {state.phase === 'betting' && (
        <View style={styles.betSpots}>
          <Pressable
            onPress={() => setActiveBetType('ante')}
            style={[
              styles.betSpot,
              activeBetType === 'ante' && styles.betSpotActive,
            ]}
          >
            <Text style={styles.betSpotLabel}>ANTE</Text>
            {state.anteBet > 0 && (
              <Text style={styles.betSpotAmount}>${state.anteBet}</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => setActiveBetType('pairplus')}
            style={[
              styles.betSpot,
              activeBetType === 'pairplus' && styles.betSpotActive,
            ]}
          >
            <Text style={styles.betSpotLabel}>PAIR+</Text>
            {state.pairPlusBet > 0 && (
              <Text style={styles.betSpotAmount}>${state.pairPlusBet}</Text>
            )}
            <Text style={styles.betSpotOdds}>40:1 max</Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveBetType('sixcard')}
            style={[
              styles.betSpot,
              activeBetType === 'sixcard' && styles.betSpotActive,
            ]}
          >
            <Text style={styles.betSpotLabel}>6-CARD</Text>
            {state.sixCardBet > 0 && (
              <Text style={styles.betSpotAmount}>${state.sixCardBet}</Text>
            )}
            <Text style={styles.betSpotOdds}>1000:1 max</Text>
          </Pressable>

          <Pressable
            onPress={() => setActiveBetType('progressive')}
            style={[
              styles.betSpot,
              activeBetType === 'progressive' && styles.betSpotActive,
            ]}
          >
            <Text style={styles.betSpotLabel}>PROG</Text>
            {state.progressiveBet > 0 && (
              <Text style={styles.betSpotAmount}>${state.progressiveBet}</Text>
            )}
            <Text style={styles.betSpotOdds}>$1 unit</Text>
          </Pressable>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {state.phase === 'betting' && (
          <PrimaryButton
            label="DEAL"
            onPress={handleDeal}
            disabled={state.anteBet === 0 || isDisconnected || isSubmitting}
            variant="primary"
            size="large"
          />
        )}

        {state.phase === 'dealt' && (
          <>
            <PrimaryButton
              label={`PLAY ($${state.anteBet})`}
              onPress={handlePlay}
              disabled={isDisconnected || isSubmitting}
              variant="primary"
              size="large"
            />
            <PrimaryButton
              label="FOLD"
              onPress={handleFold}
              disabled={isDisconnected || isSubmitting}
              variant="danger"
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
        <ChipSelector
          selectedValue={selectedChip}
          onSelect={setSelectedChip}
          onChipPlace={handleChipPlace}
        />
      )}
      </GameLayout>

      {/* Tutorial */}
      <TutorialOverlay
        gameId="three_card_poker"
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
    minHeight: 100,
  },
  cardWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  cardPlaceholder: {
    width: 70,
    height: 100,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  handName: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.bodySmall,
    marginTop: SPACING.xs,
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
  },
  messageWin: {
    color: COLORS.success,
  },
  messageLoss: {
    color: COLORS.error,
  },
  messageError: {
    color: COLORS.error,
  },
  payout: {
    color: COLORS.gold,
    ...TYPOGRAPHY.displayMedium,
    textAlign: 'center',
  },
  betSpots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  betSpot: {
    width: 100,
    height: 80,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  betSpotActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surfaceElevated,
  },
  betSpotLabel: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
  },
  betSpotAmount: {
    color: COLORS.gold,
    ...TYPOGRAPHY.h3,
  },
  betSpotOdds: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
});
