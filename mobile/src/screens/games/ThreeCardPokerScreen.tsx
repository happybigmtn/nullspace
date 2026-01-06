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
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection } from '../../hooks';
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
  phase: 'betting' | 'dealt' | 'showdown' | 'result';
  message: string;
  playerHand: ThreeCardPokerHand | null;
  dealerHand: ThreeCardPokerHand | null;
  dealerQualifies: boolean;
  anteResult: 'win' | 'loss' | 'push' | null;
  pairPlusResult: 'win' | 'loss' | null;
  payout: number;
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
      const stateBytes = decodeStateBytes((lastMessage as { state?: unknown }).state);
      if (!stateBytes) return;
      InteractionManager.runAfterInteractions(() => {
        if (!isMounted.current) return;
        const parsed = parseThreeCardState(stateBytes);
        if (!parsed) return;
        setState((prev) => ({
          ...prev,
          playerCards: parsed.playerCards.length > 0 ? parsed.playerCards : prev.playerCards,
          dealerCards: parsed.dealerCards.length > 0 ? parsed.dealerCards : prev.dealerCards,
          pairPlusBet: parsed.pairPlusBet > 0 ? parsed.pairPlusBet : prev.pairPlusBet,
          sixCardBet: parsed.sixCardBonusBet > 0 ? parsed.sixCardBonusBet : prev.sixCardBet,
          progressiveBet: parsed.progressiveBet > 0 ? parsed.progressiveBet : prev.progressiveBet,
          dealerRevealed: parsed.stage === 'awaiting' || parsed.stage === 'complete',
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
          haptics.jackpot();
        } else {
          haptics.win();
        }
      } else {
        haptics.loss();
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
  }, [lastMessage, state.anteBet, state.pairPlusBet]);

  const handleChipPlace = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;

    // Calculate current total bet
    const currentTotalBet = state.anteBet + state.pairPlusBet + state.sixCardBet + state.progressiveBet;
    if (activeBetType === 'progressive') {
      const progressiveUnit = 1;
      if (currentTotalBet + (state.progressiveBet > 0 ? 0 : progressiveUnit) > balance) {
        haptics.error();
        return;
      }
      haptics.chipPlace();
      setState((prev) => ({
        ...prev,
        progressiveBet: prev.progressiveBet > 0 ? 0 : progressiveUnit,
      }));
      return;
    }
    if (currentTotalBet + value > balance) {
      haptics.error();
      return;
    }

    haptics.chipPlace();

    setState((prev) => ({
      ...prev,
      anteBet: activeBetType === 'ante' ? prev.anteBet + value : prev.anteBet,
      pairPlusBet: activeBetType === 'pairplus' ? prev.pairPlusBet + value : prev.pairPlusBet,
      sixCardBet: activeBetType === 'sixcard' ? prev.sixCardBet + value : prev.sixCardBet,
    }));
  }, [state.phase, activeBetType, state.anteBet, state.pairPlusBet, state.sixCardBet, state.progressiveBet, balance]);

  const handleDeal = useCallback(async () => {
    if (state.anteBet === 0) return;
    await haptics.betConfirm();

    send({
      type: 'three_card_poker_deal',
      ante: state.anteBet,
      pairPlus: state.pairPlusBet,
      sixCard: state.sixCardBet,
      progressive: state.progressiveBet,
    });

    setState((prev) => ({
      ...prev,
      message: 'Dealing...',
    }));
  }, [state.anteBet, state.pairPlusBet, state.sixCardBet, state.progressiveBet, send]);

  const handlePlay = useCallback(async () => {
    await haptics.betConfirm();

    send({
      type: 'three_card_poker_play',
    });

    setState((prev) => ({
      ...prev,
      phase: 'showdown',
      message: 'Revealing dealer...',
    }));
  }, [send]);

  const handleFold = useCallback(async () => {
    await haptics.buttonPress();

    send({
      type: 'three_card_poker_fold',
    });

    setState((prev) => ({
      ...prev,
      phase: 'result',
      anteResult: 'loss',
      message: 'Folded',
    }));
  }, [send]);

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
            disabled={state.anteBet === 0 || isDisconnected}
            variant="primary"
            size="large"
          />
        )}

        {state.phase === 'dealt' && (
          <>
            <PrimaryButton
              label={`PLAY ($${state.anteBet})`}
              onPress={handlePlay}
              disabled={isDisconnected}
              variant="primary"
              size="large"
            />
            <PrimaryButton
              label="FOLD"
              onPress={handleFold}
              disabled={isDisconnected}
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
