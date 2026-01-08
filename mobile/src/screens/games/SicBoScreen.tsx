/**
 * Sic Bo Game Screen - Jony Ive Redesigned
 * 3 dice with Big/Small quick bets, drawer for advanced bets
 */
import { View, Text, StyleSheet, Pressable, Modal, ScrollView, InteractionManager } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, {
  SlideInUp,
  SlideOutDown,
} from 'react-native-reanimated';
import { ChipSelector, Dice3D } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton, BetConfirmationModal, SicBoSkeleton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useModalBackHandler, useBetSubmission, useBetConfirmation } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, SPRING } from '../../constants/theme';
// Note: SPRING still used for modal animations
import { useGameStore } from '../../stores/gameStore';
import { getDieFace } from '../../utils/dice';
// Note: getDieFace still needed for drawer bet display
import { decodeStateBytes, parseNumeric, parseSicBoState } from '../../utils';
import type { ChipValue, TutorialStep, SicBoBetType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface SicBoBet {
  type: SicBoBetType;
  amount: number;
  target?: number;
}

interface SicBoState {
  bets: SicBoBet[];
  dice: [number, number, number] | null;
  total: number;
  phase: 'betting' | 'rolling' | 'result';
  message: string;
  winAmount: number;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Three Dice',
    description: 'Predict the outcome of three dice. Small (4-10) or Big (11-17) are the easiest bets.',
  },
  {
    title: 'Totals & Triples',
    description: 'Bet on specific totals (4-17) or triples. Specific triple pays 180:1!',
  },
  {
    title: 'Any Triple',
    description: 'Any Triple (all three dice match) pays 30:1. Big risk, big reward!',
  },
];

