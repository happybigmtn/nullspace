/**
 * Ultimate Texas Hold'em Game Screen - Jony Ive Redesigned
 * Multi-street betting with progressive Play bet options
 */
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useState, useCallback, useEffect, useMemo } from 'react';
import Animated, { FadeIn, SlideInUp, SlideInDown } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS } from '../../constants/theme';
import { useGameStore } from '../../stores/gameStore';
import type { ChipValue, TutorialStep, PokerHand, Card as CardType } from '../../types';
import type { UltimateTXMessage } from '@nullspace/protocol/mobile';

type GamePhase = 'betting' | 'preflop' | 'flop' | 'river' | 'showdown' | 'result';

interface UltimateTXState {
  anteBet: number;
  blindBet: number;
  playBet: number;
  tripsBet: number;
  playerCards: CardType[];
  communityCards: CardType[];
  dealerCards: CardType[];
  dealerRevealed: boolean;
  phase: GamePhase;
  message: string;
  playerHand: PokerHand | null;
  dealerHand: PokerHand | null;
  dealerQualifies: boolean;
  anteResult: 'win' | 'loss' | 'push' | null;
  blindResult: 'win' | 'loss' | 'push' | null;
  playResult: 'win' | 'loss' | 'push' | null;
  tripsResult: 'win' | 'loss' | null;
  payout: number;
  hasChecked: boolean;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Ante & Blind',
    description: 'Place equal Ante and Blind bets to start. Trips is an optional side bet on your final hand.',
  },
  {
    title: 'Bet or Check',
    description: 'Preflop: Bet 4x or check. After flop: Bet 2x or check. After river: Bet 1x or fold.',
  },
  {
    title: 'Dealer Qualifies',
    description: 'Dealer needs pair or better. Blind pays on straight or better. Trips pays independently!',
  },
];

const HAND_NAMES: Record<PokerHand, string> = {
  ROYAL_FLUSH: 'Royal Flush',
  STRAIGHT_FLUSH: 'Straight Flush',
  FOUR_OF_A_KIND: 'Four of a Kind',
  FULL_HOUSE: 'Full House',
  FLUSH: 'Flush',
  STRAIGHT: 'Straight',
  THREE_OF_A_KIND: 'Three of a Kind',
  TWO_PAIR: 'Two Pair',
  JACKS_OR_BETTER: 'Pair',
  NOTHING: 'High Card',
};

