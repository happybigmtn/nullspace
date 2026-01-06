/**
 * Roulette Game Screen - Jony Ive Redesigned
 * 6 quick bets visible, drawer for advanced bets
 */
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  Easing,
  cancelAnimation,
  SlideInUp,
  SlideOutDown,
} from 'react-native-reanimated';
import { ChipSelector } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useModalBackHandler, useBetSubmission } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, GAME_DETAIL_COLORS, SPRING } from '../../constants/theme';
import { parseNumeric } from '../../utils';
import { useGameStore } from '../../stores/gameStore';
import type { ChipValue, TutorialStep, RouletteBetType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

const QUICK_BETS: RouletteBetType[] = ['RED', 'BLACK', 'ODD', 'EVEN', 'LOW', 'HIGH'];
const SPLIT_H_TARGETS = Array.from({ length: 35 }, (_, i) => i + 1).filter((num) => num % 3 !== 0);
const SPLIT_V_TARGETS = Array.from({ length: 33 }, (_, i) => i + 1);
const STREET_TARGETS = Array.from({ length: 12 }, (_, i) => 1 + i * 3);
const CORNER_TARGETS = Array.from({ length: 32 }, (_, i) => i + 1).filter((num) => num % 3 !== 0);
const SIX_LINE_TARGETS = Array.from({ length: 11 }, (_, i) => 1 + i * 3);
const ROULETTE_NUMBERS = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

const getNumberAngle = (num: number) => {
  const index = ROULETTE_NUMBERS.indexOf(num);
  if (index < 0) return 0;
  return (index * 360) / ROULETTE_NUMBERS.length;
};

interface RouletteBet {
  type: RouletteBetType;
  amount: number;
  target?: number;
}

interface RouletteState {
  bets: RouletteBet[];
  phase: 'betting' | 'spinning' | 'result';
  result: number | null;
  message: string;
  winAmount: number;
}

type InsideBetType = 'SPLIT_H' | 'SPLIT_V' | 'STREET' | 'CORNER' | 'SIX_LINE';

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Pick Your Bet',
    description: 'Tap the quick bets below - Red/Black, Odd/Even, or High/Low. Each pays 1:1.',
  },
  {
    title: 'Bets',
    description: 'Tap "Bets" for dozens, columns, and straight-up numbers. Straight numbers pay 35:1!',
  },
  {
    title: 'Spin to Win',
    description: 'When ready, tap SPIN and watch where the ball lands. Green 0 is house edge.',
  },
];

