/**
 * Ultimate Texas Hold'em Game Screen - Jony Ive Redesigned
 * Multi-street betting with progressive Play bet options
 */
import { View, Text, StyleSheet, ScrollView, InteractionManager, Pressable } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { FadeIn, SlideInUp, SlideInDown } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useBetSubmission } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, SPRING } from '../../constants/theme';
import { decodeCardList, decodeStateBytes, parseNumeric, parseUltimateHoldemState } from '../../utils';
import { useGameStore } from '../../stores/gameStore';
import type { ChipValue, TutorialStep, PokerHand, Card as CardType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

type GamePhase = 'betting' | 'preflop' | 'flop' | 'river' | 'showdown' | 'result';

interface UltimateTXState {
  anteBet: number;
  blindBet: number;
  playBet: number;
  tripsBet: number;
  sixCardBet: number;
  progressiveBet: number;
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
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { balance } = useGameStore();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);

  const [state, setState] = useState<UltimateTXState>({
    anteBet: 0,
    blindBet: 0,
    playBet: 0,
    tripsBet: 0,
    sixCardBet: 0,
    progressiveBet: 0,
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
  const [activeBetType, setActiveBetType] = useState<'main' | 'trips' | 'sixcard' | 'progressive'>('main');
  const [showTutorial, setShowTutorial] = useState(false);

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
      clearSubmission();
      const stateBytes = decodeStateBytes((lastMessage as { state?: unknown }).state);
      if (!stateBytes) return;
      InteractionManager.runAfterInteractions(() => {
        if (!isMounted.current) return;
        const parsed = parseUltimateHoldemState(stateBytes);
        if (!parsed) return;
        setState((prev) => ({
          ...prev,
          playerCards: parsed.playerCards.length > 0 ? parsed.playerCards : prev.playerCards,
          communityCards: parsed.communityCards.length > 0 ? parsed.communityCards : prev.communityCards,
          dealerCards: parsed.dealerCards.length > 0 ? parsed.dealerCards : prev.dealerCards,
          tripsBet: parsed.tripsBet > 0 ? parsed.tripsBet : prev.tripsBet,
          sixCardBet: parsed.sixCardBonusBet > 0 ? parsed.sixCardBonusBet : prev.sixCardBet,
          progressiveBet: parsed.progressiveBet > 0 ? parsed.progressiveBet : prev.progressiveBet,
          dealerRevealed: parsed.stage === 'showdown' || parsed.stage === 'result',
          phase: parsed.stage,
          message: parsed.stage === 'preflop'
            ? 'Bet 4x or Check'
            : parsed.stage === 'flop'
              ? 'Bet 2x or Check'
              : parsed.stage === 'river'
                ? 'Bet 1x or Fold'
                : parsed.stage === 'showdown'
                  ? 'Revealing dealer...'
                  : parsed.stage === 'result'
                    ? 'Round complete'
                    : 'Place Ante & Blind',
        }));
      });
      return;
    }

    if (lastMessage.type === 'game_result') {
      clearSubmission();
      const payload = lastMessage as Record<string, unknown>;
      const payout = parseNumeric(payload.totalReturn ?? payload.payout) ?? 0;
      const player = payload.player as { cards?: number[]; rank?: PokerHand } | undefined;
      const dealer = payload.dealer as { cards?: number[]; rank?: PokerHand; qualifies?: boolean } | undefined;
      const community = Array.isArray(payload.community) ? payload.community as number[] : null;
      const anteReturn = parseNumeric(payload.anteReturn) ?? 0;
      const anteBet = parseNumeric(payload.anteBet) ?? state.anteBet;
      const blindReturn = parseNumeric(payload.blindReturn) ?? 0;
      const blindBet = parseNumeric(payload.blindBet) ?? state.blindBet;
      const playReturn = parseNumeric(payload.playReturn) ?? 0;
      const playBet = parseNumeric(payload.playBet) ?? state.playBet;
      const tripsReturn = parseNumeric(payload.tripsReturn) ?? 0;
      const tripsBet = parseNumeric(payload.tripsBet) ?? state.tripsBet;

      if (payout > 0) {
        if (player?.rank === 'ROYAL_FLUSH') {
          haptics.jackpot().catch(() => {});
        } else {
          haptics.win().catch(() => {});
        }
      } else {
        haptics.loss().catch(() => {});
      }

      setState((prev) => ({
        ...prev,
        communityCards: community ? decodeCardList(community) : prev.communityCards,
        dealerCards: dealer?.cards ? decodeCardList(dealer.cards) : prev.dealerCards,
        dealerRevealed: true,
        playerHand: player?.rank ?? prev.playerHand,
        dealerHand: dealer?.rank ?? prev.dealerHand,
        dealerQualifies: dealer?.qualifies ?? prev.dealerQualifies,
        phase: 'result',
        anteResult: anteReturn > anteBet ? 'win' : anteReturn === anteBet ? 'push' : 'loss',
        blindResult: blindReturn > blindBet ? 'win' : blindReturn === blindBet ? 'push' : 'loss',
        playResult: playBet > 0 ? (playReturn > playBet ? 'win' : playReturn === playBet ? 'push' : 'loss') : prev.playResult,
        tripsResult: tripsBet > 0 ? (tripsReturn > tripsBet ? 'win' : 'loss') : null,
        payout,
        message: typeof payload.message === 'string' ? payload.message : payout > 0 ? 'You win!' : 'Dealer wins',
      }));
    }
  }, [lastMessage, state.anteBet, state.blindBet, state.playBet, state.tripsBet, clearSubmission]);

  const handleTripsChip = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;

    // Calculate current total bet
    const currentTotalBet =
      state.anteBet + state.blindBet + state.tripsBet + state.sixCardBet + state.progressiveBet;
    if (currentTotalBet + value > balance) {
      haptics.error().catch(() => {});
      return;
    }

    haptics.chipPlace().catch(() => {});

    setState((prev) => ({
      ...prev,
      tripsBet: prev.tripsBet + value,
    }));
  }, [state.phase, state.anteBet, state.blindBet, state.tripsBet, state.sixCardBet, state.progressiveBet, balance]);

  const handleSixCardChip = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;

    const currentTotalBet =
      state.anteBet + state.blindBet + state.tripsBet + state.sixCardBet + state.progressiveBet;
    if (currentTotalBet + value > balance) {
      haptics.error().catch(() => {});
      return;
    }

    haptics.chipPlace().catch(() => {});

    setState((prev) => ({
      ...prev,
      sixCardBet: prev.sixCardBet + value,
    }));
  }, [state.phase, state.anteBet, state.blindBet, state.tripsBet, state.sixCardBet, state.progressiveBet, balance]);

  const handleProgressiveToggle = useCallback(() => {
    if (state.phase !== 'betting') return;

    const currentTotalBet =
      state.anteBet + state.blindBet + state.tripsBet + state.sixCardBet + state.progressiveBet;
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
  }, [state.phase, state.anteBet, state.blindBet, state.tripsBet, state.sixCardBet, state.progressiveBet, balance]);

  const handleChipPlace = useCallback((value: ChipValue) => {
    if (activeBetType === 'trips') {
      handleTripsChip(value);
      return;
    }
    if (activeBetType === 'sixcard') {
      handleSixCardChip(value);
      return;
    }
    if (activeBetType === 'progressive') {
      handleProgressiveToggle();
      return;
    }
    if (state.phase !== 'betting') return;

    // Calculate current total bet (ante + blind are placed together, so 2x value)
    const currentTotalBet =
      state.anteBet + state.blindBet + state.tripsBet + state.sixCardBet + state.progressiveBet;
    if (currentTotalBet + (value * 2) > balance) {
      haptics.error().catch(() => {});
      return;
    }

    haptics.chipPlace().catch(() => {});

    // Ante and Blind are always equal
    setState((prev) => ({
      ...prev,
      anteBet: prev.anteBet + value,
      blindBet: prev.blindBet + value,
    }));
  }, [
    activeBetType,
    handleTripsChip,
    handleSixCardChip,
    handleProgressiveToggle,
    state.phase,
    state.anteBet,
    state.blindBet,
    state.tripsBet,
    state.sixCardBet,
    state.progressiveBet,
    balance,
  ]);

  const handleDeal = useCallback(() => {
    if (state.anteBet === 0 || isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    const success = submitBet({
      type: 'ultimate_tx_deal',
      ante: state.anteBet,
      blind: state.blindBet,
      trips: state.tripsBet,
      sixCard: state.sixCardBet,
      progressive: state.progressiveBet,
    });

    if (success) {
      setState((prev) => ({
        ...prev,
        message: 'Dealing...',
      }));
    }
  }, [state.anteBet, state.blindBet, state.tripsBet, state.sixCardBet, state.progressiveBet, isSubmitting, submitBet]);

  const handleBet = useCallback((multiplier: number) => {
    if (isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    const success = submitBet({
      type: 'ultimate_tx_bet',
      multiplier,
    });

    if (success) {
      setState((prev) => ({
        ...prev,
        playBet: state.anteBet * multiplier,
        message: 'Waiting for cards...',
      }));
    }
  }, [state.anteBet, isSubmitting, submitBet]);

  const handleCheck = useCallback(() => {
    if (isSubmitting) return;
    haptics.buttonPress().catch(() => {});

    const success = submitBet({
      type: 'ultimate_tx_check',
    });

    if (success) {
      setState((prev) => ({
        ...prev,
        hasChecked: true,
        message: 'Checking...',
      }));
    }
  }, [isSubmitting, submitBet]);

  const handleFold = useCallback(() => {
    if (isSubmitting) return;
    haptics.buttonPress().catch(() => {});

    const success = submitBet({
      type: 'ultimate_tx_fold',
    });

    if (success) {
      setState((prev) => ({
        ...prev,
        phase: 'result',
        message: 'Folded',
      }));
    }
  }, [isSubmitting, submitBet]);

  const handleNewGame = useCallback(() => {
    setState({
      anteBet: 0,
      blindBet: 0,
      playBet: 0,
      tripsBet: 0,
      sixCardBet: 0,
      progressiveBet: 0,
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
    setActiveBetType('main');
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
    setState((prev) => ({
      ...prev,
      anteBet: 0,
      blindBet: 0,
      tripsBet: 0,
      sixCardBet: 0,
      progressiveBet: 0,
    }));
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

  const cardEnterDown = SlideInDown.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);

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
                  entering={cardEnterDown.delay(i * 100)}
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
                  entering={cardEnterFade.delay(i * 80)}
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
                  entering={cardEnterUp.delay(i * 100)}
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
            {state.sixCardBet > 0 && (
              <View style={styles.betItem}>
                <Text style={styles.betLabel}>6-Card</Text>
                <Text style={styles.betAmount}>${state.sixCardBet}</Text>
              </View>
            )}
            {state.progressiveBet > 0 && (
              <View style={styles.betItem}>
                <Text style={styles.betLabel}>Prog</Text>
                <Text style={styles.betAmount}>${state.progressiveBet}</Text>
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
            disabled={state.anteBet === 0 || isDisconnected || isSubmitting}
            variant="primary"
            size="large"
          />
        )}

        {['preflop', 'flop', 'river'].includes(state.phase) && state.playBet === 0 && (
          <>
            <PrimaryButton
              label={`BET ${multiplier}x ($${state.anteBet * multiplier})`}
              onPress={() => handleBet(multiplier)}
              disabled={isDisconnected || isSubmitting}
              variant="primary"
              size="large"
            />
            {canCheck ? (
              <PrimaryButton
                label="CHECK"
                onPress={handleCheck}
                disabled={isDisconnected || isSubmitting}
                variant="secondary"
              />
            ) : (
              <PrimaryButton
                label="FOLD"
                onPress={handleFold}
                disabled={isDisconnected || isSubmitting}
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
          <Pressable
            onPress={() => setActiveBetType('main')}
            style={[
              styles.chipLabelButton,
              activeBetType === 'main' && styles.chipLabelButtonActive,
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                activeBetType === 'main' && styles.chipLabelTextActive,
              ]}
            >
              Ante/Blind
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveBetType('trips')}
            style={[
              styles.chipLabelButton,
              activeBetType === 'trips' && styles.chipLabelButtonActive,
            ]}
          >
            <Text
              style={[
                styles.chipLabelAlt,
                activeBetType === 'trips' && styles.chipLabelTextActive,
              ]}
            >
              Trips (Optional)
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveBetType('sixcard')}
            style={[
              styles.chipLabelButton,
              activeBetType === 'sixcard' && styles.chipLabelButtonActive,
            ]}
          >
            <Text
              style={[
                styles.chipLabelAlt,
                activeBetType === 'sixcard' && styles.chipLabelTextActive,
              ]}
            >
              6-Card Bonus
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveBetType('progressive')}
            style={[
              styles.chipLabelButton,
              activeBetType === 'progressive' && styles.chipLabelButtonActive,
            ]}
          >
            <Text
              style={[
                styles.chipLabelAlt,
                activeBetType === 'progressive' && styles.chipLabelTextActive,
              ]}
            >
              Progressive ($1)
            </Text>
          </Pressable>
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
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  chipLabelButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
  chipLabelButtonActive: {
    backgroundColor: COLORS.surface,
  },
  chipLabel: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.caption,
  },
  chipLabelAlt: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
  },
  chipLabelTextActive: {
    color: COLORS.textPrimary,
  },
});
