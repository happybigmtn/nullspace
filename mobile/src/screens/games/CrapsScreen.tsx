/**
 * Craps Game Screen - Jony Ive Redesigned
 * Pass/Don't Pass visible, drawer for 40+ bet types
 */
import { View, Text, StyleSheet, Pressable, Modal, ScrollView } from 'react-native';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Animated, {
  SlideInUp,
  SlideOutDown,
} from 'react-native-reanimated';
import { ChipSelector, Dice3D } from '../../components/casino';
import { GameLayout } from '../../components/game';
import { TutorialOverlay, PrimaryButton, BetConfirmationModal } from '../../components/ui';
import { haptics } from '../../services/haptics';
import { useGameKeyboard, KEY_ACTIONS, useGameConnection, useModalBackHandler, useBetSubmission, useBetConfirmation } from '../../hooks';
import { COLORS, SPACING, TYPOGRAPHY, RADIUS, GAME_DETAIL_COLORS, SPRING } from '../../constants/theme';
// Note: SPRING still used for modal animations
import { decodeStateBytes, parseCrapsState, parseNumeric } from '../../utils';
import { useGameStore } from '../../stores/gameStore';
import type { ChipValue, TutorialStep, CrapsBetType } from '../../types';
import type { GameMessage } from '@nullspace/protocol/mobile';

interface CrapsBet {
  type: CrapsBetType;
  amount: number;
  target?: number;
}

interface CrapsState {
  bets: CrapsBet[];
  tableTotals: { type: string; amount: number; target?: number }[];
  dice: [number, number] | null;
  point: number | null;
  phase: 'comeout' | 'point' | 'rolling' | 'result';
  message: string;
  winAmount: number;
  lastResult: 'win' | 'loss' | null;
}

type ConfirmationStatus = 'pending' | 'confirmed' | 'failed';
type ConfirmationSource = 'onchain';

interface ConfirmationState {
  status: ConfirmationStatus;
  source: ConfirmationSource;
  label: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Come Out Roll',
    description: 'Pass Line wins on 7 or 11, loses on 2, 3, or 12. Any other number sets the Point.',
  },
  {
    title: 'Point Phase',
    description: 'Once Point is set, Pass wins if Point rolls again before 7. Don\'t Pass is the opposite.',
  },
  {
    title: 'Bets',
    description: 'Tap "Bets" for Come, Place, Hardways, and proposition bets with higher payouts!',
  },
];

const ESSENTIAL_BETS: CrapsBetType[] = ['PASS', 'DONT_PASS'];
const YES_NO_TARGETS = [4, 5, 6, 8, 9, 10];
const NEXT_TARGETS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const HARDWAY_TARGETS = [4, 6, 8, 10];
type LiveTablePhase = 'betting' | 'locked' | 'rolling' | 'payout' | 'cooldown';

