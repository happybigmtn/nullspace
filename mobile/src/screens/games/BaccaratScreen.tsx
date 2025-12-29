/**
 * Baccarat Game Screen - Jony Ive Redesigned
 * Epitome of simplicity - only 3 betting options
 */
import { View, Text, StyleSheet, Pressable } from 'react-native';
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
import type { ChipValue, TutorialStep, BaccaratBetType, Card as CardType } from '../../types';
import type { BaccaratMessage } from '@nullspace/protocol/mobile';

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
  'P_PERFECT_PAIR',
  'B_PERFECT_PAIR',
];

const SIDE_BET_LABELS: Record<BaccaratSideBetType, string> = {
  TIE: 'Tie',
  P_PAIR: 'Player Pair',
  B_PAIR: 'Banker Pair',
  LUCKY6: 'Lucky 6',
  P_DRAGON: 'Player Dragon',
  B_DRAGON: 'Banker Dragon',
  PANDA8: 'Panda 8',
  P_PERFECT_PAIR: 'Player Perfect Pair',
  B_PERFECT_PAIR: 'Banker Perfect Pair',
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
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<BaccaratMessage>();
  const { balance } = useGameStore();

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

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'cards_dealt') {
      haptics.cardDeal();
      setState((prev) => ({
        ...prev,
        playerCards: lastMessage.playerCards ?? [],
        bankerCards: lastMessage.bankerCards ?? [],
        playerTotal: lastMessage.playerTotal ?? 0,
        bankerTotal: lastMessage.bankerTotal ?? 0,
      }));
    }

    if (lastMessage.type === 'game_result') {
      const winner = lastMessage.winner;
      const betOnWinner = winner
        && ((winner === 'TIE' && state.sideBets.some((b) => b.type === 'TIE' && b.amount > 0))
          || (winner !== 'TIE' && state.selection === winner && state.mainBet > 0));

      if (betOnWinner) {
        haptics.win();
      } else {
        haptics.loss();
      }

      setState((prev) => ({
        ...prev,
        phase: 'result',
        playerCards: lastMessage.playerCards ?? prev.playerCards,
        bankerCards: lastMessage.bankerCards ?? prev.bankerCards,
        playerTotal: lastMessage.playerTotal ?? prev.playerTotal,
        bankerTotal: lastMessage.bankerTotal ?? prev.bankerTotal,
        winner: winner ?? null,
        message: lastMessage.message ?? `${winner} wins!`,
      }));
    }
  }, [lastMessage, state.mainBet, state.selection, state.sideBets]);

  const handleMainSelect = useCallback((selection: 'PLAYER' | 'BANKER') => {
    if (state.phase !== 'betting') return;
    haptics.buttonPress();
    setState((prev) => ({ ...prev, selection }));
  }, [state.phase]);

  const addMainBet = useCallback(() => {
    if (state.phase !== 'betting') return;
    const sideTotal = state.sideBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (state.mainBet + sideTotal + selectedChip > balance) {
      haptics.error();
      return;
    }

    haptics.chipPlace();
    setState((prev) => ({
      ...prev,
      mainBet: prev.mainBet + selectedChip,
    }));
  }, [state.phase, state.mainBet, state.sideBets, selectedChip, balance]);

  const addSideBet = useCallback((type: BaccaratSideBetType) => {
    if (state.phase !== 'betting') return;
    const currentTotal = state.mainBet + state.sideBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (currentTotal + selectedChip > balance) {
      haptics.error();
      return;
    }

    haptics.chipPlace();
    setState((prev) => {
      const existingIndex = prev.sideBets.findIndex((bet) => bet.type === type);
      if (existingIndex >= 0) {
        const next = [...prev.sideBets];
        next[existingIndex] = {
          type,
          amount: next[existingIndex].amount + selectedChip,
        };
        return { ...prev, sideBets: next };
      }
      return { ...prev, sideBets: [...prev.sideBets, { type, amount: selectedChip }] };
    });
  }, [state.phase, state.mainBet, state.sideBets, selectedChip, balance]);

  const handleDeal = useCallback(async () => {
    const betList: BaccaratBet[] = [];
    if (state.mainBet > 0) {
      betList.push({ type: state.selection, amount: state.mainBet });
    }
    betList.push(...state.sideBets.filter((bet) => bet.amount > 0));

    if (betList.length === 0) return;
    await haptics.betConfirm();

    send({
      type: 'baccarat_deal',
      bets: betList,
    });

    setState((prev) => ({
      ...prev,
      phase: 'dealing',
      message: 'Dealing...',
    }));
  }, [state.selection, state.mainBet, state.sideBets, send]);

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

  const totalBet = state.mainBet + state.sideBets.reduce((sum, bet) => sum + bet.amount, 0);

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
                  entering={SlideInDown.delay(i * 150 + 300)}
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
                  entering={SlideInUp.delay(i * 150)}
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
                disabled={state.phase !== 'betting' || isDisconnected}
                style={({ pressed }) => [
                  styles.mainBetButton,
                  type === 'PLAYER' && styles.playerBet,
                  type === 'BANKER' && styles.bankerBet,
                  state.selection === type && styles.mainBetSelected,
                  pressed && styles.betOptionPressed,
                  isDisconnected && styles.betOptionDisabled,
                ]}
              >
                <Text style={styles.betOptionLabel}>{type}</Text>
                <Text style={styles.betOptionOdds}>
                  {type === 'PLAYER' ? '1:1' : '0.95:1'}
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
                  disabled={state.phase !== 'betting' || isDisconnected}
                  style={({ pressed }) => [
                    styles.sideBetButton,
                    pressed && styles.betOptionPressed,
                    isDisconnected && styles.betOptionDisabled,
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
              disabled={totalBet === 0 || isDisconnected}
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