export function UltimateTXHoldemScreen() {
  // Shared hook for connection (UTH has multi-bet so keeps custom bet state)
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<UltimateTXMessage>();
  const { balance } = useGameStore();

  const [state, setState] = useState<UltimateTXState>({
    anteBet: 0,
    blindBet: 0,
    playBet: 0,
    tripsBet: 0,
    playerCards: [],
    communityCards: [],
    dealerCards: [],
    dealerRevealed: false,
    phase: 'betting',
    message: 'Place Ante & Blind',
    playerHand: null,
    dealerHand: null,
    dealerQualifies: false,
    anteResult: null,
    blindResult: null,
    playResult: null,
    tripsResult: null,
    payout: 0,
    hasChecked: false,
  });
  const [selectedChip, setSelectedChip] = useState<ChipValue>(25);
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'cards_dealt') {
      haptics.cardDeal();
      setState((prev) => ({
        ...prev,
        playerCards: lastMessage.playerCards ?? [],
        dealerCards: lastMessage.dealerCards ?? [],
        phase: 'preflop',
        message: 'Bet 4x or Check',
        hasChecked: false,
      }));
    }

    if (lastMessage.type === 'community_dealt') {
      haptics.cardDeal();
      setState((prev) => ({
        ...prev,
        communityCards: lastMessage.communityCards ?? [],
        phase: lastMessage.phase ?? prev.phase,
        message: lastMessage.phase === 'flop'
          ? 'Bet 2x or Check'
          : 'Bet 1x or Fold',
      }));
    }

    if (lastMessage.type === 'game_result') {
      const payout = lastMessage.payout ?? 0;
      if (payout > 0) {
        if (lastMessage.playerHand === 'ROYAL_FLUSH') {
          haptics.jackpot();
        } else {
          haptics.win();
        }
      } else {
        haptics.loss();
      }

      setState((prev) => ({
        ...prev,
        communityCards: lastMessage.communityCards ?? prev.communityCards,
        dealerCards: lastMessage.dealerCards ?? prev.dealerCards,
        dealerRevealed: true,
        playerHand: lastMessage.playerHand ?? null,
        dealerHand: lastMessage.dealerHand ?? null,
        dealerQualifies: lastMessage.dealerQualifies ?? false,
        phase: 'result',
        anteResult: lastMessage.anteResult ?? null,
        blindResult: lastMessage.blindResult ?? null,
        playResult: lastMessage.playResult ?? null,
        tripsResult: lastMessage.tripsResult ?? null,
        payout,
        message: lastMessage.message ?? (payout > 0 ? 'You win!' : 'Dealer wins'),
      }));
    }
  }, [lastMessage]);

  const handleChipPlace = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;

    // Calculate current total bet (ante + blind are placed together, so 2x value)
    const currentTotalBet = state.anteBet + state.blindBet + state.tripsBet;
    if (currentTotalBet + (value * 2) > balance) {
      haptics.error();
      return;
    }

    haptics.chipPlace();

    // Ante and Blind are always equal
    setState((prev) => ({
      ...prev,
      anteBet: prev.anteBet + value,
      blindBet: prev.blindBet + value,
    }));
  }, [state.phase, state.anteBet, state.blindBet, state.tripsBet, balance]);

  const handleTripsChip = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;

    // Calculate current total bet
    const currentTotalBet = state.anteBet + state.blindBet + state.tripsBet;
    if (currentTotalBet + value > balance) {
      haptics.error();
      return;
    }

    haptics.chipPlace();

    setState((prev) => ({
      ...prev,
      tripsBet: prev.tripsBet + value,
    }));
  }, [state.phase, state.anteBet, state.blindBet, state.tripsBet, balance]);

  const handleDeal = useCallback(async () => {
    if (state.anteBet === 0) return;
    await haptics.betConfirm();

    send({
      type: 'ultimate_tx_deal',
      ante: state.anteBet,
      blind: state.blindBet,
      trips: state.tripsBet,
    });

    setState((prev) => ({
      ...prev,
      message: 'Dealing...',
    }));
  }, [state.anteBet, state.blindBet, state.tripsBet, send]);

  const handleBet = useCallback(async (multiplier: number) => {
    await haptics.betConfirm();

    send({
      type: 'ultimate_tx_bet',
      multiplier,
    });

    setState((prev) => ({
      ...prev,
      playBet: state.anteBet * multiplier,
      message: 'Waiting for cards...',
    }));
  }, [state.anteBet, send]);

  const handleCheck = useCallback(async () => {
    await haptics.buttonPress();

    send({
      type: 'ultimate_tx_check',
    });

    setState((prev) => ({
      ...prev,
      hasChecked: true,
      message: 'Checking...',
    }));
  }, [send]);

  const handleFold = useCallback(async () => {
    await haptics.buttonPress();

    send({
      type: 'ultimate_tx_fold',
    });

    setState((prev) => ({
      ...prev,
      phase: 'result',
      message: 'Folded',
    }));
  }, [send]);

  const handleNewGame = useCallback(() => {
    setState({
      anteBet: 0,
      blindBet: 0,
      playBet: 0,
      tripsBet: 0,
      playerCards: [],
      communityCards: [],
      dealerCards: [],
      dealerRevealed: false,
      phase: 'betting',
      message: 'Place Ante & Blind',
      playerHand: null,
      dealerHand: null,
      dealerQualifies: false,
      anteResult: null,
      blindResult: null,
      playResult: null,
      tripsResult: null,
      payout: 0,
      hasChecked: false,
    });
  }, []);

  const getMultiplier = () => {
    switch (state.phase) {
      case 'preflop': return 4;
      case 'flop': return 2;
      case 'river': return 1;
      default: return 0;
    }
  };

  const canCheck = state.phase !== 'river' && state.playBet === 0;
  const multiplier = getMultiplier();

  const handleClearBets = useCallback(() => {
    if (state.phase !== 'betting') return;
    setState((prev) => ({ ...prev, anteBet: 0, blindBet: 0, tripsBet: 0 }));
  }, [state.phase]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && state.anteBet > 0 && !isDisconnected) handleDeal();
      else if (['preflop', 'flop', 'river'].includes(state.phase) && state.playBet === 0 && !isDisconnected) {
        handleBet(multiplier);
      }
      else if (state.phase === 'result') handleNewGame();
    },
    [KEY_ACTIONS.ESCAPE]: () => {
      if (state.phase === 'betting') handleClearBets();
      else if (['preflop', 'flop', 'river'].includes(state.phase) && state.playBet === 0 && !isDisconnected) {
        if (canCheck) handleCheck();
        else handleFold();
      }
    },
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && handleChipPlace(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && handleChipPlace(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && handleChipPlace(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && handleChipPlace(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && handleChipPlace(500 as ChipValue),
  }), [state.phase, state.anteBet, state.playBet, multiplier, canCheck, isDisconnected, handleDeal, handleBet, handleCheck, handleFold, handleNewGame, handleClearBets, handleChipPlace]);

  useGameKeyboard(keyboardHandlers);

  return (
    <>
      <GameLayout
        title="Ultimate Texas Hold'em"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
      >
        {/* Game Area */}
      <ScrollView style={styles.gameArea} contentContainerStyle={styles.gameContent}>
        {/* Dealer Hand */}
        <View style={styles.handContainer}>
          <Text style={styles.handLabel}>DEALER</Text>
          <View style={styles.cards}>
            {state.dealerCards.length > 0 ? (
              state.dealerCards.map((card, i) => (
                <Animated.View
                  key={i}
                  entering={SlideInDown.delay(i * 100)}
                  style={[styles.cardWrapper, { marginLeft: i > 0 ? -15 : 0 }]}
                >
                  <Card
                    suit={card.suit}
                    rank={card.rank}
                    faceUp={state.dealerRevealed}
                    size="small"
                  />
                </Animated.View>
              ))
            ) : (
              <View style={styles.cardPlaceholderSmall} />
            )}
          </View>
          {state.dealerHand && state.dealerRevealed && (
            <Text style={styles.handName}>
              {HAND_NAMES[state.dealerHand]}
              {!state.dealerQualifies && ' (No Qualify)'}
            </Text>
          )}
        </View>

        {/* Community Cards */}
        <View style={styles.communityContainer}>
          <Text style={styles.communityLabel}>COMMUNITY</Text>
          <View style={styles.communityCards}>
            {state.communityCards.length > 0 ? (
              state.communityCards.map((card, i) => (
                <Animated.View
                  key={i}
                  entering={FadeIn.delay(i * 80)}
                  style={styles.communityCard}
                >
                  <Card
                    suit={card.suit}
                    rank={card.rank}
                    faceUp={true}
                    size="small"
                  />
                </Animated.View>
              ))
            ) : (
              Array.from({ length: 5 }).map((_, i) => (
                <View key={i} style={styles.communityPlaceholder} />
              ))
            )}
          </View>
        </View>

        {/* Message */}
        <Text
          style={[
            styles.message,
            state.payout > 0 && styles.messageWin,
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
                  entering={SlideInUp.delay(i * 100)}
                  style={[styles.cardWrapper, { marginLeft: i > 0 ? -15 : 0 }]}
                >
                  <Card suit={card.suit} rank={card.rank} faceUp={true} size="small" />
                </Animated.View>
              ))
            ) : (
              <View style={styles.cardPlaceholderSmall} />
            )}
          </View>
          {state.playerHand && (
            <Text style={styles.handName}>{HAND_NAMES[state.playerHand]}</Text>
          )}
        </View>

        {/* Bet Display */}
        {state.anteBet > 0 && (
          <View style={styles.betsRow}>
            <View style={styles.betItem}>
              <Text style={styles.betLabel}>Ante</Text>
              <Text style={styles.betAmount}>${state.anteBet}</Text>
            </View>
            <View style={styles.betItem}>
              <Text style={styles.betLabel}>Blind</Text>
              <Text style={styles.betAmount}>${state.blindBet}</Text>
            </View>
            {state.playBet > 0 && (
              <View style={styles.betItem}>
                <Text style={styles.betLabel}>Play</Text>
                <Text style={styles.betAmount}>${state.playBet}</Text>
              </View>
            )}
            {state.tripsBet > 0 && (
              <View style={styles.betItem}>
                <Text style={styles.betLabel}>Trips</Text>
                <Text style={styles.betAmount}>${state.tripsBet}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

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

        {['preflop', 'flop', 'river'].includes(state.phase) && state.playBet === 0 && (
          <>
            <PrimaryButton
              label={`BET ${multiplier}x ($${state.anteBet * multiplier})`}
              onPress={() => handleBet(multiplier)}
              disabled={isDisconnected}
              variant="primary"
              size="large"
            />
            {canCheck ? (
              <PrimaryButton
                label="CHECK"
                onPress={handleCheck}
                disabled={isDisconnected}
                variant="secondary"
              />
            ) : (
              <PrimaryButton
                label="FOLD"
                onPress={handleFold}
                disabled={isDisconnected}
                variant="danger"
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
        <View style={styles.chipArea}>
          <View style={styles.chipLabels}>
            <Text style={styles.chipLabel}>Ante/Blind</Text>
            <Text style={styles.chipLabelAlt}>Trips (Optional)</Text>
          </View>
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
        gameId="ultimate_tx_holdem"
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
  },
  gameContent: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  handContainer: {
    alignItems: 'center',
    marginVertical: SPACING.sm,
  },
  handLabel: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
    marginBottom: SPACING.xs,
  },
  cards: {
    flexDirection: 'row',
    minHeight: 70,
  },
  cardWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  cardPlaceholderSmall: {
    width: 50,
    height: 70,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  handName: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.bodySmall,
    marginTop: SPACING.xs,
  },
  communityContainer: {
    alignItems: 'center',
    marginVertical: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
  },
  communityLabel: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.xs,
  },
  communityCards: {
    flexDirection: 'row',
    gap: SPACING.xs,
  },
  communityCard: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  communityPlaceholder: {
    width: 45,
    height: 65,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
    backgroundColor: COLORS.surfaceElevated,
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
    marginVertical: SPACING.sm,
  },
  messageWin: {
    color: COLORS.success,
  },
  payout: {
    color: COLORS.gold,
    ...TYPOGRAPHY.displayMedium,
    textAlign: 'center',
  },
  betsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    marginTop: SPACING.sm,
  },
  betItem: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceElevated,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
  betLabel: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
  },
  betAmount: {
    color: COLORS.gold,
    ...TYPOGRAPHY.label,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  chipArea: {
    paddingBottom: SPACING.md,
  },
  chipLabels: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: SPACING.xs,
  },
  chipLabel: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.caption,
  },
  chipLabelAlt: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
  },
});