export function RouletteScreen() {
  // Shared hook for connection (Roulette has multi-bet array so keeps custom bet state)
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);
  const { balance } = useGameStore();

  const [state, setState] = useState<RouletteState>({
    bets: [],
    phase: 'betting',
    result: null,
    message: 'Place your bets',
    winAmount: 0,
  });
  const [selectedChip, setSelectedChip] = useState<ChipValue>(25);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [insideMode, setInsideMode] = useState<InsideBetType>('SPLIT_H');
  const spinSeedRef = useRef({ extraSpins: 4 });

  useModalBackHandler(showAdvanced, () => setShowAdvanced(false));

  const insideTargets = useMemo(() => {
    switch (insideMode) {
      case 'SPLIT_H':
        return SPLIT_H_TARGETS;
      case 'SPLIT_V':
        return SPLIT_V_TARGETS;
      case 'STREET':
        return STREET_TARGETS;
      case 'CORNER':
        return CORNER_TARGETS;
      case 'SIX_LINE':
        return SIX_LINE_TARGETS;
    }
  }, [insideMode]);

  const wheelRotation = useSharedValue(0);

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'game_result') {
      clearSubmission();
      cancelAnimation(wheelRotation);
      const payload = lastMessage as Record<string, unknown>;
      const result = typeof payload.result === 'number' ? payload.result : 0;
      const current = wheelRotation.value % 360;
      const targetAngle = getNumberAngle(result);
      const delta = (targetAngle - current + 360) % 360;
      const targetRotation = wheelRotation.value + spinSeedRef.current.extraSpins * 360 + delta;
      wheelRotation.value = withTiming(targetRotation, {
        duration: 2200,
        easing: Easing.out(Easing.cubic),
      });

      const won = (payload.won as boolean | undefined) ?? false;
      const totalReturn = parseNumeric(payload.totalReturn ?? payload.payout) ?? 0;
      const totalWagered = parseNumeric(payload.totalWagered) ?? 0;
      const winAmount = Math.max(0, totalReturn - totalWagered);
      if (won) {
        haptics.win().catch(() => {});
      } else {
        haptics.loss().catch(() => {});
      }

      setState((prev) => ({
        ...prev,
        phase: 'result',
        result,
        winAmount,
        message: typeof payload.message === 'string' ? payload.message : won ? 'You win!' : 'No luck',
      }));
    }
  }, [lastMessage, wheelRotation, clearSubmission]);

  useEffect(() => () => {
    cancelAnimation(wheelRotation);
  }, [wheelRotation]);

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${wheelRotation.value}deg` }],
  }));

  const addBet = useCallback((type: RouletteBetType, target?: number) => {
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

  const handleSpin = useCallback(() => {
    if (state.bets.length === 0 || isSubmitting) return;
    haptics.wheelSpin().catch(() => {});

    const success = submitBet({
      type: 'roulette_spin',
      bets: state.bets,
    });

    if (success) {
      spinSeedRef.current = { extraSpins: 4 + Math.floor(Math.random() * 3) };
      wheelRotation.value = withRepeat(
        withTiming(360, { duration: 500, easing: Easing.linear }),
        -1,
        false
      );

      setState((prev) => ({
        ...prev,
        phase: 'spinning',
        message: 'No more bets!',
      }));
    }
  }, [state.bets, submitBet, isSubmitting, wheelRotation]);

  const handleNewGame = useCallback(() => {
    setState((prev) => ({
      ...prev,
      bets: [],
      phase: 'betting',
      result: null,
      message: 'Place your bets',
      winAmount: 0,
    }));
  }, []);

  const handleChipPlace = useCallback((value: ChipValue) => {
    addBet('RED');
  }, [addBet]);

  const totalBet = useMemo(() => state.bets.reduce((sum, b) => sum + b.amount, 0), [state.bets]);

  const handleClearBets = useCallback(() => {
    if (state.phase !== 'betting') return;
    setState((prev) => ({ ...prev, bets: [] }));
  }, [state.phase]);

  const getResultColor = (num: number | null): string => {
    if (num === null) return COLORS.textSecondary;
    if (num === 0 || num === 37) return GAME_DETAIL_COLORS.roulette.green;
    const reds = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    return reds.includes(num) ? GAME_DETAIL_COLORS.roulette.red : GAME_DETAIL_COLORS.roulette.black;
  };

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase === 'betting' && state.bets.length > 0 && !isDisconnected) handleSpin();
      else if (state.phase === 'result') handleNewGame();
    },
    [KEY_ACTIONS.R]: () => state.phase === 'betting' && !isDisconnected && addBet('RED'),
    [KEY_ACTIONS.B]: () => state.phase === 'betting' && !isDisconnected && addBet('BLACK'),
    [KEY_ACTIONS.G]: () => state.phase === 'betting' && !isDisconnected && addBet('STRAIGHT', 0),
    [KEY_ACTIONS.ESCAPE]: () => handleClearBets(),
    [KEY_ACTIONS.ONE]: () => state.phase === 'betting' && setSelectedChip(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase === 'betting' && setSelectedChip(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase === 'betting' && setSelectedChip(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase === 'betting' && setSelectedChip(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase === 'betting' && setSelectedChip(500 as ChipValue),
  }), [state.phase, state.bets.length, isDisconnected, handleSpin, handleNewGame, addBet, handleClearBets]);

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
        title="Roulette"
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
      >
        {/* Wheel Display */}
      <View style={styles.wheelContainer}>
        <Animated.View style={[styles.wheel, wheelStyle]}>
          <View style={styles.wheelInner}>
            {state.result !== null ? (
              <Text style={[styles.resultNumber, { color: getResultColor(state.result) }]}>
                {state.result}
              </Text>
            ) : (
              <Text style={styles.wheelPlaceholder}>🎰</Text>
            )}
          </View>
        </Animated.View>
      </View>

      {/* Message */}
      <Text style={styles.message}>{state.message}</Text>

      {/* Win Amount */}
      {state.winAmount > 0 && (
        <Text style={styles.winAmount}>+${state.winAmount}</Text>
      )}

      {/* Quick Bets */}
      <View style={styles.quickBets}>
        {QUICK_BETS.map((bet) => (
          <Pressable
            key={bet}
            onPress={() => addBet(bet)}
            disabled={state.phase !== 'betting' || isDisconnected}
            style={({ pressed }) => [
              styles.quickBetButton,
              (bet === 'RED') && styles.quickBetRed,
              (bet === 'BLACK') && styles.quickBetBlack,
              pressed && styles.quickBetPressed,
              isDisconnected && styles.quickBetDisabled,
            ]}
          >
            <Text style={styles.quickBetText}>{bet}</Text>
          </Pressable>
        ))}
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
            label="SPIN"
            onPress={handleSpin}
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

            {/* Dozens */}
            <Text style={styles.sectionTitle}>Dozens (2:1)</Text>
            <View style={styles.betRow}>
              <Pressable
                style={styles.advancedBet}
                onPress={() => addBet('DOZEN_1')}
              >
                <Text style={styles.advancedBetText}>1-12</Text>
              </Pressable>
              <Pressable
                style={styles.advancedBet}
                onPress={() => addBet('DOZEN_2')}
              >
                <Text style={styles.advancedBetText}>13-24</Text>
              </Pressable>
              <Pressable
                style={styles.advancedBet}
                onPress={() => addBet('DOZEN_3')}
              >
                <Text style={styles.advancedBetText}>25-36</Text>
              </Pressable>
            </View>

            {/* Columns */}
            <Text style={styles.sectionTitle}>Columns (2:1)</Text>
            <View style={styles.betRow}>
              <Pressable
                style={styles.advancedBet}
                onPress={() => addBet('COL_1')}
              >
                <Text style={styles.advancedBetText}>Col 1</Text>
              </Pressable>
              <Pressable
                style={styles.advancedBet}
                onPress={() => addBet('COL_2')}
              >
                <Text style={styles.advancedBetText}>Col 2</Text>
              </Pressable>
              <Pressable
                style={styles.advancedBet}
                onPress={() => addBet('COL_3')}
              >
                <Text style={styles.advancedBetText}>Col 3</Text>
              </Pressable>
            </View>

            {/* Inside Bets */}
            <Text style={styles.sectionTitle}>Inside Bets</Text>
            <View style={styles.insideTabs}>
              {(['SPLIT_H', 'SPLIT_V', 'STREET', 'CORNER', 'SIX_LINE'] as InsideBetType[]).map((type) => (
                <Pressable
                  key={type}
                  onPress={() => setInsideMode(type)}
                  style={[styles.insideTab, insideMode === type && styles.insideTabActive]}
                >
                  <Text style={styles.insideTabText}>{type.replace('_', ' ')}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.numberGrid}>
              {insideTargets.map((num) => (
                <Pressable
                  key={`${insideMode}-${num}`}
                  style={styles.numberBet}
                  onPress={() => addBet(insideMode, num)}
                >
                  <Text style={styles.numberText}>{num}</Text>
                </Pressable>
              ))}
            </View>

            {/* Straight Numbers */}
            <Text style={styles.sectionTitle}>Straight Up (35:1)</Text>
            <View style={styles.numberGrid}>
              {[0, ...Array.from({ length: 36 }, (_, i) => i + 1)].map((num) => (
                <Pressable
                  key={num}
                  style={[
                    styles.numberBet,
                    { backgroundColor: getResultColor(num) },
                  ]}
                  onPress={() => addBet('STRAIGHT', num)}
                >
                  <Text style={styles.numberText}>{num}</Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        </View>
      </Modal>

      {/* Tutorial */}
      <TutorialOverlay
        gameId="roulette"
        steps={TUTORIAL_STEPS}
        onComplete={() => setShowTutorial(false)}
        forceShow={showTutorial}
      />
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
  wheelContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: SPACING.lg,
  },
  wheel: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: COLORS.surface,
    borderWidth: 4,
    borderColor: COLORS.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelInner: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultNumber: {
    ...TYPOGRAPHY.displayLarge,
    color: COLORS.textPrimary,
  },
  wheelPlaceholder: {
    fontSize: 48,
  },
  message: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.h3,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  winAmount: {
    color: COLORS.success,
    ...TYPOGRAPHY.h2,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  quickBets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  quickBetButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surfaceElevated,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickBetRed: {
    backgroundColor: GAME_DETAIL_COLORS.roulette.red,
    borderColor: GAME_DETAIL_COLORS.roulette.red,
  },
  quickBetBlack: {
    backgroundColor: GAME_DETAIL_COLORS.roulette.black,
    borderColor: GAME_DETAIL_COLORS.roulette.black,
  },
  quickBetPressed: {
    opacity: 0.7,
  },
  quickBetDisabled: {
    opacity: 0.5,
  },
  quickBetText: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
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
    maxHeight: '80%',
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
  betRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  insideTabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  insideTab: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceElevated,
  },
  insideTabActive: {
    borderColor: COLORS.gold,
  },
  insideTabText: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.caption,
    textTransform: 'uppercase',
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
  numberGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: SPACING.sm,
  },
  numberBet: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.bodySmall,
    fontWeight: 'bold',
  },
});