export function CrapsScreen() {
  // Shared hook for connection (Craps has multi-bet array so keeps custom bet state)
  const { isDisconnected, send, lastMessage, connectionStatusProps } = useGameConnection<GameMessage>();
  const { isSubmitting, submitBet, clearSubmission } = useBetSubmission(send);
  const { balance } = useGameStore();

  const [state, setState] = useState<CrapsState>({
    bets: [],
    tableTotals: [],
    dice: null,
    point: null,
    phase: 'comeout',
    message: 'Joining global table...',
    winAmount: 0,
    lastResult: null,
  });
  const [selectedChip, setSelectedChip] = useState<ChipValue>(25);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationState | null>(null);
  const [liveTable, setLiveTable] = useState<{ phase: LiveTablePhase; timeRemainingMs: number; roundId: number; playerCount: number }>({
    phase: 'betting',
    timeRemainingMs: 0,
    roundId: 0,
    playerCount: 0,
  });
  const liveTableRef = useRef(liveTable);

  // Track mounted state to prevent setState after unmount
  const isMounted = useRef(true);
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  useModalBackHandler(showAdvanced, () => setShowAdvanced(false));

  useEffect(() => {
    liveTableRef.current = liveTable;
  }, [liveTable]);

  useEffect(() => {
    if (isDisconnected) return;
    send({ type: 'craps_live_join' });
    return () => {
      send({ type: 'craps_live_leave' });
    };
  }, [isDisconnected, send]);

  // DS-047: Track dice rolling state for 3D animation
  const [diceRolling, setDiceRolling] = useState(false);

  useEffect(() => {
    if (!lastMessage) return;
    const payload = lastMessage as Record<string, unknown>;
    const stateBytes = decodeStateBytes(payload.state);
    const parsedState = stateBytes ? parseCrapsState(stateBytes) : null;
    const dice = Array.isArray(payload.dice) && payload.dice.length === 2
      ? payload.dice as [number, number]
      : parsedState?.dice ?? null;
    const point = typeof payload.point === 'number'
      ? payload.point
      : parsedState?.point ?? null;

    // DS-047: Trigger 3D dice roll animation
    const shouldAnimateDice = dice !== null;
    if (shouldAnimateDice) {
      setDiceRolling(true);
      haptics.diceRoll().catch(() => {});
    }

    if (lastMessage.type === 'live_table_confirmation') {
      const status = typeof payload.status === 'string'
        ? payload.status as ConfirmationStatus
        : 'pending';
      const source: ConfirmationSource = 'onchain';
      const defaultLabel = status === 'confirmed'
        ? 'On-chain confirmed'
        : status === 'failed'
          ? 'On-chain failed'
          : 'On-chain pending';

      setConfirmation({
        status,
        source,
        label: typeof payload.message === 'string' ? payload.message : defaultLabel,
      });
      if (status === 'confirmed') {
        clearSubmission();
        haptics.betConfirm().catch(() => {});
      }
      return;
    }

    if (lastMessage.type === 'live_table_state') {
      const phase = typeof payload.phase === 'string' ? payload.phase as LiveTablePhase : liveTableRef.current.phase;
      const timeRemainingMs = typeof payload.timeRemainingMs === 'number'
        ? payload.timeRemainingMs
        : liveTableRef.current.timeRemainingMs;
      const roundId = typeof payload.roundId === 'number' ? payload.roundId : liveTableRef.current.roundId;
      const playerCount = typeof payload.playerCount === 'number'
        ? payload.playerCount
        : liveTableRef.current.playerCount;
      const seconds = Math.max(0, Math.ceil(timeRemainingMs / 1000));
      const liveMessage = phase === 'betting'
        ? `Global roll in ${seconds}s - Place your bets`
        : phase === 'locked'
          ? 'Bets locked'
          : phase === 'rolling'
            ? 'Global roll in progress...'
            : phase === 'payout'
              ? 'Paying out...'
              : 'Next round soon';

      const nextBets = Array.isArray(payload.myBets)
        ? payload.myBets
            .filter((bet) => typeof bet === 'object' && bet !== null)
            .map((bet) => {
              const entry = bet as { type?: string; amount?: number; target?: number };
              return {
                type: (entry.type ?? 'PASS') as CrapsBetType,
                amount: typeof entry.amount === 'number' ? entry.amount : 0,
                target: entry.target,
              } as CrapsBet;
            })
            .filter((bet) => bet.amount > 0)
        : null;

      const nextTotals = Array.isArray(payload.tableTotals)
        ? payload.tableTotals
            .filter((bet) => typeof bet === 'object' && bet !== null)
            .map((bet) => {
              const entry = bet as { type?: string; amount?: number; target?: number };
              return {
                type: typeof entry.type === 'string' ? entry.type : 'BET',
                amount: typeof entry.amount === 'number' ? entry.amount : 0,
                target: entry.target,
              };
            })
            .filter((bet) => bet.amount > 0)
        : null;

      setLiveTable({ phase, timeRemainingMs, roundId, playerCount });
      setState((prev) => ({
        ...prev,
        dice,
        point,
        phase: point ? 'point' : 'comeout',
        message: liveMessage,
        winAmount: roundId !== liveTableRef.current.roundId ? 0 : prev.winAmount,
        lastResult: roundId !== liveTableRef.current.roundId ? null : prev.lastResult,
        bets: nextBets ?? prev.bets,
        tableTotals: nextTotals ?? prev.tableTotals,
      }));
      return;
    }

    if (lastMessage.type === 'live_table_result') {
      clearSubmission();
      const netWin = parseNumeric(payload.netWin ?? payload.payout) ?? 0;
      const won = netWin > 0;
      if (won) {
        haptics.win().catch(() => {});
      } else {
        haptics.loss().catch(() => {});
      }

      const nextBets = Array.isArray(payload.myBets)
        ? payload.myBets
            .filter((bet) => typeof bet === 'object' && bet !== null)
            .map((bet) => {
              const entry = bet as { type?: string; amount?: number; target?: number };
              return {
                type: (entry.type ?? 'PASS') as CrapsBetType,
                amount: typeof entry.amount === 'number' ? entry.amount : 0,
                target: entry.target,
              } as CrapsBet;
            })
            .filter((bet) => bet.amount > 0)
        : null;

      setState((prev) => ({
        ...prev,
        dice,
        point,
        phase: point ? 'point' : 'comeout',
        winAmount: Math.max(0, netWin),
        lastResult: won ? 'win' : 'loss',
        message: typeof payload.message === 'string' ? payload.message : won ? 'Winner!' : 'No win',
        bets: nextBets ?? prev.bets,
      }));
      return;
    }

    if (lastMessage.type === 'game_move') {
      const phaseLabel = typeof payload.phase === 'string' ? payload.phase : null;
      setState((prev) => {
        const phase = phaseLabel === 'POINT'
          ? 'point'
          : phaseLabel === 'COME_OUT'
            ? 'comeout'
            : parsedState?.phase ?? prev.phase;
        return {
          ...prev,
          dice,
          point,
          phase,
          message: phase === 'point' ? 'Point is set' : 'Come out roll',
        };
      });
      setConfirmation((prev) => {
        if (!prev || prev.source !== 'onchain' || prev.status !== 'pending') return prev;
        return {
          status: 'confirmed',
          source: 'onchain',
          label: 'On-chain confirmed',
        };
      });
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
        point,
        phase: 'result',
        winAmount,
        lastResult: won ? 'win' : 'loss',
        message: typeof payload.message === 'string' ? payload.message : won ? 'Winner!' : 'Seven out!',
      }));
      setConfirmation((prev) => {
        if (!prev || prev.source !== 'onchain' || prev.status !== 'pending') return prev;
        return {
          status: 'confirmed',
          source: 'onchain',
          label: 'On-chain confirmed',
        };
      });
      return;
    }

    if (lastMessage.type === 'error') {
      setConfirmation((prev) => {
        if (!prev || prev.status !== 'pending') return prev;
        return {
          status: 'failed',
          source: prev.source,
          label: 'On-chain failed',
        };
      });
    }
  }, [lastMessage, clearSubmission]);

  // DS-047: Handler when dice roll animation completes
  const handleDiceRollComplete = useCallback(() => {
    setDiceRolling(false);
  }, []);

  const addBet = useCallback((type: CrapsBetType, target?: number) => {
    if (liveTable.phase !== 'betting') {
      setState((prev) => ({ ...prev, message: 'BETTING CLOSED' }));
      return;
    }
    if (state.phase === 'rolling') return;

    // Calculate current total bet
    const currentTotalBet = state.bets.reduce((sum, b) => sum + b.amount, 0);
    if (currentTotalBet + selectedChip > balance) {
      haptics.error().catch(() => {});
      return;
    }

    haptics.chipPlace().catch(() => {});

    setState((prev) => {
      const existingIndex = prev.bets.findIndex((b) => b.type === type && b.target === target);

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
  }, [state.phase, selectedChip, state.bets, balance, liveTable.phase]);

  /**
   * Execute the bet placement after confirmation (US-155)
   */
  const executePlaceBets = useCallback(() => {
    if (state.bets.length === 0 || isSubmitting) return;
    if (liveTable.phase !== 'betting') {
      setState((prev) => ({ ...prev, message: 'BETTING CLOSED' }));
      return;
    }
    setConfirmation({
      status: 'pending',
      source: 'onchain',
      label: 'On-chain pending',
    });
    // US-090: Calculate total bet for atomic validation
    const totalBetAmount = state.bets.reduce((sum, b) => sum + b.amount, 0);
    submitBet(
      {
        type: 'craps_live_bet',
        bets: state.bets,
      },
      { amount: totalBetAmount }
    );
    setState((prev) => ({
      ...prev,
      message: 'BETS PLACED',
    }));
  }, [state.bets, submitBet, liveTable.phase, isSubmitting]);

  // US-155: Bet confirmation modal integration
  const { showConfirmation, confirmationProps, requestConfirmation } = useBetConfirmation({
    gameType: 'craps',
    onConfirm: executePlaceBets,
    countdownSeconds: 5,
  });

  /**
   * Handle place bets button - triggers confirmation modal (US-155)
   */
  const handleRoll = useCallback(async () => {
    if (state.bets.length === 0 || isSubmitting) return;
    if (liveTable.phase !== 'betting') {
      setState((prev) => ({ ...prev, message: 'BETTING CLOSED' }));
      return;
    }

    // US-155: Show confirmation modal
    const totalBetAmount = state.bets.reduce((sum, b) => sum + b.amount, 0);
    requestConfirmation({
      amount: totalBetAmount,
    });
  }, [state.bets, isSubmitting, liveTable.phase, requestConfirmation]);

  const handleChipPlace = useCallback((value: ChipValue) => {
    addBet('PASS');
  }, [addBet]);

  const totalBet = useMemo(() => state.bets.reduce((sum, b) => sum + b.amount, 0), [state.bets]);
  const sortedTotals = useMemo(() => {
    const totals = [...state.tableTotals];
    totals.sort((a, b) => b.amount - a.amount);
    return totals;
  }, [state.tableTotals]);
  const liveTotals = useMemo(() => sortedTotals.slice(0, 12), [sortedTotals]);
  const maxLiveTotal = sortedTotals[0]?.amount ?? 0;
  const formatBetLabel = useCallback((bet: { type: string; target?: number }) => {
    const type = bet.type.toUpperCase();
    if (type === 'HARDWAY' && bet.target) return `HARD ${bet.target}`;
    if (type === 'YES' && bet.target) return `YES ${bet.target}`;
    if (type === 'NO' && bet.target) return `NO ${bet.target}`;
    if (type === 'NEXT' && bet.target) return `NEXT ${bet.target}`;
    if (bet.target) return `${type} ${bet.target}`;
    return type.replace(/_/g, ' ');
  }, []);

  const handleClearBets = useCallback(() => {
    if (state.phase === 'rolling') return;
    setState((prev) => ({ ...prev, bets: [] }));
  }, [state.phase]);

  // Keyboard controls
  const keyboardHandlers = useMemo(() => ({
    [KEY_ACTIONS.SPACE]: () => {
      if (state.phase !== 'rolling' && state.bets.length > 0 && !isDisconnected && !isSubmitting) handleRoll();
    },
    [KEY_ACTIONS.ESCAPE]: () => handleClearBets(),
    [KEY_ACTIONS.ONE]: () => state.phase !== 'rolling' && setSelectedChip(1 as ChipValue),
    [KEY_ACTIONS.TWO]: () => state.phase !== 'rolling' && setSelectedChip(5 as ChipValue),
    [KEY_ACTIONS.THREE]: () => state.phase !== 'rolling' && setSelectedChip(25 as ChipValue),
    [KEY_ACTIONS.FOUR]: () => state.phase !== 'rolling' && setSelectedChip(100 as ChipValue),
    [KEY_ACTIONS.FIVE]: () => state.phase !== 'rolling' && setSelectedChip(500 as ChipValue),
  }), [state.phase, state.bets.length, isDisconnected, isSubmitting, handleRoll, handleClearBets]);

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
        title="Craps — Global Table"
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
        gameId="craps"
      >
        {/* Point Display */}
      {state.point && (
        <View style={styles.pointContainer}>
          <Text style={styles.pointLabel}>POINT</Text>
          <Text style={styles.pointValue}>{state.point}</Text>
        </View>
      )}

      {/* DS-047: 3D Dice Display */}
      <View style={styles.diceContainer}>
        {state.dice ? (
          <>
            <Dice3D
              value={state.dice[0]}
              isRolling={diceRolling}
              index={0}
              size={70}
              onRollComplete={handleDiceRollComplete}
            />
            <Dice3D
              value={state.dice[1]}
              isRolling={diceRolling}
              index={1}
              size={70}
            />
          </>
        ) : (
          <>
            <Dice3D value={1} isRolling={false} index={0} size={70} skipAnimation />
            <Dice3D value={1} isRolling={false} index={1} size={70} skipAnimation />
          </>
        )}
      </View>

      {/* Total Display */}
      {state.dice && (
        <Text style={styles.total}>{state.dice[0] + state.dice[1]}</Text>
      )}

      {/* Global Table Meta */}
      <View style={styles.globalTableMeta}>
        <Text style={styles.globalTableLabel}>GLOBAL TABLE</Text>
        <Text style={styles.globalTableCount}>
          {liveTable.playerCount > 0 ? `${liveTable.playerCount} PLAYERS` : 'PLAYERS JOINING...'}
        </Text>
        <Text style={styles.globalTableRound}>
          {liveTable.roundId > 0 ? `ROUND ${liveTable.roundId}` : 'ROUND —'} • {liveTable.phase.toUpperCase()}
        </Text>
      </View>

      {/* Message */}
      <Text
        style={[
          styles.message,
          state.lastResult === 'win' && styles.messageWin,
          state.lastResult === 'loss' && styles.messageLoss,
        ]}
      >
        {state.message}
      </Text>
      {confirmation && (
        <View
          style={[
            styles.confirmationPill,
            confirmation.status === 'pending' && styles.confirmationPending,
            confirmation.status === 'confirmed' && styles.confirmationConfirmed,
            confirmation.status === 'failed' && styles.confirmationFailed,
          ]}
        >
          <Text style={styles.confirmationText}>{confirmation.label}</Text>
        </View>
      )}

      {/* Win Amount */}
      {state.winAmount > 0 && (
        <Text style={styles.winAmount}>+${state.winAmount}</Text>
      )}

      {/* Global Table Heat */}
      {liveTotals.length > 0 && (
        <View style={styles.heatContainer}>
          <Text style={styles.heatTitle}>TABLE HEAT</Text>
          {liveTotals.map((bet) => {
            const intensity = maxLiveTotal > 0 ? bet.amount / maxLiveTotal : 0;
            const heatColor = `rgba(255, 204, 0, ${0.15 + intensity * 0.7})`;
            return (
              <View key={`${bet.type}-${bet.target ?? 'n'}`} style={styles.heatRow}>
                <Text style={styles.heatLabel}>{formatBetLabel(bet)}</Text>
                <View style={styles.heatBarTrack}>
                  <View style={[styles.heatBarFill, { width: `${Math.max(8, intensity * 100)}%`, backgroundColor: heatColor }]} />
                </View>
                <Text style={styles.heatAmount}>${bet.amount}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Essential Bets */}
      <View style={styles.essentialBets}>
        {ESSENTIAL_BETS.map((bet) => (
          <Pressable
            key={bet}
            onPress={() => addBet(bet)}
            disabled={state.phase === 'rolling' || isDisconnected}
            style={({ pressed }) => [
              styles.essentialBetButton,
              bet === 'PASS' && styles.passBet,
              bet === 'DONT_PASS' && styles.dontPassBet,
              pressed && styles.betPressed,
              isDisconnected && styles.betDisabled,
            ]}
          >
            <Text style={styles.essentialBetText}>
              {bet === 'PASS' ? 'PASS LINE' : "DON'T PASS"}
            </Text>
            {state.bets.find((b) => b.type === bet && b.target === undefined) && (
              <Text style={styles.betAmountLabel}>
                ${state.bets.find((b) => b.type === bet && b.target === undefined)?.amount}
              </Text>
            )}
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
        <PrimaryButton
          label={liveTable.phase === 'betting' ? 'PLACE BETS' : 'BETTING CLOSED'}
          onPress={handleRoll}
          disabled={state.bets.length === 0 || liveTable.phase !== 'betting' || isDisconnected || isSubmitting}
          variant="primary"
          size="large"
        />
      </View>

      {/* Chip Selector */}
      {state.phase !== 'rolling' && (
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

            <ScrollView>
              <Text style={styles.liveTableNote}>
                Global table: every player shares the same roll
              </Text>
              {sortedTotals.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>Table Heat</Text>
                  {sortedTotals.map((bet) => {
                    const intensity = maxLiveTotal > 0 ? bet.amount / maxLiveTotal : 0;
                    const heatColor = `rgba(255, 204, 0, ${0.15 + intensity * 0.7})`;
                    return (
                      <View key={`${bet.type}-${bet.target ?? 'n'}`} style={styles.heatRow}>
                        <Text style={styles.heatLabel}>{formatBetLabel(bet)}</Text>
                        <View style={styles.heatBarTrack}>
                          <View style={[styles.heatBarFill, { width: `${Math.max(8, intensity * 100)}%`, backgroundColor: heatColor }]} />
                        </View>
                        <Text style={styles.heatAmount}>${bet.amount}</Text>
                      </View>
                    );
                  })}
                </>
              )}
              {/* Come Bets */}
              <Text style={styles.sectionTitle}>Come Bets</Text>
              <View style={styles.betRow}>
                <Pressable style={styles.advancedBet} onPress={() => addBet('COME')}>
                  <Text style={styles.advancedBetText}>COME</Text>
                </Pressable>
                <Pressable style={styles.advancedBet} onPress={() => addBet('DONT_COME')}>
                  <Text style={styles.advancedBetText}>DON'T COME</Text>
                </Pressable>
              </View>

              {/* Field */}
              <Text style={styles.sectionTitle}>Field</Text>
              <View style={styles.betRow}>
                <Pressable style={styles.advancedBet} onPress={() => addBet('FIELD')}>
                  <Text style={styles.advancedBetText}>FIELD</Text>
                </Pressable>
              </View>

              {/* YES (Place) */}
              <Text style={styles.sectionTitle}>YES (Place)</Text>
              <View style={styles.betRow}>
                {YES_NO_TARGETS.slice(0, 3).map((num) => (
                  <Pressable key={`yes-${num}`} style={styles.advancedBet} onPress={() => addBet('YES', num)}>
                    <Text style={styles.advancedBetText}>{num}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.betRow}>
                {YES_NO_TARGETS.slice(3).map((num) => (
                  <Pressable key={`yes-${num}`} style={styles.advancedBet} onPress={() => addBet('YES', num)}>
                    <Text style={styles.advancedBetText}>{num}</Text>
                  </Pressable>
                ))}
              </View>

              {/* NO (Lay) */}
              <Text style={styles.sectionTitle}>NO (Lay)</Text>
              <View style={styles.betRow}>
                {YES_NO_TARGETS.slice(0, 3).map((num) => (
                  <Pressable key={`no-${num}`} style={styles.advancedBet} onPress={() => addBet('NO', num)}>
                    <Text style={styles.advancedBetText}>{num}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.betRow}>
                {YES_NO_TARGETS.slice(3).map((num) => (
                  <Pressable key={`no-${num}`} style={styles.advancedBet} onPress={() => addBet('NO', num)}>
                    <Text style={styles.advancedBetText}>{num}</Text>
                  </Pressable>
                ))}
              </View>

              {/* NEXT (Hop) */}
              <Text style={styles.sectionTitle}>NEXT (Hop)</Text>
              <View style={styles.betRow}>
                {NEXT_TARGETS.slice(0, 6).map((num) => (
                  <Pressable key={`next-${num}`} style={styles.advancedBet} onPress={() => addBet('NEXT', num)}>
                    <Text style={styles.advancedBetText}>{num}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.betRow}>
                {NEXT_TARGETS.slice(6).map((num) => (
                  <Pressable key={`next-${num}`} style={styles.advancedBet} onPress={() => addBet('NEXT', num)}>
                    <Text style={styles.advancedBetText}>{num}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Hardways */}
              <Text style={styles.sectionTitle}>Hardways</Text>
              <View style={styles.betRow}>
                {HARDWAY_TARGETS.map((num) => (
                  <Pressable key={`hard-${num}`} style={styles.advancedBet} onPress={() => addBet('HARDWAY', num)}>
                    <Text style={styles.advancedBetText}>H{num}</Text>
                  </Pressable>
                ))}
              </View>

              {/* Fire + ATS */}
              <Text style={styles.sectionTitle}>Fire + ATS</Text>
              <View style={styles.betRow}>
                <Pressable style={styles.advancedBet} onPress={() => addBet('FIRE')}>
                  <Text style={styles.advancedBetText}>FIRE</Text>
                </Pressable>
                <Pressable style={styles.advancedBet} onPress={() => addBet('ATS_SMALL')}>
                  <Text style={styles.advancedBetText}>ATS SMALL</Text>
                </Pressable>
              </View>
              <View style={styles.betRow}>
                <Pressable style={styles.advancedBet} onPress={() => addBet('ATS_TALL')}>
                  <Text style={styles.advancedBetText}>ATS TALL</Text>
                </Pressable>
                <Pressable style={styles.advancedBet} onPress={() => addBet('ATS_ALL')}>
                  <Text style={styles.advancedBetText}>ATS ALL</Text>
                </Pressable>
              </View>

              {/* Side Bets */}
              <Text style={styles.sectionTitle}>Side Bets</Text>
              <View style={styles.betRow}>
                <Pressable style={styles.advancedBet} onPress={() => addBet('MUGGSY')}>
                  <Text style={styles.advancedBetText}>MUGGSY</Text>
                </Pressable>
                <Pressable style={styles.advancedBet} onPress={() => addBet('DIFF_DOUBLES')}>
                  <Text style={styles.advancedBetText}>DIFF DOUBLES</Text>
                </Pressable>
              </View>
              <View style={styles.betRow}>
                <Pressable style={styles.advancedBet} onPress={() => addBet('RIDE_LINE')}>
                  <Text style={styles.advancedBetText}>RIDE LINE</Text>
                </Pressable>
                <Pressable style={styles.advancedBet} onPress={() => addBet('REPLAY')}>
                  <Text style={styles.advancedBetText}>REPLAY</Text>
                </Pressable>
              </View>
              <View style={styles.betRow}>
                <Pressable style={styles.advancedBet} onPress={() => addBet('HOT_ROLLER')}>
                  <Text style={styles.advancedBetText}>HOT ROLLER</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Tutorial */}
      <TutorialOverlay
        gameId="craps"
        steps={TUTORIAL_STEPS}
        onComplete={() => setShowTutorial(false)}
        forceShow={showTutorial}
      />

      {/* US-155: Bet Confirmation Modal */}
      <BetConfirmationModal
        {...confirmationProps}
        testID="bet-confirmation-modal"
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
  pointContainer: {
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  pointLabel: {
    color: COLORS.gold,
    ...TYPOGRAPHY.label,
  },
  pointValue: {
    color: COLORS.gold,
    ...TYPOGRAPHY.displayLarge,
  },
  diceContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.lg,
    marginVertical: SPACING.lg,
  },
  total: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.displayMedium,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  globalTableMeta: {
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  globalTableLabel: {
    color: COLORS.gold,
    ...TYPOGRAPHY.label,
    letterSpacing: 2,
  },
  globalTableCount: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.bodySmall,
    marginTop: 2,
  },
  globalTableRound: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    marginTop: 2,
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
  messageLoss: {
    color: COLORS.error,
  },
  confirmationPill: {
    alignSelf: 'center',
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
    borderRadius: RADIUS.full,
    marginBottom: SPACING.sm,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  confirmationPending: {
    backgroundColor: 'rgba(255, 198, 0, 0.2)',
  },
  confirmationConfirmed: {
    backgroundColor: 'rgba(0, 200, 120, 0.2)',
  },
  confirmationFailed: {
    backgroundColor: 'rgba(220, 50, 50, 0.2)',
  },
  confirmationText: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.caption,
  },
  winAmount: {
    color: COLORS.success,
    ...TYPOGRAPHY.h2,
    textAlign: 'center',
    marginBottom: SPACING.md,
  },
  heatContainer: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surfaceElevated,
  },
  heatTitle: {
    color: COLORS.textMuted,
    ...TYPOGRAPHY.caption,
    marginBottom: SPACING.xs,
    letterSpacing: 1,
  },
  heatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
  },
  heatLabel: {
    width: 90,
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.bodySmall,
  },
  heatBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: RADIUS.full,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
    overflow: 'hidden',
  },
  heatBarFill: {
    height: 8,
    borderRadius: RADIUS.full,
  },
  heatAmount: {
    width: 64,
    textAlign: 'right',
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.caption,
  },
  essentialBets: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  essentialBetButton: {
    flex: 1,
    maxWidth: 160,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  passBet: {
    backgroundColor: GAME_DETAIL_COLORS.craps.pass,
  },
  dontPassBet: {
    backgroundColor: GAME_DETAIL_COLORS.craps.dontPass,
  },
  betPressed: {
    opacity: 0.7,
  },
  betDisabled: {
    opacity: 0.5,
  },
  essentialBetText: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.label,
  },
  betAmountLabel: {
    color: COLORS.textPrimary,
    ...TYPOGRAPHY.caption,
    marginTop: 4,
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
  liveTableNote: {
    color: COLORS.textSecondary,
    ...TYPOGRAPHY.bodySmall,
    textAlign: 'center',
    marginBottom: SPACING.sm,
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
    marginBottom: SPACING.sm,
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
    ...TYPOGRAPHY.bodySmall,
  },
});
