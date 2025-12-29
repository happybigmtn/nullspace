/**
 * Casino War Game Screen - Jony Ive Redesigned
 * Simplest card game - just deal and optional war
 */
import { View, Text, StyleSheet } from 'react-native';
import { useState, useCallback, useEffect, useMemo } from 'react';
import Animated, { FadeIn, SlideInLeft, SlideInRight } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useChipBetting } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY } from '../../constants/theme';
import type { ChipValue, TutorialStep, Card as CardType } from '../../types';
import type { CasinoWarMessage } from '@nullspace/protocol/mobile';

interface CasinoWarState {
  playerCard: CardType | null;
  dealerCard: CardType | null;
  phase: 'betting' | 'dealt' | 'war_choice' | 'war' | 'result';
  message: string;
  lastResult: 'win' | 'loss' | 'war' | null;
  warBet: number;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'High Card Wins',
    description: 'You and the dealer each get one card. Higher card wins. It\'s that simple!',
  },
  {
    title: 'Tie = War',
    description: 'If cards are equal, you can "Go to War" (match your bet) or "Surrender" (lose half).',
  },
  {
    title: 'Win in War',
    description: 'In War, 3 cards are burned and new cards dealt. Win pays 1:1 on original bet.',
  },
];

export function CasinoWarScreen() {
  // Shared hooks for connection and betting
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<CasinoWarMessage>();
  const { bet, selectedChip, setSelectedChip, placeChip, clearBet, balance } = useChipBetting();

  const [state, setState] = useState<CasinoWarState>({
    playerCard: null,
    dealerCard: null,
    phase: 'betting',
    message: 'Place your bet',
    lastResult: null,
    warBet: 0,
  });
  const [showTutorial, setShowTutorial] = useState(false);

  // Wrap chip placement to check game phase
  const handleChipPlace = useCallback((value: ChipValue) => {
    if (state.phase !== 'betting') return;
    placeChip(value);
  }, [state.phase, placeChip]);

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'cards_dealt') {
      haptics.cardDeal();
      setState((prev) => ({
        ...prev,
        playerCard: lastMessage.playerCard ?? null,
        dealerCard: lastMessage.dealerCard ?? null,
        phase: 'dealt',
      }));
    }

    if (lastMessage.type === 'tie') {
      haptics.push();
      setState((prev) => ({
        ...prev,
        phase: 'war_choice',
        message: 'Tie! Go to War or Surrender?',
        lastResult: 'war',
      }));
    }

    if (lastMessage.type === 'game_result') {
      const won = lastMessage.won ?? false;
      if (won) {
        haptics.win();
      } else {
        haptics.loss();
      }

      setState((prev) => ({
        ...prev,
        phase: 'result',
        playerCard: lastMessage.playerCard ?? prev.playerCard,
        dealerCard: lastMessage.dealerCard ?? prev.dealerCard,
        lastResult: won ? 'win' : 'loss',
        message: lastMessage.message ?? (won ? 'You win!' : 'Dealer wins'),
      }));
    }
  }, [lastMessage]);

  const handleDeal = useCallback(async () => {
    if (bet === 0) return;
    await haptics.betConfirm();

    send({
      type: 'casino_war_deal',
      amount: bet,
    });

    setState((prev) => ({
      ...prev,
      message: 'Dealing...',
    }));
  }, [bet, send]);

  const handleWar = useCallback(async () => {
    await haptics.betConfirm();

    send({
      type: 'casino_war_war',
    });

    setState((prev) => ({
      ...prev,
      phase: 'war',
      warBet: bet,
      message: 'Going to War!',
    }));
  }, [send, bet]);

  const handleSurrender = useCallback(async () => {
    await haptics.buttonPress();

    send({
      type: 'casino_war_surrender',
    });

    setState((prev) => ({
      ...prev,
      phase: 'result',
      lastResult: 'loss',
      message: 'Surrendered - Half bet returned',
    }));
  }, [send]);

  const handleNewGame = useCallback(() => {
    clearBet();
    setState({
      playerCard: null,
      dealerCard: null,
      phase: 'betting',
      message: 'Place your bet',
      lastResult: null,
      warBet: 0,
    });
  }, [clearBet]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && bet > 0 && !isDisconnected) handleDeal();
      else if (state.phase === 'result') handleNewGame();
      else if (state.phase === 'war_choice' && !isDisconnected) handleWar();
    },
    [KEY_ACTIONS.ESCAPE]: () => {
      if (state.phase === 'betting') clearBet();
      else if (state.phase === 'war_choice' && !isDisconnected) handleSurrender();
    },
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && handleChipPlace(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && handleChipPlace(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && handleChipPlace(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && handleChipPlace(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && handleChipPlace(500 as ChipValue),
  }), [state.phase, bet, isDisconnected, handleDeal, handleNewGame, handleWar, handleSurrender, clearBet, handleChipPlace]);

  useGameKeyboard(keyboardHandlers);

  return (
    <>
      <GameLayout
        title="Casino War"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
      >
        {/* Game Area */}
        <View style={styles.gameArea}>
        {/* Cards Display */}
        <View style={styles.cardsContainer}>
          {/* Dealer Card */}
          <View style={styles.cardSide}>
            <Text style={styles.sideLabel}>Dealer</Text>
            {state.dealerCard ? (
              <Animated.View entering={SlideInLeft.duration(300)}>
                <Card
                  suit={state.dealerCard.suit}
                  rank={state.dealerCard.rank}
                  faceUp={true}
                  size="large"
                />
              </Animated.View>
            ) : (
              <View style={styles.cardPlaceholder} />
            )}
          </View>

          {/* VS Divider */}
          <View style={styles.vsContainer}>
            <Text style={styles.vsText}>VS</Text>
          </View>

          {/* Player Card */}
          <View style={styles.cardSide}>
            <Text style={styles.sideLabel}>You</Text>
            {state.playerCard ? (
              <Animated.View entering={SlideInRight.duration(300)}>
                <Card
                  suit={state.playerCard.suit}
                  rank={state.playerCard.rank}
                  faceUp={true}
                  size="large"
                />
              </Animated.View>
            ) : (
              <View style={styles.cardPlaceholder} />
            )}
          </View>
        </View>

        {/* Message */}
        <Text
          style={[
            styles.message,
            state.lastResult === 'win' && styles.messageWin,
            state.lastResult === 'loss' && styles.messageLoss,
            state.lastResult === 'war' && styles.messageWar,
          ]}
        >
          {state.message}
        </Text>

        {/* Bet Display */}
        {bet > 0 && (
          <View style={styles.betContainer}>
            <Text style={styles.betLabel}>
              {state.warBet > 0 ? 'Total Bet (War)' : 'Bet'}
            </Text>
            <Text style={styles.betAmount}>
              ${bet + state.warBet}
            </Text>
          </View>
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

        {state.phase === 'war_choice' && (
          <>
            <PrimaryButton
              label="GO TO WAR"
              onPress={handleWar}
              disabled={isDisconnected}
              variant="primary"
              size="large"
            />
            <PrimaryButton
              label="SURRENDER"
              onPress={handleSurrender}
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
        <View style={styles.chipArea}>
          {bet > 0 && (
            <PrimaryButton
              label="CLEAR"
              onPress={clearBet}
              variant="secondary"
            />
          )}
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
        gameId="casino_war"
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
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  cardsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.xl,
  },
  cardSide: {
    alignItems: 'center',
  },
  sideLabel: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
    marginBottom: SPACING.sm,
  },
  cardPlaceholder: {
    width: 100,
    height: 150,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  vsContainer: {
    marginHorizontal: SPACING.lg,
  },
  vsText: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.h2,
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  messageWin: {
    color: COLORS.success,
  },
  messageLoss: {
    color: COLORS.error,
  },
  messageWar: {
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  chipArea: {
    alignItems: 'center',
    paddingBottom: SPACING.lg,
  },
});
