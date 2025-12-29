/**
 * Three Card Poker Game Screen - Jony Ive Redesigned
 * Ante/Play with optional Pair Plus side bet
 */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useState, useCallback, useEffect, useMemo } from 'react';
import Animated, { FadeIn, SlideInUp } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../../constants/theme';
import { useGameStore } from '../../stores/gameStore';
import type { ChipValue, TutorialStep, ThreeCardPokerHand, Card as CardType } from '../../types';
import type { ThreeCardPokerMessage } from '@nullspace/protocol/mobile';

interface ThreeCardPokerState {
  anteBet: number;
  pairPlusBet: number;
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

const PAIR_PLUS_PAYOUTS: Record<ThreeCardPokerHand, number> = {
  STRAIGHT_FLUSH: 40,
  THREE_OF_A_KIND: 30,
  STRAIGHT: 6,
  FLUSH: 3,
  PAIR: 1,
  HIGH_CARD: 0,
};

export function ThreeCardPokerScreen() {
  // Shared hook for connection (ThreeCardPoker has multi-bet so keeps custom bet state)
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<ThreeCardPokerMessage>();
  const { balance } = useGameStore();

  const [state, setState] = useState<ThreeCardPokerState>({
    anteBet: 0,
    pairPlusBet: 0,
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
  const [activeBetType, setActiveBetType] = useState<'ante' | 'pairplus'>('ante');

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'cards_dealt') {
      haptics.cardDeal();
      setState((prev) => ({
        ...prev,
        playerCards: lastMessage.playerCards ?? [],
        dealerCards: lastMessage.dealerCards ?? [],
        playerHand: lastMessage.playerHand ?? null,
        phase: 'dealt',
        message: 'Play or Fold?',
      }));
    }

    if (lastMessage.type === 'game_result') {
      const payout = lastMessage.payout ?? 0;
      if (payout > 0) {
        if (lastMessage.playerHand === 'STRAIGHT_FLUSH') {
          haptics.jackpot();
        } else {
          haptics.win();
        }
      } else {
        haptics.loss();
      }

      setState((prev) => ({
        ...prev,
        dealerCards: lastMessage.dealerCards ?? prev.dealerCards,
        dealerRevealed: true,
        dealerHand: lastMessage.dealerHand ?? null,
        dealerQualifies: lastMessage.dealerQualifies ?? false,
        phase: 'result',
        anteResult: lastMessage.anteResult ?? null,
        pairPlusResult: lastMessage.pairPlusResult ?? null,
        payout,
        message: lastMessage.message ?? (payout > 0 ? 'You win!' : 'Dealer wins'),
      }));
    }
  }, [lastMessage]);

  const handleChipPlace = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;

    // Calculate current total bet
    const currentTotalBet = state.anteBet + state.pairPlusBet;
    if (currentTotalBet + value > balance) {
      haptics.error();
      return;
    }

    haptics.chipPlace();

    setState((prev) => ({
      ...prev,
      anteBet: activeBetType === 'ante' ? prev.anteBet + value : prev.anteBet,
      pairPlusBet: activeBetType === 'pairplus' ? prev.pairPlusBet + value : prev.pairPlusBet,
    }));
  }, [state.phase, activeBetType, state.anteBet, state.pairPlusBet, balance]);

  const handleDeal = useCallback(async () => {
    if (state.anteBet === 0) return;
    await haptics.betConfirm();

    send({
      type: 'three_card_poker_deal',
      ante: state.anteBet,
      pairPlus: state.pairPlusBet,
    });

    setState((prev) => ({
      ...prev,
      message: 'Dealing...',
    }));
  }, [state.anteBet, state.pairPlusBet, send]);

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

  const totalBet = state.anteBet + state.pairPlusBet;

  const handleClearBets = useCallback(() => {
    if (state.phase !== 'betting') return;
    setState((prev) => ({ ...prev, anteBet: 0, pairPlusBet: 0 }));
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
                  entering={SlideInUp.delay(i * 100 + 300)}
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
                  entering={FadeIn.delay(i * 100)}
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