export function SicBoScreen() {
  // Shared hook for connection (SicBo has multi-bet so keeps custom bet state)
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);
  const { balance } = useGameStore();

  const [state, setState] = useState<SicBoState>({
    bets: [],
    dice: null,
    total: 0,
    phase: 'betting',
    message: 'Place your bets',
    winAmount: 0,
  });
  const [selectedChip, setSelectedChip] = useState<ChipValue>(25);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [comboMode, setComboMode] = useState<'NONE' | 'DOMINO' | 'HOP3_EASY' | 'HOP3_HARD' | 'HOP4_EASY'>('NONE');
  const [comboPicks, setComboPicks] = useState<number[]>([]);

  // US-156: Track initial loading state for skeleton
  const [isParsingState, setIsParsingState] = useState(true);

  // Track mounted state to prevent setState after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // US-156: Clear skeleton after initial render
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (isMounted.current) {
        setIsParsingState(false);
      }
    });
    return () => task.cancel();
  }, []);

  useModalBackHandler(showAdvanced, () => setShowAdvanced(false));

  // DS-047: Track dice rolling state for 3D animation
  const [diceRolling, setDiceRolling] = useState(false);

  useEffect(() => {
    if (!lastMessage) return;

    const payload = lastMessage as Record<string, unknown>;
    const stateBytes = decodeStateBytes(payload.state);
    const parsedState = stateBytes ? parseSicBoState(stateBytes) : null;
    const dice = Array.isArray(payload.dice) && payload.dice.length === 3
      ? payload.dice as [number, number, number]
      : parsedState?.dice ?? null;

    // DS-047: Trigger 3D dice roll animation
    if (dice) {
      setDiceRolling(true);
      haptics.diceRoll().catch(() => {});
    }

    if (lastMessage.type === 'game_started') {
      setState((prev) => ({
        ...prev,
        bets: [],
        dice: parsedState?.dice ?? null,
        total: parsedState?.dice ? parsedState.dice[0] + parsedState.dice[1] + parsedState.dice[2] : 0,
        phase: 'betting',
        winAmount: 0,
        message: 'Place your bets',
      }));
      return;
    }

    if (lastMessage.type === 'game_move') {
      if (dice) {
        setState((prev) => ({
          ...prev,
          dice,
          total: dice[0] + dice[1] + dice[2],
          phase: 'rolling',
        }));
      }
      return;
    }

    if (lastMessage.type === 'game_result') {
      clearSubmission();
      const totalReturn = parseNumeric(payload.totalReturn ?? payload.payout) ?? 0;
      const totalWagered = parseNumeric(payload.totalWagered) ?? 0;
      const winAmount = Math.max(0, totalReturn - totalWagered);
      const won = winAmount > 0;
      if (won) {
        haptics.win().catch(() => {});
      } else {
        haptics.loss().catch(() => {});
      }

      setState((prev) => ({
        ...prev,
        dice,
        total: dice ? dice[0] + dice[1] + dice[2] : prev.total,
        phase: 'result',
        winAmount,
        message: typeof payload.message === 'string' ? payload.message : won ? 'You win!' : 'No luck',
      }));
    }
  }, [lastMessage, clearSubmission]);

  // DS-047: Handler when dice roll animation completes
  const handleDiceRollComplete = useCallback(() => {
    setDiceRolling(false);
  }, []);

  useEffect(() => {
    setComboPicks([]);
  }, [comboMode]);

  const addBet = useCallback((type: SicBoBetType, target?: number) => {
    if (state.phase !== 'betting') return;

    // Calculate current total bet
    const currentTotalBet = state.bets.reduce((sum, b) => sum + b.amount, 0);
    if (currentTotalBet + selectedChip > balance) {
      haptics.error().catch(() => {});
      return;
    }

    haptics.chipPlace().catch(() => {});

    setState((prev) => {
      const existingIndex = prev.bets.findIndex(
        (b) => b.type === type && b.target === target
      );

      if (existingIndex >= 0) {
        const newBets = [...prev.bets];
        const existingBet = newBets[existingIndex];
        if (existingBet) {
          newBets[existingIndex] = {
            type: existingBet.type,
            amount: existingBet.amount + selectedChip,
            target: existingBet.target,
          };
        }
        return { ...prev, bets: newBets };
      }

      return {
        ...prev,
        bets: [...prev.bets, { type, amount: selectedChip, target }],
      };
    });
  }, [state.phase, selectedChip, state.bets, balance]);

  const handleComboPick = useCallback((num: number) => {
    if (comboMode === 'NONE') return;

    const place = (type: SicBoBetType, target?: number) => {
      addBet(type, target);
      setComboPicks([]);
    };

    if (comboMode === 'DOMINO') {
      const next = comboPicks.includes(num)
        ? comboPicks.filter((x) => x !== num)
        : [...comboPicks, num].slice(0, 2);
      if (next.length < 2) {
        setComboPicks(next);
        return;
      }
      const a = next[0];
      const b = next[1];
      if (a === undefined || b === undefined) {
        return;
      }
      if (a === b) {
        setComboPicks([a]);
        return;
      }
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      return place('DOMINO', (min << 4) | max);
    }

    if (comboMode === 'HOP3_EASY' || comboMode === 'HOP4_EASY') {
      const maxCount = comboMode === 'HOP3_EASY' ? 3 : 4;
      const next = comboPicks.includes(num) ? comboPicks.filter((x) => x !== num) : [...comboPicks, num];
      if (next.length > maxCount) return;
      if (next.length < maxCount) {
        setComboPicks(next);
        return;
      }
      const mask = next.reduce((m, v) => m | (1 << (v - 1)), 0);
      return place(comboMode, mask);
    }

    if (comboMode === 'HOP3_HARD') {
      if (comboPicks.length === 0) {
        setComboPicks([num]);
        return;
      }
      const doubled = comboPicks[0];
      if (doubled === undefined) {
        return;
      }
      if (num === doubled) {
        setComboPicks([]);
        return;
      }
      return place('HOP3_HARD', (doubled << 4) | num);
    }
  }, [comboMode, comboPicks, addBet]);

  // US-155: Execute roll after bet confirmation
  const executeRoll = useCallback(() => {
    if (state.bets.length === 0 || isSubmitting) return;
    haptics.diceRoll().catch(() => {});

    // US-090: Calculate total bet for atomic validation
    const totalBetAmount = state.bets.reduce((sum, b) => sum + b.amount, 0);
    const success = submitBet(
      {
        type: 'sic_bo_roll',
        bets: state.bets,
      },
      { amount: totalBetAmount }
    );

    if (success) {
      setState((prev) => ({
        ...prev,
        phase: 'rolling',
        message: 'Rolling...',
      }));
    }
  }, [state.bets, submitBet, isSubmitting]);

  // US-155: Bet confirmation modal integration
  const { showConfirmation, confirmationProps, requestConfirmation } = useBetConfirmation({
    gameType: 'sic_bo',
    onConfirm: executeRoll,
    countdownSeconds: 5,
  });

  const handleRoll = useCallback(() => {
    if (state.bets.length === 0 || isSubmitting) return;
    const totalBetAmount = state.bets.reduce((sum, b) => sum + b.amount, 0);
    requestConfirmation({ amount: totalBetAmount });
  }, [state.bets, isSubmitting, requestConfirmation]);

  const handleNewGame = useCallback(() => {
    setState({
      bets: [],
      dice: null,
      total: 0,
      phase: 'betting',
      message: 'Place your bets',
      winAmount: 0,
    });
  }, []);

  const handleChipPlace = useCallback((value: ChipValue) => {
    addBet('BIG');
  }, [addBet]);

  const totalBet = useMemo(() => state.bets.reduce((sum, b) => sum + b.amount, 0), [state.bets]);

  const handleClearBets = useCallback(() => {
    if (state.phase !== 'betting') return;
    setState((prev) => ({ ...prev, bets: [] }));
  }, [state.phase]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && state.bets.length > 0 && !isDisconnected) handleRoll();
      else if (state.phase === 'result') handleNewGame();
    },
    [KEY_ACTIONS.ESCAPE]: () => handleClearBets(),
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && setSelectedChip(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && setSelectedChip(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && setSelectedChip(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && setSelectedChip(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && setSelectedChip(500 as ChipValue),
  }), [state.phase, state.bets.length, isDisconnected, handleRoll, handleNewGame, handleClearBets]);

  useGameKeyboard(keyboardHandlers);

  const drawerEnter = SlideInUp.springify()
    .damping(SPRING.modal.damping)
    .stiffness(SPRING.modal.stiffness)
    .mass(SPRING.modal.mass);

  const drawerExit = SlideOutDown.springify()
    .damping(SPRING.modal.damping)
    .stiffness(SPRING.modal.stiffness)
    .mass(SPRING.modal.mass);

  return (
    <>
      <GameLayout
        title="Sic Bo"
        balance={balance}
        onHelpPress={() => setShowTutorial(true)}
        connectionStatus={connectionStatusProps}
        headerRightContent={
          <Pressable
            onPress={() => setShowAdvanced(true)}
            style={styles.moreBetsButton}
          >
            <Text style={styles.moreBetsText}>Bets ▾</Text>
          </Pressable>
        }
        gameId="sicBo"
      >
        {/* US-156: Show skeleton during initial render */}
        {isParsingState ? (
          <SicBoSkeleton />
        ) : (
        <>
        {/* DS-047: 3D Dice Display */}
      <View style={styles.diceContainer}>
        {state.dice ? (
          <>
            <Dice3D
              value={state.dice[0]}
              isRolling={diceRolling}
              index={0}
              size={56}
              onRollComplete={handleDiceRollComplete}
            />
            <Dice3D
              value={state.dice[1]}
              isRolling={diceRolling}
              index={1}
              size={56}
            />
            <Dice3D
              value={state.dice[2]}
              isRolling={diceRolling}
              index={2}
              size={56}
            />
          </>
        ) : (
          <>
            <Dice3D value={1} isRolling={false} index={0} size={56} skipAnimation />
            <Dice3D value={1} isRolling={false} index={1} size={56} skipAnimation />
            <Dice3D value={1} isRolling={false} index={2} size={56} skipAnimation />
          </>
        )}
      </View>

      {/* Total */}
      {state.dice && (
        <Text style={styles.total}>Total: {state.total}</Text>
      )}

      {/* Message */}
      <Text
        style={[
          styles.message,
          state.winAmount > 0 && styles.messageWin,
        ]}
      >
        {state.message}
      </Text>

      {/* Win Amount */}
      {state.winAmount > 0 && (
        <Text style={styles.winAmount}>+${state.winAmount}</Text>
      )}

      {/* Quick Bets */}
      <View style={styles.quickBets}>
        <Pressable
          onPress={() => addBet('SMALL')}
          disabled={state.phase !== 'betting' || isDisconnected}
          style={({ pressed }) => [
            styles.quickBetButton,
            pressed && styles.quickBetPressed,
            isDisconnected && styles.quickBetDisabled,
          ]}
        >
          <Text style={styles.quickBetLabel}>SMALL</Text>
          <Text style={styles.quickBetRange}>4-10</Text>
          <Text style={styles.quickBetOdds}>1:1</Text>
        </Pressable>

        <Pressable
          onPress={() => addBet('BIG')}
          disabled={state.phase !== 'betting' || isDisconnected}
          style={({ pressed }) => [
            styles.quickBetButton,
            pressed && styles.quickBetPressed,
            isDisconnected && styles.quickBetDisabled,
          ]}
        >
          <Text style={styles.quickBetLabel}>BIG</Text>
          <Text style={styles.quickBetRange}>11-17</Text>
          <Text style={styles.quickBetOdds}>1:1</Text>
        </Pressable>
      </View>

      {/* Bet Summary */}
      {totalBet > 0 && (
        <View style={styles.betSummary}>
          <Text style={styles.betLabel}>Total Bet</Text>
          <Text style={styles.betAmount}>${totalBet}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {state.phase === 'betting' && (
          <PrimaryButton
            label="ROLL"
            onPress={handleRoll}
            disabled={state.bets.length === 0 || isDisconnected || isSubmitting}
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
        </>
        )}
      </GameLayout>

      {/* Advanced Bets Drawer */}
      <Modal visible={showAdvanced} transparent animationType="slide">
        <View style={styles.drawerOverlay}>
          <Animated.View
            entering={drawerEnter}
            exiting={drawerExit}
            style={styles.drawer}
          >
            <View style={styles.drawerHeader}>
              <Pressable onPress={() => setShowAdvanced(false)} style={styles.drawerHandle}>
                <Text style={styles.drawerHandleText}>Bets ▾</Text>
              </Pressable>
            </View>

            <ScrollView>
              {/* Odd / Even */}
              <Text style={styles.sectionTitle}>Odd / Even</Text>
              <View style={styles.betRow}>
                <Pressable style={styles.advancedBet} onPress={() => addBet('ODD')}>
                  <Text style={styles.advancedBetText}>ODD</Text>
                </Pressable>
                <Pressable style={styles.advancedBet} onPress={() => addBet('EVEN')}>
                  <Text style={styles.advancedBetText}>EVEN</Text>
                </Pressable>
              </View>

              {/* Totals */}
              <Text style={styles.sectionTitle}>Totals</Text>
              <View style={styles.totalsGrid}>
                {[4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((num) => (
                  <Pressable
                    key={num}
                    style={styles.totalBet}
                    onPress={() => addBet('SUM', num)}
                  >
                    <Text style={styles.totalNumber}>{num}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Singles */}
              <Text style={styles.sectionTitle}>Single Number</Text>
              <View style={styles.betRow}>
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <Pressable
                    key={num}
                    style={styles.singleBet}
                    onPress={() => addBet('SINGLE_DIE', num)}
                  >
                    <Text style={styles.singleNumber}>{getDieFace(num)}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Doubles */}
              <Text style={styles.sectionTitle}>Specific Double</Text>
              <View style={styles.betRow}>
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <Pressable
                    key={`double-${num}`}
                    style={styles.singleBet}
                    onPress={() => addBet('DOUBLE_SPECIFIC', num)}
                  >
                    <Text style={styles.singleNumber}>{getDieFace(num)}{getDieFace(num)}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Triples */}
              <Text style={styles.sectionTitle}>Triples</Text>
              <View style={styles.betRow}>
                <Pressable
                  style={styles.tripleBet}
                  onPress={() => addBet('TRIPLE_ANY')}
                >
                  <Text style={styles.tripleLabel}>Any Triple</Text>
                  <Text style={styles.tripleOdds}>30:1</Text>
                </Pressable>
              </View>
              <View style={styles.betRow}>
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <Pressable
                    key={num}
                    style={styles.specificTriple}
                    onPress={() => addBet('TRIPLE_SPECIFIC', num)}
                  >
                    <Text style={styles.specificTripleText}>
                      {getDieFace(num)}{getDieFace(num)}{getDieFace(num)}
                    </Text>
                    <Text style={styles.specificTripleOdds}>180:1</Text>
                  </Pressable>
                ))}
              </View>

              {/* Combo Builder */}
              <Text style={styles.sectionTitle}>Combo Builder</Text>
              <View style={styles.comboModes}>
                <Pressable
                  onPress={() => setComboMode('NONE')}
                  style={[styles.comboMode, comboMode === 'NONE' && styles.comboModeActive]}
                >
                  <Text style={styles.comboModeText}>NONE</Text>
                </Pressable>
                {(['DOMINO', 'HOP3_EASY', 'HOP3_HARD', 'HOP4_EASY'] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    onPress={() => setComboMode(mode)}
                    style={[styles.comboMode, comboMode === mode && styles.comboModeActive]}
                  >
                    <Text style={styles.comboModeText}>{mode.replace('_', ' ')}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.comboGrid}>
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <Pressable
                    key={`combo-${num}`}
                    style={[
                      styles.comboPick,
                      comboPicks.includes(num) && styles.comboPickActive,
                    ]}
                    onPress={() => handleComboPick(num)}
                    disabled={comboMode === 'NONE'}
                  >
                    <Text style={styles.comboPickText}>{getDieFace(num)}</Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Tutorial */}
      <TutorialOverlay
        gameId="sic_bo"
        steps={TUTORIAL_STEPS}
        onComplete={() => setShowTutorial(false)}
        forceShow={showTutorial}
      />

      {/* US-155: Bet Confirmation Modal */}
      <BetConfirmationModal {...confirmationProps} testID="bet-confirmation-modal" />
    </>
  );
}

const styles = StyleSheet.create({
  moreBetsButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
  },
  moreBetsText: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.bodySmall,
  },
  diceContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
    marginVertical: SPACING.lg,
  },
  total: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.h2,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  messageWin: {
    color: COLORS.success,
  },
  winAmount: {
    color: COLORS.gold,
    ...TYPOGRAPHY.displayMedium,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  quickBets: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  quickBetButton: {
    flex: 1,
    maxWidth: 140,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickBetPressed: {
    opacity: 0.7,
  },
  quickBetDisabled: {
    opacity: 0.5,
  },
  quickBetLabel: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
  },
  quickBetRange: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
  },
  quickBetOdds: {
    color: COLORS.gold,
    ...TYPOGRAPHY.caption,
  },
  betSummary: {
    alignItems: 'center',
    marginBottom: SPACING.md,
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
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  drawerOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  drawer: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.md,
    maxHeight: '70%',
  },
  drawerHeader: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  drawerHandle: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  drawerHandleText: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.bodySmall,
  },
  sectionTitle: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.label,
    marginTop: SPACING.md,
    marginBottom: SPACING.sm,
  },
  totalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  totalBet: {
    width: 44,
    height: 44,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalNumber: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
  },
  betRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    flexWrap: 'wrap',
  },
  singleBet: {
    width: 48,
    height: 48,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  singleNumber: {
    fontSize: 28,
  },
  tripleBet: {
    flex: 1,
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  tripleLabel: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
  },
  tripleOdds: {
    color: COLORS.gold,
    ...TYPOGRAPHY.caption,
  },
  specificTriple: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  specificTripleText: {
    fontSize: 16,
  },
  specificTripleOdds: {
    color: COLORS.gold,
    ...TYPOGRAPHY.caption,
  },
  advancedBet: {
    flex: 1,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  advancedBetText: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
  },
  comboModes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  comboMode: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  comboModeActive: {
    borderColor: COLORS.gold,
  },
  comboModeText: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.caption,
    textTransform: 'uppercase',
  },
  comboGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  comboPick: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comboPickActive: {
    borderWidth: 1,
    borderColor: COLORS.gold,
  },
  comboPickText: {
    fontSize: 20,
  },
});
