/**
 * Baccarat Game Screen - Jony Ive Redesigned
 * Epitome of simplicity - only 3 betting options
 */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { FadeIn, SlideInUp, SlideInDown } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useBetSubmission } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, SPRING } from '../../constants/theme';
import { decodeCardList } from '../../utils';
import { useGameStore } from '../../stores/gameStore';
import type { ChipValue, TutorialStep, BaccaratBetType, Card as CardType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface BaccaratBet {
  type: BaccaratBetType;
  amount: number;
}

type BaccaratSideBetType = Exclude<BaccaratBetType, 'PLAYER' | 'BANKER'>;

interface BaccaratState {
  selection: 'PLAYER' | 'BANKER';
  mainBet: number;
  sideBets: BaccaratBet[];
  playerCards: CardType[];
  bankerCards: CardType[];
  playerTotal: number;
  bankerTotal: number;
  phase: 'betting' | 'dealing' | 'result';
  message: string;
  winner: 'PLAYER' | 'BANKER' | 'TIE' | null;
}

const SIDE_BET_TYPES: BaccaratSideBetType[] = [
  'TIE',
  'P_PAIR',
  'B_PAIR',
  'LUCKY6',
  'P_DRAGON',
  'B_DRAGON',
  'PANDA8',
  'PERFECT_PAIR',
];

const SIDE_BET_LABELS: Record<BaccaratSideBetType, string> = {
  TIE: 'Tie',
  P_PAIR: 'Player Pair',
  B_PAIR: 'Banker Pair',
  LUCKY6: 'Lucky 6',
  P_DRAGON: 'Player Dragon',
  B_DRAGON: 'Banker Dragon',
  PANDA8: 'Panda 8',
  PERFECT_PAIR: 'Perfect Pair',
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Main Bet',
    description: 'Choose Player or Banker for the main bet. Tie and pairs live in Side Bets.',
  },
  {
    title: 'Closest to 9',
    description: 'The hand closest to 9 wins. Face cards = 0, Aces = 1. If over 9, drop the tens digit.',
  },
  {
    title: 'Side Bets',
    description: 'Add Tie, Pair, Lucky 6, Dragon, or Perfect Pair side bets for bigger payouts.',
  },
];

