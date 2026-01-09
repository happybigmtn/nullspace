/**
 * Casino War Game Screen - Jony Ive Redesigned
 * Simplest card game - just deal and optional war
 */
import { View, Text, StyleSheet, InteractionManager } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, { SlideInLeft, SlideInRight } from 'react-native-reanimated';
import { Card } from '../../components/casino';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton, BlackjackSkeleton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useChipBetting, useBetSubmission, useWinCelebration } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, SPRING } from '../../constants/theme';
import { decodeCardId, decodeStateBytes, parseCasinoWarState } from '../../utils';
import type { ChipValue, TutorialStep, Card as CardType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface CasinoWarState {
  playerCard: CardType | null;
  dealerCard: CardType | null;
  phase: 'betting' | 'dealt' | 'war_choice' | 'war' | 'result';
  message: string;
  lastResult: 'win' | 'loss' | 'war' | null;
  warBet: number;
  tieBet: number;
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
  // Shared hooks for connection, betting, and submission debouncing
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { bet, selectedChip, setSelectedChip, placeChip, clearBet, balance } = useChipBetting();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);
  const { celebrationState, triggerWin, clearCelebration } = useWinCelebration();

  const [state, setState] = useState<CasinoWarState>({
    playerCard: null,
    dealerCard: null,
    phase: 'betting',
    message: 'Place your bet',
    lastResult: null,
    warBet: 0,
    tieBet: 0,
  });
  const [showTutorial, setShowTutorial] = useState(false);
  // US-156: Track loading state during InteractionManager parsing
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

    const payload = lastMessage as Record<string, unknown>;
    const stateBytes = decodeStateBytes(payload.state);
    const parsedState = stateBytes ? parseCasinoWarState(stateBytes) : null;

    if (lastMessage.type === 'game_started' || lastMessage.type === 'game_move') {
      clearSubmission(); // Clear bet submission state on server response
      if (parsedState) {
        // US-156: Show skeleton during state parsing
        setIsParsingState(true);
        InteractionManager.runAfterInteractions(() => {
          if (!isMounted.current) return;
          setIsParsingState(false);
          setState((prev) => {
            const nextPhase =
              parsedState.stage === 'war'
                ? prev.phase === 'war'
                  ? 'war'
                  : 'war_choice'
                : parsedState.stage === 'complete'
                  ? 'result'
                  : 'betting';

            return {
              ...prev,
              playerCard: parsedState.playerCard ?? prev.playerCard,
              dealerCard: parsedState.dealerCard ?? prev.dealerCard,
              tieBet: parsedState.tieBet > 0 ? parsedState.tieBet : prev.tieBet,
              phase: nextPhase,
              message: nextPhase === 'war_choice' ? 'Tie! Go to War or Surrender?' : prev.message,
            };
          });
        });
      }
      return;
    }

    if (lastMessage.type === 'game_result') {
      clearSubmission(); // Clear bet submission state on result
      const won = (payload.won as boolean | undefined) ?? false;
      const playerCard = typeof payload.playerCard === 'number' ? decodeCardId(payload.playerCard) : null;
      const dealerCard = typeof payload.dealerCard === 'number' ? decodeCardId(payload.dealerCard) : null;

      // Calculate win amount from payout field if available
      const payout = typeof payload.payout === 'number' ? payload.payout : 0;
      const totalBet = bet + state.tieBet + state.warBet;

      if (won) {
        haptics.win().catch(() => {});
        // Trigger win celebration with particles and balance animation
        if (payout > 0) {
          triggerWin(payout, totalBet);
        }
      } else {
        haptics.loss().catch(() => {});
      }

      setState((prev) => ({
        ...prev,
        phase: 'result',
        playerCard: playerCard ?? prev.playerCard,
        dealerCard: dealerCard ?? prev.dealerCard,
        lastResult: won ? 'win' : 'loss',
        message: typeof payload.message === 'string' ? payload.message : won ? 'You win!' : 'Dealer wins',
      }));
    }
  }, [lastMessage, clearSubmission, bet, state.tieBet, state.warBet, triggerWin]);

  const handleDeal = useCallback(() => {
    if (bet === 0 || isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    // US-090: Pass total bet amount for atomic validation
    const totalBet = bet + state.tieBet;
    const success = submitBet(
      {
        type: 'casino_war_deal',
        amount: bet,
        tieBet: state.tieBet,
      },
      { amount: totalBet }
    );

    if (success) {
      setState((prev) => ({
        ...prev,
        message: 'Dealing...',
      }));
    }
  }, [bet, submitBet, state.tieBet, isSubmitting]);

  const handleToggleTieBet = useCallback(() => {
    if (state.phase !== 'betting') return;
    const nextAmount = state.tieBet > 0 ? 0 : selectedChip;
    if (bet + nextAmount > balance) {
      haptics.error().catch(() => {});
      setState((prev) => ({ ...prev, message: 'Insufficient balance' }));
      return;
    }
    haptics.buttonPress().catch(() => {});
    setState((prev) => ({ ...prev, tieBet: nextAmount }));
  }, [state.phase, state.tieBet, selectedChip, bet, balance]);

  const handleWar = useCallback(() => {
    if (isSubmitting) return;
    haptics.betConfirm().catch(() => {});

    const success = submitBet({
      type: 'casino_war_war',
    });

    if (success) {
      setState((prev) => ({
        ...prev,
        phase: 'war',
        warBet: bet,
        message: 'Going to War!',
      }));
    }
  }, [submitBet, bet, isSubmitting]);

  const handleSurrender = useCallback(() => {
    if (isSubmitting) return;
    haptics.buttonPress().catch(() => {});

    submitBet({
      type: 'casino_war_surrender',
    });

    setState((prev) => ({
      ...prev,
      phase: 'result',
      lastResult: 'loss',
      message: 'Surrendered - Half bet returned',
    }));
  }, [submitBet, isSubmitting]);

  const handleNewGame = useCallback(() => {
    clearBet();
    clearCelebration();
    setState({
      playerCard: null,
      dealerCard: null,
      phase: 'betting',
      message: 'Place your bet',
      lastResult: null,
      warBet: 0,
      tieBet: 0,
    });
  }, [clearBet, clearCelebration]);

  const handleClearBets = useCallback(() => {
    clearBet();
    setState((prev) => ({ ...prev, tieBet: 0 }));
  }, [clearBet]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && bet > 0 && !isDisconnected) handleDeal();
      else if (state.phase === 'result') handleNewGame();
      else if (state.phase === 'war_choice' && !isDisconnected) handleWar();
    },
    [KEY_ACTIONS.ESCAPE]: () => {
      if (state.phase === 'betting') handleClearBets();
      else if (state.phase === 'war_choice' && !isDisconnected) handleSurrender();
    },
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && handleChipPlace(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && handleChipPlace(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && handleChipPlace(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && handleChipPlace(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && handleChipPlace(500 as ChipValue),
  }), [state.phase, bet, isDisconnected, handleDeal, handleNewGame, handleWar, handleSurrender, handleClearBets, handleChipPlace]);

  useGameKeyboard(keyboardHandlers);
  const cardEnterLeft = SlideInLeft.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);
  const cardEnterRight = SlideInRight.springify()
    .damping(SPRING.cardDeal.damping)
    .stiffness(SPRING.cardDeal.stiffness)
    .mass(SPRING.cardDeal.mass);

  return (
    <>
      <GameLayout
        title="Casino War"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
        celebrationState={celebrationState}
        gameId="casinoWar"
      >
        {/* US-156: Show skeleton during state parsing */}
        {isParsingState ? (
          <BlackjackSkeleton />
        ) : (
        <>
        {/* Game Area */}
        <View style={styles.gameArea} testID="game-area">
        {/* Cards Display */}
        <View style={styles.cardsContainer} testID="cards-container">
          {/* Dealer Card */}
          <View style={styles.cardSide} testID="dealer-card-side">
            <Text style={styles.sideLabel} testID="dealer-label">Dealer</Text>
            {state.dealerCard ? (
              <Animated.View entering={cardEnterLeft}>
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
          <View style={styles.cardSide} testID="player-card-side">
            <Text style={styles.sideLabel} testID="player-label">You</Text>
            {state.playerCard ? (
              <Animated.View entering={cardEnterRight}>
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
          testID="game-message"
          style={[
            styles.message,
            state.lastResult === 'win' && styles.messageWin,
            state.lastResult === 'loss' && styles.messageLoss,
            state.lastResult === 'war' && styles.messageWar,
          ]}
        >
          {state.message}
        </Text>
        {/* Hidden result indicator for E2E testing */}
        <Text testID={`game-result-${state.lastResult || 'none'}`} style={{ display: 'none' }}>
          {state.lastResult}
        </Text>

        {/* Bet Display */}
        {bet > 0 && (
          <View style={styles.betContainer} testID="bet-container">
            <Text style={styles.betLabel} testID="bet-label">
              {state.warBet > 0 ? 'Total Bet (War)' : 'Bet'}
            </Text>
            <Text style={styles.betAmount} testID="bet-amount">
              ${bet + state.warBet}
            </Text>
            {state.tieBet > 0 && (
              <Text style={styles.tieBetAmount} testID="tie-bet-amount">
                Tie Bet: ${state.tieBet}
              </Text>
            )}
          </View>
        )}

        {state.phase === 'betting' && (
          <PrimaryButton
            label={state.tieBet > 0 ? `Tie Bet $${state.tieBet}` : 'Add Tie Bet'}
            onPress={handleToggleTieBet}
            variant={state.tieBet > 0 ? 'secondary' : 'ghost'}
            testID="tie-bet-button"
          />
        )}
      </View>

      {/* Actions */}
      <View style={styles.actions} testID="actions-container">
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

        {state.phase === 'war_choice' && (
          <>
            <PrimaryButton
              label="GO TO WAR"
              onPress={handleWar}
              disabled={isDisconnected || isSubmitting}
              variant="primary"
              size="large"
              testID="action-go-to-war"
            />
            <PrimaryButton
              label="SURRENDER"
              onPress={handleSurrender}
              disabled={isDisconnected || isSubmitting}
              variant="danger"
              testID="action-surrender"
            />
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
      </View>

      {/* Chip Selector */}
      {state.phase === 'betting' && (
        <View style={styles.chipArea} testID="chip-area">
          {bet > 0 && (
            <PrimaryButton
              label="CLEAR"
              onPress={handleClearBets}
              variant="secondary"
              testID="clear-button"
            />
          )}
          <ChipSelector
            selectedValue={selectedChip}
            onSelect={setSelectedChip}
            onChipPlace={handleChipPlace}
          />
        </View>
      )}
        </>
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
  tieBetAmount: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xs,
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