export function BaccaratScreen() {
  // Shared hook for connection (Baccarat has multi-bet so keeps custom bet state)
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { balance } = useGameStore();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);

  const [state, setState] = useState<BaccaratState>({
    selection: 'PLAYER',
    mainBet: 0,
    sideBets: [],
    playerCards: [],
    bankerCards: [],
    playerTotal: 0,
    bankerTotal: 0,
    phase: 'betting',
    message: 'Place your bet',
    winner: null,
  });
  const [selectedChip, setSelectedChip] = useState<ChipValue>(25);
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
    }
    if (lastMessage.type === 'game_result') {
      clearSubmission();
      const payload = lastMessage as Record<string, unknown>;
      const player = payload.player as { cards?: number[]; total?: number } | undefined;
      const banker = payload.banker as { cards?: number[]; total?: number } | undefined;
      const winner = payload.winner as 'PLAYER' | 'BANKER' | 'TIE' | undefined;

      const betOnWinner = winner
        && ((winner === 'TIE' && state.sideBets.some((b) => b.type === 'TIE' && b.amount > 0))
          || (winner !== 'TIE' && state.selection === winner && state.mainBet > 0));

      if (betOnWinner) {
        haptics.win().catch(() => {});
      } else {
        haptics.loss().catch(() => {});
      }

      setState((prev) => ({
        ...prev,
        phase: 'result',
        playerCards: player?.cards ? decodeCardList(player.cards) : prev.playerCards,
        bankerCards: banker?.cards ? decodeCardList(banker.cards) : prev.bankerCards,
        playerTotal: typeof player?.total === 'number' ? player.total : prev.playerTotal,
        bankerTotal: typeof banker?.total === 'number' ? banker.total : prev.bankerTotal,
        winner: winner ?? null,
        message: typeof payload.message === 'string' ? payload.message : winner ? `${winner} wins!` : 'Round complete',
      }));
    }
  }, [lastMessage, state.mainBet, state.selection, state.sideBets, clearSubmission]);

  const handleMainSelect = useCallback((selection: 'PLAYER' | 'BANKER') => {
    if (state.phase !== 'betting') return;
    haptics.buttonPress().catch(() => {});
    setState((prev) => ({ ...prev, selection }));
  }, [state.phase]);

  const addMainBet = useCallback(() => {
    if (state.phase !== 'betting') return;
    const sideTotal = state.sideBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (state.mainBet + sideTotal + selectedChip > balance) {
      haptics.error().catch(() => {});
      return;
    }

    haptics.chipPlace().catch(() => {});
    setState((prev) => ({
      ...prev,
      mainBet: prev.mainBet + selectedChip,
    }));
  }, [state.phase, state.mainBet, state.sideBets, selectedChip, balance]);

  const addSideBet = useCallback((type: BaccaratSideBetType) => {
    if (state.phase !== 'betting') return;
    const currentTotal = state.mainBet + state.sideBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (currentTotal + selectedChip > balance) {
      haptics.error().catch(() => {});
      return;
    }

    haptics.chipPlace().catch(() => {});
    setState((prev) => {
      const existingIndex = prev.sideBets.findIndex((bet) => bet.type === type);
      if (existingIndex >= 0) {
        const next = [...prev.sideBets];
        const existing = next[existingIndex];
        if (!existing) {
          return prev;
        }
        next[existingIndex] = {
          type,
          amount: existing.amount + selectedChip,
        };
        return { ...prev, sideBets: next };
      }
      return { ...prev, sideBets: [...prev.sideBets, { type, amount: selectedChip }] };
    });
  }, [state.phase, state.mainBet, state.sideBets, selectedChip, balance]);

  const handleDeal = useCallback(() => {
    if (isSubmitting) return;
    const betList: BaccaratBet[] = [];
    if (state.mainBet > 0) {
      betList.push({ type: state.selection, amount: state.mainBet });
    }
    betList.push(...state.sideBets.filter((bet) => bet.amount > 0));

    if (betList.length === 0) return;
    haptics.betConfirm().catch(() => {});

    // US-090: Calculate total bet for atomic validation
    const totalBet = betList.reduce((sum, b) => sum + b.amount, 0);
    const success = submitBet(
      {
        type: 'baccarat_deal',
        bets: betList,
      },
      { amount: totalBet }
    );

    if (success) {
      setState((prev) => ({
        ...prev,
        phase: 'dealing',
        message: 'Dealing...',
      }));
    }
  }, [state.selection, state.mainBet, state.sideBets, isSubmitting, submitBet]);

  const handleNewGame = useCallback(() => {
    setState({
      selection: 'PLAYER',
      mainBet: 0,
      sideBets: [],
      playerCards: [],
      bankerCards: [],
      playerTotal: 0,
      bankerTotal: 0,
      phase: 'betting',
      message: 'Place your bet',
      winner: null,
    });
  }, []);

  const handleChipPlace = useCallback((_value: ChipValue) => {
    addMainBet();
  }, [addMainBet]);

  const totalBet = useMemo(() => (
    state.mainBet + state.sideBets.reduce((sum, bet) => sum + bet.amount, 0)
  ), [state.mainBet, state.sideBets]);

  const handleClearBets = useCallback(() => {
    if (state.phase !== 'betting') return;
    setState((prev) => ({ ...prev, mainBet: 0, sideBets: [] }));
  }, [state.phase]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.LEFT]: () => state.phase === 'betting' && !isDisconnected && handleMainSelect('PLAYER'),
    [KEY_ACTIONS.RIGHT]: () => state.phase === 'betting' && !isDisconnected && handleMainSelect('BANKER'),
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && totalBet > 0 && !isDisconnected) handleDeal();
      else if (state.phase === 'result') handleNewGame();
    },
    [KEY_ACTIONS.ESCAPE]: () => handleClearBets(),
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && setSelectedChip(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && setSelectedChip(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && setSelectedChip(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && setSelectedChip(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && setSelectedChip(500 as ChipValue),
  }), [state.phase, totalBet, isDisconnected, handleMainSelect, handleDeal, handleNewGame, handleClearBets]);

  useGameKeyboard(keyboardHandlers);
  const cardEnterDown = SlideInDown.springify()
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
        title="Baccarat"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
      >
        {/* Game Area */}
        <View style={styles.gameArea}>
          {/* Banker Hand */}
          <View style={styles.handContainer}>
            <View style={styles.handHeader}>
              <Text style={styles.handLabel}>BANKER</Text>
              {state.bankerCards.length > 0 && (
                <Text style={styles.handTotal}>{state.bankerTotal}</Text>
              )}
            </View>
            <View style={styles.cards}>
              {state.bankerCards.map((card, i) => (
                <Animated.View
                  key={i}
                  entering={cardEnterDown.delay(i * 150 + 300)}
                  style={[styles.cardWrapper, { marginLeft: i > 0 ? -30 : 0 }]}
                >
                  <Card suit={card.suit} rank={card.rank} faceUp={true} />
                </Animated.View>
              ))}
            </View>
            {state.winner === 'BANKER' && (
              <Animated.View entering={FadeIn} style={styles.winnerBadge}>
                <Text style={styles.winnerText}>WINNER</Text>
              </Animated.View>
            )}
          </View>

          {/* Message */}
          <Text
            style={[
              styles.message,
              state.winner === 'TIE' && styles.messageTie,
            ]}
          >
            {state.message}
          </Text>

          {/* Player Hand */}
          <View style={styles.handContainer}>
            <View style={styles.handHeader}>
              <Text style={styles.handLabel}>PLAYER</Text>
              {state.playerCards.length > 0 && (
                <Text style={styles.handTotal}>{state.playerTotal}</Text>
              )}
            </View>
            <View style={styles.cards}>
              {state.playerCards.map((card, i) => (
                <Animated.View
                  key={i}
                  entering={cardEnterUp.delay(i * 150)}
                  style={[styles.cardWrapper, { marginLeft: i > 0 ? -30 : 0 }]}
                >
                  <Card suit={card.suit} rank={card.rank} faceUp={true} />
                </Animated.View>
              ))}
            </View>
            {state.winner === 'PLAYER' && (
              <Animated.View entering={FadeIn} style={styles.winnerBadge}>
                <Text style={styles.winnerText}>WINNER</Text>
              </Animated.View>
            )}
          </View>
        </View>

        {/* Betting Options */}
        <View style={styles.betOptions}>
          <Text style={styles.sectionTitle}>Main Bet</Text>
          <View style={styles.mainBetRow}>
            {(['PLAYER', 'BANKER'] as const).map((type) => (
              <Pressable
                key={type}
                onPress={() => handleMainSelect(type)}
                disabled={state.phase !== 'betting' || isDisconnected || isSubmitting}
                style={({ pressed }) => [
                  styles.mainBetButton,
                  type === 'PLAYER' && styles.playerBet,
                  type === 'BANKER' && styles.bankerBet,
                  state.selection === type && styles.mainBetSelected,
                  pressed && styles.betOptionPressed,
                  (isDisconnected || isSubmitting) && styles.betOptionDisabled,
                ]}
              >
                <Text style={styles.betOptionLabel}>{type}</Text>
                <Text style={styles.betOptionOdds}>
                  {type === 'PLAYER' ? '1:1' : '1:1 (6 pays 1:2)'}
                </Text>
                {state.selection === type && state.mainBet > 0 && (
                  <Text style={styles.betOptionAmount}>${state.mainBet}</Text>
                )}
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionTitle}>Side Bets</Text>
          <View style={styles.sideBetGrid}>
            {SIDE_BET_TYPES.map((type) => {
              const amount = state.sideBets.find((bet) => bet.type === type)?.amount ?? 0;
              return (
                <Pressable
                  key={type}
                  onPress={() => addSideBet(type)}
                  disabled={state.phase !== 'betting' || isDisconnected || isSubmitting}
                  style={({ pressed }) => [
                    styles.sideBetButton,
                    pressed && styles.betOptionPressed,
                    (isDisconnected || isSubmitting) && styles.betOptionDisabled,
                  ]}
                >
                  <Text style={styles.sideBetText}>{SIDE_BET_LABELS[type]}</Text>
                  {amount > 0 && (
                    <Text style={styles.betOptionAmount}>${amount}</Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {state.phase === 'betting' && (
            <PrimaryButton
              label="DEAL"
              onPress={handleDeal}
              disabled={totalBet === 0 || isDisconnected || isSubmitting}
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
        gameId="baccarat"
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
  handHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    marginBottom: SPACING.sm,
  },
  handLabel: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
  },
  handTotal: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.h2,
  },
  cards: {
    flexDirection: 'row',
    minHeight: 120,
  },
  cardWrapper: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  winnerBadge: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.gold,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
  },
  winnerText: {
    color: COLORS.background,
    ...TYPOGRAPHY.label,
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
  },
  messageTie: {
    color: COLORS.gold,
  },
  betOptions: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
    marginBottom: SPACING.sm,
  },
  mainBetRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  mainBetButton: {
    flex: 1,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  mainBetSelected: {
    borderColor: COLORS.gold,
    backgroundColor: COLORS.surface,
  },
  sideBetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  sideBetButton: {
    flexBasis: '48%',
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sideBetText: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.caption,
    textAlign: 'center',
  },
  betOptionPressed: {
    opacity: 0.7,
  },
  betOptionDisabled: {
    opacity: 0.5,
  },
  betOptionLabel: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
  },
  betOptionOdds: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    marginTop: 2,
  },
  betOptionAmount: {
    color: COLORS.gold,
    ...TYPOGRAPHY.bodySmall,
    marginTop: SPACING.xs,
  },
  playerBet: {
    borderColor: COLORS.primary,
  },
  bankerBet: {
    borderColor: COLORS.gold,
  },
  actions: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
});
